"""
Rate limiting simples por janela fixa, baseado no Redis (INCR + EXPIRE).

Usado nas rotas públicas sensíveis a abuso (login: força bruta; signup: contas
em massa). Fail-open: se o Redis estiver fora, NÃO bloqueia o usuário legítimo.
"""
import logging
import os

from fastapi import Request

log = logging.getLogger(__name__)

# Quantos proxies nossos ficam na frente da API (Coolify/Traefik = 1). Só os
# saltos adicionados por eles são confiáveis; o resto o cliente inventa.
try:
    _TRUSTED_PROXIES = max(1, int(os.getenv("TRUSTED_PROXIES") or 1))
except ValueError:
    _TRUSTED_PROXIES = 1


def client_ip(request: Request) -> str:
    """IP real do cliente, à prova de X-Forwarded-For forjado.

    X-Forwarded-For é "cliente, proxy1, proxy2…": cada proxy APENDA quem falou
    com ele. O começo da lista é escrito pelo CLIENTE, então pegar o primeiro
    valor tornava o rate limit inútil — bastava mandar um X-Forwarded-For
    diferente a cada requisição pra ter uma "identidade" nova e escapar do
    limite de login, de cadastro e do cardápio.

    O único trecho confiável é o que os NOSSOS proxies acrescentaram, contando
    da direita. TRUSTED_PROXIES diz quantos são (Coolify/Traefik = 1).
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        partes = [p.strip() for p in fwd.split(",") if p.strip()]
        if partes:
            # N proxies confiáveis → o IP real é o N-ésimo a contar do fim.
            indice = max(0, len(partes) - _TRUSTED_PROXIES)
            return partes[indice]
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
