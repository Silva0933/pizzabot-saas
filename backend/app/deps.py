"""Dependencies do FastAPI: auth, contexto de tenant, etc."""
import uuid

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token
from app.db import get_db
from app.models import Entregador, EquipePizzaria, Pizzaria, Usuario

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


# Rotas que continuam abertas com a pizzaria SUSPENSA. Sem esta lista o bloqueio
# viraria armadilha: a pizzaria inadimplente não conseguiria nem ver o próprio
# estado nem pagar para voltar. São, propositalmente, só leitura do cadastro e o
# fluxo de assinatura/fatura.
_ROTAS_LIBERADAS_SUSPENSA = (
    "/assinatura",
    "/uso",
    "/whatsapp/status",
)


def _liberada_com_suspensao(request: Request) -> bool:
    caminho = request.url.path.rstrip("/")
    if any(trecho in caminho for trecho in _ROTAS_LIBERADAS_SUSPENSA):
        return True
    # GET do próprio cadastro: /pizzarias/{uuid} e nada além disso.
    if request.method == "GET" and caminho.count("/") == 2 and caminho.startswith("/pizzarias/"):
        return True
    return False


async def membership(
    pizzaria_id: uuid.UUID,
    request: Request,
    user: Usuario = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> EquipePizzaria:
    """Garante que o usuário pertence à pizzaria. Platform admins passam direto.

    Também barra a pizzaria SUSPENSA (inadimplência ou trial vencido). Antes esta
    checagem só existia no bot, no webhook e no cardápio público: o painel e a API
    seguiam liberados, então bastava não pagar para continuar operando.
    """
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

    if not _liberada_com_suspensao(request):
        pizz = (
            await db.execute(
                select(Pizzaria.suspensa, Pizzaria.suspensa_motivo).where(Pizzaria.id == pizzaria_id)
            )
        ).first()
        if pizz and pizz[0]:
            # 402 em vez de 403: o front distingue "pague para voltar" de
            # "você não tem acesso a esta pizzaria".
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                {
                    "erro": "pizzaria_suspensa",
                    "motivo": pizz[1] or "inadimplencia",
                    "mensagem": "Assinatura suspensa. Regularize o pagamento para voltar a usar o painel.",
                },
            )
    return link


async def current_entregador(
    pizzaria_id: uuid.UUID,
    user: Usuario = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Entregador:
    """Garante que o usuário é um entregador ATIVO desta pizzaria."""
    stmt = select(Entregador).where(
        Entregador.pizzaria_id == pizzaria_id,
        Entregador.usuario_id == user.id,
        Entregador.ativo.is_(True),
    )
    ent = (await db.execute(stmt)).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito a entregadores")
    return ent
