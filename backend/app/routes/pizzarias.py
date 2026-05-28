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


class PizzariaOut(BaseModel):
    id: uuid.UUID
    nome: str
    instancia: str | None
    plano: str
    bot_ativo_global: bool
    endereco: str | None
    telefone_admin: str | None

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
