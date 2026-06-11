"""Pool de conexões assíncrono com Postgres (SQLAlchemy 2.0 + asyncpg)."""
import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_settings = get_settings()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except (TypeError, ValueError):
        return default


# Pool ROLE-AWARE. O worker Celery roda asyncio.run + engine.dispose() a cada task
# (loop novo por task) → NÃO reaproveita conexões. Um pool grande no worker só
# desperdiça e arrisca estourar o max_connections do Postgres quando subimos a
# concorrência (Etapa 0). Por isso worker/beat usam um pool enxuto; a API, que tem
# loop persistente, mantém o pool maior. Tudo tunável por env (Coolify).
_role = (os.getenv("APP_ROLE") or "api").lower()
_is_worker = _role in ("worker", "beat")
_default_pool, _default_overflow = (2, 3) if _is_worker else (10, 20)
_pool_size = _int_env("DB_POOL_SIZE", _default_pool)
_max_overflow = _int_env("DB_MAX_OVERFLOW", _default_overflow)

engine = create_async_engine(
    _settings.database_url,
    pool_size=_pool_size,
    max_overflow=_max_overflow,
    pool_pre_ping=True,
    echo=_settings.app_env == "development",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency do FastAPI: fornece sessão e garante close."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
