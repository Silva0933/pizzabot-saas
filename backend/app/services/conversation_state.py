"""Estado curto e estruturado da conversa atual."""
from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

MAX_STATE_BYTES = 3000


def _compact_state(estado: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(estado, ensure_ascii=False, default=str)
    if len(encoded.encode("utf-8")) <= MAX_STATE_BYTES:
        return estado
    keep = {k: estado[k] for k in ("etapa", "itens", "tipo", "total", "taxa_entrega", "pagamento") if k in estado}
    return keep


async def load_state(db: AsyncSession, pizzaria_id: uuid.UUID, telefone: str) -> dict[str, Any]:
    try:
        row = (await db.execute(text("""
            SELECT estado FROM public.atendimento_estado
            WHERE pizzaria_id = :pid AND telefone = :tel
        """), {"pid": str(pizzaria_id), "tel": telefone})).first()
    except Exception:
        await db.rollback()
        return {}
    if not row or not row[0]:
        return {}
    return row[0] if isinstance(row[0], dict) else json.loads(row[0])


async def save_state(db: AsyncSession, pizzaria_id: uuid.UUID, telefone: str, estado: dict[str, Any]) -> None:
    estado = _compact_state(estado)
    await db.execute(text("""
        INSERT INTO public.atendimento_estado (pizzaria_id, telefone, estado, updated_at)
        VALUES (:pid, :tel, CAST(:estado AS jsonb), now())
        ON CONFLICT (pizzaria_id, telefone) DO UPDATE
          SET estado = EXCLUDED.estado, updated_at = now()
    """), {
        "pid": str(pizzaria_id),
        "tel": telefone,
        "estado": json.dumps(estado, ensure_ascii=False, default=str),
    })


async def clear_state(db: AsyncSession, pizzaria_id: uuid.UUID, telefone: str) -> None:
    await db.execute(text("""
        DELETE FROM public.atendimento_estado
        WHERE pizzaria_id = :pid AND telefone = :tel
    """), {"pid": str(pizzaria_id), "tel": telefone})
