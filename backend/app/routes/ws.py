"""
WebSocket pro painel (eventos em tempo real).

Conexão:
    ws://api/ws?token=<jwt>&pizzaria_id=<uuid>

Validamos JWT + vínculo de equipe antes de aceitar.
Eventos chegam via Broadcaster (pub/sub Redis).
"""
import asyncio
import logging
import uuid

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.auth import sessao_revogada
from app.config import get_settings
from app.db import AsyncSessionLocal
from app.models import Entregador, EquipePizzaria, Pizzaria, Usuario
from app.services.broadcaster import broadcaster

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])


# De quanto em quanto tempo a conexão aberta é reavaliada. Antes o acesso só era
# checado ao conectar: usuário removido da equipe, entregador desativado, sessão
# revogada ou pizzaria suspensa seguiam recebendo os eventos até desconectar.
REVALIDAR_A_CADA_S = 60


async def _authorize(
    token: str, pizzaria_id: uuid.UUID, *, verificar_exp: bool = True
) -> Usuario | None:
    """Valida JWT e checa se o usuário pode acessar essa pizzaria (e se ela não
    está suspensa). Na revalidação periódica a expiração do token não conta: o
    que importa é o acesso atual, conferido no banco — senão a conexão cairia de
    hora em hora só porque o access token venceu."""
    try:
        cfg = get_settings()
        payload = jwt.decode(
            token, cfg.app_secret_key, algorithms=[cfg.jwt_algorithm],
            options={"verify_exp": verificar_exp},
        )
        if payload.get("typ") != "access":
            return None
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(Usuario).where(Usuario.id == user_id))).scalar_one_or_none()
        if not user or sessao_revogada(user, payload):
            return None
        if user.is_platform_admin:
            return user
        suspensa = (await db.execute(
            select(Pizzaria.suspensa).where(Pizzaria.id == pizzaria_id)
        )).scalar_one_or_none()
        if suspensa:
            return None
        link = (
            await db.execute(
                select(EquipePizzaria).where(
                    EquipePizzaria.pizzaria_id == pizzaria_id,
                    EquipePizzaria.usuario_id == user.id,
                    EquipePizzaria.status.in_(("ativo", "proprietario")),
                )
            )
        ).scalar_one_or_none()
        if link:
            return user
        # Entregador ativo da pizzaria também conecta (recebe updates das entregas).
        ent = (
            await db.execute(
                select(Entregador).where(
                    Entregador.pizzaria_id == pizzaria_id,
                    Entregador.usuario_id == user.id,
                    Entregador.ativo.is_(True),
                )
            )
        ).scalar_one_or_none()
        return user if ent else None


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
        # Loop: aceita pings/pongs do cliente (não esperamos mensagens reais) e
        # reavalia o acesso periodicamente.
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=REVALIDAR_A_CADA_S)
            except TimeoutError:
                if not await _authorize(token, pizzaria_id, verificar_exp=False):
                    log.info("WS encerrado (acesso revogado): user=%s pizzaria=%s", user.email, pizzaria_id)
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("WS error: %s", e)
    finally:
        await broadcaster.disconnect(pizzaria_id, websocket)
        log.info("WS desconectado: user=%s pizzaria=%s", user.email, pizzaria_id)
