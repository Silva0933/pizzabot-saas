"""
Webhook do Evolution API (entrada de mensagens WhatsApp).

Fluxo:
  1. Recebe POST do Evolution
  2. Identifica pizzaria por `instance`
  3. Extrai texto/áudio/imagem
  4. Salva mensagem + atualiza conversa
  5. Empilha na fila Redis (debounce 3s)
  6. Agenda Celery flush_conversation
  7. Broadcast WS para o painel
  8. Retorna 200 imediato (Evolution não pode esperar)
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Conversa, Mensagem, Pizzaria
from app.schemas import EvolutionWebhookPayload
from app.services.broadcaster import broadcaster
from app.services.queue import enqueue_message

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


# ============================================
# Helpers
# ============================================
def _extract_phone(remote_jid: str) -> str:
    """`5511999999999@s.whatsapp.net` → `5511999999999`."""
    return remote_jid.split("@", 1)[0]


def _extract_content(data: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """Retorna (conteudo, tipo, metadata)."""
    msg = data.get("message") or {}
    push_name = data.get("pushName")
    metadata = {"pushName": push_name, "evolution_id": data.get("key", {}).get("id")}

    if texto := msg.get("conversation"):
        return texto, "texto", metadata
    if ext := msg.get("extendedTextMessage"):
        return ext.get("text") or "", "texto", metadata
    if audio := msg.get("audioMessage"):
        metadata["audio"] = audio
        return "[áudio]", "audio", metadata
    if img := msg.get("imageMessage"):
        metadata["imagem"] = img
        return img.get("caption") or "[imagem]", "imagem", metadata
    if sticker := msg.get("stickerMessage"):
        metadata["figurinha"] = sticker
        return "[figurinha]", "figurinha", metadata
    if loc := msg.get("locationMessage"):
        metadata["localizacao"] = loc
        return "[localização]", "localizacao", metadata
    return "[mensagem não suportada]", "texto", metadata


async def _get_or_create_conversa(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    nome: str | None,
) -> Conversa:
    stmt = select(Conversa).where(
        Conversa.pizzaria_id == pizzaria_id,
        Conversa.cliente_telefone == telefone,
    )
    conv = (await db.execute(stmt)).scalar_one_or_none()
    if conv:
        return conv

    conv = Conversa(
        pizzaria_id=pizzaria_id,
        cliente_telefone=telefone,
        cliente_nome=nome,
    )
    db.add(conv)
    await db.flush()
    return conv


# ============================================
# Endpoint
# ============================================
@router.post("/evolution", status_code=status.HTTP_200_OK)
async def evolution_webhook(
    payload: EvolutionWebhookPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Loga uma única linha pra debug (sem expor dados sensíveis)
    log.info("Evolution webhook: event=%s instance=%s", payload.event, payload.instance)

    if payload.event not in (None, "messages.upsert"):
        return {"ignored": payload.event}

    data = payload.data or {}
    key = data.get("key") or {}
    if key.get("fromMe"):
        # Ignora ecos das nossas próprias mensagens
        return {"ignored": "fromMe"}

    if not payload.instance:
        return {"ignored": "no_instance"}

    # ---- localiza pizzaria pela instância ----
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.instancia == payload.instance))
    ).scalar_one_or_none()
    if not pizz:
        log.warning("Webhook para instância desconhecida: %s", payload.instance)
        return {"ignored": "unknown_instance"}

    if not pizz.bot_ativo_global:
        log.info("Bot global desligado para pizzaria %s", pizz.id)
        # Ainda salvamos a msg pra histórico, mas não processamos com IA
        # (deixa o painel decidir o que fazer)

    # ---- filtra grupos e broadcasts ----
    remote_jid = key.get("remoteJid", "")
    if remote_jid.endswith("@g.us"):
        log.debug("Ignorando mensagem de grupo: %s", remote_jid)
        return {"ignored": "group_message"}
    if "@broadcast" in remote_jid:
        log.debug("Ignorando mensagem de broadcast: %s", remote_jid)
        return {"ignored": "broadcast_message"}

    # ---- extrai dados ----
    telefone = _extract_phone(remote_jid)
    if not telefone:
        return {"ignored": "no_phone"}

    conteudo, tipo, metadata = _extract_content(data)
    evolution_msg_id = key.get("id")
    push_name = data.get("pushName")

    # ---- persiste ----
    conv = await _get_or_create_conversa(db, pizz.id, telefone, push_name)
    msg = Mensagem(
        conversa_id=conv.id,
        pizzaria_id=pizz.id,
        origem="cliente",
        tipo=tipo,
        conteudo=conteudo,
        metadata_json=metadata,
    )
    db.add(msg)

    # Atualiza conversa
    conv.last_message = conteudo
    conv.last_timestamp = datetime.now(timezone.utc)
    conv.unread_count = (conv.unread_count or 0) + 1
    if push_name and not conv.cliente_nome:
        conv.cliente_nome = push_name

    await db.commit()
    await db.refresh(msg)

    # ---- fila + broadcast (não bloqueia retorno) ----
    if pizz.bot_ativo_global and conv.bot_ativo:
        await enqueue_message(
            pizzaria_id=pizz.id,
            telefone=telefone,
            mensagem_id=msg.id,
            conteudo=conteudo,
            metadata={"evolution_msg_id": evolution_msg_id, "tipo": tipo},
        )
        # Agenda flush_conversation com countdown=10.5s (alinhado ao debounce de 10s)
        from app.workers.tasks import flush_conversation
        flush_conversation.apply_async(
            args=[str(pizz.id), telefone],
            countdown=10.5,
        )

    await broadcaster.publish(
        pizz.id,
        {
            "tipo": "mensagem.nova",
            "pizzaria_id": str(pizz.id),
            "payload": {
                "conversa_id": str(conv.id),
                "mensagem_id": str(msg.id),
                "telefone": telefone,
                "nome": push_name,
                "conteudo": conteudo,
                "tipo": tipo,
                "origem": "cliente",
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            },
        },
    )

    return {"ok": True, "conversa_id": str(conv.id), "mensagem_id": str(msg.id)}
