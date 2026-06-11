"""Topologia Redis do dispatcher assíncrono (Etapa 1).

- `disp:due`   ZSET — fila de PRAZOS do debounce. Membro `"{pid}:{tel}"`,
  score = `flush_at` (epoch). Alimentado pelo webhook (ver `services/queue.py`).
- `disp:ready` STREAM — conversas com debounce vencido, prontas pra processar.
  Consumidas pelo consumer group `disp`.

O `pump_due` move membros vencidos do ZSET pro stream via script Lua ATÔMICO —
como o Redis é single-thread, várias réplicas do dispatcher podem rodar o
scheduler sem risco de despachar a mesma conversa duas vezes.
"""
import time

from app.redis_client import redis

DUE_KEY = "disp:due"
READY_STREAM = "disp:ready"
GROUP = "disp"

# Move até max_batch membros vencidos (score <= now) do ZSET (KEYS[1]) pro
# stream (KEYS[2]). Atômico: quem chegar primeiro no Redis remove+publica; as
# outras réplicas já veem o ZSET sem o membro. Retorna quantos promoveu.
_PUMP_LUA = """
local n = 0
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, member in ipairs(due) do
  redis.call('ZREM', KEYS[1], member)
  redis.call('XADD', KEYS[2], '*', 'conv', member)
  n = n + 1
end
return n
"""
_pump_script = None


async def ensure_group() -> None:
    """Cria o stream + consumer group (idempotente)."""
    try:
        await redis.xgroup_create(READY_STREAM, GROUP, id="0", mkstream=True)
    except Exception as e:  # noqa: BLE001
        if "BUSYGROUP" not in str(e):
            raise


async def pump_due(max_batch: int = 200) -> int:
    """Promove conversas com debounce vencido pro stream. Retorna quantas."""
    global _pump_script
    if _pump_script is None:
        _pump_script = redis.register_script(_PUMP_LUA)
    return int(await _pump_script(keys=[DUE_KEY, READY_STREAM], args=[time.time(), max_batch]))


async def read_ready(consumer: str, count: int, block_ms: int) -> list[tuple[str, str | None]]:
    """XREADGROUP de novas entradas (>). Retorna [(entry_id, conv), ...]."""
    res = await redis.xreadgroup(GROUP, consumer, {READY_STREAM: ">"}, count=count, block=block_ms)
    out: list[tuple[str, str | None]] = []
    for _stream, entries in res or []:
        for entry_id, fields in entries:
            out.append((entry_id, (fields or {}).get("conv")))
    return out


async def ack(entry_id: str) -> None:
    await redis.xack(READY_STREAM, GROUP, entry_id)


async def claim_stale(consumer: str, min_idle_ms: int = 60000, count: int = 50) -> list[tuple[str, str | None]]:
    """Recupera entradas presas no PEL de consumers mortos (XAUTOCLAIM)."""
    try:
        res = await redis.xautoclaim(READY_STREAM, GROUP, consumer, min_idle_ms, start_id="0-0", count=count)
    except Exception:  # noqa: BLE001
        return []
    # redis-py 7.x: [next_cursor, messages, deleted_ids]
    messages = res[1] if isinstance(res, (list, tuple)) and len(res) >= 2 else []
    out: list[tuple[str, str | None]] = []
    for entry_id, fields in messages:
        out.append((entry_id, (fields or {}).get("conv") if fields else None))
    return out
