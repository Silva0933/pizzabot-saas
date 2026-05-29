"""API do painel para conversas e mensagens."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import membership
from app.models import Conversa, Mensagem, Pizzaria
from app.schemas import (
    ConversaOut,
    EnviarMensagemIn,
    MensagemOut,
    ToggleBotIn,
)
from app.services.broadcaster import broadcaster
from app.services.evolution import evolution

router = APIRouter(prefix="/pizzarias/{pizzaria_id}", tags=["conversas"])


# ============================================
# Listar conversas
# ============================================
@router.get("/conversas", response_model=list[ConversaOut])
async def list_conversas(
    pizzaria_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Conversa]:
    stmt = (
        select(Conversa)
        .where(Conversa.pizzaria_id == pizzaria_id)
        .order_by(desc(Conversa.last_timestamp))
        .limit(limit)
        .offset(offset)
    )
    if status_filter:
        stmt = stmt.where(Conversa.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


# ============================================
# Buscar mensagens de uma conversa
# ============================================
@router.get("/conversas/{conversa_id}/mensagens", response_model=list[MensagemOut])
async def get_mensagens(
    pizzaria_id: uuid.UUID,
    conversa_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    before: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Mensagem]:
    stmt = (
        select(Mensagem)
        .where(
            Mensagem.conversa_id == conversa_id,
            Mensagem.pizzaria_id == pizzaria_id,
        )
        .order_by(desc(Mensagem.created_at))
        .limit(limit)
    )
    if before:
        stmt = stmt.where(Mensagem.created_at < before)
    rows = (await db.execute(stmt)).scalars().all()
    return list(reversed(rows))  # cronológico


# ============================================
# Enviar manualmente (operador humano)
# ============================================
@router.post("/conversas/{conversa_id}/enviar", status_code=status.HTTP_201_CREATED)
async def enviar_manual(
    pizzaria_id: uuid.UUID,
    conversa_id: uuid.UUID,
    body: EnviarMensagemIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.id == conversa_id,
                Conversa.pizzaria_id == pizzaria_id,
            )
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")

    # Só permite envio manual quando o bot está desativado nesta conversa.
    if conv.bot_ativo:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Desative o atendimento do bot nesta conversa para enviar mensagens manualmente.",
        )

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))
    ).scalar_one()
    if not pizz.instancia:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pizzaria sem instância Evolution configurada")

    # Envia pelo Evolution
    await evolution.send_text(
        instancia=pizz.instancia,
        numero=conv.cliente_telefone,
        texto=body.conteudo,
    )

    # Persiste
    msg = Mensagem(
        conversa_id=conv.id,
        pizzaria_id=pizz.id,
        origem="humano",
        tipo="texto",
        conteudo=body.conteudo,
    )
    db.add(msg)
    conv.last_message = body.conteudo
    conv.last_timestamp = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(msg)

    await broadcaster.publish(
        pizz.id,
        {
            "tipo": "mensagem.nova",
            "pizzaria_id": str(pizz.id),
            "payload": {
                "conversa_id": str(conv.id),
                "mensagem_id": str(msg.id),
                "telefone": conv.cliente_telefone,
                "conteudo": body.conteudo,
                "origem": "humano",
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            },
        },
    )

    return {"ok": True, "mensagem_id": str(msg.id)}


# ============================================
# Pausar/retomar bot por conversa
# ============================================
@router.patch("/conversas/{conversa_id}/bot")
async def toggle_bot(
    pizzaria_id: uuid.UUID,
    conversa_id: uuid.UUID,
    body: ToggleBotIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.id == conversa_id,
                Conversa.pizzaria_id == pizzaria_id,
            )
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")

    conv.bot_ativo = body.bot_ativo
    conv.status = "bot_ativo" if body.bot_ativo else "humano_assumiu"
    await db.commit()

    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "bot.toggled",
            "pizzaria_id": str(pizzaria_id),
            "payload": {
                "conversa_id": str(conv.id),
                "bot_ativo": conv.bot_ativo,
                "status": conv.status,
            },
        },
    )
    return {"ok": True, "bot_ativo": conv.bot_ativo, "status": conv.status}


# ============================================
# Marcar como lida
# ============================================
@router.post("/conversas/{conversa_id}/lida")
async def marcar_lida(
    pizzaria_id: uuid.UUID,
    conversa_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.id == conversa_id,
                Conversa.pizzaria_id == pizzaria_id,
            )
        )
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada")

    conv.unread_count = 0
    await db.commit()
    return {"ok": True}


# ============================================
# Limpar TODAS as conversas e mensagens
# ============================================
log = logging.getLogger(__name__)


@router.delete("/conversas/todas")
async def limpar_todas_conversas(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
    x_confirm_delete: str | None = Header(None),
) -> dict:
    """
    Apaga TODAS as conversas e mensagens de uma pizzaria.

    Requer header `X-Confirm-Delete: true` para confirmar a ação.
    """
    if x_confirm_delete != "true":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Header X-Confirm-Delete: true é obrigatório para confirmar esta ação destrutiva.",
        )

    # Deleta histórico da memória do agente
    from sqlalchemy import text
    await db.execute(
        text("DELETE FROM public.agente_memoria WHERE pizzaria_id = :pid"),
        {"pid": str(pizzaria_id)},
    )

    # Deleta mensagens primeiro (FK depende de conversas)
    await db.execute(
        delete(Mensagem).where(Mensagem.pizzaria_id == pizzaria_id)
    )
    # Deleta conversas
    result = await db.execute(
        delete(Conversa).where(Conversa.pizzaria_id == pizzaria_id)
    )
    conversas_deletadas = result.rowcount

    await db.commit()

    # Limpa filas Redis pendentes desta pizzaria
    try:
        from app.redis_client import redis as redis_client
        keys_pending = await redis_client.keys(f"pending:{pizzaria_id}:*")
        keys_flush = await redis_client.keys(f"flush_at:{pizzaria_id}:*")
        all_keys = keys_pending + keys_flush
        if all_keys:
            await redis_client.delete(*all_keys)
    except Exception as e:
        log.warning("Erro ao limpar filas Redis: %s", e)

    # Broadcast para atualizar painel em tempo real
    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "conversas.limpas",
            "pizzaria_id": str(pizzaria_id),
            "payload": {"conversas_deletadas": conversas_deletadas},
        },
    )

    log.info("Todas as conversas da pizzaria %s foram apagadas (%d conversas)", pizzaria_id, conversas_deletadas)
    return {"ok": True, "conversas_deletadas": conversas_deletadas}
