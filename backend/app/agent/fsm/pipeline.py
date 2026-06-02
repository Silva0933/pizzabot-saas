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

    # Controle de falhas consecutivas de NLU (confiança < 0.5)
    confianca = res_nlu.get("confianca", 1.0)
    if confianca < 0.5:
        estado["nlu_falhas_consecutivas"] = estado.get("nlu_falhas_consecutivas", 0) + 1
    else:
        estado["nlu_falhas_consecutivas"] = 0

    if estado.get("nlu_falhas_consecutivas", 0) >= 3:
        log.warning("FSM escalando por falhas consecutivas de NLU (confianca baixa repetida) para pizzaria=%s tel=%s", pizzaria_id, telefone)
        from app.agent.tools import escalar_humano
        await escalar_humano(ctx, db, motivo_escalonamento="IA não compreendeu o cliente por 3 vezes consecutivas (confiança NLU muito baixa)")
        
        msg_transicao = "Vou chamar um de nossos atendentes para finalizar o seu pedido. Só um instantinho que já vão te responder! 😊"
        await save_state(db, pizzaria_id, telefone, estado)
        await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)
        await append_turn(db, pizzaria_id, telefone, role="assistant", content=msg_transicao)
        await db.commit()
        return AgentResult(
            texto=msg_transicao, iteracoes=1,
            tool_calls=["fsm:escalado:nlu_falhas"],
            precos_tool=set(),
        )

    # Rede de segurança: baixa confiança em algo que não seja pedido → agente legado.
    if res_nlu["confianca"] < CONFIANCA_MINIMA and res_nlu["intencao"] in ("duvida_geral",):
        log.info("FSM fallback p/ legado (confianca=%.2f)", res_nlu["confianca"])
        return None

    # 2) Engine (decisão determinística)
    out = await engine.processar(db, ctx, estado, res_nlu, user_input=user_input)
    estado = out["estado"]
    decisao = out["decisao"]

    # Incrementa ou reseta contador de pendências
    if decisao.get("acao") == "pendencia":
        estado["pendencias_consecutivas"] = estado.get("pendencias_consecutivas", 0) + 1
    else:
        estado["pendencias_consecutivas"] = 0

    if estado.get("pendencias_consecutivas", 0) >= 3:
        log.warning("FSM escalando por pendências consecutivas acumuladas para pizzaria=%s tel=%s", pizzaria_id, telefone)
        from app.agent.tools import escalar_humano
        
        erro_pendencia = "Falta de dados/erro no pedido"
        for fato in decisao.get("fatos", []):
            if "precisa resolver" in fato or "erro" in fato:
                erro_pendencia = fato
        
        await escalar_humano(ctx, db, motivo_escalonamento=f"Cliente travou em pendências por 3 vezes consecutivas ({erro_pendencia})")
        
        msg_transicao = "Vou chamar um de nossos atendentes para finalizar o seu pedido. Só um instantinho que já vão te responder! 😊"
        await save_state(db, pizzaria_id, telefone, estado)
        await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)
        await append_turn(db, pizzaria_id, telefone, role="assistant", content=msg_transicao)
        await db.commit()
        return AgentResult(
            texto=msg_transicao, iteracoes=1,
            tool_calls=["fsm:escalado:pendencias_limite"],
            precos_tool=set(),
        )

    # 3) Voz
    ja_apresentou = bool(estado.get("apresentou")) and decisao.get("acao") != "saudacao"
    voz_usage: dict = {}
    msg_pronta = decisao.get("mensagem_pronta")
    if msg_pronta:
        # BLINDAGEM (Pilar 2): mensagens CRÍTICAS (resumo/fechamento) vêm prontas do
        # backend — não passam pela LLM, então os valores nunca divergem. Economiza
        # tokens e elimina alucinação de preço de uma vez.
        texto = str(msg_pronta)
    else:
        comando = voice.montar_comando(
            personalidade=ctx.personalidade,
            pizzaria_nome=ctx.pizzaria.nome,
            decisao=decisao,
            ja_apresentou=ja_apresentou,
            user_input=user_input,
        )
        texto, voz_usage = await voice.gerar_voz(provider=provider, api_key=api_key, model=model, comando=comando)
        if not texto:
            texto = "Pode repetir, por favor? 😊"
        # BLINDAGEM (Pilar 3): guard-rail determinístico sobre o texto da LLM —
        # remove saudação repetida e neutraliza qualquer preço sem lastro.
        try:
            from app.agent.fsm.guard import blindar
            texto, correcoes = blindar(
                texto, ja_apresentou=ja_apresentou,
                precos_validos=decisao.get("precos_validos") or [],
            )
            if correcoes.get("precos_neutralizados"):
                # Pilar 5: preço inventado é sinal grave → alerta no painel.
                from app.services.alertas import registrar_alerta
                await registrar_alerta(
                    db, tipo="preco_suspeito", pizzaria_id=pizzaria_id, nivel="warning",
                    detalhe=(
                        f"IA citou preço sem lastro {correcoes['precos_neutralizados']} "
                        f"(válidos: {decisao.get('precos_validos')}); neutralizado. "
                        f"Acao={decisao.get('acao')} input='{user_input[:80]}'"
                    ),
                )
        except Exception as e:  # noqa: BLE001
            log.debug("Guard FSM falhou (texto segue como veio): %s", e)
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
    # Passa os preços VÁLIDOS calculados pelo FSM pro validador do runner (C4),
    # senão ele acha que "Preços vindos das tools: []" e marca todo valor legítimo
    # como suspeito (falso-positivo). Como o resumo verbatim mostra exatamente
    # esses valores, o C4 do runner não dispara mais à toa.
    precos_validos = {
        round(float(v), 2) for v in (decisao.get("precos_validos") or [])
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    return AgentResult(
        texto=texto, iteracoes=1,
        tool_calls=[f"fsm:{decisao.get('acao')}:{res_nlu.get('intencao')}"],
        precos_tool=precos_validos,
    )
