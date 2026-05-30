"""Envio humanizado: quebra texto em baloes e ajusta digitando por tamanho."""
from __future__ import annotations

import re
from typing import Any


def typing_delay_ms(texto: str) -> int:
    tamanho = len(texto or "")
    if tamanho <= 20:
        return 800
    if tamanho <= 80:
        return min(max(tamanho * 35, 1200), 3200)
    return min(max(tamanho * 28, 2800), 6500)


def split_balloons(texto: str, *, max_balloons: int = 3, max_chars: int = 320) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", (texto or "").strip())
    if not text:
        return []
    explicit = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(explicit) > 1:
        return explicit[:max_balloons]
    if len(text) <= max_chars:
        return [text]

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    cur = ""
    for sentence in sentences:
        if not sentence:
            continue
        candidate = f"{cur} {sentence}".strip()
        if cur and len(candidate) > max_chars and len(chunks) < max_balloons - 1:
            chunks.append(cur)
            cur = sentence
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return chunks[:max_balloons] or [text[:max_chars]]


async def send_humanized_text(
    *,
    evolution: Any,
    instancia: str,
    numero: str,
    texto: str,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for part in split_balloons(texto):
        delay = typing_delay_ms(part)
        try:
            await evolution.send_presence(
                instancia=instancia,
                numero=numero,
                tipo="composing",
                delay_ms=delay,
            )
        except Exception:
            pass
        results.append(await evolution.send_text(
            instancia=instancia,
            numero=numero,
            texto=part,
            delay_ms=delay,
        ))
    return results
