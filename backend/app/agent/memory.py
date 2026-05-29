"""
Persistência da memória conversacional na tabela `agente_memoria`.

Cada turno (user/assistant/tool) vira uma linha. Carregamos as últimas N
ao iniciar e fazemos append a cada novo turno.
"""
from __future__ import annotations

import uuid
from typing import Any

from google.genai import types
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.llm import to_content
from app.models import Mensagem

# Quantos turnos carregamos pra contexto (cada turno = 1 linha em agente_memoria).
# Mantido enxuto para economizar tokens de ENTRADA a cada mensagem.
MAX_HISTORY = 12


async def load_history_messages(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    limit: int = MAX_HISTORY,
) -> list[dict[str, str]]:
    """
    Histórico conversacional neutro (formato OpenAI) — só user/assistant em
    texto. Ignora turnos de tool para evitar pareamento estrito de tool_call_id
    (as tools são executadas ao vivo no loop). Usado pelos providers OpenAI.
    """
    from sqlalchemy import text

    rows = (await db.execute(text("""
        SELECT role, content, tool_calls
        FROM public.agente_memoria
        WHERE pizzaria_id = :pid AND telefone = :tel
        ORDER BY created_at DESC
        LIMIT :lim
    """), {"pid": str(pizzaria_id), "tel": telefone, "lim": limit})).fetchall()

    out: list[dict[str, str]] = []
    for role, content, tcs in reversed(rows):
        if role == "user" and content:
            out.append({"role": "user", "content": content})
        elif role == "assistant" and content and not tcs:
            out.append({"role": "assistant", "content": content})
    return out


async def load_history(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    limit: int = MAX_HISTORY,
) -> list[types.Content]:
    """
    Carrega turnos recentes da memória do agente.

    Para Phase 3 simplificamos lendo direto da tabela `mensagens` quando
    não houver entrada em agente_memoria. Isso facilita migração futura.
    """
    # Tenta primeiro o histórico do agente
    from app.models import Base  # noqa: F401  para garantir import dos models
    from sqlalchemy import text

    rows = (await db.execute(text("""
        SELECT role, content, tool_calls, tool_call_id
        FROM public.agente_memoria
        WHERE pizzaria_id = :pid AND telefone = :tel
        ORDER BY created_at DESC
        LIMIT :lim
    """), {"pid": str(pizzaria_id), "tel": telefone, "lim": limit})).fetchall()

    if rows:
        rows = list(reversed(rows))
        out: list[types.Content] = []
        for r in rows:
            role, content, tcs, tcid = r
            if role == "user":
                out.append(to_content("user", text=content))
            elif role == "assistant":
                if tcs:
                    # Pode ter sido turno só de tool call
                    for tc in tcs:
                        out.append(to_content("model", function_call={"name": tc["name"], "args": tc.get("args", {})}))
                else:
                    out.append(to_content("model", text=content))
            elif role == "tool":
                # Gemini espera role='function'
                import json as _json
                response_payload = _json.loads(content) if content else {}
                out.append(to_content("function", function_response={"name": tcid or "unknown", "response": response_payload}))
        return out

    # Fallback: reconstitui a partir das mensagens reais — SOMENTE da conversa
    # deste cliente (isola por telefone, senão mistura conversas de clientes).
    from app.models import Conversa

    conv_id = (await db.execute(
        select(Conversa.id).where(
            Conversa.pizzaria_id == pizzaria_id,
            Conversa.cliente_telefone == telefone,
        )
    )).scalar_one_or_none()
    if conv_id is None:
        return []

    stmt = (
        select(Mensagem)
        .where(Mensagem.pizzaria_id == pizzaria_id)
        .where(Mensagem.conversa_id == conv_id)
        .where(Mensagem.created_at.isnot(None))
        .order_by(Mensagem.created_at.desc())
        .limit(limit)
    )
    msgs = list(reversed((await db.execute(stmt)).scalars().all()))
    out = []
    for m in msgs:
        if m.origem == "cliente":
            out.append(to_content("user", text=m.conteudo))
        elif m.origem in ("bot", "humano"):
            out.append(to_content("model", text=m.conteudo))
    return out


async def append_turn(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    *,
    role: str,
    content: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    tool_call_id: str | None = None,
) -> None:
    """Salva um turno na memória do agente."""
    from sqlalchemy import text
    await db.execute(text("""
        INSERT INTO public.agente_memoria (pizzaria_id, telefone, role, content, tool_calls, tool_call_id)
        VALUES (:pid, :tel, :role, :content, CAST(:tcs AS jsonb), :tcid)
    """), {
        "pid": str(pizzaria_id),
        "tel": telefone,
        "role": role,
        "content": content or "",
        "tcs": __import__("json").dumps(tool_calls) if tool_calls else None,
        "tcid": tool_call_id,
    })
