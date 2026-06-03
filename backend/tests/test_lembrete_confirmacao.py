"""
Testes do lembrete de confirmação (Celery task `lembrar_confirmacao`).

Regra: se o cliente viu o resumo e não confirmou em alguns minutos, manda UM
follow-up perguntando se pode fechar — mas só se ainda estiver aguardando, o bot
estiver ativo e ainda não tivermos lembrado.
"""
from __future__ import annotations

import asyncio
import contextlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


class _FakeSessionCtx:
    """Substitui `async with AsyncSessionLocal() as db`."""
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *a):
        return False


@contextlib.contextmanager
def _mock_ambiente(db, estado, send_text):
    """Patches comuns: sessão, engine, estado, evolution, broadcaster, memória."""
    with patch("app.db.AsyncSessionLocal", return_value=_FakeSessionCtx(db)), \
            patch("app.db.engine", MagicMock(dispose=AsyncMock())), \
            patch("app.services.conversation_state.load_state", new=AsyncMock(return_value=estado)), \
            patch("app.services.conversation_state.save_state", new=AsyncMock()), \
            patch("app.services.evolution.evolution.send_text", new=send_text), \
            patch("app.services.evolution.evolution.close", new=AsyncMock()), \
            patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()), \
            patch("app.agent.memory.append_turn", new=AsyncMock()):
        yield


class TestLembreteConfirmacao:
    def test_envia_quando_aguardando_e_nao_lembrado(self):
        from app.workers import tasks

        estado = {"etapa": "AGUARDANDO_CONFIRMACAO"}
        conv = MagicMock(); conv.id = "c1"; conv.bot_ativo = True; conv.cliente_nome = "J"
        pizz = MagicMock(); pizz.id = "p1"; pizz.instancia = "inst"

        res_conv = MagicMock(); res_conv.scalar_one_or_none = MagicMock(return_value=conv)
        res_pizz = MagicMock(); res_pizz.scalar_one_or_none = MagicMock(return_value=pizz)
        db = AsyncMock(); db.execute = AsyncMock(side_effect=[res_conv, res_pizz])
        send = AsyncMock()

        with _mock_ambiente(db, estado, send):
            out = asyncio.run(tasks._lembrar_confirmacao_async(uuid.uuid4(), "5511999999999"))

        assert out["ok"] is True
        send.assert_awaited_once()
        assert "não foi fechado" in send.call_args.kwargs["texto"].lower()
        assert estado["confirmacao_lembrada"] is True

    def test_skip_quando_nao_esta_mais_aguardando(self):
        from app.workers import tasks

        estado = {"etapa": "FINALIZADO"}  # já confirmou / mudou de etapa
        send = AsyncMock()

        with _mock_ambiente(AsyncMock(), estado, send):
            out = asyncio.run(tasks._lembrar_confirmacao_async(uuid.uuid4(), "5511999999999"))

        assert out["motivo"] == "nao_aguardando"
        send.assert_not_awaited()

    def test_skip_quando_ja_lembrado(self):
        from app.workers import tasks

        estado = {"etapa": "AGUARDANDO_CONFIRMACAO", "confirmacao_lembrada": True}
        send = AsyncMock()

        with _mock_ambiente(AsyncMock(), estado, send):
            out = asyncio.run(tasks._lembrar_confirmacao_async(uuid.uuid4(), "5511999999999"))

        assert out["motivo"] == "ja_lembrado"
        send.assert_not_awaited()

    def test_skip_quando_humano_assumiu(self):
        from app.workers import tasks

        estado = {"etapa": "AGUARDANDO_CONFIRMACAO"}
        conv = MagicMock(); conv.bot_ativo = False  # operador assumiu
        res_conv = MagicMock(); res_conv.scalar_one_or_none = MagicMock(return_value=conv)
        db = AsyncMock(); db.execute = AsyncMock(return_value=res_conv)
        send = AsyncMock()

        with _mock_ambiente(db, estado, send):
            out = asyncio.run(tasks._lembrar_confirmacao_async(uuid.uuid4(), "5511999999999"))

        assert out["motivo"] == "humano_assumiu"
        send.assert_not_awaited()
