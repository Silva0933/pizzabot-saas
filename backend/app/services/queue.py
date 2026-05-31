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

# Debounce base curto: respondemos ~7s após a última MENSAGEM. Se a Evolution
# avisar que o cliente está "digitando" (presence.update), esticamos a espera
# por mais TYPING_GRACE_SECONDS a cada sinal — assim a gente espera ele terminar
# de escrever antes de responder, sem ficar preso num timer fixo longo.
DEBOUNCE_SECONDS = 7.0
TYPING_GRACE_SECONDS = 6.0
# Teto: nunca segura mais que isso desde a última mensagem (evita travar pra
# sempre se os eventos de "digitando" não pararem de chegar).
MAX_HOLD_SECONDS = 45.0


def _pending_key(pid: uuid.UUID, phone: str) -> str:
    return f"pending:{pid}:{phone}"


def _flush_key(pid: uuid.UUID, phone: str) -> str:
    return f"flush_at:{pid}:{phone}"


def _first_seen_key(pid: uuid.UUID, phone: str) -> str:
    return f"batch_start:{pid}:{phone}"


async def touch_typing(pizzaria_id: uuid.UUID, telefone: str) -> bool:
    """
    Cliente está digitando: estica o flush_at por mais TYPING_GRACE_SECONDS,
    respeitando o teto MAX_HOLD_SECONDS desde a 1ª mensagem do lote.

    Só estica se já existir um lote pendente (flush_at setado) — não faz sentido
    segurar nada se não há mensagem na fila ainda.
    Retorna True se esticou.
    """
    flush_at_raw = await redis.get(_flush_key(pizzaria_id, telefone))
    if not flush_at_raw:
        return False

    now = time.time()
    novo_flush = now + TYPING_GRACE_SECONDS

    # Respeita o teto a partir do início do lote.
    started_raw = await redis.get(_first_seen_key(pizzaria_id, telefone))
    if started_raw:
        limite = float(started_raw) + MAX_HOLD_SECONDS
        novo_flush = min(novo_flush, limite)

    atual = float(flush_at_raw)
    if novo_flush <= atual:
        return False  # já estamos esperando mais que isso

    await redis.set(_flush_key(pizzaria_id, telefone), str(novo_flush), ex=3600)
    return True


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
    # Marca o início do lote (só na 1ª msg) para o teto MAX_HOLD_SECONDS.
    pipe.set(_first_seen_key(pizzaria_id, telefone), str(time.time()), nx=True, ex=3600)
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
    pipe.delete(_first_seen_key(pizzaria_id, telefone))
    raw_list, _, _, _ = await pipe.execute()

    return [json.loads(item) for item in raw_list]
