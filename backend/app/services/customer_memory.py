"""Memoria longa enxuta do cliente.

Mantem somente sinais uteis para atendimento, com limite curto para nao inflar
prompt nem transformar a memoria em historico bruto.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

MAX_FIELD_CHARS = 180
MAX_SUMMARY_CHARS = 500


def _clean_text(value: str | None, *, limit: int = MAX_FIELD_CHARS) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text:
        return None
    # Reduz risco de prompt injection guardado como preferencia.
    blocked = ("ignore as instrucoes", "ignore instrucoes", "system prompt", "prompt", "developer")
    lowered = text.lower()
    if any(b in lowered for b in blocked):
        return None
    return text[:limit]


def build_memory_summary(
    existing: dict[str, Any] | None,
    *,
    nome: str | None = None,
    endereco_padrao: str | None = None,
    preferencias: str | None = None,
) -> dict[str, Any]:
    current = dict(existing or {})
    if cleaned := _clean_text(nome, limit=80):
        current["nome"] = cleaned
    if cleaned := _clean_text(endereco_padrao, limit=220):
        current["endereco_padrao"] = cleaned
    if cleaned := _clean_text(preferencias, limit=260):
        prev = _clean_text(current.get("preferencias"), limit=260)
        if prev and cleaned.lower() not in prev.lower():
            joined = f"{prev}; {cleaned}"
            current["preferencias"] = joined[:300]
        else:
            current["preferencias"] = cleaned

    resumo = []
    if current.get("endereco_padrao"):
        resumo.append(f"Endereco: {current['endereco_padrao']}")
    if current.get("preferencias"):
        resumo.append(f"Preferencias: {current['preferencias']}")
    current["resumo_prompt"] = "; ".join(resumo)[:MAX_SUMMARY_CHARS]
    current["updated_at"] = datetime.now(UTC).isoformat()
    return current


def prompt_summary(
    memoria: dict[str, Any] | None,
    fallback_preferencias: str | None = None,
    *,
    include_address: bool = True,
    include_preferences: bool = True,
) -> str | None:
    parts: list[str] = []
    if memoria:
        if include_address and memoria.get("endereco_padrao"):
            parts.append(f"Endereco: {memoria['endereco_padrao']}")
        if include_preferences and memoria.get("preferencias"):
            parts.append(f"Preferencias: {memoria['preferencias']}")
    if not parts and include_preferences:
        fallback = _clean_text(fallback_preferencias, limit=MAX_SUMMARY_CHARS)
        if fallback:
            parts.append(f"Preferencias: {fallback}")
    return "; ".join(parts)[:MAX_SUMMARY_CHARS] or None
