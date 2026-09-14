"""Envio humanizado: quebra texto em baloes e ajusta digitando por tamanho."""
from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from typing import Any


def typing_delay_ms(
    texto: str,
    *,
    multiplier: float = 1.0,
    min_delay_ms: int = 600,
    max_delay_ms: int = 5000,
) -> int:
    """Tempo de 'digitando' proporcional ao tamanho do texto.
    Curto = quase imediato; longo = pausa maior (com teto pra não cansar)."""
    tamanho = len(texto or "")
    if tamanho <= 15:           # "ok 😊", "perfeito!"
        base = 600
    elif tamanho <= 40:
        base = min(max(tamanho * 28, 900), 1800)
    elif tamanho <= 90:
        base = min(max(tamanho * 26, 1800), 3000)
    else:
        base = min(max(tamanho * 22, 3000), 5000)
    return min(max(int(base * multiplier), min_delay_ms), max_delay_ms)


def split_balloons(texto: str, *, max_balloons: int = 6, max_chars: int = 320) -> list[str]:
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
    max_balloons: int = 6,
    max_chars: int = 320,
    delay_multiplier: float = 1.0,
    min_delay_ms: int = 600,
    max_delay_ms: int = 5000,
    can_send: Callable[[], Awaitable[bool]] | None = None,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for part in split_balloons(texto, max_balloons=max_balloons, max_chars=max_chars):
        # O humano pode assumir entre dois balões. Revalidar aqui evita que o bot
        # complete a resposta por cima do operador.
        if can_send is not None and not await can_send():
            break
        delay = typing_delay_ms(
            part,
            multiplier=delay_multiplier,
            min_delay_ms=min_delay_ms,
            max_delay_ms=max_delay_ms,
        )
        # 1) Mostra "digitando…" e 2) SEGURA pelo tempo proporcional ao texto,
        # garantindo que o indicador apareça (não depende do delay nativo da
        # Evolution, que é instável). Curto = rápido; texto longo = pausa maior.
        try:
            await evolution.send_presence(
                instancia=instancia,
                numero=numero,
                tipo="composing",
                delay_ms=delay,
            )
        except Exception:
            pass
        try:
            await asyncio.sleep(min(delay, 7000) / 1000)
        except Exception:
            pass
        if can_send is not None and not await can_send():
            break
        # Sem delay extra no envio — a pausa já foi feita acima.
        results.append(await evolution.send_text(
            instancia=instancia,
            numero=numero,
            texto=part,
        ))
    return results
