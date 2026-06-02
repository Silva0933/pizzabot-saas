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
    # Aumentado o limite de bytes seguro para 50KB para evitar compactação destrutiva acidental
    if len(encoded.encode("utf-8")) <= 50000:
        return estado
    # Se ainda assim passar, preservamos todas as chaves essenciais do funil da FSM e do legado
    chaves_essenciais = (
        "etapa", "carrinho", "itens", "tipo", "total", "taxa_entrega", "pagamento",
        "endereco", "pagar_agora", "pipeline", "apresentou", "upsell_feito",
        "cardapio_enviado", "observacoes", "pedido_id", "numero_pedido", "fingerprint"
    )
    keep = {k: estado[k] for k in chaves_essenciais if k in estado}
    return keep


async def load_state(db: AsyncSession, pizzaria_id: uuid.UUID, telefone: str) -> dict[str, Any]:
    # TTL: ignora rascunho de pedido antigo (cliente sumiu e voltou horas depois).
    from app.agent.memory import CONVERSA_TTL_HORAS
    try:
        row = (await db.execute(text(f"""
            SELECT estado FROM public.atendimento_estado
            WHERE pizzaria_id = :pid AND telefone = :tel
              AND updated_at > now() - interval '{CONVERSA_TTL_HORAS} hours'
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
