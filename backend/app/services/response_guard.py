"""Validador simples anti-alucinacao para texto final do agente."""
from __future__ import annotations

import re

PRICE_OR_SPECIFIC = re.compile(r"(R\$\s*\d|pre[cç]o|taxa|entrega\s+R\$)", re.IGNORECASE)
PRICE_TOOLS = {"buscar_cardapio", "consultar_taxa_entrega", "preparar_resumo_pedido", "registrar_pedido"}


def guard_response(texto: str, tool_calls: list[str]) -> tuple[str, bool, str | None]:
    """Bloqueia resposta que cita preço/taxa sem tool de dados reais."""
    if not texto:
        return texto, False, None
    if PRICE_OR_SPECIFIC.search(texto) and not (set(tool_calls or []) & PRICE_TOOLS):
        return (
            "Deixa eu confirmar essa informação no cardápio certinho antes de te passar valor, tá?",
            True,
            "citou_preco_ou_taxa_sem_tool",
        )
    return texto, False, None
