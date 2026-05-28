"""Dependencies do FastAPI: auth, contexto de tenant, etc."""
import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token
from app.db import get_db
from app.models import EquipePizzaria, Usuario

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Usuario:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")

    try:
        payload = decode_token(token)
        if payload.get("typ") != "access":
            raise ValueError("token type")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Token inválido: {e}") from e

    user = (await db.execute(select(Usuario).where(Usuario.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado")
    return user


async def require_platform_admin(user: Usuario = Depends(current_user)) -> Usuario:
    if not user.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito à plataforma")
    return user


async def membership(
    pizzaria_id: uuid.UUID,
    user: Usuario = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> EquipePizzaria:
    """Garante que o usuário pertence à pizzaria. Platform admins passam direto."""
    if user.is_platform_admin:
        # Retorna um vínculo "virtual" como admin
        return EquipePizzaria(pizzaria_id=pizzaria_id, usuario_id=user.id, email=user.email, role="admin", status="ativo")

    stmt = select(EquipePizzaria).where(
        EquipePizzaria.pizzaria_id == pizzaria_id,
        EquipePizzaria.usuario_id == user.id,
        EquipePizzaria.status.in_(("ativo", "proprietario")),
    )
    link = (await db.execute(stmt)).scalar_one_or_none()
    if not link:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso a esta pizzaria")
    return link
