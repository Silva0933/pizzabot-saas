"""
Orquestrador do pipeline FSM: NLU → Engine → Voz.

Retorna um AgentResult (compatível com o runner antigo) OU None para indicar
'fallback' ao agente legado (rede de segurança quando a NLU não tem confiança).
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

CONFIANCA_MINIMA = 0.6
QUEBRA = "[QUEBRA]"

# Sinais de que o cliente está enviando o comprovante do Pix manual.
_COMPROVANTE_KW = re.compile(
    r"(paguei|pagei|comprovante|fiz o pix|ja paguei|já paguei|ta pago|tá pago|"
    r"transferi|segue o|comprov|pagamento feito|acabei de pagar)",
    re.IGNORECASE,
)


def _parece_comprovante(user_input: str) -> bool:
    """True se a mensagem é (provavelmente) o comprovante: imagem ou frase de 'paguei'."""
    t = (user_input or "").lower()
    if "[imagem]" in t:
        return True
    return bool(_COMPROVANTE_KW.search(t))


# ============================================
# NLU determinística (curto-circuito sem LLM)
# ============================================
# Mensagens triviais e inequívocas ("sim", "não", "oi") não precisam de LLM:
# sintetizamos o MESMO formato de saída da NLU com custo zero. Só disparamos
# quando a mensagem é PURA (nada além da confirmação/recusa/saudação) — qualquer
# conteúdo extra ("sim, mas sem cebola") segue para a NLU LLM normal.
_PONTUACAO_FINAL_RE = re.compile(r"[\s!.,…~?]+$")

# Saudação pura no início da conversa (sem pedido junto).
_SAUDACAO_PURA_RE = re.compile(
    r"^\s*(oi+|ol[aá]+|opa|eae|eai|e a[ií]|al[oô]|bom dia|boa tarde|boa noite)$",
    re.IGNORECASE,
)
# Recusa pura ao upsell ("não", "nada não", "não quero, obrigado").
_RECUSA_PURA_RE = re.compile(
    r"^\s*(n[aã]o|nada)(\s+n[aã]o)?(\s+quero|\s+precisa)?([,\s]+(obrigad[oa]u?|valeu|brigad[oa]))?$",
    re.IGNORECASE,
)


# Localização enviada pelo WhatsApp (formatada pelo webhook em
# "[localizacao lat=... lon=...]"): vira endereço via reverse geocoding,
# sem LLM. Mandar a localização implica entrega (delivery).
_LOCALIZACAO_RE = re.compile(
    r"\[localizacao lat=(-?\d+(?:\.\d+)?) lon=(-?\d+(?:\.\d+)?)\]"
)


def _usage_zero() -> dict[str, int]:
    return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


async def _nlu_localizacao(user_input: str) -> dict[str, Any] | None:
    """
    Se a mensagem contém uma localização do WhatsApp, converte em
    'informar_endereco' com o endereço resolvido por reverse geocoding.
    Sem número da casa (comum no GPS), marca _localizacao_sem_numero para o
    engine confirmar e pedir só o número. Falhou o geocoding → None (NLU LLM).
    """
    m = _LOCALIZACAO_RE.search(user_input or "")
    if not m:
        return None
    try:
        lat, lon = float(m.group(1)), float(m.group(2))
    except ValueError:
        return None

    from app.services.geocoding import reverse_geocode
    geo = await reverse_geocode(lat, lon)
    if not geo.get("ok"):
        log.info("Localização recebida mas reverse geocoding falhou (lat=%s lon=%s)", lat, lon)
        return None

    dados: dict[str, Any] = {
        "tipo_entrega": "delivery",
        "endereco": {
            "rua": geo.get("rua"),
            "numero": geo.get("numero"),
            "bairro": geo.get("bairro"),
            "referencia": "localização enviada pelo WhatsApp",
        },
    }
    if not geo.get("numero"):
        dados["_localizacao_sem_numero"] = True
    log.info(
        "Localização convertida em endereço (sem LLM): %s, %s — numero=%s",
        geo.get("rua"), geo.get("bairro"), geo.get("numero") or "(pendente)",
    )
    return {
        "intencao": "informar_endereco", "confianca": 1.0, "dados": dados,
        "_usage": _usage_zero(), "_deterministica": True,
    }


def _nlu_deterministica(user_input: str, estado: dict[str, Any]) -> dict[str, Any] | None:
    """
    Resolve sem LLM os casos inequívocos. Retorna o MESMO formato do nlu_extract
    (intencao/confianca/dados/_usage) ou None para seguir à NLU normal.
    As intenções espelham o que a NLU real produziria; os regex de confirmação/
    aceite vêm do próprio engine (mesmas regras → mesmo comportamento).

    A "pureza" é checada com fullmatch sobre o texto SEM a pontuação final:
    o padrão precisa consumir a mensagem inteira ("sim!" passa; "sim, mas sem
    cebola" não) — com fullmatch o backtracking encontra a alternativa mais
    longa ("pode fechar"), o que o .match() comum não garante.
    """
    from app.agent.fsm.engine import _ACEITA_UPSELL_RE, _CONFIRMA_RE

    t = (user_input or "").strip()
    if not t or len(t) > 30:
        return None
    tl = _PONTUACAO_FINAL_RE.sub("", t.lower())
    if not tl:
        return None

    def _res(intencao: str, dados: dict[str, Any] | None = None) -> dict[str, Any]:
        log.info("NLU determinística (sem LLM): '%s' → %s", t[:30], intencao)
        return {
            "intencao": intencao, "confianca": 1.0, "dados": dados or {},
            "_usage": _usage_zero(),
            "_deterministica": True,
        }

    # 1) Confirmação pura do resumo ("sim", "pode fechar", "fechado").
    if estado.get("etapa") == "AGUARDANDO_CONFIRMACAO" and _CONFIRMA_RE.fullmatch(tl):
        return _res("confirmar_resumo")

    # 2) Resposta pura ao upsell: recusa ("não, obrigado") ou aceite ("quero").
    if estado.get("aguardando_upsell"):
        if _RECUSA_PURA_RE.fullmatch(tl):
            # O engine decide pela recusa via texto (_afirmou_upsell); a intenção
            # neutra só precisa não desviar o fluxo antes do handler de upsell.
            return _res("conversa_fiada")
        if _ACEITA_UPSELL_RE.fullmatch(tl):
            return _res("confirmar_resumo")

    # 3) Saudação pura na abertura da conversa (carrinho vazio).
    if not estado.get("carrinho") and not estado.get("apresentou") and _SAUDACAO_PURA_RE.fullmatch(tl):
        return _res("saudacao")

    # 4) Número da casa após a localização do WhatsApp ("123", "nº 123 apto 4").
    if estado.get("aguardando_numero"):
        m = re.fullmatch(r"(?:n[ºo°.]?\s*)?(\d{1,6})(?:[,\s]+(.{1,40}))?", tl)
        if m:
            end: dict[str, Any] = {"numero": m.group(1)}
            if m.group(2):
                end["referencia"] = m.group(2).strip()
            return _res("informar_endereco", {"endereco": end})

    return None


async def _checar_comprovante_manual(db: AsyncSession, ctx, telefone: str, user_input: str):
    """Pix manual: se há um pedido aguardando conferência ('em_analise') e o cliente
    mandou o comprovante (imagem/'paguei'), dá um ack, notifica o painel e RETORNA —
    sem rodar o funil, pra a LLM não reabrir o pedido. Aditivo: só atua nesse caso."""
    from app.agent.memory import append_turn
    from app.agent.runner import AgentResult
    from app.agent.tools import _notificar_painel_pagamento_manual
    from app.models import Pedido

    if not _parece_comprovante(user_input) or not ctx.cliente:
        return None

    ped = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == ctx.cliente.id,
            Pedido.payment_status == "em_analise",
            Pedido.status.in_(["novo", "confirmado", "no_forno"]),
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()
    if not ped:
        return None

    await _notificar_painel_pagamento_manual(
        db, ctx.pizzaria.id, ped, telefone,
        evento="pagamento.comprovante",
        texto_sistema=(
            f"📎 Comprovante recebido do cliente (pedido #{ped.numero_pedido}) — "
            "confira e confirme o pagamento."
        ),
    )

    msg = "Recebi! 🙏 Vou conferir com a equipe e já te confirmo, tá?"
    try:
        await append_turn(db, ctx.pizzaria.id, telefone, role="user", content=user_input)
        await append_turn(db, ctx.pizzaria.id, telefone, role="assistant", content=msg)
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao salvar memória (comprovante): %s", e)
    await db.commit()
    return AgentResult(
        texto=msg, iteracoes=1, tool_calls=["fsm:comprovante_recebido"], precos_tool=set(),
    )


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

    # Pix manual: comprovante de um pedido aguardando conferência tem prioridade —
    # responde, notifica o painel e NÃO roda o funil (a LLM não reabre o pedido).
    res_comprovante = await _checar_comprovante_manual(db, ctx, telefone, user_input)
    if res_comprovante is not None:
        return res_comprovante

    # Estado (carrinho/etapa). Se não for FSM ainda, inicia.
    estado = await load_state(db, pizzaria_id, telefone)
    if not isinstance(estado, dict) or estado.get("pipeline") != "fsm":
        estado = engine.estado_inicial()

    # Histórico enxuto (texto puro) p/ a NLU interpretar "sim", "grande", etc.
    msgs = await load_history_messages(db, pizzaria_id, telefone)
    hist_txt = "\n".join(f"{m['role']}: {m['content']}" for m in msgs[-6:])

    # 1) NLU — primeiro o curto-circuito determinístico (mensagens triviais não
    # gastam LLM); senão, a NLU LLM com modelo barato dedicado (nlu_model) e
    # failover para o provedor reserva.
    from app.agent.failover import com_failover

    estado_resumo = engine.resumo_estado(estado)
    nlu_model = (cfg.get("nlu_model") or "").strip() or model

    res_nlu = await _nlu_localizacao(user_input)
    if res_nlu is None:
        res_nlu = _nlu_deterministica(user_input, estado)
    nlu_provider_usado, nlu_model_usado = provider, nlu_model
    if res_nlu is None:
        async def _nlu(prov: str, key: str, mdl: str):
            return await nlu.nlu_extract(
                provider=prov, api_key=key, model=mdl,
                estado_resumo=estado_resumo,
                historico_texto=hist_txt,
                user_input=user_input,
            )

        res_nlu, nlu_provider_usado, nlu_model_usado = await com_failover(
            _nlu, cfg=cfg, model=nlu_model
        )
    provider_usado, model_usado = provider, model

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
        async def _voz(prov: str, key: str, mdl: str):
            return await voice.gerar_voz(provider=prov, api_key=key, model=mdl, comando=comando)

        (texto, voz_usage), provider_usado, model_usado = await com_failover(_voz, cfg=cfg, model=model)
        if not texto:
            texto = "Pode repetir, por favor? 😊"
        # BLINDAGEM (Pilar 3): guard-rail determinístico sobre o texto da LLM —
        # remove saudação repetida e neutraliza qualquer preço sem lastro.
        try:
            from app.agent.fsm.guard import blindar
            texto, correcoes = blindar(
                texto, ja_apresentou=ja_apresentou,
                precos_validos=decisao.get("precos_validos") or [],
                persona_nome=getattr(ctx.personalidade, "nome", None) or "Camila",
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

    # Registra uso/custo — alimenta o limite por plano (C2) e o dashboard de
    # custo (C3). NLU e voz são registradas separadas (modelos podem diferir);
    # o curto-circuito determinístico não registra (custo zero).
    try:
        from app.services.app_config import record_usage
        nlu_usage = res_nlu.get("_usage") or {}
        if not res_nlu.get("_deterministica"):
            await record_usage(
                db, pizzaria_id=pizzaria_id,
                provider=nlu_provider_usado, model=nlu_model_usado,
                prompt_tokens=int(nlu_usage.get("prompt_tokens", 0)),
                completion_tokens=int(nlu_usage.get("completion_tokens", 0)),
                total_tokens=int(nlu_usage.get("total_tokens", 0)), calls=1,
            )
        if any(voz_usage.values()):
            await record_usage(
                db, pizzaria_id=pizzaria_id, provider=provider_usado, model=model_usado,
                prompt_tokens=int(voz_usage.get("prompt_tokens", 0)),
                completion_tokens=int(voz_usage.get("completion_tokens", 0)),
                total_tokens=int(voz_usage.get("total_tokens", 0)), calls=1,
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
