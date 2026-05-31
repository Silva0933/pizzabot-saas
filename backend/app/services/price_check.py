"""
Validador NÃO-BLOQUEANTE de preços (Fase 2 — C4).

Compara os preços citados no texto final da IA com os preços que REALMENTE
vieram das tools (cardápio, taxa, resumo). Se a IA citar um valor sem lastro,
geramos um ALERTA (observabilidade) — sem nunca bloquear ou alterar a resposta.
"""
from __future__ import annotations

import re
from typing import Any

# Chaves de resultado de tool que representam dinheiro.
PRICE_KEYS = {
    "preco", "preco_unit", "taxa", "valor", "total",
    "valor_total", "valor_itens", "taxa_entrega",
}
_PRICE_RE = re.compile(r"R\$\s*(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)", re.IGNORECASE)


def _parse_valor(s: str) -> float | None:
    s = s.strip()
    try:
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        elif "," in s:
            s = s.replace(",", ".")
        return round(float(s), 2)
    except (ValueError, TypeError):
        return None


def coletar_precos_tool(result: Any) -> set[float]:
    """Coleta recursivamente os valores monetários de um resultado de tool."""
    achados: set[float] = set()

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in PRICE_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                    f = round(float(v), 2)
                    if f > 0:
                        achados.add(f)
                walk(v)
        elif isinstance(obj, list):
            for it in obj:
                walk(it)

    walk(result)
    return achados


def precos_no_texto(texto: str) -> list[float]:
    out: list[float] = []
    for m in _PRICE_RE.findall(texto or ""):
        v = _parse_valor(m)
        if v is not None and v > 0:
            out.append(v)
    return out


def precos_sem_lastro(texto: str, validos: set[float]) -> list[float]:
    """
    Preços citados no texto que NÃO batem com os preços vindos das tools
    (aceitando soma de pares, ex.: itens + entrega = total). Se nenhum preço veio
    de tool, todo valor citado é considerado suspeito.
    """
    citados = precos_no_texto(texto)
    if not citados:
        return []
    if not validos:
        return citados

    base = set(validos)
    vals = list(validos)
    for i in range(len(vals)):
        for j in range(i, len(vals)):
            base.add(round(vals[i] + vals[j], 2))

    suspeitos: list[float] = []
    for p in citados:
        # bate no valor exato, na parte inteira (R$ 42 vs 42,00) ou bem perto
        if any(abs(p - b) < 0.5 for b in base):
            continue
        suspeitos.append(p)
    return suspeitos
