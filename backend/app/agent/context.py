"""Carrega contexto necessário pro agente: pizzaria, personalidade, cliente."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Cliente, PersonalidadeAtendente, Pizzaria


@dataclass
class AgentContext:
    pizzaria: Pizzaria
    personalidade: PersonalidadeAtendente | None
    cliente: Cliente | None
    telefone: str

    @property
    def cliente_nome(self) -> str | None:
        return self.cliente.nome if self.cliente else None

    @property
    def cliente_total_pedidos(self) -> int:
        return self.cliente.total_pedidos if self.cliente else 0


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

    return AgentContext(pizzaria=pizz, personalidade=pers, cliente=cli, telefone=telefone)
