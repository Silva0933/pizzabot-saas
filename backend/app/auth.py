"""Autenticação JWT + hashing bcrypt."""
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from passlib.context import CryptContext

from app.config import get_settings

_settings = get_settings()
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ============================================
# Senhas
# ============================================
def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


# ============================================
# JWT
# ============================================
def create_access_token(
    subject: str,
    *,
    extra: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> str:
    """`subject` é normalmente o usuario_id (UUID)."""
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=expires_minutes or _settings.jwt_access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "typ": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _settings.app_secret_key, algorithm=_settings.jwt_algorithm)


def create_refresh_token(subject: str) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(days=_settings.jwt_refresh_token_ttl_days)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "typ": "refresh",
    }
    return jwt.encode(payload, _settings.app_secret_key, algorithm=_settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Levanta jwt.InvalidTokenError se inválido/expirado."""
    return jwt.decode(token, _settings.app_secret_key, algorithms=[_settings.jwt_algorithm])
