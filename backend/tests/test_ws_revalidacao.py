"""
O WebSocket do painel só checava o acesso ao conectar: usuário removido da
equipe, sessão revogada ou pizzaria suspensa seguiam recebendo os eventos
(pedidos, mensagens de clientes) até a conexão cair. Agora reavalia a cada
REVALIDAR_A_CADA_S e recusa pizzaria suspensa.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import jwt

from app.auth import create_access_token
from app.config import get_settings

PID = uuid.uuid4()
UID = "00000000-0000-0000-0000-0000000000aa"


def _sessao(resultados):
    """AsyncSessionLocal() falso que devolve os resultados em ordem."""
    db = MagicMock()
    fila = list(resultados)

    async def _exec(*_a, **_k):
        r = MagicMock()
        r.scalar_one_or_none = MagicMock(return_value=fila.pop(0) if fila else None)
        return r

    db.execute = _exec
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=db)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


def _user():
    u = MagicMock()
    u.id = uuid.UUID(UID)
    u.is_platform_admin = False
    u.sessoes_validas_desde = None
    return u


class TestAuthorize:
    def test_pizzaria_suspensa_recusa(self):
        from app.routes import ws
        with patch.object(ws, "AsyncSessionLocal", _sessao([_user(), True])):
            assert asyncio.run(ws._authorize(create_access_token(UID), PID)) is None

    def test_membro_ativo_passa(self):
        from app.routes import ws
        u = _user()
        with patch.object(ws, "AsyncSessionLocal", _sessao([u, False, MagicMock()])):
            assert asyncio.run(ws._authorize(create_access_token(UID), PID)) is u

    def test_revalidacao_ignora_so_a_expiracao(self):
        """Access token venceu durante a conexão: a revalidação confere o acesso
        no banco, não derruba o painel de hora em hora."""
        from app.routes import ws
        cfg = get_settings()
        vencido = jwt.encode(
            {"sub": UID, "typ": "access", "iat": 1,
             "exp": int((datetime.now(UTC) - timedelta(minutes=5)).timestamp())},
            cfg.app_secret_key, algorithm=cfg.jwt_algorithm,
        )
        u = _user()
        with patch.object(ws, "AsyncSessionLocal", _sessao([u, False, MagicMock()])):
            assert asyncio.run(ws._authorize(vencido, PID)) is None                 # conectar: não
        with patch.object(ws, "AsyncSessionLocal", _sessao([u, False, MagicMock()])):
            assert asyncio.run(ws._authorize(vencido, PID, verificar_exp=False)) is u


class TestConexaoAberta:
    def test_acesso_removido_fecha_a_conexao(self):
        from app.routes import ws

        websocket = MagicMock()
        websocket.accept = AsyncMock()
        websocket.send_json = AsyncMock()
        websocket.close = AsyncMock()

        async def _nunca_fala():
            await asyncio.sleep(3600)

        websocket.receive_text = _nunca_fala
        autorizacoes = [_user(), None]   # conecta ok; na revalidação perdeu acesso

        async def _auth(*_a, **_k):
            return autorizacoes.pop(0)

        with patch.object(ws, "_authorize", _auth), \
             patch.object(ws, "REVALIDAR_A_CADA_S", 0.01), \
             patch.object(ws.broadcaster, "connect", AsyncMock()), \
             patch.object(ws.broadcaster, "disconnect", AsyncMock()) as desc:
            asyncio.run(asyncio.wait_for(ws._handle_ws(websocket, "tok", PID), timeout=2))

        websocket.close.assert_awaited_once()
        desc.assert_awaited_once()
