"""Conexão Redis compartilhada (async)."""
from redis.asyncio import Redis

from app.config import get_settings

_settings = get_settings()

# Pool global de conexões assíncronas
redis: Redis = Redis.from_url(
    _settings.redis_url,
    encoding="utf-8",
    decode_responses=True,
    health_check_interval=30,
)


async def ping() -> bool:
    return bool(await redis.ping())
