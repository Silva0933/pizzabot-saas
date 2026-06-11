"""
Smoke de INTEGRAÇÃO do dispatcher com Redis REAL (Lua do scheduler + stream).

Pula automaticamente se não houver Redis acessível (CI-safe). Para rodar:
  REDIS_URL=redis://localhost:6379/0 pytest tests/test_dispatcher_redis_smoke.py

Valida o que os mocks não cobrem: o script Lua atômico promovendo só os prazos
vencidos, o roundtrip pelo consumer group e a re-arm.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid

import pytest


def _redis_ok() -> bool:
    from redis.asyncio import Redis

    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    async def _ping() -> bool:
        try:
            r = Redis.from_url(url, decode_responses=True)
            ok = bool(await r.ping())
            await r.aclose()
            return ok
        except Exception:
            return False

    return asyncio.run(_ping())


pytestmark = pytest.mark.skipif(not _redis_ok(), reason="Redis indisponível (defina REDIS_URL)")


async def _fresh_redis():
    from redis.asyncio import Redis

    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return Redis.from_url(url, decode_responses=True)


def test_pump_due_promove_so_vencidos_e_e_atomico():
    async def run():
        from app.dispatcher import streams

        r = await _fresh_redis()
        # Limpa estado anterior do smoke.
        await r.delete(streams.DUE_KEY, streams.READY_STREAM)
        try:
            await r.xgroup_destroy(streams.READY_STREAM, streams.GROUP)
        except Exception:
            pass

        import app.redis_client as rc
        rc.redis = r  # streams usa app.redis_client.redis
        streams.redis = r
        streams._pump_script = None

        await streams.ensure_group()

        pid = uuid.uuid4()
        vencido = f"{pid}:551100000001"
        futuro = f"{pid}:551100000002"
        now = time.time()
        await r.zadd(streams.DUE_KEY, {vencido: now - 5, futuro: now + 999})

        promovidos = await streams.pump_due(max_batch=100)
        assert promovidos == 1                       # só o vencido
        assert await r.zcard(streams.DUE_KEY) == 1   # o futuro continua no zset

        # 2ª chamada não promove de novo (já saiu do zset) — atômico/idempotente.
        assert await streams.pump_due(max_batch=100) == 0

        entries = await streams.read_ready("smoke-c0", count=10, block_ms=200)
        convs = [c for _id, c in entries]
        assert vencido in convs
        for entry_id, _c in entries:
            await streams.ack(entry_id)

        await r.delete(streams.DUE_KEY, streams.READY_STREAM)
        await r.aclose()

    asyncio.run(run())


def test_rearm_volta_pro_zset():
    async def run():
        from app.dispatcher import streams
        from app.services import queue

        r = await _fresh_redis()
        import app.redis_client as rc
        rc.redis = r
        streams.redis = r
        queue.redis = r

        pid = uuid.uuid4()
        await r.delete(streams.DUE_KEY)
        await queue.rearm_dispatcher(pid, "551100000003", 0.0)
        assert await r.zscore(streams.DUE_KEY, f"{pid}:551100000003") is not None
        await r.delete(streams.DUE_KEY)
        await r.aclose()

    asyncio.run(run())
