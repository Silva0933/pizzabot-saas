"""Gestao das contas de consumidores pelo painel da pizzaria."""
import uuid
from collections import Counter
from datetime import UTC, datetime
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


def _pedido_conta(pedido: Pedido) -> bool:
    """Pedido que entra nos números do cliente: nem cancelado nem rascunho vazio."""
    return pedido.status != "cancelado" and float(pedido.valor_total or 0) > 0


async def _numeros_por_cliente(
    db: AsyncSession, pizzaria_id: uuid.UUID, ids: list[uuid.UUID],
) -> dict[uuid.UUID, tuple[int, float, datetime | None]]:
    """(pedidos, total gasto, último pedido) calculados dos PEDIDOS, não dos
    contadores do cadastro: o pedido do cardápio digital não atualizava os
    contadores e o cliente aparecia com "0 pedidos · R$ 0,00" (teste de 29/09)."""
    if not ids:
        return {}
    rows = (await db.execute(
        select(Pedido.cliente_id, func.count(Pedido.id), func.coalesce(func.sum(Pedido.valor_total), 0),
               func.max(Pedido.created_at))
        .where(Pedido.pizzaria_id == pizzaria_id, Pedido.cliente_id.in_(ids),
               Pedido.status != "cancelado", Pedido.valor_total > 0)
        .group_by(Pedido.cliente_id)
    )).all()
    return {r[0]: (int(r[1]), float(r[2] or 0), r[3]) for r in rows}


def _cliente_out(cliente: Cliente, numeros: tuple[int, float, datetime | None] | None = None) -> dict[str, Any]:
    pedidos, gasto, ultimo = numeros or (0, 0.0, None)
    return {
        "id": str(cliente.id),
        "nome": cliente.nome or "Cliente sem nome",
        "telefone": cliente.telefone,
        "email": cliente.email or "",
        "endereco_padrao": cliente.endereco_padrao,
        "total_pedidos": pedidos,
        "total_gasto": round(gasto, 2),
        "ultima_visita": ultimo.isoformat() if ultimo else None,
        "criado_em": cliente.created_at.isoformat() if cliente.created_at else None,
        "conta_atualizada_em": cliente.conta_atualizada_at.isoformat() if cliente.conta_atualizada_at else None,
    }


def _resumo(pedidos: list[Pedido]) -> dict[str, Any]:
    """Números do painel do cliente: ticket médio, favoritos, forma de pagamento."""
    validos = [p for p in pedidos if _pedido_conta(p)]
    total = sum(float(p.valor_total or 0) for p in validos)
    favoritos: Counter[str] = Counter()
    for p in validos:
        for it in p.itens or []:
            if isinstance(it, dict) and it.get("nome"):
                favoritos[str(it["nome"])] += int(it.get("quantidade") or 1)
    formas = Counter(str(p.forma_pagamento) for p in validos if p.forma_pagamento)
    return {
        "pedidos": len(validos),
        "total_gasto": round(total, 2),
        "ticket_medio": round(total / len(validos), 2) if validos else 0.0,
        "primeiro_pedido": min(p.created_at for p in validos).isoformat() if validos else None,
        "favoritos": [{"nome": n, "quantidade": q} for n, q in favoritos.most_common(3)],
        "pagamento_preferido": formas.most_common(1)[0][0] if formas else None,
        "cancelados": sum(1 for p in pedidos if p.status == "cancelado"),
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
        "taxa_entrega": float(pedido.taxa_entrega or Decimal("0")),
        "forma_pagamento": pedido.forma_pagamento,
        "origem": pedido.origem,
        "endereco_entrega": pedido.endereco_entrega,
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
    numeros = await _numeros_por_cliente(db, pizzaria_id, [c.id for c in clientes])
    return {"clientes": [_cliente_out(c, numeros.get(c.id)) for c in clientes], "total": total}


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
    numeros = await _numeros_por_cliente(db, pizzaria_id, [cliente.id])
    return {
        "cliente": _cliente_out(cliente, numeros.get(cliente.id)),
        "resumo": _resumo(pedidos),
        "pedidos": [_pedido_out(p) for p in pedidos],
    }


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
    cliente.conta_atualizada_at = datetime.now(UTC)
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
    cliente.conta_atualizada_at = datetime.now(UTC)
    await db.commit()
    return {"ok": True, "mensagem": "Conta excluida e dados pessoais removidos. Os pedidos foram preservados."}
