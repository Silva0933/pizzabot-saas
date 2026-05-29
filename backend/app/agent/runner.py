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
from app.models import Conversa, Mensagem
from app.services.app_config import get_llm_config
from app.services.broadcaster import broadcaster
from app.services.evolution import evolution

log = logging.getLogger(__name__)

# Limite de iterações no loop (evita custo absurdo se o modelo gira em torno de tools)
MAX_AGENT_ITERATIONS = 6


class AgentResult:
    def __init__(self, *, texto: str | None, iteracoes: int, tool_calls: list[str]):
        self.texto = texto
        self.iteracoes = iteracoes
        self.tool_calls = tool_calls


async def run_agent(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    user_input: str,
) -> AgentResult:
    """Roda uma rodada completa do agente para uma entrada do cliente."""
    ctx = await load_context(db, pizzaria_id, telefone)
    system = build_system_prompt(
        ctx.pizzaria,
        ctx.personalidade,
        cliente_nome=ctx.cliente_nome,
        cliente_total_pedidos=ctx.cliente_total_pedidos,
    )

    # Provider de LLM configurado pelo admin (gemini | openai | openrouter)
    cfg = await get_llm_config(db)
    provider = cfg["provider"]
    if provider in ("openai", "openrouter") and cfg["keys"].get(provider):
        return await _run_openai_agent(
            db, pizzaria_id, telefone, user_input, ctx=ctx, system=system, cfg=cfg,
        )

    history = await load_history(db, pizzaria_id, telefone)
    # Acrescenta a entrada atual
    history.append(to_content("user", text=user_input))

    # Persiste a entrada na memória
    await append_turn(db, pizzaria_id, telefone, role="user", content=user_input)

    tools = get_tools()
    tool_calls_made: list[str] = []
    final_text: str | None = None

    gemini_key = cfg["keys"].get("gemini") or None
    gemini_model = cfg["model"] if provider == "gemini" else "gemini-2.0-flash"
    for iteration in range(1, MAX_AGENT_ITERATIONS + 1):
        log.info("Agente iter=%d pizzaria=%s tel=%s", iteration, pizzaria_id, telefone)
        response = await call_gemini(
            system=system, history=history, tools=tools,
            model=gemini_model, api_key=gemini_key,
        )

        fcs = extract_function_calls(response)
        if fcs:
            # Modelo pediu tools — executa e itera
            history.append(response.candidates[0].content)
            for fc in fcs:
                tool_calls_made.append(fc["name"])
                result = await execute_tool(
                    fc["name"], fc["args"], ctx=ctx, db=db,
                )
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

    await db.commit()
    return AgentResult(texto=final_text, iteracoes=iteration, tool_calls=tool_calls_made)


async def _run_openai_agent(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    user_input: str,
    *,
    ctx: Any,
    system: str,
    cfg: dict,
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

    tool_calls_made: list[str] = []
    final_text: str | None = None
    iteration = 0

    for iteration in range(1, MAX_AGENT_ITERATIONS + 1):
        log.info("Agente(%s) iter=%d pizzaria=%s", provider, iteration, pizzaria_id)
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=messages, tools=tools,
        )
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

    await db.commit()
    return AgentResult(texto=final_text, iteracoes=iteration, tool_calls=tool_calls_made)


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
            )
    except Exception as e:
        log.debug("Falha ao enviar indicador de digitando: %s", e)

    # ---- Roda o agente IA ----
    result = await run_agent(db, pizzaria_id, telefone, user_input)

    if not result.texto:
        log.warning("Agente terminou sem texto (iter=%d)", result.iteracoes)
        return {"ok": False, "iter": result.iteracoes, "tool_calls": result.tool_calls}

    # Envia pelo WhatsApp
    try:
        if pizz.instancia:
            # Calcula delay proporcional ao tamanho do texto (max 8 segundos)
            tamanho = len(result.texto) if result.texto else 0
            delay_ms = int(min(max(tamanho * 55, 1500), 8000))
            await evolution.send_text(
                instancia=pizz.instancia,
                numero=telefone,
                texto=result.texto,
                delay_ms=delay_ms,
            )
    except Exception as e:
        log.exception("Falha enviando pelo Evolution: %s", e)

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

    return {
        "ok": True,
        "texto": result.texto,
        "iteracoes": result.iteracoes,
        "tool_calls": result.tool_calls,
    }
