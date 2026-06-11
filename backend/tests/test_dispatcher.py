"""
Testes do dispatcher assíncrono (Etapa 1).

Cobrem a lógica sem Redis real (mocks): arming no ZSET, cap por pizzaria, e os
caminhos do handler — conversa vazia, lock preso e happy path (drena + chama o
agente + confirma + solta lock/tenant/semáforo + ACK). Também o parsing das
respostas de XREADGROUP/XAUTOCLAIM.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


PID = uuid.UUID("00000000-0000-0000-0000-000000000001")
TEL = "5511999999999"
CONV = f"{PID}:{TEL}"


class _FakeSession:
    async def __aenter__(self):
        return MagicMock()

    async def __aexit__(self, *a):
        return False


# ----------------------------- parse + arming ------------------------------ #
def test_parse_conv_separa_uuid_e_telefone():
    from app.dispatcher.runner import _parse_conv
    pid, tel = _parse_conv(CONV)
    assert pid == str(PID)
    assert tel == TEL


def test_arm_dispatcher_zadd_gt_quando_ha_flush_at():
    from app.services import queue
    r = MagicMock()
    r.get = AsyncMock(return_value="1700000000.0")
    r.zadd = AsyncMock()
    with patch.object(queue, "redis", r):
        ok = asyncio.run(queue.arm_dispatcher(PID, TEL))
    assert ok is True
    args, kwargs = r.zadd.call_args
    assert args[0] == "disp:due"
    assert args[1] == {CONV: 1700000000.0}
    assert kwargs.get("gt") is True


def test_arm_dispatcher_sem_flush_at_nao_arma():
    from app.services import queue
    r = MagicMock()
    r.get = AsyncMock(return_value=None)
    r.zadd = AsyncMock()
    with patch.object(queue, "redis", r):
        ok = asyncio.run(queue.arm_dispatcher(PID, TEL))
    assert ok is False
    r.zadd.assert_not_called()


def test_rearm_dispatcher_usa_now_mais_delay():
    from app.services import queue
    r = MagicMock()
    r.zadd = AsyncMock()
    with patch.object(queue, "redis", r):
        with patch.object(queue.time, "time", return_value=1000.0):
            asyncio.run(queue.rearm_dispatcher(PID, TEL, 2.0))
    args, _ = r.zadd.call_args
    assert args[0] == "disp:due"
    assert args[1] == {CONV: 1002.0}


# ------------------------------ cap por tenant ----------------------------- #
def test_tenant_admit_abaixo_do_cap():
    from app.dispatcher import runner
    r = MagicMock()
    r.incr = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    with patch("app.redis_client.redis", r), patch.object(runner, "TENANT_CAP", 25):
        admitido = asyncio.run(runner._tenant_admit(str(PID)))
    assert admitido is True
    r.expire.assert_awaited()  # primeiro INCR seta TTL


def test_tenant_admit_acima_do_cap_recua():
    from app.dispatcher import runner
    r = MagicMock()
    r.incr = AsyncMock(return_value=26)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    with patch("app.redis_client.redis", r), patch.object(runner, "TENANT_CAP", 25):
        admitido = asyncio.run(runner._tenant_admit(str(PID)))
    assert admitido is False
    r.decr.assert_awaited()  # devolve a vaga


# -------------------------------- handler ---------------------------------- #
def test_handle_conv_vazia_so_da_ack():
    from app.dispatcher import runner
    sem = asyncio.Semaphore(1)
    asyncio.run(sem.acquire())
    with patch.object(runner.streams, "ack", new=AsyncMock()) as ack:
        asyncio.run(runner._handle("1-0", None, sem))
    ack.assert_awaited_once_with("1-0")
    assert not sem.locked()  # semáforo devolvido


def test_handle_lock_preso_reprograma_sem_chamar_agente():
    from app.dispatcher import runner
    from app.services import queue
    r = MagicMock()
    r.incr = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    r.set = AsyncMock(return_value=None)  # lock NÃO adquirido
    sem = asyncio.Semaphore(1)
    asyncio.run(sem.acquire())
    with patch("app.redis_client.redis", r), \
         patch.object(queue, "rearm_dispatcher", new=AsyncMock()) as rearm, \
         patch.object(runner.streams, "ack", new=AsyncMock()) as ack, \
         patch("app.agent.runner.process_and_reply", new=AsyncMock()) as pr:
        asyncio.run(runner._handle("2-0", CONV, sem))
    rearm.assert_awaited_once()
    pr.assert_not_called()
    ack.assert_awaited_once_with("2-0")
    assert not sem.locked()


def test_handle_happy_path_drena_chama_agente_confirma_e_solta_tudo():
    from app.dispatcher import runner
    from app.services import queue
    r = MagicMock()
    r.incr = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    r.set = AsyncMock(return_value=True)   # lock adquirido
    r.delete = AsyncMock()
    sem = asyncio.Semaphore(2)
    asyncio.run(sem.acquire())
    with patch("app.redis_client.redis", r), \
         patch.object(queue, "drain_pending", new=AsyncMock(return_value=[{"conteudo": "quero uma calabresa"}])), \
         patch.object(queue, "confirm_processed", new=AsyncMock()) as confirm, \
         patch.object(runner.streams, "ack", new=AsyncMock()) as ack, \
         patch("app.agent.runner.process_and_reply", new=AsyncMock(return_value={"ok": True})) as pr, \
         patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
        asyncio.run(runner._handle("3-0", CONV, sem))
    pr.assert_awaited_once()
    assert pr.call_args.args[1] == PID            # pizzaria_id como UUID
    assert pr.call_args.args[2] == TEL
    assert pr.call_args.args[3] == "quero uma calabresa"
    confirm.assert_awaited_once()
    r.delete.assert_awaited()                      # soltou o lock
    r.decr.assert_awaited()                        # soltou a vaga do tenant
    ack.assert_awaited_once_with("3-0")
    assert not sem.locked()


def test_handle_pending_vazio_nao_chama_agente_mas_confirma():
    from app.dispatcher import runner
    from app.services import queue
    r = MagicMock()
    r.incr = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    r.set = AsyncMock(return_value=True)
    r.delete = AsyncMock()
    sem = asyncio.Semaphore(1)
    asyncio.run(sem.acquire())
    with patch("app.redis_client.redis", r), \
         patch.object(queue, "drain_pending", new=AsyncMock(return_value=[])), \
         patch.object(queue, "confirm_processed", new=AsyncMock()) as confirm, \
         patch.object(runner.streams, "ack", new=AsyncMock()) as ack, \
         patch("app.agent.runner.process_and_reply", new=AsyncMock()) as pr:
        asyncio.run(runner._handle("4-0", CONV, sem))
    pr.assert_not_called()
    confirm.assert_awaited_once()
    ack.assert_awaited_once_with("4-0")


# ----------------------------- streams parsing ----------------------------- #
def test_read_ready_extrai_id_e_conv():
    from app.dispatcher import streams
    r = MagicMock()
    r.xreadgroup = AsyncMock(return_value=[["disp:ready", [("10-0", {"conv": CONV}), ("11-0", {"conv": "a:b"})]]])
    with patch.object(streams, "redis", r):
        out = asyncio.run(streams.read_ready("c0", count=10, block_ms=100))
    assert out == [("10-0", CONV), ("11-0", "a:b")]


def test_claim_stale_parseia_tupla_de_3_do_xautoclaim():
    from app.dispatcher import streams
    r = MagicMock()
    # redis-py 7.x: [next_cursor, messages, deleted_ids]
    r.xautoclaim = AsyncMock(return_value=["0-0", [("20-0", {"conv": CONV})], []])
    with patch.object(streams, "redis", r):
        out = asyncio.run(streams.claim_stale("c0-reclaim"))
    assert out == [("20-0", CONV)]
