"""Carrega contexto necessário pro agente: pizzaria, personalidade, cliente."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Cliente, Pedido, PersonalidadeAtendente, Pizzaria


@dataclass
class AgentContext:
    pizzaria: Pizzaria
    personalidade: PersonalidadeAtendente | None
    cliente: Cliente | None
    telefone: str
    ultimo_pedido_resumo: str | None = None
    estado_atendimento: dict | None = None

    @property
    def cliente_nome(self) -> str | None:
        return self.cliente.nome if self.cliente else None

    @property
    def cliente_total_pedidos(self) -> int:
        return self.cliente.total_pedidos if self.cliente else 0


async def _resumo_ultimo_pedido(db: AsyncSession, pizzaria_id: uuid.UUID, cliente: Cliente | None) -> str | None:
    """Itens do último pedido real do cliente — pra saudação de recorrente ('o de sempre')."""
    if not cliente:
        return None
    ped = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == pizzaria_id,
            Pedido.cliente_id == cliente.id,
            Pedido.status.in_(["confirmado", "no_forno", "a_caminho", "entregue"]),
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()
    if not ped or not ped.itens:
        return None
    partes = []
    for it in ped.itens:
        if isinstance(it, dict) and it.get("nome"):
            qtd = int(it.get("quantidade") or it.get("qtd") or 1)
            partes.append(f"{qtd}x {it['nome']}" if qtd > 1 else str(it["nome"]))
    return ", ".join(partes) or None


async def load_context(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
) -> AgentContext:
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))
    ).scalar_one()

    pers = (
        await db.execute(
            select(PersonalidadeAtendente).where(PersonalidadeAtendente.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()

    cli = (
        await db.execute(
            select(Cliente).where(
                Cliente.pizzaria_id == pizzaria_id,
                Cliente.telefone == telefone,
            )
        )
    ).scalar_one_or_none()

    resumo = None
    if cli and (cli.total_pedidos or 0) > 0:
        try:
            resumo = await _resumo_ultimo_pedido(db, pizzaria_id, cli)
        except Exception:  # noqa: BLE001
            resumo = None

    try:
        from app.services.conversation_state import load_state
        estado = await load_state(db, pizzaria_id, telefone)
    except Exception:  # noqa: BLE001
        estado = {}

    return AgentContext(
        pizzaria=pizz, personalidade=pers, cliente=cli,
        telefone=telefone, ultimo_pedido_resumo=resumo,
        estado_atendimento=estado,
    )
