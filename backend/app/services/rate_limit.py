"""
Rate limiting simples por janela fixa, baseado no Redis (INCR + EXPIRE).

Usado nas rotas públicas sensíveis a abuso (login: força bruta; signup: contas
em massa). Fail-open: se o Redis estiver fora, NÃO bloqueia o usuário legítimo.
"""
import logging

from fastapi import Request

log = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """IP real do cliente (atrás do proxy do Coolify vem em X-Forwarded-For)."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def allow(key: str, *, max_hits: int, window_seconds: int) -> bool:
    """True = pode seguir; False = estourou o limite na janela."""
    try:
        from app.redis_client import redis

        rkey = f"ratelimit:{key}"
        hits = await redis.incr(rkey)
        if hits == 1:
            await redis.expire(rkey, window_seconds)
        return hits <= max_hits
    except Exception as e:  # noqa: BLE001
        log.debug("Rate limit indisponível (fail-open): %s", e)
        return True
