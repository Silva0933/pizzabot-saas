"""
Testes do monitor de saturação do dispatcher (job do Beat — autoscaling assistido).

Validam a lógica de avaliação da fila: sem saturação limpa o streak; saturado
acumula streak e só alerta após N checagens seguidas, respeitando o cooldown.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _fake_redis(*, due: int, pel: int):
    r = MagicMock()
    r.zcard = AsyncMock(return_value=due)
    r.xpending = AsyncMock(return_value={"pending": pel})
    r.delete = AsyncMock()
    r.expire = AsyncMock()
    r.incr = AsyncMock()
    r.set = AsyncMock(return_value=True)  # cooldown disponível por padrão
    return r


def test_fila_tranquila_nao_alerta_e_limpa_streak():
    from app.workers import periodic

    r = _fake_redis(due=3, pel=1)
    with patch.object(periodic, "_ALERT_DUE", 50), patch.object(periodic, "_ALERT_PEL", 30):
        out = asyncio.run(periodic._avaliar_fila_dispatcher(r))
    assert out["saturado"] is False
    r.delete.assert_awaited_with("disp:alert:streak")
    r.incr.assert_not_called()


def test_satura_mas_streak_1_ainda_nao_alerta():
    from app.workers import periodic

    r = _fake_redis(due=80, pel=0)
    r.incr = AsyncMock(return_value=1)  # 1ª checagem saturada
    with patch.object(periodic, "_ALERT_DUE", 50), patch.object(periodic, "_ALERT_STREAK", 2):
        out = asyncio.run(periodic._avaliar_fila_dispatcher(r))
    assert out["saturado"] is True and out["alerta"] is False
    r.set.assert_not_called()  # nem chega a tentar o cooldown


def test_satura_streak_atingido_alerta_uma_vez():
    from app.workers import periodic

    r = _fake_redis(due=0, pel=40)  # satura pelo PEL
    r.incr = AsyncMock(return_value=2)  # 2ª checagem seguida
    with patch.object(periodic, "_ALERT_PEL", 30), patch.object(periodic, "_ALERT_STREAK", 2):
        out = asyncio.run(periodic._avaliar_fila_dispatcher(r))
    assert out["alerta"] is True
    # cooldown setado com NX + TTL
    args, kwargs = r.set.call_args
    assert args[0] == "disp:alert:cooldown" and kwargs.get("nx") is True and kwargs.get("ex")


def test_cooldown_ativo_nao_realerta():
    from app.workers import periodic

    r = _fake_redis(due=80, pel=0)
    r.incr = AsyncMock(return_value=5)
    r.set = AsyncMock(return_value=None)  # cooldown ainda ativo → SET NX falha
    with patch.object(periodic, "_ALERT_DUE", 50), patch.object(periodic, "_ALERT_STREAK", 2):
        out = asyncio.run(periodic._avaliar_fila_dispatcher(r))
    assert out["saturado"] is True and out["alerta"] is False
