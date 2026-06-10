"""
Failover de provedor LLM.

Se o provedor primário falhar (timeout, 5xx, chave inválida, indisponível),
tenta UMA vez o provedor reserva configurado no painel admin
(`fallback_provider` + `fallback_model` na config de LLM).

Usado nas chamadas do pipeline FSM (NLU e voz). O agente legado não usa —
ele já é, ele mesmo, o fallback do FSM (FSM → legado → humano).
"""
import logging
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")

# chamada(provider, api_key, model) -> resultado
Chamada = Callable[[str, str, str], Awaitable[T]]


def fallback_config(cfg: dict[str, Any]) -> tuple[str, str, str] | None:
    """(provider, api_key, model) do reserva, ou None se não configurado/sem chave."""
    provider = (cfg.get("fallback_provider") or "").lower().strip()
    model = (cfg.get("fallback_model") or "").strip()
    if provider not in ("gemini", "openai", "openrouter") or not model:
        return None
    api_key = (cfg.get("keys") or {}).get(provider) or ""
    if not api_key:
        return None
    return provider, api_key, model


async def com_failover(
    chamada: Chamada[T], *, cfg: dict[str, Any], model: str
) -> tuple[T, str, str]:
    """
    Executa `chamada` com o provedor primário; em QUALQUER exceção, tenta uma
    única vez o reserva (se configurado e diferente). Retorna
    (resultado, provider_usado, model_usado) — para registrar o uso correto.
    """
    provider = cfg["provider"]
    api_key = (cfg.get("keys") or {}).get(provider) or ""
    try:
        return await chamada(provider, api_key, model), provider, model
    except Exception as e:  # noqa: BLE001
        fb = fallback_config(cfg)
        if fb is None or (fb[0] == provider and fb[2] == model):
            raise
        fb_provider, fb_key, fb_model = fb
        log.warning(
            "LLM primário falhou (%s/%s): %s — tentando reserva %s/%s",
            provider, model, str(e)[:200], fb_provider, fb_model,
        )
        resultado = await chamada(fb_provider, fb_key, fb_model)
        log.info("Reserva %s/%s respondeu com sucesso.", fb_provider, fb_model)
        return resultado, fb_provider, fb_model
