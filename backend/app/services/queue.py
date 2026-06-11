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


def _inflight_key(pid: uuid.UUID, phone: str) -> str:
    return f"inflight:{pid}:{phone}"


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
    """Tira as msgs pendentes (atômico), limpa o flush_at e move o lote para um
    "inflight" durável.

    Como o worker faz `task_acks_late=True`, se ele crashar DEPOIS do drain e ANTES
    de responder, com um drain puramente destrutivo as mensagens se perderiam (a
    task seria reentregue e encontraria a fila vazia → cliente sem resposta).
    Aqui, em vez de só apagar, gravamos o lote no `inflight:{pid}:{phone}` e só o
    limpamos via `confirm_processed` após o atendimento concluir. Numa reentrega
    (ou no próximo flush) o lote órfão é recuperado e reprocessado.

    Também reincorpora qualquer `inflight` deixado por uma execução anterior que
    falhou (recuperação automática).
    """
    pkey = _pending_key(pizzaria_id, telefone)
    ikey = _inflight_key(pizzaria_id, telefone)

    # 1) Lê inflight órfão (de um crash anterior) + pendentes novas, e remove a
    #    lista de pendentes + os marcadores de debounce — tudo atômico.
    pipe = redis.pipeline()
    pipe.lrange(ikey, 0, -1)
    pipe.lrange(pkey, 0, -1)
    pipe.delete(pkey)
    pipe.delete(_flush_key(pizzaria_id, telefone))
    pipe.delete(_first_seen_key(pizzaria_id, telefone))
    inflight_raw, pending_raw, *_ = await pipe.execute()

    itens_raw = list(inflight_raw) + list(pending_raw)
    if not itens_raw:
        return []

    # 2) Regrava o lote completo no inflight (durável até o envio ser confirmado).
    pipe2 = redis.pipeline()
    pipe2.delete(ikey)
    pipe2.rpush(ikey, *itens_raw)
    pipe2.expire(ikey, 3600)
    await pipe2.execute()

    return [json.loads(item) for item in itens_raw]


async def confirm_processed(pizzaria_id: uuid.UUID, telefone: str) -> None:
    """Limpa o lote inflight após o atendimento concluir (sucesso ou falha tratada).

    Só um crash DURO do worker (que nem roda o finally) mantém o inflight, e aí o
    lote é reprocessado numa reentrega da task — evitando perder a mensagem.
    """
    await redis.delete(_inflight_key(pizzaria_id, telefone))


# --------------------------------------------------------------------------- #
# Dispatcher assíncrono (Etapa 1) — caminho alternativo ao Celery, por pizzaria.
# Em vez de agendar uma task Celery, "arma" a conversa no ZSET de prazos que o
# serviço APP_ROLE=dispatcher drena. Reaproveita pending/inflight/lock acima.
# --------------------------------------------------------------------------- #
async def arm_dispatcher(pizzaria_id: uuid.UUID, telefone: str) -> bool:
    """Sincroniza o ZSET de prazos do dispatcher com o `flush_at` atual da conversa.

    ZADD GT: nunca ANTECIPA o prazo (só adia), então o typing que estica o
    debounce também adia o despacho. Chamado pelo webhook após enfileirar e ao
    esticar por presença. Retorna True se armou (havia flush_at pendente).
    """
    from app.dispatcher.streams import DUE_KEY

    flush_at_raw = await redis.get(_flush_key(pizzaria_id, telefone))
    if not flush_at_raw:
        return False
    await redis.zadd(DUE_KEY, {f"{pizzaria_id}:{telefone}": float(flush_at_raw)}, gt=True)
    return True


async def rearm_dispatcher(pizzaria_id: uuid.UUID | str, telefone: str, delay: float) -> None:
    """Recoloca a conversa no ZSET pra reprocessar em ~delay s.

    Usado pelo dispatcher quando o lock está preso por outra execução ou o cap de
    concorrência por pizzaria foi atingido (backpressure). Sobrescreve o score
    (retry responsivo — o drain idempotente cobre uma eventual antecipação).
    """
    from app.dispatcher.streams import DUE_KEY

    await redis.zadd(DUE_KEY, {f"{pizzaria_id}:{telefone}": time.time() + delay})
