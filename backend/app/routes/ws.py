"""
WebSocket pro painel (eventos em tempo real).

Conexão:
    ws://api/ws?token=<jwt>&pizzaria_id=<uuid>

Validamos JWT + vínculo de equipe antes de aceitar.
Eventos chegam via Broadcaster (pub/sub Redis).
"""
import logging
import uuid

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.auth import decode_token
from app.db import AsyncSessionLocal
from app.models import EquipePizzaria, Usuario
from app.services.broadcaster import broadcaster

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])


async def _authorize(token: str, pizzaria_id: uuid.UUID) -> Usuario | None:
    """Valida JWT e checa se o usuário pode acessar essa pizzaria."""
    try:
        payload = decode_token(token)
        if payload.get("typ") != "access":
            return None
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(Usuario).where(Usuario.id == user_id))).scalar_one_or_none()
        if not user:
            return None
        if user.is_platform_admin:
            return user
        link = (
            await db.execute(
                select(EquipePizzaria).where(
                    EquipePizzaria.pizzaria_id == pizzaria_id,
                    EquipePizzaria.usuario_id == user.id,
                    EquipePizzaria.status.in_(("ativo", "proprietario")),
                )
            )
        ).scalar_one_or_none()
        return user if link else None


@router.websocket("/ws/{pizzaria_id}")
async def panel_ws_path(websocket: WebSocket, pizzaria_id: uuid.UUID, token: str = Query(...)) -> None:
    """Rota alternativa com pizzaria_id no path (frontend usa esta)."""
    await _handle_ws(websocket, token, pizzaria_id)


@router.websocket("/ws")
async def panel_ws(
    websocket: WebSocket,
    token: str = Query(...),
    pizzaria_id: uuid.UUID = Query(...),
) -> None:
    await _handle_ws(websocket, token, pizzaria_id)


async def _handle_ws(websocket: WebSocket, token: str, pizzaria_id: uuid.UUID) -> None:
    user = await _authorize(token, pizzaria_id)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    await broadcaster.connect(pizzaria_id, websocket)
    log.info("WS conectado: user=%s pizzaria=%s", user.email, pizzaria_id)

    try:
        # Envia evento "olá" pro cliente confirmar
        await websocket.send_json({
            "tipo": "system.hello",
            "pizzaria_id": str(pizzaria_id),
            "payload": {"user": user.email},
        })
        # Loop: aceita pings/pongs do cliente (não esperamos mensagens reais)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("WS error: %s", e)
    finally:
        await broadcaster.disconnect(pizzaria_id, websocket)
        log.info("WS desconectado: user=%s pizzaria=%s", user.email, pizzaria_id)
