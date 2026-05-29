"""
Fila com debounce por conversa (pizzaria + telefone).

Quando uma msg chega:
  - Empilha no Redis (lista `pending:{pid}:{phone}`)
  - Atualiza `flush_at:{pid}:{phone}` para now + 3s
  - Agenda task Celery `flush_conversation` com countdown=3s

Quando a task roda:
  - Se ainda existe `flush_at` > now → reagenda mais 1s
  - Senão → pega todas as msgs pendentes e processa (Fase 3 chama o agente IA)

Esse padrão evita o bot responder no meio de "boa noite, vc tem calabresa,
me manda preço pra dois litros". Espera o cliente parar de digitar.
"""
import json
import time
import uuid
from typing import Any

from app.redis_client import redis

DEBOUNCE_SECONDS = 10.0


def _pending_key(pid: uuid.UUID, phone: str) -> str:
    return f"pending:{pid}:{phone}"


def _flush_key(pid: uuid.UUID, phone: str) -> str:
    return f"flush_at:{pid}:{phone}"


async def enqueue_message(
    *,
    pizzaria_id: uuid.UUID,
    telefone: str,
    mensagem_id: uuid.UUID,
    conteudo: str,
    metadata: dict[str, Any] | None = None,
) -> float:
    """Empilha uma msg e retorna o `flush_at` (epoch seconds)."""
    flush_at = time.time() + DEBOUNCE_SECONDS
    entry = {
        "mensagem_id": str(mensagem_id),
        "conteudo": conteudo,
        "metadata": metadata or {},
        "ts": time.time(),
    }

    pipe = redis.pipeline()
    pipe.rpush(_pending_key(pizzaria_id, telefone), json.dumps(entry))
    # Conversa "morta" depois de 1h sem msg cai sozinha
    pipe.expire(_pending_key(pizzaria_id, telefone), 3600)
    pipe.set(_flush_key(pizzaria_id, telefone), str(flush_at), ex=3600)
    await pipe.execute()

    return flush_at


async def should_flush_now(pizzaria_id: uuid.UUID, telefone: str) -> tuple[bool, float]:
    """Retorna (pode_fazer_flush, segundos_a_esperar)."""
    flush_at_raw = await redis.get(_flush_key(pizzaria_id, telefone))
    if not flush_at_raw:
        return True, 0.0
    flush_at = float(flush_at_raw)
    delta = flush_at - time.time()
    if delta <= 0:
        return True, 0.0
    return False, delta


async def drain_pending(pizzaria_id: uuid.UUID, telefone: str) -> list[dict[str, Any]]:
    """Tira todas as msgs pendentes (atômico) e limpa o flush_at."""
    key = _pending_key(pizzaria_id, telefone)

    # LRANGE + DELETE atômico via pipeline
    pipe = redis.pipeline()
    pipe.lrange(key, 0, -1)
    pipe.delete(key)
    pipe.delete(_flush_key(pizzaria_id, telefone))
    raw_list, _, _ = await pipe.execute()

    return [json.loads(item) for item in raw_list]
