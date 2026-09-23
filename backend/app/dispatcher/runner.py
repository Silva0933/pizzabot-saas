"""Loop principal do dispatcher assíncrono (Etapa 1).

Entrada: `APP_ROLE=dispatcher` → `python -m app.dispatcher.runner`.

Um único event loop por processo roda:
  - scheduler: promove conversas com debounce vencido (ZSET → stream), Lua atômico;
  - N readers: XREADGROUP do stream e despacham handlers limitados por um semáforo;
  - reclaim: XAUTOCLAIM recupera entradas de consumers mortos.

Cada handler reaproveita as primitivas atuais (lock por conversa, drain_pending,
process_and_reply, confirm_processed). O loop é PERSISTENTE → pool de DB e client
do LLM são reaproveitados (sem dispose/reset por mensagem, ao contrário do worker).
"""
import asyncio
import collections
import logging
import os
import signal
import socket
import time
import uuid as _uuid

from app.dispatcher import streams
from app.observability import init_sentry

log = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except (TypeError, ValueError):
        return default


# Concorrência global de process_and_reply simultâneos. LIMITADA pelas conexões
# do Postgres: a sessão fica aberta durante a chamada do LLM (2–15s), então cada
# conversa em voo segura 1 conexão. Pra ir além de ~dezenas, use PgBouncer e/ou
# eleve max_connections. O pool de DB (db.py, papel 'dispatcher') acompanha isto.
CONCURRENCY = _int_env("DISPATCHER_CONCURRENCY", 40)
READERS = _int_env("DISPATCHER_READERS", 4)
TENANT_CAP = _int_env("DISPATCHER_TENANT_CAP", 25)
SCHEDULER_INTERVAL = float(os.getenv("DISPATCHER_SCHEDULER_INTERVAL") or 0.25)
READ_COUNT = _int_env("DISPATCHER_READ_COUNT", 10)
RECLAIM_INTERVAL = float(os.getenv("DISPATCHER_RECLAIM_INTERVAL") or 30.0)
RECLAIM_MIN_IDLE_MS = _int_env("DISPATCHER_RECLAIM_MIN_IDLE_MS", 60000)
METRICS_INTERVAL = float(os.getenv("DISPATCHER_METRICS_INTERVAL") or 30.0)
LOCK_TTL = 90  # igual ao FLUSH_LOCK_TTL do worker — mesmo namespace de lock

# Nome único por réplica (o consumer group exige consumers distintos por réplica,
# senão dois processos compartilhariam o mesmo PEL).
_HOST = os.getenv("HOSTNAME") or socket.gethostname() or _uuid.uuid4().hex[:8]

_stop = asyncio.Event()
_inflight: set[asyncio.Task] = set()
# Janela das últimas durações de handle (p50/p95 nas métricas periódicas).
_durations: collections.deque[float] = collections.deque(maxlen=500)


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1))))
    return s[k]


def _parse_conv(conv: str) -> tuple[str, str]:
    pid, tel = conv.rsplit(":", 1)
    return pid, tel


async def _tenant_admit(pid: str) -> bool:
    """Cap de concorrência por pizzaria (justiça). INCR com teto; True se admitido."""
    from app.redis_client import redis

    key = f"disp:tenant:{pid}"
    n = await redis.incr(key)
    if n == 1:
        await redis.expire(key, 300)
    if n > TENANT_CAP:
        await redis.decr(key)
        return False
    return True


async def _tenant_release(pid: str) -> None:
    from app.redis_client import redis

    try:
        await redis.decr(f"disp:tenant:{pid}")
    except Exception:  # noqa: BLE001
        pass


async def _handle(entry_id: str, conv: str | None, sem: asyncio.Semaphore) -> None:
    """Processa UMA conversa pronta. ACK, release de tenant e do semáforo
    acontecem EXATAMENTE uma vez, no finally externo."""
    from app.redis_client import redis
    from app.services.queue import confirm_processed, drain_pending, rearm_dispatcher

    admitted = False
    pid: str | None = None
    try:
        if not conv:
            return
        pid, tel = _parse_conv(conv)

        # Cap por pizzaria: se estourou, devolve pro ZSET e tenta de novo já já.
        if not await _tenant_admit(pid):
            await rearm_dispatcher(pid, tel, 1.5)
            return
        admitted = True

        lock_key = f"lock:flush:{pid}:{tel}"
        got = await redis.set(lock_key, "1", nx=True, ex=LOCK_TTL)
        if not got:
            # Outra execução está com esta conversa: reprograma e sai.
            await rearm_dispatcher(pid, tel, 2.0)
            return
        try:
            pid_uuid = _uuid.UUID(pid)
            pending = await drain_pending(pid_uuid, tel)
            if pending:
                t0 = time.monotonic()
                conteudo = "\n".join(p["conteudo"] for p in pending if p.get("conteudo"))
                if conteudo.strip():
                    from app.agent.runner import process_and_reply
                    from app.db import AsyncSessionLocal

                    async with AsyncSessionLocal() as db:
                        try:
                            await process_and_reply(db, pid_uuid, tel, conteudo)
                        except Exception as e:  # noqa: BLE001
                            log.exception("Dispatcher: agente falhou (pid=%s tel=%s): %s", pid, tel, e)
                            try:
                                await db.rollback()
                            except Exception:  # noqa: BLE001
                                pass
                dur = time.monotonic() - t0
                _durations.append(dur)
                log.info(
                    "Dispatcher: conversa processada pid=%s tel=%s msgs=%d dur=%.2fs",
                    pid, tel, len(pending), dur,
                )
            await confirm_processed(pid_uuid, tel)
        finally:
            try:
                await redis.delete(lock_key)
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        log.exception("Dispatcher: erro inesperado no handle (%s): %s", conv, e)
    finally:
        if admitted and pid is not None:
            await _tenant_release(pid)
        try:
            await streams.ack(entry_id)
        except Exception:  # noqa: BLE001
            pass
        sem.release()


def _spawn(coro) -> None:
    """Cria task e mantém referência (evita GC de task pendente)."""
    t = asyncio.create_task(coro)
    _inflight.add(t)
    t.add_done_callback(_inflight.discard)


async def _scheduler_loop() -> None:
    from app.redis_client import redis

    while not _stop.is_set():
        try:
            await streams.pump_due(max_batch=200)
            # heartbeat pro healthcheck do container
            await redis.set(f"disp:hb:{_HOST}", "1", ex=30)
        except Exception as e:  # noqa: BLE001
            log.warning("Dispatcher scheduler: %s", e)
        try:
            await asyncio.wait_for(_stop.wait(), timeout=SCHEDULER_INTERVAL)
        except TimeoutError:
            pass


async def _reader_loop(consumer: str, sem: asyncio.Semaphore) -> None:
    while not _stop.is_set():
        try:
            entries = await streams.read_ready(consumer, count=READ_COUNT, block_ms=1000)
        except Exception as e:  # noqa: BLE001
            log.warning("Dispatcher reader %s: %s", consumer, e)
            await asyncio.sleep(0.5)
            continue
        for entry_id, conv in entries:
            await sem.acquire()  # backpressure: não lê mais do que dá conta
            _spawn(_handle(entry_id, conv, sem))


async def _reclaim_loop(consumer: str, sem: asyncio.Semaphore) -> None:
    while not _stop.is_set():
        try:
            await asyncio.wait_for(_stop.wait(), timeout=RECLAIM_INTERVAL)
            break  # _stop setado
        except TimeoutError:
            pass
        try:
            stale = await streams.claim_stale(consumer, RECLAIM_MIN_IDLE_MS, count=50)
        except Exception as e:  # noqa: BLE001
            log.warning("Dispatcher reclaim: %s", e)
            continue
        for entry_id, conv in stale:
            await sem.acquire()
            _spawn(_handle(entry_id, conv, sem))


async def _metrics_loop(sem: asyncio.Semaphore) -> None:
    """Loga métricas periódicas (profundidade de fila, PEL, em-voo, p50/p95).
    Vira sinal de saturação/escala (Etapa 2)."""
    from app.redis_client import redis

    while not _stop.is_set():
        try:
            await asyncio.wait_for(_stop.wait(), timeout=METRICS_INTERVAL)
            break  # _stop setado
        except TimeoutError:
            pass
        try:
            due = await redis.zcard(streams.DUE_KEY)
            ready = await redis.xlen(streams.READY_STREAM)
            try:
                pend = await redis.xpending(streams.READY_STREAM, streams.GROUP)
                pel = pend.get("pending") if isinstance(pend, dict) else pend
            except Exception:  # noqa: BLE001
                pel = "?"
            durs = list(_durations)
            log.info(
                "Dispatcher metrics: due=%s ready=%s pel=%s inflight=%s sem_free=%s "
                "p50=%.2fs p95=%.2fs (n=%d)",
                due, ready, pel, len(_inflight), sem._value,
                _pct(durs, 50), _pct(durs, 95), len(durs),
            )
        except Exception as e:  # noqa: BLE001
            log.warning("Dispatcher metrics falhou: %s", e)


async def run_dispatcher() -> None:
    init_sentry("dispatcher")
    await streams.ensure_group()
    sem = asyncio.Semaphore(CONCURRENCY)
    log.info(
        "Dispatcher iniciando (host=%s): concurrency=%s readers=%s tenant_cap=%s",
        _HOST, CONCURRENCY, READERS, TENANT_CAP,
    )
    tasks = [
        asyncio.create_task(_scheduler_loop()),
        asyncio.create_task(_reclaim_loop(f"{_HOST}-reclaim", sem)),
        asyncio.create_task(_metrics_loop(sem)),
    ]
    for i in range(READERS):
        tasks.append(asyncio.create_task(_reader_loop(f"{_HOST}-c{i}", sem)))

    await _stop.wait()
    log.info("Dispatcher recebeu sinal de parada — encerrando loops.")
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    # Deixa os handlers em voo terminarem (best-effort, com teto).
    if _inflight:
        await asyncio.wait(set(_inflight), timeout=20)


def _install_signals(loop: asyncio.AbstractEventLoop) -> None:
    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is None:
            continue
        try:
            loop.add_signal_handler(sig, _stop.set)
        except NotImplementedError:
            pass  # Windows não suporta add_signal_handler


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    # httpx loga cada request em INFO — ruidoso. Deixa o sinal do dispatcher limpo.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signals(loop)
    try:
        loop.run_until_complete(run_dispatcher())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
