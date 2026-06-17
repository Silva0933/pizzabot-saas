"""Carrega contexto necessário pro agente: pizzaria, personalidade, cliente."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Cliente, Pedido, PersonalidadeAtendente, Pizzaria

# "O de sempre" só é oferecido quando há um PADRÃO real: o mesmo item aparece
# nos últimos N pedidos reais do cliente. Assim, quem pediu 1 vez (ou pediu
# coisas diferentes a cada vez) NÃO recebe a saudação de "o de sempre".
PEDIDOS_PADRAO_DE_SEMPRE = 3


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


def _norm_item(nome: str | None) -> str:
    import unicodedata
    s = (nome or "").strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return " ".join(s.split())


async def _pedido_de_sempre(db: AsyncSession, pizzaria_id: uuid.UUID, cliente: Cliente | None) -> str | None:
    """
    Retorna o item "de sempre" SÓ se houver padrão real: o mesmo item aparece em
    TODOS os últimos N pedidos reais (N = PEDIDOS_PADRAO_DE_SEMPRE). Caso contrário
    (poucos pedidos, ou pizzas diferentes a cada vez) retorna None — sem "de sempre".
    """
    if not cliente:
        return None
    n = PEDIDOS_PADRAO_DE_SEMPRE
    pedidos = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == pizzaria_id,
            Pedido.cliente_id == cliente.id,
            Pedido.status.in_(["confirmado", "no_forno", "pronto_entrega", "a_caminho", "entregue"]),
        ).order_by(Pedido.created_at.desc()).limit(n)
    )).scalars().all()

    if len(pedidos) < n:
        return None  # ainda não é cliente recorrente o suficiente

    # Conjunto de itens (normalizados) de cada um dos últimos N pedidos.
    conjuntos: list[set[str]] = []
    for p in pedidos:
        nomes = {_norm_item(it.get("nome")) for it in (p.itens or [])
                 if isinstance(it, dict) and it.get("nome")}
        if not nomes:
            return None  # algum pedido sem item identificável → sem padrão
        conjuntos.append(nomes)

    comuns = set.intersection(*conjuntos)
    if not comuns:
        return None  # pediu coisas diferentes → não tem "de sempre"

    # Devolve o nome ORIGINAL (como está no pedido mais recente) de um item comum.
    for it in (pedidos[0].itens or []):
        if isinstance(it, dict) and _norm_item(it.get("nome")) in comuns:
            return str(it["nome"])
    return None


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
    # "O de sempre" só quando o mesmo item se repete nos últimos N pedidos reais.
    if cli:
        try:
            resumo = await _pedido_de_sempre(db, pizzaria_id, cli)
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
