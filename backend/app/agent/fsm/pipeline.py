"""
Orquestrador do pipeline FSM: NLU → Engine → Voz.

Retorna um AgentResult (compatível com o runner antigo) OU None para indicar
'fallback' ao agente legado (rede de segurança quando a NLU não tem confiança).
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

CONFIANCA_MINIMA = 0.6
QUEBRA = "[QUEBRA]"


async def run_fsm_agent(db: AsyncSession, pizzaria_id: uuid.UUID, telefone: str, user_input: str):
    """Roda o pipeline FSM. Retorna AgentResult ou None (fallback p/ agente legado)."""
    from app.agent.context import load_context
    from app.agent.fsm import engine, nlu, voice
    from app.agent.memory import append_turn, load_history_messages
    from app.agent.runner import AgentResult
    from app.services.app_config import get_llm_config, modelo_para_plano
    from app.services.conversation_state import load_state, save_state

    ctx = await load_context(db, pizzaria_id, telefone)

    cfg = await get_llm_config(db)
    provider = cfg["provider"]
    api_key = cfg["keys"].get(provider) or ""
    model = modelo_para_plano(cfg, getattr(ctx.pizzaria, "plano", None))
    if provider not in ("openai", "openrouter", "gemini") or not api_key:
        # FSM atual roda no caminho OpenAI-compatível (NLU/voz via chat). Sem isso, fallback.
        return None

    # Estado (carrinho/etapa). Se não for FSM ainda, inicia.
    estado = await load_state(db, pizzaria_id, telefone)
    if not isinstance(estado, dict) or estado.get("pipeline") != "fsm":
        estado = engine.estado_inicial()

    # Histórico enxuto (texto puro) p/ a NLU interpretar "sim", "grande", etc.
    msgs = await load_history_messages(db, pizzaria_id, telefone)
    hist_txt = "\n".join(f"{m['role']}: {m['content']}" for m in msgs[-6:])

    # 1) NLU
    res_nlu = await nlu.nlu_extract(
        provider=provider, api_key=api_key, model=model,
        estado_resumo=engine.resumo_estado(estado),
        historico_texto=hist_txt,
        user_input=user_input,
    )

    # Rede de segurança: baixa confiança em algo que não seja pedido → agente legado.
    if res_nlu["confianca"] < CONFIANCA_MINIMA and res_nlu["intencao"] in ("duvida_geral",):
        log.info("FSM fallback p/ legado (confianca=%.2f)", res_nlu["confianca"])
        return None

    # 2) Engine (decisão determinística)
    out = await engine.processar(db, ctx, estado, res_nlu, user_input=user_input)
    estado = out["estado"]
    decisao = out["decisao"]

    # 3) Voz
    comando = voice.montar_comando(
        personalidade=ctx.personalidade,
        pizzaria_nome=ctx.pizzaria.nome,
        decisao=decisao,
        ja_apresentou=bool(estado.get("apresentou")) and decisao.get("acao") != "saudacao",
        user_input=user_input,
    )
    texto, voz_usage = await voice.gerar_voz(provider=provider, api_key=api_key, model=model, comando=comando)
    if not texto:
        texto = "Pode repetir, por favor? 😊"
    texto = texto.replace(QUEBRA, "\n\n")

    # Registra uso/custo (NLU + voz) — alimenta o limite por plano (C2) e o
    # dashboard de custo (C3), igual ao agente legado.
    try:
        from app.services.app_config import record_usage
        nlu_usage = res_nlu.get("_usage") or {}
        pt = int(nlu_usage.get("prompt_tokens", 0)) + int(voz_usage.get("prompt_tokens", 0))
        ct = int(nlu_usage.get("completion_tokens", 0)) + int(voz_usage.get("completion_tokens", 0))
        tt = int(nlu_usage.get("total_tokens", 0)) + int(voz_usage.get("total_tokens", 0))
        await record_usage(
            db, pizzaria_id=pizzaria_id, provider=provider, model=model,
            prompt_tokens=pt, completion_tokens=ct, total_tokens=tt or (pt + ct), calls=2,
        )
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao registrar uso FSM: %s", e)

    # Persiste estado + memória (turno user/assistant) para o histórico da NLU.
    try:
        await save_state(db, pizzaria_id, telefone, estado)
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao salvar estado FSM: %s", e)
    try:
        await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)
        await append_turn(db, pizzaria_id, telefone, role="assistant", content=texto)
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao salvar memória FSM: %s", e)

    await db.commit()
    return AgentResult(
        texto=texto, iteracoes=1,
        tool_calls=[f"fsm:{decisao.get('acao')}:{res_nlu.get('intencao')}"],
    )
