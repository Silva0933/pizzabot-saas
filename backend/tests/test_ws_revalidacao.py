"""
O WebSocket do painel só checava o acesso ao conectar: usuário removido da
equipe, sessão revogada ou pizzaria suspensa seguiam recebendo os eventos
(pedidos, mensagens de clientes) até a conexão cair. Agora reavalia a cada
REVALIDAR_A_CADA_S e recusa pizzaria suspensa.

A revalidação só rodava quando `receive_text` ficava REVALIDAR_A_CADA_S sem
nada — e o ping do painel a cada 30 s zerava essa espera: com a aba aberta, o
acesso nunca era reavaliado (achado A01 da análise de 01/10). Agora é um relógio
próprio. E o entregador recebia o mesmo evento do painel (conversas com telefone
e texto dos clientes); agora só recebe o aviso de pedido, sem payload (A02).
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
            assert asyncio.run(ws._authorize(create_access_token(UID), PID)) == (u, "equipe")

    def test_entregador_ativo_conecta_com_papel_de_entregador(self):
        from app.routes import ws
        u = _user()
        # usuário, suspensa=False, sem vínculo de equipe, entregador ativo
        with patch.object(ws, "AsyncSessionLocal", _sessao([u, False, None, MagicMock()])):
            assert asyncio.run(ws._authorize(create_access_token(UID), PID)) == (u, "entregador")

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
            assert asyncio.run(ws._authorize(vencido, PID, verificar_exp=False)) == (u, "equipe")


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
        autorizacoes = [(_user(), "equipe"), None]   # conecta ok; na revalidação perdeu acesso

        async def _auth(*_a, **_k):
            return autorizacoes.pop(0)

        with patch.object(ws, "_authorize", _auth), \
             patch.object(ws, "REVALIDAR_A_CADA_S", 0.01), \
             patch.object(ws.broadcaster, "connect", AsyncMock()), \
             patch.object(ws.broadcaster, "disconnect", AsyncMock()) as desc:
            asyncio.run(asyncio.wait_for(ws._handle_ws(websocket, "tok", PID), timeout=2))

        websocket.close.assert_awaited_once()
        desc.assert_awaited()   # sai do broadcaster (antes do close e no finally; é idempotente)

    def test_ping_continuo_nao_impede_a_revalidacao(self):
        """O painel manda ping a cada 30 s: mesmo falando sem parar, a conexão de
        quem perdeu o acesso tem de ser fechada."""
        from app.routes import ws

        websocket = MagicMock()
        websocket.accept = AsyncMock()
        websocket.send_json = AsyncMock()
        websocket.close = AsyncMock()
        pings = 0

        async def _ping_sem_parar():
            nonlocal pings
            await asyncio.sleep(0.002)
            pings += 1
            return "ping"

        websocket.receive_text = _ping_sem_parar
        autorizacoes = [(_user(), "equipe"), None]

        async def _auth(*_a, **_k):
            return autorizacoes.pop(0)

        with patch.object(ws, "_authorize", _auth),              patch.object(ws, "REVALIDAR_A_CADA_S", 0.05),              patch.object(ws.broadcaster, "connect", AsyncMock()),              patch.object(ws.broadcaster, "disconnect", AsyncMock()):
            asyncio.run(asyncio.wait_for(ws._handle_ws(websocket, "tok", PID), timeout=2))

        assert pings > 3   # o cliente falou várias vezes antes da revalidação
        websocket.close.assert_awaited_once()

    def test_papel_mudou_fecha_a_conexao(self):
        """Membro da equipe que virou só entregador reconecta com o filtro novo."""
        from app.routes import ws

        websocket = MagicMock()
        websocket.accept = AsyncMock()
        websocket.send_json = AsyncMock()
        websocket.close = AsyncMock()

        async def _nunca_fala():
            await asyncio.sleep(3600)

        websocket.receive_text = _nunca_fala
        u = _user()
        autorizacoes = [(u, "equipe"), (u, "entregador")]

        async def _auth(*_a, **_k):
            return autorizacoes.pop(0)

        with patch.object(ws, "_authorize", _auth),              patch.object(ws, "REVALIDAR_A_CADA_S", 0.01),              patch.object(ws.broadcaster, "connect", AsyncMock()),              patch.object(ws.broadcaster, "disconnect", AsyncMock()):
            asyncio.run(asyncio.wait_for(ws._handle_ws(websocket, "tok", PID), timeout=2))

        websocket.close.assert_awaited_once()

    def test_entregador_registrado_com_o_papel(self):
        from app.routes import ws

        websocket = MagicMock()
        websocket.accept = AsyncMock()
        websocket.send_json = AsyncMock()
        websocket.close = AsyncMock()

        async def _desconecta():
            from fastapi import WebSocketDisconnect
            raise WebSocketDisconnect()

        websocket.receive_text = _desconecta

        async def _auth(*_a, **_k):
            return (_user(), "entregador")

        with patch.object(ws, "_authorize", _auth),              patch.object(ws.broadcaster, "connect", AsyncMock()) as con,              patch.object(ws.broadcaster, "disconnect", AsyncMock()):
            asyncio.run(asyncio.wait_for(ws._handle_ws(websocket, "tok", PID), timeout=2))

        assert con.await_args.args[2] == "entregador"


class TestBroadcasterPorPapel:
    def _evento(self, tipo, **payload):
        import json
        return json.dumps({"tipo": tipo, "pizzaria_id": str(PID), "payload": payload})

    def _rodar(self, data):
        from app.services.broadcaster import Broadcaster

        b = Broadcaster()
        equipe, entregador = MagicMock(), MagicMock()
        equipe.send_text = AsyncMock()
        entregador.send_text = AsyncMock()

        async def _go():
            async with b._lock:
                b._connections[PID][equipe] = "equipe"
                b._connections[PID][entregador] = "entregador"
            await b._entregar(PID, data)

        asyncio.run(_go())
        return equipe, entregador

    def test_entregador_nao_recebe_conversa(self):
        equipe, entregador = self._rodar(
            self._evento("mensagem.nova", telefone="5511999990000", conteudo="meu endereço é ...")
        )
        equipe.send_text.assert_awaited_once()
        entregador.send_text.assert_not_awaited()

    def test_entregador_nao_recebe_chamado_nem_alerta(self):
        for tipo in ("chamado.novo", "chamado.respondido", "alerta.plataforma", "atendimento.humano",
                     "conversa.atualizada", "entregador.localizacao"):
            _equipe, entregador = self._rodar(self._evento(tipo, detalhe="x"))
            entregador.send_text.assert_not_awaited()

    def test_entregador_recebe_aviso_de_pedido_sem_payload(self):
        import json
        equipe, entregador = self._rodar(
            self._evento("pedido.atualizado", cliente_telefone="5511999990000", endereco="Rua X")
        )
        assert "Rua X" in equipe.send_text.await_args.args[0]
        enviado = json.loads(entregador.send_text.await_args.args[0])
        assert enviado == {"tipo": "pedido.atualizado", "pizzaria_id": str(PID), "payload": {}}

    def test_todos_os_tipos_que_o_app_do_entregador_usa_passam(self):
        """REFRESH_EVENTS do DriverApp.tsx: sem eles o app não atualiza sozinho
        (nem os pedidos atribuídos a ele, nem os livres para pegar)."""
        from app.services.broadcaster import EVENTOS_ENTREGADOR
        assert {"pedido.atualizado", "pedido.novo", "entregador.atribuicao", "pedidos.limpos"} <= EVENTOS_ENTREGADOR
