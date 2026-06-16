"""Endpoints de autenticação: login, refresh, register (apenas platform admin)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
from app.services.rate_limit import allow, client_ip

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


class SignupIn(BaseModel):
    """Cadastro público (trial de 14 dias)."""
    nome_pizzaria: str = Field(min_length=2, max_length=80)
    nome: str | None = Field(default=None, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=8)


# Duração do teste grátis (plano 'trial' — cota reduzida em services/plans.py).
TRIAL_DIAS = 14


async def _build_user_payload(db: AsyncSession, user: Usuario) -> dict:
    """Payload do usuário para o front. Inclui `entregador` quando a conta é de
    um entregador (define a shell do entregador no app)."""
    from app.models import Entregador

    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.usuario_id == user.id, Entregador.ativo.is_(True)
            )
        )
    ).scalar_one_or_none()
    return {
        "id": str(user.id),
        "email": user.email,
        "nome": user.nome,
        "is_platform_admin": user.is_platform_admin,
        "entregador": (
            {
                "id": str(ent.id),
                "pizzaria_id": str(ent.pizzaria_id),
                "nome": ent.nome,
                "disponivel": ent.disponivel,
            }
            if ent else None
        ),
    }


# ============================================
# Endpoints
# ============================================
@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)) -> TokenOut:
    # Anti força bruta: 5 tentativas por minuto por IP (Redis, fail-open).
    if not await allow(f"login:{client_ip(request)}", max_hits=5, window_seconds=60):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Muitas tentativas de login. Aguarde 1 minuto e tente novamente.",
        )

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
        user=await _build_user_payload(db, user),
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
        user=await _build_user_payload(db, user),
    )


@router.get("/me")
async def me(user: Usuario = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    return await _build_user_payload(db, user)


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


@router.post("/signup", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupIn, request: Request, db: AsyncSession = Depends(get_db)) -> TokenOut:
    """
    Cadastro PÚBLICO: cria o dono + a pizzaria já no plano 'trial' (14 dias,
    cota reduzida) e loga direto. O funil segue no painel: conectar WhatsApp
    (Meu Negócio), cadastrar cardápio e, na aba Assinatura, contratar um plano.
    """
    from datetime import timedelta

    from app.models import EquipePizzaria, Pizzaria
    from app.routes.pizzarias import _slugify, _unique_instancia

    # Anti-abuso: 3 cadastros por hora por IP (Redis, fail-open).
    if not await allow(f"signup:{client_ip(request)}", max_hits=3, window_seconds=3600):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Muitos cadastros deste endereço. Tente novamente mais tarde.",
        )

    existing = (
        await db.execute(
            select(Usuario).where(func.lower(Usuario.email) == body.email.lower())
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email já cadastrado. Faça login.")

    user = Usuario(
        email=body.email.lower(),
        senha_hash=hash_password(body.senha),
        nome=(body.nome or body.nome_pizzaria).strip(),
        is_platform_admin=False,
    )
    db.add(user)
    await db.flush()

    pizz = Pizzaria(
        nome=body.nome_pizzaria.strip(),
        plano="trial",
        trial_fim=datetime.now(timezone.utc) + timedelta(days=TRIAL_DIAS),
    )
    db.add(pizz)
    await db.flush()
    pizz.instancia = await _unique_instancia(db, _slugify(pizz.nome), pizz.id)

    db.add(EquipePizzaria(
        pizzaria_id=pizz.id,
        usuario_id=user.id,
        email=user.email,
        role="admin",
        status="proprietario",
    ))
    await db.commit()

    return TokenOut(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        user=await _build_user_payload(db, user),
    )
