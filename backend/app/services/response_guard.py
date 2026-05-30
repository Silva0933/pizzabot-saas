"""Validador anti-alucinação (modo observação).

IMPORTANTE: este guard NÃO substitui mais a resposta do agente.

A versão anterior trocava qualquer resposta que citasse preço/taxa (sem uma tool
de preço NO MESMO turno) por uma frase de espera ("Deixa eu confirmar essa
informação no cardápio..."). Isso causava DOIS bugs graves em produção:
  1) Loop infinito: a frase de espera encerrava o turno sem entregar nada, e
     repetia a cada mensagem do cliente.
  2) Travamento no fechamento: o resumo do pedido (que naturalmente cita R$ a
     partir de dados já buscados em turnos anteriores) era bloqueado, e o pedido
     nunca era fechado.

A regra "tool de preço no MESMO turno" é incorreta: o modelo legitimamente
repete valores que já obteve das tools em turnos anteriores (estão no histórico).
A proteção anti-invenção agora é feita pelo system prompt (PRINCÍPIO Nº 1 +
seção CARDÁPIO), que é mais preciso e não trava a conversa.

Mantemos só a DETECÇÃO para observabilidade (log), sem alterar o texto.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

PRICE_OR_SPECIFIC = re.compile(r"(R\$\s*\d|pre[cç]o|taxa|entrega\s+R\$)", re.IGNORECASE)
PRICE_TOOLS = {"buscar_cardapio", "consultar_taxa_entrega", "preparar_resumo_pedido", "registrar_pedido"}


def guard_response(texto: str, tool_calls: list[str]) -> tuple[str, bool, str | None]:
    """Pass-through: nunca bloqueia. Só registra um sinal pra telemetria.

    Retorna sempre (texto_original, False, None) para não travar a conversa.
    """
    if texto and PRICE_OR_SPECIFIC.search(texto) and not (set(tool_calls or []) & PRICE_TOOLS):
        # Apenas observabilidade — o prompt já cuida da anti-invenção.
        log.debug("guard(observação): resposta cita preço/taxa sem tool de preço no turno atual")
    return texto, False, None
