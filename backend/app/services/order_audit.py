"""Append-only record of operational events for an order."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Pedido, PedidoEvento


def registrar_evento_pedido(
    db: AsyncSession,
    pedido: Pedido,
    *,
    tipo: str,
    status_anterior: str | None = None,
    status_novo: str | None = None,
    motivo: str | None = None,
    ator_id: uuid.UUID | None = None,
    ator_nome: str | None = None,
    ator_tipo: str = "sistema",
    detalhes: dict[str, Any] | None = None,
) -> PedidoEvento:
    evento = PedidoEvento(
        pizzaria_id=pedido.pizzaria_id,
        pedido_id=pedido.id,
        tipo=tipo,
        status_anterior=status_anterior,
        status_novo=status_novo,
        motivo=motivo,
        ator_id=ator_id,
        ator_nome=ator_nome,
        ator_tipo=ator_tipo,
        detalhes=detalhes or {},
    )
    db.add(evento)
    return evento
