"""Envio humanizado: quebra texto em baloes e ajusta digitando por tamanho."""
from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
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
        # Acima do teto, o excedente vai junto no último balão. Antes era
        # descartado: o resumo do pedido (4 blocos, teto 2) chegava no WhatsApp
        # só até o total, sem endereço, pagamento, troco e o "Posso fechar?".
        teto = max(1, max_balloons)
        if len(explicit) > teto:
            explicit = [*explicit[:teto - 1], "\n\n".join(explicit[teto - 1:])]
        return explicit
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


@dataclass
class ResultadoEnvio:
    """O que de fato saiu pelo WhatsApp. Texto gerado não é prova de envio: antes
    uma falha da Evolution só virava alerta e a resposta era gravada como se o
    cliente a tivesse recebido (achado A05 da análise de 01/10)."""
    partes_total: int = 0
    partes_enviadas: int = 0
    interrompido: bool = False          # um humano assumiu entre dois balões
    erro: str | None = None
    ids: list[str] = field(default_factory=list)   # id da mensagem no WhatsApp, quando vem

    @property
    def status(self) -> str:
        if self.erro:
            return "falhou" if self.partes_enviadas == 0 else "parcial"
        if self.interrompido:
            return "interrompido"
        return "enviado"

    def como_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status, "partes_enviadas": self.partes_enviadas, "partes_total": self.partes_total,
        }
        if self.erro:
            out["erro"] = self.erro[:300]
        if self.ids:
            out["ids"] = self.ids
        return out


def _id_whatsapp(resposta: Any) -> str | None:
    if isinstance(resposta, dict):
        key = resposta.get("key")
        if isinstance(key, dict) and key.get("id"):
            return str(key["id"])
    return None


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
) -> ResultadoEnvio:
    """Manda em balões e devolve o que saiu. Não lança: falha da Evolution vira
    `erro` no resultado, com as partes que chegaram a sair."""
    partes = split_balloons(texto, max_balloons=max_balloons, max_chars=max_chars)
    resultado = ResultadoEnvio(partes_total=len(partes))
    try:
        await _enviar_partes(
            evolution=evolution, instancia=instancia, numero=numero, partes=partes,
            delay_multiplier=delay_multiplier, min_delay_ms=min_delay_ms, max_delay_ms=max_delay_ms,
            can_send=can_send, resultado=resultado,
        )
    except Exception as e:  # noqa: BLE001
        resultado.erro = f"{type(e).__name__}: {e}"
    return resultado


async def _enviar_partes(
    *,
    evolution: Any,
    instancia: str,
    numero: str,
    partes: list[str],
    delay_multiplier: float,
    min_delay_ms: int,
    max_delay_ms: int,
    can_send: Callable[[], Awaitable[bool]] | None,
    resultado: ResultadoEnvio,
) -> None:
    for part in partes:
        # O humano pode assumir entre dois balões. Revalidar aqui evita que o bot
        # complete a resposta por cima do operador.
        if can_send is not None and not await can_send():
            resultado.interrompido = True
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
            resultado.interrompido = True
            break
        # Sem delay extra no envio — a pausa já foi feita acima.
        resposta = await evolution.send_text(
            instancia=instancia,
            numero=numero,
            texto=part,
        )
        resultado.partes_enviadas += 1
        if (wid := _id_whatsapp(resposta)) is not None:
            resultado.ids.append(wid)
