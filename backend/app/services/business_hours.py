"""
Horário de funcionamento da pizzaria.

Estrutura esperada em pizzarias.horario_funcionamento (JSONB):
    {
      "seg": {"abre": "18:00", "fecha": "23:30", "fechado": false},
      "ter": {...}, ... "dom": {...}
    }

Compatível com o formato antigo (valor string livre) — nesse caso NÃO
enforça horário (assume aberto), para não quebrar configs existentes.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/Sao_Paulo")
except Exception:  # pragma: no cover
    TZ = None

# Monday=0 … Sunday=6
WEEKDAY_KEYS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]

DEFAULT_FORA_HORARIO = (
    "Olá! No momento estamos *fechados*. 😴\n"
    "Assim que abrirmos, retornamos seu contato. Obrigado pela preferência!"
)


def _to_minutes(hhmm: str | None) -> int | None:
    if not hhmm or ":" not in str(hhmm):
        return None
    try:
        h, m = str(hhmm).split(":")[:2]
        return int(h) * 60 + int(m)
    except (ValueError, TypeError):
        return None


def esta_aberto(horarios: dict[str, Any] | None, now: datetime | None = None) -> bool:
    """
    True se a pizzaria está aberta agora. Em caso de config ausente/legada,
    retorna True (não bloqueia o atendimento).
    """
    if not horarios:
        return True
    now = now or (datetime.now(TZ) if TZ else datetime.now())
    cfg = horarios.get(WEEKDAY_KEYS[now.weekday()])
    if not cfg or isinstance(cfg, str):
        return True  # sem config estruturada para o dia → não enforça
    if cfg.get("fechado"):
        return False
    abre = _to_minutes(cfg.get("abre"))
    fecha = _to_minutes(cfg.get("fecha"))
    if abre is None or fecha is None:
        return True
    agora = now.hour * 60 + now.minute
    if fecha <= abre:
        # Vira a meia-noite (ex.: 18:00–02:00)
        return agora >= abre or agora < fecha
    return abre <= agora < fecha


def mensagem_fora_horario(pizz: Any) -> str:
    msgs = getattr(pizz, "mensagens_status", None) or {}
    return msgs.get("fora_horario") or DEFAULT_FORA_HORARIO
