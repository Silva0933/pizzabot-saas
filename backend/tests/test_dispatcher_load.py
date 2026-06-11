"""
Integração + CARGA do dispatcher com Redis REAL (pula sem Redis — roda no CI).

Exercita o caminho de produção de ponta a ponta com o agente STUBADO:
  enqueue_message (pending real) → pump_due (Lua) → read_ready (consumer group)
  → runner._handle (drain_pending/lock/confirm reais) → ack.

Cobre: muitas conversas distintas sem perda/duplicação, idempotência de entrada
duplicada no stream, recuperação via XAUTOCLAIM e o cap por pizzaria sob pressão.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from unittest.mock import AsyncMock, patch

import pytest


def _redis_ok() -> bool:
    from redis.asyncio import Redis

    async def _ping() -> bool:
        try:
            r = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
            ok = bool(await r.ping())
            await r.aclose()
            return ok
        except Exception:
            return False

    return asyncio.run(_ping())


pytestmark = pytest.mark.skipif(not _redis_ok(), reason="Redis indisponível (defina REDIS_URL)")


class _FakeSession:
    async def __aenter__(self):
        return AsyncMock()

    async def __aexit__(self, *a):
        return False


async def _new_redis():
    from redis.asyncio import Redis

    return Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)


async def _swap_globals(r):
    """Aponta os módulos pro Redis de teste; devolve um restore()."""
    import app.redis_client as rc
    from app.dispatcher import streams
    from app.services import queue

    orig = (rc.redis, streams.redis, queue.redis, streams._pump_script)
    rc.redis = r
    streams.redis = r
    queue.redis = r
    streams._pump_script = None

    def restore():
        rc.redis, streams.redis, queue.redis, streams._pump_script = orig

    return restore


async def _reset_keys(r):
    from app.dispatcher import streams

    # Limpa estado de runs anteriores (chaves do dispatcher + filas por conversa).
    for pat in ("disp:*", "pending:*", "inflight:*", "flush_at:*", "batch_start:*", "lock:flush:*"):
        async for k in r.scan_iter(match=pat, count=500):
            await r.delete(k)
    try:
        await r.xgroup_destroy(streams.READY_STREAM, streams.GROUP)
    except Exception:
        pass
    await streams.ensure_group()


async def _arm(r, pid, tel, textos):
    """Enfileira mensagens reais e marca a conversa como vencida no ZSET."""
    from app.dispatcher import streams
    from app.services import queue

    for t in textos:
        await queue.enqueue_message(pizzaria_id=pid, telefone=tel, mensagem_id=uuid.uuid4(), conteudo=t)
    await r.zadd(streams.DUE_KEY, {f"{pid}:{tel}": 0})  # score 0 = vencido


async def _process_all(r, sem, consumer="cload", max_rounds=60):
    from app.dispatcher import runner, streams

    for _ in range(max_rounds):
        await streams.pump_due(500)
        entries = await streams.read_ready(consumer, count=100, block_ms=200)
        if entries:
            tasks = []
            for entry_id, conv in entries:
                await sem.acquire()
                tasks.append(asyncio.create_task(runner._handle(entry_id, conv, sem)))
            await asyncio.gather(*tasks)
            continue
        if await r.zcard(streams.DUE_KEY) == 0:
            pend = await r.xpending(streams.READY_STREAM, streams.GROUP)
            pc = pend.get("pending") if isinstance(pend, dict) else pend
            if not pc:
                return
        await asyncio.sleep(0.03)


def test_muitas_conversas_distintas_sem_perda_nem_duplicacao():
    async def run():
        r = await _new_redis()
        restore = await _swap_globals(r)
        try:
            await _reset_keys(r)
            from app.dispatcher import streams

            K = 20
            convs = {uuid.uuid4(): f"5511{i:09d}" for i in range(K)}
            for pid, tel in convs.items():
                await _arm(r, pid, tel, [f"pedido da conversa {tel}"])

            assert await streams.pump_due(500) == K  # todas promovidas

            calls = []
            pr = AsyncMock(side_effect=lambda db, pid, tel, txt: calls.append((str(pid), tel, txt)))
            sem = asyncio.Semaphore(4)  # < K: força backpressure pelo semáforo
            with patch("app.agent.runner.process_and_reply", new=pr), \
                 patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
                await _process_all(r, sem)

            # cada conversa processada EXATAMENTE uma vez, conteúdo certo
            assert len(calls) == K
            assert {c[1] for c in calls} == set(convs.values())
            assert all(c[2] == f"pedido da conversa {c[1]}" for c in calls)
            # nada sobrou: zset vazio, sem pending/inflight, PEL zerado
            assert await r.zcard(streams.DUE_KEY) == 0
            assert await r.exists(*[f"pending:{p}:{t}" for p, t in convs.items()]) == 0
            pend = await r.xpending(streams.READY_STREAM, streams.GROUP)
            assert (pend.get("pending") if isinstance(pend, dict) else pend) == 0
            assert sem._value == 4  # todos os permits devolvidos
        finally:
            restore()
            await r.aclose()

    asyncio.run(run())


def test_entrada_duplicada_no_stream_processa_uma_vez():
    async def run():
        r = await _new_redis()
        restore = await _swap_globals(r)
        try:
            await _reset_keys(r)
            from app.dispatcher import streams

            pid, tel = uuid.uuid4(), "5511000000001"
            await _arm(r, pid, tel, ["quero uma calabresa"])
            await streams.pump_due(500)
            # Simula re-arme: uma 2ª entrada ready pra MESMA conversa.
            await r.xadd(streams.READY_STREAM, {"conv": f"{pid}:{tel}"})

            calls = []
            pr = AsyncMock(side_effect=lambda db, p, t, txt: calls.append(txt))
            sem = asyncio.Semaphore(8)
            with patch("app.agent.runner.process_and_reply", new=pr), \
                 patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
                await _process_all(r, sem)

            # lock + drain idempotente: processa o conteúdo só UMA vez
            assert calls == ["quero uma calabresa"]
        finally:
            restore()
            await r.aclose()

    asyncio.run(run())


def test_xautoclaim_recupera_entrada_presa():
    async def run():
        r = await _new_redis()
        restore = await _swap_globals(r)
        try:
            await _reset_keys(r)
            from app.dispatcher import streams

            pid, tel = uuid.uuid4(), "5511000000002"
            await _arm(r, pid, tel, ["boa noite"])
            await streams.pump_due(500)

            # Consumer "morto" lê mas NÃO faz ack (entrada fica no PEL dele).
            presa = await streams.read_ready("morto", count=10, block_ms=200)
            assert len(presa) == 1

            # Outro consumer reivindica (min_idle=0) e processa.
            recuperadas = await streams.claim_stale("vivo", min_idle_ms=0, count=10)
            assert any(c == f"{pid}:{tel}" for _id, c in recuperadas)

            calls = []
            pr = AsyncMock(side_effect=lambda db, p, t, txt: calls.append(txt))
            sem = asyncio.Semaphore(4)
            with patch("app.agent.runner.process_and_reply", new=pr), \
                 patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
                for entry_id, conv in recuperadas:
                    await sem.acquire()
                    await runner_handle(entry_id, conv, sem)

            assert calls == ["boa noite"]
        finally:
            restore()
            await r.aclose()

    asyncio.run(run())


def test_cap_por_tenant_sob_pressao_processa_tudo():
    async def run():
        from app.dispatcher import runner, streams

        r = await _new_redis()
        restore = await _swap_globals(r)
        try:
            await _reset_keys(r)
            pid = uuid.uuid4()  # MESMA pizzaria → disputa o cap
            tels = [f"5522{i:09d}" for i in range(10)]
            for tel in tels:
                await _arm(r, pid, tel, [f"msg {tel}"])

            calls = []
            pr = AsyncMock(side_effect=lambda db, p, t, txt: calls.append(t))
            sem = asyncio.Semaphore(10)
            # cap baixo: força re-arms (backpressure por tenant), mas tudo conclui
            with patch.object(runner, "TENANT_CAP", 3), \
                 patch("app.agent.runner.process_and_reply", new=pr), \
                 patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
                await _process_all(r, sem)

            assert sorted(calls) == sorted(tels)  # cada conversa 1x, nenhuma perdida
            assert await r.zcard(streams.DUE_KEY) == 0
        finally:
            restore()
            await r.aclose()

    asyncio.run(run())


# alias usado no teste de reclaim (mantém a chamada legível)
def runner_handle(*a, **k):
    from app.dispatcher import runner

    return runner._handle(*a, **k)
