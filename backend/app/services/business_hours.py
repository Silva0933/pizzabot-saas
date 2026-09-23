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


def esta_aberto(
    horarios: dict[str, Any] | None,
    now: datetime | None = None,
    *,
    override: bool | None = None,
) -> bool:
    """
    True se a pizzaria está aberta agora. O override manual tem prioridade
    sobre a agenda. Em caso de config ausente/legada, retorna True.
    """
    if override is not None:
        return override
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


_NOMES_DIA = {"seg": "Seg", "ter": "Ter", "qua": "Qua", "qui": "Qui",
              "sex": "Sex", "sab": "Sáb", "dom": "Dom"}

MARCADOR_HORARIO = "{horario}"


def formatar_horario(horarios: dict[str, Any] | None) -> str | None:
    """Horário cadastrado em texto para o cliente, agrupando dias iguais seguidos.

        • Seg a Sex: 18:00 às 23:00
        • Sáb: fechado

    Devolve None se não houver horário estruturado (formato antigo/vazio) — aí
    não há o que mostrar sem arriscar informação errada.
    """
    if not isinstance(horarios, dict) or not any(
        isinstance(horarios.get(k), dict) for k in WEEKDAY_KEYS
    ):
        return None

    def rotulo(dia: dict[str, Any] | None) -> str:
        if not isinstance(dia, dict) or dia.get("fechado") or not dia.get("abre") or not dia.get("fecha"):
            return "fechado"
        return f"{dia['abre']} às {dia['fecha']}"

    grupos: list[tuple[str, str, str]] = []  # (primeiro_dia, ultimo_dia, rotulo)
    for k in WEEKDAY_KEYS:
        r = rotulo(horarios.get(k))
        if grupos and grupos[-1][2] == r:
            grupos[-1] = (grupos[-1][0], k, r)
        else:
            grupos.append((k, k, r))

    linhas = []
    for ini, fim, r in grupos:
        dias = _NOMES_DIA[ini] if ini == fim else f"{_NOMES_DIA[ini]} a {_NOMES_DIA[fim]}"
        linhas.append(f"• {dias}: {r}")
    return "\n".join(linhas)


def mensagem_fora_horario(pizz: Any) -> str:
    """Texto enviado quando o cliente escreve fora do horário.

    O horário de VERDADE — o que decide se o bot atende — é `horario_funcionamento`.
    A mensagem é texto livre digitado no painel, e os dois se descolam assim que um
    muda e o outro não: em produção a mensagem dizia "quinta a domingo, das 18 às
    23" enquanto o cadastro abria todo dia às 08:00. Por isso o texto pode conter
    `{horario}`, trocado pelo horário cadastrado, e a mensagem padrão já o inclui.
    """
    msgs = getattr(pizz, "mensagens_status", None) or {}
    texto = msgs.get("fora_horario") or DEFAULT_FORA_HORARIO
    horario = formatar_horario(getattr(pizz, "horario_funcionamento", None))

    if MARCADOR_HORARIO in texto:
        return texto.replace(MARCADOR_HORARIO, horario or "").rstrip()
    if texto == DEFAULT_FORA_HORARIO and horario:
        return f"{texto}\n\nNosso horário:\n{horario}"
    return texto
