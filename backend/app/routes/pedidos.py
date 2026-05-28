"""
API de pedidos: list, get, atualizar status, cancelar.

Atualização de status dispara:
  - Mensagem automática pro cliente via Evolution
  - Broadcast WS pro painel
  - Evento de auditoria
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import membership
from app.models import Pedido
from app.services.broadcaster import broadcaster
from app.services.status_messages import enviar_mensagem_status

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/pedidos", tags=["pedidos"])

VALID_STATUSES = ("novo", "confirmado", "no_forno", "a_caminho", "entregue", "cancelado")


class PedidoOut(BaseModel):
    id: uuid.UUID
    pizzaria_id: uuid.UUID
    cliente_id: uuid.UUID
    numero_pedido: int | None
    itens: list[dict]
    valor_total: Decimal
    status: str
    tipo: str
    endereco_entrega: str | None
    forma_pagamento: str | None
    observacoes: str | None
    payment_status: str
    link_pagamento: str | None
    bot_ativo: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: str
    motivo: str | None = None


# ============================================
# Listar
# ============================================
@router.get("", response_model=list[PedidoOut])
async def list_pedidos(
    pizzaria_id: uuid.UUID,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Pedido]:
    stmt = (
        select(Pedido)
        .where(Pedido.pizzaria_id == pizzaria_id)
        .order_by(desc(Pedido.created_at))
        .limit(limit)
    )
    if status_filter:
        stmt = stmt.where(Pedido.status == status_filter)
    return list((await db.execute(stmt)).scalars().all())


# ============================================
# Get único
# ============================================
@router.get("/{pedido_id}", response_model=PedidoOut)
async def get_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    return p


# ============================================
# Atualizar status (dispara efeitos colaterais)
# ============================================
@router.patch("/{pedido_id}/status", response_model=PedidoOut)
async def update_status(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    if body.status not in VALID_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Status inválido. Use: {VALID_STATUSES}")

    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    if p.status == body.status:
        return p  # idempotente

    old_status = p.status
    p.status = body.status

    if body.status == "cancelado":
        p.cancelado_at = datetime.now(timezone.utc)
        p.cancelamento_motivo = body.motivo

    await db.flush()

    # Efeito colateral: mensagem automática pro cliente
    if old_status != body.status:
        await enviar_mensagem_status(db, p, body.status)

    await db.commit()
    await db.refresh(p)

    # Broadcast pro painel
    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(pizzaria_id),
            "payload": {
                "pedido_id": str(p.id),
                "numero_pedido": p.numero_pedido,
                "status_anterior": old_status,
                "status_novo": p.status,
            },
        },
    )

    return p
