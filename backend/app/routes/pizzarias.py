"""CRUD básico de pizzarias (suficiente para testar a Fase 2)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user, membership, require_platform_admin
from app.models import EquipePizzaria, Pizzaria, Usuario

router = APIRouter(prefix="/pizzarias", tags=["pizzarias"])


class PizzariaIn(BaseModel):
    nome: str = Field(min_length=2)
    instancia: str | None = None
    telefone_admin: str | None = None
    endereco: str | None = None


class PizzariaPatch(BaseModel):
    """Todos opcionais — só atualiza o que vier."""
    nome: str | None = Field(default=None, min_length=2)
    instancia: str | None = None
    telefone_admin: str | None = None
    telefone_contato: str | None = None
    endereco: str | None = None
    logo_url: str | None = None
    bot_ativo_global: bool | None = None
    horario_funcionamento: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    tempo_entrega_min: int | None = None
    tempo_entrega_max: int | None = None


class PizzariaOut(BaseModel):
    id: uuid.UUID
    nome: str
    instancia: str | None
    plano: str
    bot_ativo_global: bool
    endereco: str | None
    telefone_admin: str | None
    telefone_contato: str | None
    logo_url: str | None = None
    horario_funcionamento: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    tempo_entrega_min: int | None = None
    tempo_entrega_max: int | None = None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[PizzariaOut])
async def list_pizzarias(
    user: Usuario = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Pizzaria]:
    """Lista pizzarias do usuário (ou todas se for platform admin)."""
    if user.is_platform_admin:
        stmt = select(Pizzaria).order_by(Pizzaria.created_at.desc())
    else:
        stmt = (
            select(Pizzaria)
            .join(EquipePizzaria, EquipePizzaria.pizzaria_id == Pizzaria.id)
            .where(
                EquipePizzaria.usuario_id == user.id,
                EquipePizzaria.status.in_(("ativo", "proprietario")),
            )
        )
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.post("", response_model=PizzariaOut, status_code=status.HTTP_201_CREATED)
async def create_pizzaria(
    body: PizzariaIn,
    user: Usuario = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
) -> Pizzaria:
    pizz = Pizzaria(
        nome=body.nome.strip(),
        instancia=body.instancia,
        telefone_admin=body.telefone_admin,
        endereco=body.endereco,
    )
    db.add(pizz)
    await db.flush()

    # Cria vínculo do admin como proprietário também
    db.add(EquipePizzaria(
        pizzaria_id=pizz.id,
        usuario_id=user.id,
        email=user.email,
        role="admin",
        status="proprietario",
    ))
    await db.commit()
    await db.refresh(pizz)
    return pizz


@router.get("/{pizzaria_id}", response_model=PizzariaOut)
async def get_pizzaria(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pizzaria:
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    return pizz


@router.patch("/{pizzaria_id}", response_model=PizzariaOut)
async def update_pizzaria(
    pizzaria_id: uuid.UUID,
    body: PizzariaPatch,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pizzaria:
    """Atualiza campos da pizzaria. Aceita qualquer subset dos campos."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    updates = body.model_dump(exclude_unset=True, exclude_none=False)
    for k, v in updates.items():
        if hasattr(pizz, k):
            setattr(pizz, k, v)
    await db.commit()
    await db.refresh(pizz)
    return pizz
