"""
Loop principal do agente.

Recebe (pizzaria_id, telefone, user_input) → roda Gemini com tools → devolve resposta final.
Salva memória, envia mensagem pelo Evolution, broadcast WS.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import load_context
from app.agent.llm import (
    call_gemini,
    extract_function_calls,
    extract_text,
    to_content,
)
from app.agent.memory import append_turn, load_history, load_history_messages
from app.agent.prompt import build_system_prompt
from app.agent.providers import openai_chat, openai_tools
from app.agent.tools import execute_tool, get_tools
from app.services.price_check import coletar_precos_tool, precos_sem_lastro
from app.models import Conversa, Mensagem
from app.services.app_config import get_llm_config, record_usage
from app.services.broadcaster import broadcaster
from app.services.customer_memory import prompt_summary
from app.services.evolution import evolution
from app.services.humanized_delivery import send_humanized_text
from app.services.response_guard import guard_response

log = logging.getLogger(__name__)

# Limite de iterações no loop (evita custo absurdo se o modelo gira em torno de tools)
MAX_AGENT_ITERATIONS = 6

# Tetos de tempo do processamento (segundos). Precisam somar abaixo do TTL do lock
# de flush (ver FLUSH_LOCK_TTL em workers/tasks.py), senão dois workers poderiam
# processar a MESMA conversa em paralelo e mandar respostas duplicadas.
#   pior caso = FSM_TIMEOUT_SECONDS (FSM) + LEGACY_TIMEOUT_SECONDS (fallback legado)
FSM_TIMEOUT_SECONDS = 15.0
LEGACY_TIMEOUT_SECONDS = 40.0


class AgentResult:
    def __init__(self, *, texto: str | None, iteracoes: int, tool_calls: list[str],
                 precos_tool: set[float] | None = None):
        self.texto = texto
        self.iteracoes = iteracoes
        self.tool_calls = tool_calls
        # Preços que vieram das tools nesta rodada (pra validar o texto final).
        self.precos_tool = precos_tool or set()


async def run_agent(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    user_input: str,
    max_iterations: int | None = None,
) -> AgentResult:
    """Roda uma rodada completa do agente para uma entrada do cliente."""
    ctx = await load_context(db, pizzaria_id, telefone)
    system = build_system_prompt(
        ctx.pizzaria,
        ctx.personalidade,
        cliente_nome=ctx.cliente_nome,
        cliente_total_pedidos=ctx.cliente_total_pedidos,
        cliente_ultimo_pedido=ctx.ultimo_pedido_resumo,
        cliente_preferencias=prompt_summary(
            ctx.cliente.memoria_resumo if ctx.cliente else None,
            ctx.cliente.preferencias if ctx.cliente else None,
        ),
        estado_atendimento=ctx.estado_atendimento,
    )

    max_iter = max_iterations or MAX_AGENT_ITERATIONS

    # Provider de LLM configurado pelo admin (gemini | openai | openrouter)
    cfg = await get_llm_config(db)
    # Custo por plano: usa o modelo definido para o plano da pizzaria (se houver).
    from app.services.app_config import modelo_para_plano
    cfg = {**cfg, "model": modelo_para_plano(cfg, getattr(ctx.pizzaria, "plano", None))}
    provider = cfg["provider"]
    if provider in ("openai", "openrouter") and cfg["keys"].get(provider):
        return await _run_openai_agent(
            db, pizzaria_id, telefone, user_input, ctx=ctx, system=system, cfg=cfg, max_iterations=max_iter,
        )

    history = await load_history(db, pizzaria_id, telefone)
    # Acrescenta a entrada atual
    history.append(to_content("user", text=user_input))

    # Persiste a entrada na memória
    await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)

    tools = get_tools()
    tool_calls_made: list[str] = []
    precos_tool: set[float] = set()
    final_text: str | None = None

    gemini_key = cfg["keys"].get("gemini") or None
    gemini_model = cfg["model"] if provider == "gemini" else "gemini-2.0-flash"
    usage_acc = {"prompt": 0, "completion": 0, "total": 0}
    for iteration in range(1, max_iter + 1):
        log.info("Agente iter=%d pizzaria=%s tel=%s", iteration, pizzaria_id, telefone)
        response = await call_gemini(
            system=system, history=history, tools=tools,
            model=gemini_model, api_key=gemini_key,
        )
        um = getattr(response, "usage_metadata", None)
        if um:
            usage_acc["prompt"] += getattr(um, "prompt_token_count", 0) or 0
            usage_acc["completion"] += getattr(um, "candidates_token_count", 0) or 0
            usage_acc["total"] += getattr(um, "total_token_count", 0) or 0

        fcs = extract_function_calls(response)
        if fcs:
            # Modelo pediu tools — executa e itera
            history.append(response.candidates[0].content)
            for fc in fcs:
                tool_calls_made.append(fc["name"])
                result = await execute_tool(
                    fc["name"], fc["args"], ctx=ctx, db=db,
                )
                precos_tool |= coletar_precos_tool(result)
                await append_turn(
                    db, pizzaria_id, telefone,
                    role="assistant", tool_calls=[fc],
                )
                await append_turn(
                    db, pizzaria_id, telefone,
                    role="tool", content=__import__("json").dumps(result, default=str),
                    tool_call_id=fc["name"],
                )
                history.append(to_content("function", function_response={
                    "name": fc["name"], "response": result,
                }))
            continue

        # Sem tool calls → resposta final em texto
        final_text = extract_text(response)
        if final_text:
            await append_turn(db, pizzaria_id, telefone, role="assistant", content=final_text)
        break

    # Rede de segurança: nunca deixar o cliente no vácuo.
    if not final_text:
        if "enviar_cardapio_arquivo" in tool_calls_made:
            final_text = "Te mandei o cardápio aí em cima! 👆"
        elif not tool_calls_made:
            final_text = "Desculpa, não entendi 😅 Pode repetir, por favor?"
        
        if final_text:
            await append_turn(db, pizzaria_id, telefone, role="assistant", content=final_text)

    await record_usage(
        db, pizzaria_id=pizzaria_id, provider="gemini", model=gemini_model,
        prompt_tokens=usage_acc["prompt"], completion_tokens=usage_acc["completion"],
        total_tokens=usage_acc["total"], calls=iteration,
    )
    await db.commit()
    return AgentResult(texto=final_text, iteracoes=iteration, tool_calls=tool_calls_made, precos_tool=precos_tool)


async def _run_openai_agent(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    user_input: str,
    *,
    ctx: Any,
    system: str,
    cfg: dict,
    max_iterations: int | None = None,
) -> AgentResult:
    """Loop do agente usando provider OpenAI-compatível (OpenAI/OpenRouter)."""
    import json as _json

    provider = cfg["provider"]
    api_key = cfg["keys"][provider]
    model = cfg["model"]
    tools = openai_tools()

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    messages += await load_history_messages(db, pizzaria_id, telefone)
    messages.append({"role": "user", "content": user_input})

    await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)

    max_iter = max_iterations or MAX_AGENT_ITERATIONS
    tool_calls_made: list[str] = []
    precos_tool: set[float] = set()
    final_text: str | None = None
    iteration = 0
    usage_acc = {"prompt": 0, "completion": 0, "total": 0}

    for iteration in range(1, max_iter + 1):
        log.info("Agente(%s) iter=%d pizzaria=%s", provider, iteration, pizzaria_id)
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=messages, tools=tools,
        )
        # Modelos leves (flash-lite) às vezes devolvem resposta vazia.
        # Uma nova tentativa costuma resolver antes de desistir.
        if not (res.get("tool_calls") or (res.get("content") or "").strip()):
            res = await openai_chat(
                provider=provider, api_key=api_key, model=model,
                messages=messages, tools=tools, temperature=0.4,
            )
        u = res.get("usage") or {}
        usage_acc["prompt"] += u.get("prompt_tokens", 0) or 0
        usage_acc["completion"] += u.get("completion_tokens", 0) or 0
        usage_acc["total"] += u.get("total_tokens", 0) or 0
        calls = res.get("tool_calls") or []
        if calls:
            messages.append({
                "role": "assistant",
                "content": res.get("content"),
                "tool_calls": [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["name"], "arguments": _json.dumps(c["args"])}}
                    for c in calls
                ],
            })
            for c in calls:
                tool_calls_made.append(c["name"])
                result = await execute_tool(c["name"], c["args"], ctx=ctx, db=db)
                precos_tool |= coletar_precos_tool(result)
                await append_turn(db, pizzaria_id, telefone, role="assistant", tool_calls=[{"name": c["name"], "args": c["args"]}])
                await append_turn(db, pizzaria_id, telefone, role="tool", content=_json.dumps(result, default=str), tool_call_id=c["name"])
                messages.append({
                    "role": "tool",
                    "tool_call_id": c["id"],
                    "content": _json.dumps(result, default=str),
                })
            continue

        final_text = (res.get("content") or "").strip() or None
        if final_text:
            await append_turn(db, pizzaria_id, telefone, role="assistant", content=final_text)
        break

    # Rede de segurança: nunca deixar o cliente no vácuo.
    if not final_text:
        if "enviar_cardapio_arquivo" in tool_calls_made:
            final_text = "Te mandei o cardápio aí em cima! 👆"
        elif not tool_calls_made:
            final_text = "Desculpa, não entendi 😅 Pode repetir, por favor?"
        
        if final_text:
            await append_turn(db, pizzaria_id, telefone, role="assistant", content=final_text)

    await record_usage(
        db, pizzaria_id=pizzaria_id, provider=provider, model=model,
        prompt_tokens=usage_acc["prompt"], completion_tokens=usage_acc["completion"],
        total_tokens=usage_acc["total"], calls=iteration,
    )
    await db.commit()
    return AgentResult(texto=final_text, iteracoes=iteration, tool_calls=tool_calls_made, precos_tool=precos_tool)


async def process_and_reply(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    user_input: str,
) -> dict[str, Any]:
    """
    End-to-end: roda agente, manda mensagem pelo WhatsApp, persiste e broadcast.

    Esta função é chamada pelo worker Celery.
    """
    # Carrega conversa e pizzaria
    from sqlalchemy import select
    from app.models import Pizzaria

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizzaria_id,
                Conversa.cliente_telefone == telefone,
            )
        )
    ).scalar_one_or_none()

    # ---- Re-checagem de "bot ligado" (race humano × bot) ----
    # O webhook só enfileira se o bot estava ativo, mas entre o enqueue e este
    # flush passam segundos de debounce (7–45s). Nesse intervalo um atendente pode
    # ter ASSUMIDO a conversa (bot_ativo=False), o admin pode ter desligado o bot
    # global, ou a pizzaria pode ter sido suspensa. Revalidamos aqui, senão o bot
    # responderia por cima do humano.
    if getattr(pizz, "suspensa", False):
        log.info("Pizzaria %s suspensa no flush — não respondendo", pizzaria_id)
        return {"ok": False, "motivo": "pizzaria_suspensa"}
    if not getattr(pizz, "bot_ativo_global", True):
        log.info("Bot global desligado no flush para pizzaria %s — não respondendo", pizzaria_id)
        return {"ok": False, "motivo": "bot_global_desligado"}
    if conv is not None and not getattr(conv, "bot_ativo", True):
        log.info(
            "Conversa assumida por humano durante o debounce (pizzaria=%s tel=%s) — bot não responde",
            pizzaria_id, telefone,
        )
        return {"ok": False, "motivo": "humano_assumiu"}

    # ---- Cota de ATENDIMENTOS do plano (C2) ----
    # Limite por conversa/cliente no mês (não por mensagem). Conversas JÁ em
    # andamento neste mês continuam (não cortamos um pedido no meio); só conversas
    # NOVAS além da cota são bloqueadas. Cliente bloqueado não recebe resposta
    # automática — o painel sinaliza pro dono assumir manualmente se quiser.
    try:
        from app.services.app_config import conversa_ja_atendida_mes, conversas_atendidas_mes
        from app.services.plans import plan_info
        limite = int((plan_info(pizz.plano).get("limites") or {}).get("conversas_mes") or 0)
        if limite > 0:
            ja_atendida = bool(conv) and await conversa_ja_atendida_mes(db, pizzaria_id, conv.id)
            if not ja_atendida:
                usados = await conversas_atendidas_mes(db, pizzaria_id)
                if usados >= limite:
                    log.warning(
                        "Cota de atendimentos atingida: pizzaria=%s (%s/%s) — nova conversa bloqueada",
                        pizzaria_id, usados, limite,
                    )
                    await broadcaster.publish(
                        pizzaria_id,
                        {
                            "tipo": "limite.ia",
                            "pizzaria_id": str(pizzaria_id),
                            "payload": {"usados": usados, "limite": limite, "telefone": telefone},
                        },
                    )
                    return {"ok": False, "motivo": "limite_conversas_atingido", "usados": usados, "limite": limite}
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao checar cota de atendimentos: %s", e)

    # ---- Envia indicador de "digitando" ANTES de processar ----
    try:
        if conv:
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "bot.digitando",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "telefone": telefone,
                        "acao": "digitando",
                    },
                },
            )
        if pizz.instancia:
            await evolution.send_presence(
                instancia=pizz.instancia,
                numero=telefone,
                tipo="composing",
                delay_ms=2500,
            )
    except Exception as e:
        log.debug("Falha ao enviar indicador de digitando: %s", e)

    # ---- Roda o agente IA (pipeline FSM se a pizzaria estiver com a flag) ----
    import asyncio
    try:
        result = None
        fallback_iterations = None
        if getattr(pizz, "pipeline_fsm", False):
            try:
                from app.agent.fsm.pipeline import run_fsm_agent
                result = await asyncio.wait_for(
                    run_fsm_agent(db, pizzaria_id, telefone, user_input),
                    timeout=FSM_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                log.warning(
                    "Pipeline FSM estourou o timeout de %.0fs, caindo p/ agente legado com limites reduzidos",
                    FSM_TIMEOUT_SECONDS,
                )
                result = None
                fallback_iterations = 3
            except Exception as e_fsm:  # noqa: BLE001
                log.exception("Pipeline FSM falhou, caindo p/ agente legado: %s", e_fsm)
                result = None
                fallback_iterations = 3
        if result is None:  # flag off OU fallback do FSM
            # Teto de tempo no agente legado também: sem isso uma única chamada de
            # LLM lenta (timeout HTTP de 60s) já estouraria o lock de flush e
            # abriria brecha pra resposta duplicada por outro worker.
            result = await asyncio.wait_for(
                run_agent(db, pizzaria_id, telefone, user_input, max_iterations=fallback_iterations),
                timeout=LEGACY_TIMEOUT_SECONDS,
            )
    except Exception as e:
        import traceback
        tb = traceback.format_exc()

        # Limpa qualquer transação parcial/abortada antes de gravar o aviso de
        # sistema (o agente pode ter falhado no meio de um commit).
        try:
            await db.rollback()
        except Exception as e_rb:  # noqa: BLE001
            log.debug("Falha no rollback pós-erro do agente: %s", e_rb)
        
        # Carrega o estado FSM atual para enriquecer os logs e a mensagem interna
        estado_desc = "Desconhecido"
        carrinho_desc = "Vazio"
        try:
            from app.services.conversation_state import load_state
            estado = await load_state(db, pizzaria_id, telefone)
            if isinstance(estado, dict):
                estado_desc = estado.get("etapa") or "Desconhecido"
                carrinho = estado.get("carrinho") or []
                carrinho_desc = "; ".join(
                    f"{i.get('qtd', 1)}x {i.get('nome') or ' / '.join(i.get('sabores') or [])}"
                    + (f" ({i.get('tamanho')})" if i.get("tamanho") else "")
                    for i in carrinho
                ) or "Vazio"
        except Exception as e_state:
            log.warning("Falha ao recuperar estado para logs em runner: %s", e_state)

        # Log estruturado rico no console
        log.error(
            "--- FALHA CRITICA NO AGENTE IA ---\n"
            "Pizzaria ID: %s | Pizzaria Nome: %s\n"
            "Cliente: %s (%s)\n"
            "Etapa FSM: %s | Carrinho: %s\n"
            "Input do Cliente: %s\n"
            "Erro: %s: %s\n"
            "Stack Trace:\n%s"
            "----------------------------------",
            pizzaria_id, getattr(pizz, "nome", "Desconhecida"),
            conv.cliente_nome if conv else "Desconhecido", telefone,
            estado_desc, carrinho_desc,
            user_input,
            type(e).__name__, str(e),
            tb
        )

        try:
            from app.services.alertas import registrar_alerta_seguro
            await registrar_alerta_seguro(
                tipo="falha_ia", pizzaria_id=pizzaria_id, nivel="error",
                detalhe=f"Falha no agente: {type(e).__name__} ({estado_desc}) - {e}"
            )
        except Exception:  # noqa: BLE001
            pass

        # Mensagem simpática e transparente pro cliente final (WhatsApp)
        msg_fallback = (
            "Vou chamar um de nossos atendentes para finalizar o seu pedido. "
            "Só um instantinho que já vão te responder! 😊"
        )
        try:
            if pizz.instancia:
                await evolution.send_text(
                    instancia=pizz.instancia,
                    numero=telefone,
                    texto=msg_fallback,
                )
        except Exception as e_send:
            log.warning("Falha ao enviar mensagem de fallback de erro: %s", e_send)

        # Salva a mensagem no histórico (origem="sistema") e desliga o bot
        if conv:
            conteudo_sistema = (
                f"⚠️ Falha técnica no processamento (IA)\n"
                f"Erro: {type(e).__name__}: {e}\n"
                f"Etapa FSM: {estado_desc}\n"
                f"Carrinho: {carrinho_desc}\n"
                f"Input do cliente: '{user_input[:100]}'\n"
                f"Atendimento transferido para humano."
            )
            msg = Mensagem(
                conversa_id=conv.id,
                pizzaria_id=pizzaria_id,
                origem="sistema",
                tipo="texto",
                conteudo=conteudo_sistema,
                metadata_json={"erro_ia": str(e), "etapa": estado_desc, "carrinho": carrinho_desc},
            )
            db.add(msg)
            conv.bot_ativo = False
            conv.status = "humano_necessario"
            conv.last_message = msg_fallback
            conv.last_timestamp = datetime.now(timezone.utc)
            await db.commit()

            # Broadcast para o painel de atendimento em tempo real
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "atendimento.humano",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "telefone": telefone,
                        "cliente_nome": conv.cliente_nome,
                        "motivo": f"Erro de IA: {type(e).__name__} ({estado_desc})",
                    },
                },
            )
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "conversa.atualizada",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "telefone": telefone,
                        "bot_ativo": False,
                        "status": "humano_necessario",
                        "motivo": f"Erro de IA: {type(e).__name__}",
                    },
                },
            )
            # Broadcast nova mensagem do sistema
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "mensagem.nova",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "mensagem_id": str(msg.id),
                        "telefone": telefone,
                        "conteudo": conteudo_sistema,
                        "origem": "sistema",
                        "created_at": msg.created_at.isoformat() if msg.created_at else datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        return {"ok": False, "erro": str(e), "fallback_acionado": True}

    if not result.texto:
        # Rede de segurança final: o agente rodou sem erro mas não produziu texto
        # (ex.: gastou todas as iterações em tool calls e nunca formulou a resposta).
        # NÃO podemos deixar o cliente no vácuo: mandamos uma mensagem amigável e
        # transferimos pra um humano, igual ao caminho de exceção crítica.
        log.warning(
            "Agente terminou SEM texto (iter=%d, tool_calls=%s) — escalando p/ humano",
            result.iteracoes, result.tool_calls,
        )
        msg_fallback = (
            "Vou chamar um de nossos atendentes para finalizar o seu pedido. "
            "Só um instantinho que já vão te responder! 😊"
        )
        try:
            if pizz.instancia:
                await evolution.send_text(
                    instancia=pizz.instancia, numero=telefone, texto=msg_fallback,
                )
        except Exception as e_send:  # noqa: BLE001
            log.warning("Falha ao enviar fallback de 'sem texto': %s", e_send)

        try:
            from app.services.alertas import registrar_alerta_seguro
            await registrar_alerta_seguro(
                tipo="falha_ia", pizzaria_id=pizzaria_id, nivel="error",
                detalhe=f"Agente terminou sem texto (iter={result.iteracoes}, tools={result.tool_calls})",
            )
        except Exception:  # noqa: BLE001
            pass

        if conv:
            conteudo_sistema = (
                "⚠️ A IA terminou o processamento sem gerar resposta.\n"
                f"Iterações: {result.iteracoes} | Tools: {result.tool_calls}\n"
                f"Input do cliente: '{user_input[:100]}'\n"
                "Atendimento transferido para humano."
            )
            msg = Mensagem(
                conversa_id=conv.id,
                pizzaria_id=pizzaria_id,
                origem="sistema",
                tipo="texto",
                conteudo=conteudo_sistema,
                metadata_json={"erro_ia": "sem_texto", "iter": result.iteracoes, "tool_calls": result.tool_calls},
            )
            db.add(msg)
            conv.bot_ativo = False
            conv.status = "humano_necessario"
            conv.last_message = msg_fallback
            conv.last_timestamp = datetime.now(timezone.utc)
            await db.commit()

            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "atendimento.humano",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "telefone": telefone,
                        "cliente_nome": conv.cliente_nome,
                        "motivo": "IA sem resposta",
                    },
                },
            )
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "conversa.atualizada",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "telefone": telefone,
                        "bot_ativo": False,
                        "status": "humano_necessario",
                        "motivo": "IA sem resposta",
                    },
                },
            )
            await broadcaster.publish(
                pizzaria_id,
                {
                    "tipo": "mensagem.nova",
                    "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "mensagem_id": str(msg.id),
                        "telefone": telefone,
                        "conteudo": conteudo_sistema,
                        "origem": "sistema",
                        "created_at": msg.created_at.isoformat() if msg.created_at else datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        return {"ok": False, "motivo": "sem_texto", "iter": result.iteracoes, "tool_calls": result.tool_calls, "fallback_acionado": True}

    guarded_text, blocked, reason = guard_response(result.texto, result.tool_calls)
    if blocked:
        log.warning("Resposta do agente bloqueada por guardrail (%s)", reason)
        result.texto = guarded_text
        result.tool_calls.append(f"guardrail:{reason}")

    # ---- C4: validador NÃO-BLOQUEANTE de preço ----
    # Se a IA citou um valor que não veio de nenhuma tool (nem soma de itens),
    # registra um alerta pro painel. A resposta segue normalmente.
    try:
        suspeitos = precos_sem_lastro(result.texto, result.precos_tool)
        if suspeitos:
            from app.services.alertas import registrar_alerta
            await registrar_alerta(
                db,
                tipo="preco_suspeito",
                pizzaria_id=pizzaria_id,
                detalhe=(
                    f"Possível preço sem lastro citado: {suspeitos}. "
                    f"Preços vindos das tools: {sorted(result.precos_tool)}. "
                    f"Resposta: {result.texto[:200]}"
                ),
            )
    except Exception as e:  # noqa: BLE001
        log.debug("Falha no validador de preço (ignorado): %s", e)

    # Envia pelo WhatsApp
    try:
        if pizz.instancia:
            await send_humanized_text(
                evolution=evolution,
                instancia=pizz.instancia,
                numero=telefone,
                texto=result.texto,
            )
    except Exception as e:
        log.exception("Falha enviando pelo Evolution: %s", e)
        try:
            from app.services.alertas import registrar_alerta_seguro
            await registrar_alerta_seguro(tipo="falha_envio", pizzaria_id=pizzaria_id, nivel="error",
                                          detalhe=f"Falha ao enviar pelo WhatsApp (Evolution): {e}")
        except Exception:  # noqa: BLE001
            pass

    # Salva como mensagem do bot
    if conv:
        msg = Mensagem(
            conversa_id=conv.id,
            pizzaria_id=pizzaria_id,
            origem="bot",
            tipo="texto",
            conteudo=result.texto,
            metadata_json={"iter": result.iteracoes, "tool_calls": result.tool_calls},
        )
        db.add(msg)
        conv.last_message = result.texto
        conv.last_timestamp = datetime.now(timezone.utc)
        # ---- Reset unread_count quando bot responde ----
        conv.unread_count = 0
        await db.commit()

        # Broadcast nova mensagem do bot
        await broadcaster.publish(
            pizzaria_id,
            {
                "tipo": "mensagem.nova",
                "pizzaria_id": str(pizzaria_id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "mensagem_id": str(msg.id),
                    "telefone": telefone,
                    "conteudo": result.texto,
                    "origem": "bot",
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                },
            },
        )

        # ---- Broadcast conversa.atualizada (unread_count resetado) ----
        await broadcaster.publish(
            pizzaria_id,
            {
                "tipo": "conversa.atualizada",
                "pizzaria_id": str(pizzaria_id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "telefone": telefone,
                    "unread_count": 0,
                    "last_message": result.texto,
                    "bot_ativo": conv.bot_ativo,
                    "status": conv.status,
                },
            },
        )

    # ---- Broadcast pedido.novo se registrar_pedido foi chamada ----
    if "registrar_pedido" in result.tool_calls:
        await broadcaster.publish(
            pizzaria_id,
            {
                "tipo": "pedido.novo",
                "pizzaria_id": str(pizzaria_id),
                "payload": {"telefone": telefone},
            },
        )

    # ---- Lembrete de confirmação ----
    # Se o FSM mostrou o resumo e está esperando o "ok", agenda UM follow-up: se o
    # cliente sumir sem confirmar, mandamos uma mensagem perguntando se pode fechar
    # (evita o cliente achar que o pedido já está fechado e ir buscar sem confirmar).
    try:
        if any(str(tc).startswith("fsm:resumo_confirmar") for tc in (result.tool_calls or [])):
            from app.workers.tasks import CONFIRM_REMINDER_SECONDS, lembrar_confirmacao
            lembrar_confirmacao.apply_async(
                args=[str(pizzaria_id), telefone], countdown=CONFIRM_REMINDER_SECONDS,
            )
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao agendar lembrete de confirmação: %s", e)

    # ---- Resgate de carrinho abandonado ----
    # Pedido com itens parado no meio do funil: agenda UM follow-up gentil para
    # ~25 min depois. A task só envia se a conversa continuar fria (cada resposta
    # nova reagenda; o check de updated_at descarta os agendamentos antigos) e
    # no máximo 1 resgate por conversa (flag resgate_enviado).
    try:
        from app.services.conversation_state import load_state as _load_state
        from app.workers.tasks import (
            _ETAPAS_RESGATE,
            RESGATE_CARRINHO_SECONDS,
            resgatar_carrinho,
        )
        _est = await _load_state(db, pizzaria_id, telefone)
        if (
            isinstance(_est, dict)
            and _est.get("carrinho")
            and _est.get("etapa") in _ETAPAS_RESGATE
            and not _est.get("resgate_enviado")
        ):
            resgatar_carrinho.apply_async(
                args=[str(pizzaria_id), telefone], countdown=RESGATE_CARRINHO_SECONDS,
            )
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao agendar resgate de carrinho: %s", e)

    return {
        "ok": True,
        "texto": result.texto,
        "iteracoes": result.iteracoes,
        "tool_calls": result.tool_calls,
    }
