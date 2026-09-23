"""
API de entregadores (painel de entregador).

Dois conjuntos de rotas:
  - Dono (escopo `membership`): CRUD de entregadores + toggle de self-claim.
  - Entregador (escopo `current_entregador`): minhas entregas, disponíveis,
    pegar pedido livre, atualizar status (saí/entreguei), disponibilidade.

O entregador reusa a conta `usuarios` (mesmo /auth/login). Atualização de
status reaproveita `apply_status_change` de pedidos.py (mensagem ao cliente +
broadcast). Sem aviso novo ao cliente — usa o "saiu para entrega" já existente.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.db import get_db
from app.deps import current_entregador, membership
from app.models import Entregador, EquipePizzaria, Pedido, Pizzaria, Usuario
from app.routes.pedidos import PedidoOut, _broadcast_atribuicao, apply_status_change

# O entregador enxerga o pedido desde que seja atribuído a ele (status confirmado em
# diante). "Minhas entregas" = atribuídos a ele e em qualquer status ativo (inclui
# 'pronto_entrega', que ele acabou de pegar e ainda não saiu).
ENTREGA_ATIVA = ("confirmado", "no_forno", "pronto_entrega", "a_caminho")
# "Disponíveis" para pegar = só os que já estão PRONTOS PARA ENTREGA (saíram do
# forno e estão prontos para sair). Pizza ainda no forno não fica disponível.
DISPONIVEL_STATUS = ("pronto_entrega",)
DRIVER_STATUSES = ("a_caminho", "entregue")

owner_router = APIRouter(prefix="/pizzarias/{pizzaria_id}/entregadores", tags=["entregadores"])
driver_router = APIRouter(prefix="/pizzarias/{pizzaria_id}/entregador", tags=["entregador"])


# ============================================
# Schemas
# ============================================
class EntregadorOut(BaseModel):
    id: uuid.UUID
    nome: str
    email: str
    telefone: str | None = None
    disponivel: bool
    ativo: bool
    entregas_concluidas: int = 0
    created_at: datetime


class EntregadoresResp(BaseModel):
    entregadores: list[EntregadorOut]
    permitir_autoatribuicao: bool


class EntregadorCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=6)
    telefone: str | None = None


class EntregadorUpdate(BaseModel):
    nome: str | None = Field(default=None, max_length=80)
    telefone: str | None = None
    ativo: bool | None = None
    nova_senha: str | None = Field(default=None, min_length=6)


class ConfigIn(BaseModel):
    permitir_autoatribuicao: bool


class DriverStatusIn(BaseModel):
    status: str


class DisponibilidadeIn(BaseModel):
    disponivel: bool


def _out(ent: Entregador, entregas: int = 0) -> EntregadorOut:
    return EntregadorOut(
        id=ent.id,
        nome=ent.nome,
        email=ent.usuario.email if ent.usuario else "",
        telefone=ent.telefone,
        disponivel=ent.disponivel,
        ativo=ent.ativo,
        entregas_concluidas=entregas,
        created_at=ent.created_at,
    )


# ============================================
# Dono — CRUD + config
# ============================================
@owner_router.get("", response_model=EntregadoresResp)
async def listar_entregadores(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadoresResp:
    rows = (
        await db.execute(
            select(Entregador).where(Entregador.pizzaria_id == pizzaria_id).order_by(Entregador.created_at)
        )
    ).scalars().all()
    # Quantas entregas cada entregador concluiu (status 'entregue').
    count_rows = (
        await db.execute(
            select(Pedido.entregador_id, func.count())
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.status == "entregue",
                Pedido.entregador_id.isnot(None),
            )
            .group_by(Pedido.entregador_id)
        )
    ).all()
    counts = {row[0]: row[1] for row in count_rows}
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    return EntregadoresResp(
        entregadores=[_out(e, counts.get(e.id, 0)) for e in rows],
        permitir_autoatribuicao=pizz.permitir_autoatribuicao_entregador,
    )


@owner_router.put("/config", response_model=EntregadoresResp)
async def set_config(
    pizzaria_id: uuid.UUID,
    body: ConfigIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadoresResp:
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    pizz.permitir_autoatribuicao_entregador = body.permitir_autoatribuicao
    await db.commit()
    return await listar_entregadores(pizzaria_id, db, None)  # type: ignore[arg-type]


@owner_router.post("", response_model=EntregadorOut, status_code=status.HTTP_201_CREATED)
async def criar_entregador(
    pizzaria_id: uuid.UUID,
    body: EntregadorCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadorOut:
    """Cria a conta de login (usuarios) + o vínculo de entregador na pizzaria."""
    email = body.email.lower()
    existing = (
        await db.execute(select(Usuario).where(func.lower(Usuario.email) == email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este email já está em uso.")

    user = Usuario(email=email, senha_hash=hash_password(body.senha), nome=body.nome.strip())
    db.add(user)
    await db.flush()

    ent = Entregador(
        pizzaria_id=pizzaria_id,
        usuario_id=user.id,
        nome=body.nome.strip(),
        telefone=body.telefone,
    )
    db.add(ent)
    await db.commit()
    await db.refresh(ent)
    return _out(ent)


@owner_router.patch("/{entregador_id}", response_model=EntregadorOut)
async def atualizar_entregador(
    pizzaria_id: uuid.UUID,
    entregador_id: uuid.UUID,
    body: EntregadorUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadorOut:
    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.id == entregador_id, Entregador.pizzaria_id == pizzaria_id
            )
        )
    ).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entregador não encontrado")

    if body.nome is not None:
        ent.nome = body.nome.strip()
    if body.telefone is not None:
        ent.telefone = body.telefone
    if body.ativo is not None:
        ent.ativo = body.ativo
    if body.nova_senha and ent.usuario:
        ent.usuario.senha_hash = hash_password(body.nova_senha)

    await db.commit()
    await db.refresh(ent)
    return _out(ent)


@owner_router.delete("/{entregador_id}")
async def remover_entregador(
    pizzaria_id: uuid.UUID,
    entregador_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.id == entregador_id, Entregador.pizzaria_id == pizzaria_id
            )
        )
    ).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entregador não encontrado")

    usuario_id = ent.usuario_id
    await db.execute(delete(Entregador).where(Entregador.id == entregador_id))

    # Se a conta de login era exclusiva de entregador (sem vínculo de equipe),
    # remove o usuário órfão para não deixar login pendurado.
    tem_equipe = (
        await db.execute(
            select(EquipePizzaria.id).where(EquipePizzaria.usuario_id == usuario_id).limit(1)
        )
    ).scalar_one_or_none()
    outro_entregador = (
        await db.execute(
            select(Entregador.id).where(Entregador.usuario_id == usuario_id).limit(1)
        )
    ).scalar_one_or_none()
    if not tem_equipe and not outro_entregador:
        await db.execute(delete(Usuario).where(Usuario.id == usuario_id))

    await db.commit()
    return {"ok": True}


# ============================================
# Entregador — entregas
# ============================================
@driver_router.get("/minhas-entregas", response_model=list[PedidoOut])
async def minhas_entregas(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> list[Pedido]:
    rows = (
        await db.execute(
            select(Pedido)
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id == ent.id,
                Pedido.status.in_(ENTREGA_ATIVA),
            )
            .order_by(desc(Pedido.atribuido_em))
        )
    ).scalars().all()
    return list(rows)


@driver_router.get("/disponiveis", response_model=list[PedidoOut])
async def entregas_disponiveis(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> list[Pedido]:
    """Pedidos delivery sem entregador, prontos para entrega — só se o self-claim
    estiver ligado para a pizzaria."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    if not pizz.permitir_autoatribuicao_entregador:
        return []
    rows = (
        await db.execute(
            select(Pedido)
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id.is_(None),
                Pedido.tipo == "delivery",
                Pedido.status.in_(DISPONIVEL_STATUS),
            )
            .order_by(desc(Pedido.created_at))
        )
    ).scalars().all()
    return list(rows)


@driver_router.get("/resumo")
async def resumo_entregador(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    """Quantas entregas o entregador concluiu (total e hoje)."""
    base = select(func.count()).where(
        Pedido.pizzaria_id == pizzaria_id,
        Pedido.entregador_id == ent.id,
        Pedido.status == "entregue",
    )
    total = (await db.execute(base)).scalar_one()
    hoje = (
        await db.execute(
            base.where(
                text(
                    "pedidos.updated_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')"
                )
            )
        )
    ).scalar_one()
    return {"entregas_total": int(total), "entregas_hoje": int(hoje)}


@driver_router.post("/pedidos/{pedido_id}/pegar", response_model=PedidoOut)
async def pegar_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> Pedido:
    """Self-claim: o entregador pega um pedido livre (valida o toggle no backend)."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    if not pizz.permitir_autoatribuicao_entregador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A pizzaria não permite pegar pedidos livres.")

    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    if p.entregador_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Pedido já tem entregador.")

    p.entregador_id = ent.id
    p.atribuido_em = datetime.now(UTC)
    await db.commit()
    await db.refresh(p)
    await _broadcast_atribuicao(pizzaria_id, p)
    return p


@driver_router.post("/pedidos/{pedido_id}/status", response_model=PedidoOut)
async def atualizar_status_entregador(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: DriverStatusIn,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> Pedido:
    """Entregador atualiza o status (apenas 'a_caminho' e 'entregue') do SEU pedido."""
    if body.status not in DRIVER_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Entregador só pode usar: {DRIVER_STATUSES}")

    p = (
        await db.execute(
            select(Pedido).where(
                Pedido.id == pedido_id,
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id == ent.id,
            )
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado ou não é seu")

    return await apply_status_change(
        db, pizzaria_id, p, body.status,
        ator_id=ent.usuario_id, ator_nome=ent.nome, ator_tipo="entregador",
    )


@driver_router.patch("/disponibilidade")
async def set_disponibilidade(
    pizzaria_id: uuid.UUID,
    body: DisponibilidadeIn,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    ent.disponivel = body.disponivel
    await db.commit()
    return {"ok": True, "disponivel": ent.disponivel}
