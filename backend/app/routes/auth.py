"""Endpoints de autenticação: login, refresh, register (apenas platform admin)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db import get_db
from app.deps import current_user, require_platform_admin
from app.models import Usuario

router = APIRouter(prefix="/auth", tags=["auth"])


# ============================================
# Schemas
# ============================================
class LoginIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=6)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshIn(BaseModel):
    refresh_token: str


class RegisterIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8)
    nome: str | None = None
    is_platform_admin: bool = False


# ============================================
# Endpoints
# ============================================
@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    user = (
        await db.execute(
            select(Usuario).where(func.lower(Usuario.email) == body.email.lower())
        )
    ).scalar_one_or_none()

    if not user or not verify_password(body.senha, user.senha_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email ou senha inválidos")

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        user={
            "id": str(user.id),
            "email": user.email,
            "nome": user.nome,
            "is_platform_admin": user.is_platform_admin,
        },
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("typ") != "refresh":
            raise ValueError("not a refresh token")
    except Exception as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Refresh inválido: {e}") from e

    user = (await db.execute(select(Usuario).where(Usuario.id == payload["sub"]))).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado")

    return TokenOut(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        user={
            "id": str(user.id),
            "email": user.email,
            "nome": user.nome,
            "is_platform_admin": user.is_platform_admin,
        },
    )


@router.get("/me")
async def me(user: Usuario = Depends(current_user)) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "nome": user.nome,
        "is_platform_admin": user.is_platform_admin,
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    db: AsyncSession = Depends(get_db),
    _admin: Usuario = Depends(require_platform_admin),  # só admin cria contas
) -> dict:
    existing = (
        await db.execute(
            select(Usuario).where(func.lower(Usuario.email) == body.email.lower())
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email já cadastrado")

    user = Usuario(
        email=body.email.lower(),
        senha_hash=hash_password(body.senha),
        nome=body.nome,
        is_platform_admin=body.is_platform_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "email": user.email}
