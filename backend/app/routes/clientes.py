"""Gestao das contas de consumidores pelo painel da pizzaria."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.db import get_db
from app.deps import membership
from app.models import Cliente, Pedido

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/clientes", tags=["clientes"])


class NovaSenhaIn(BaseModel):
    nova_senha: str = Field(min_length=10, max_length=128)


def _pode_gerenciar(vinculo: object) -> bool:
    return getattr(vinculo, "role", "") in {"admin", "proprietario", "gerente"}


def _cliente_out(cliente: Cliente) -> dict[str, Any]:
    return {
        "id": str(cliente.id),
        "nome": cliente.nome or "Cliente sem nome",
        "telefone": cliente.telefone,
        "email": cliente.email or "",
        "endereco_padrao": cliente.endereco_padrao,
        "total_pedidos": cliente.total_pedidos,
        "total_gasto": float(cliente.total_gasto or 0),
        "ultima_visita": cliente.ultima_visita.isoformat() if cliente.ultima_visita else None,
        "criado_em": cliente.created_at.isoformat() if cliente.created_at else None,
        "conta_atualizada_em": cliente.conta_atualizada_at.isoformat() if cliente.conta_atualizada_at else None,
    }


def _pedido_out(pedido: Pedido) -> dict[str, Any]:
    labels = {
        "novo": "Recebido", "confirmado": "Confirmado", "no_forno": "Em preparo",
        "pronto_entrega": "Pronto", "a_caminho": "Saiu para entrega",
        "entregue": "Entregue", "cancelado": "Cancelado",
    }
    return {
        "id": str(pedido.id),
        "numero_pedido": pedido.numero_pedido,
        "status": pedido.status,
        "status_label": labels.get(pedido.status, pedido.status.replace("_", " ").title()),
        "tipo": pedido.tipo,
        "itens": pedido.itens or [],
        "valor_total": float(pedido.valor_total or Decimal("0")),
        "criado_em": pedido.created_at.isoformat(),
    }


async def _conta_da_pizzaria(pizzaria_id: uuid.UUID, cliente_id: uuid.UUID, db: AsyncSession) -> Cliente:
    cliente = (await db.execute(select(Cliente).where(
        Cliente.id == cliente_id,
        Cliente.pizzaria_id == pizzaria_id,
        Cliente.conta_ativa.is_(True),
    ))).scalar_one_or_none()
    if not cliente:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conta de cliente nao encontrada.")
    return cliente


@router.get("")
async def listar_clientes(
    pizzaria_id: uuid.UUID,
    busca: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, Any]:
    filtros = [Cliente.pizzaria_id == pizzaria_id, Cliente.conta_ativa.is_(True)]
    if busca and busca.strip():
        termo = f"%{busca.strip()}%"
        filtros.append(or_(Cliente.nome.ilike(termo), Cliente.email.ilike(termo), Cliente.telefone.ilike(termo)))
    total = int((await db.execute(select(func.count(Cliente.id)).where(*filtros))).scalar_one())
    clientes = list((await db.execute(
        select(Cliente).where(*filtros).order_by(Cliente.ultima_visita.desc().nullslast(), Cliente.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all())
    return {"clientes": [_cliente_out(c) for c in clientes], "total": total}


@router.get("/{cliente_id}")
async def detalhe_cliente(
    pizzaria_id: uuid.UUID,
    cliente_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, Any]:
    cliente = await _conta_da_pizzaria(pizzaria_id, cliente_id, db)
    pedidos = list((await db.execute(
        select(Pedido).where(Pedido.pizzaria_id == pizzaria_id, Pedido.cliente_id == cliente.id)
        .order_by(Pedido.created_at.desc()).limit(100)
    )).scalars().all())
    return {"cliente": _cliente_out(cliente), "pedidos": [_pedido_out(p) for p in pedidos]}


@router.patch("/{cliente_id}/senha")
async def redefinir_senha(
    pizzaria_id: uuid.UUID,
    cliente_id: uuid.UUID,
    body: NovaSenhaIn,
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
) -> dict[str, Any]:
    if not _pode_gerenciar(vinculo):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Somente proprietarios e gerentes podem redefinir senhas.")
    cliente = await _conta_da_pizzaria(pizzaria_id, cliente_id, db)
    cliente.senha_hash = hash_password(body.nova_senha)
    cliente.conta_versao = int(cliente.conta_versao or 1) + 1
    cliente.conta_atualizada_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "mensagem": "Senha redefinida. As sessoes anteriores foram encerradas."}


@router.delete("/{cliente_id}")
async def excluir_conta(
    pizzaria_id: uuid.UUID,
    cliente_id: uuid.UUID,
    x_confirm_delete: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
) -> dict[str, Any]:
    if not _pode_gerenciar(vinculo):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Somente proprietarios e gerentes podem excluir contas.")
    if x_confirm_delete != "true":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirme a exclusao da conta.")
    cliente = await _conta_da_pizzaria(pizzaria_id, cliente_id, db)
    cliente.conta_ativa = False
    cliente.conta_versao = int(cliente.conta_versao or 1) + 1
    cliente.email = None
    cliente.senha_hash = None
    cliente.nome = "Cliente excluido"
    cliente.telefone = f"excluido-{cliente.id.hex}"
    cliente.endereco_padrao = None
    cliente.preferencias = None
    cliente.memoria_resumo = {}
    cliente.memoria_atualizada_at = None
    cliente.conta_atualizada_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "mensagem": "Conta excluida e dados pessoais removidos. Os pedidos foram preservados."}
