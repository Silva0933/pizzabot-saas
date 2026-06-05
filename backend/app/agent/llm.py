"""Cliente Gemini com tool calling.

Usa o SDK google-genai. Async pela camada client.aio.
"""
import logging
from typing import Any

from google import genai
from google.genai import types

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()

# gemini-2.0-flash tem cota de free tier bem maior que a 2.5-flash (que é
# limitada a ~20 req/dia no free tier). Para produção real, habilite billing.
DEFAULT_MODEL = "gemini-2.0-flash"

_clients: dict[str, genai.Client] = {}


def get_client(api_key: str | None = None) -> genai.Client:
    """Cliente Gemini para a chave informada (ou a do ambiente). Cacheado por chave."""
    key = api_key or _settings.gemini_api_key
    if not key:
        raise RuntimeError("GEMINI_API_KEY não configurado")
    if key not in _clients:
        _clients[key] = genai.Client(api_key=key)
    return _clients[key]


async def reset_client() -> None:
    for c in list(_clients.values()):
        try:
            await c.aio.aclose()
        except Exception:
            pass
    _clients.clear()


# ============================================
# Conversão para o formato do SDK
# ============================================
def to_content(role: str, text: str | None = None, *, function_call: dict | None = None,
               function_response: dict | None = None) -> types.Content:
    """Constrói um types.Content para o histórico."""
    parts: list[types.Part] = []
    if text:
        parts.append(types.Part(text=text))
    if function_call:
        parts.append(types.Part(function_call=types.FunctionCall(
            name=function_call["name"],
            args=function_call.get("args", {}),
        )))
    if function_response:
        parts.append(types.Part.from_function_response(
            name=function_response["name"],
            response=function_response["response"],
        ))
    return types.Content(role=role, parts=parts)


# ============================================
# Chamada principal
# ============================================
async def call_gemini(
    *,
    system: str,
    history: list[types.Content],
    tools: list[types.Tool] | None = None,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    api_key: str | None = None,
) -> types.GenerateContentResponse:
    """Faz uma chamada ao Gemini com tools."""
    client = get_client(api_key)

    config_kwargs: dict[str, Any] = dict(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_tokens,
        tools=tools,
        # Desliga o loop automático do SDK — nós controlamos a execução das tools.
        # Com AFC ligado, o SDK às vezes "consome" a function_call e devolve um
        # response sem texto nem function_call → o bot travava sem responder.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    # Gemini 2.5 ("thinking") gasta o orçamento de tokens PENSANDO antes do texto e
    # pode devolver resposta VAZIA (foi o que aconteceu no teste com gemini-2.5-flash).
    # A tarefa do agente não precisa de raciocínio explícito — desligamos nos 2.5.
    # Best-effort: SDKs antigos podem não ter ThinkingConfig.
    if "2.5" in (model or ""):
        _TC = getattr(types, "ThinkingConfig", None)
        if _TC is not None:
            try:
                config_kwargs["thinking_config"] = _TC(thinking_budget=0)
            except Exception:  # noqa: BLE001
                pass
    config = types.GenerateContentConfig(**config_kwargs)

    response = await client.aio.models.generate_content(
        model=model,
        contents=history,
        config=config,
    )
    return response


def extract_function_calls(response: types.GenerateContentResponse) -> list[dict[str, Any]]:
    """Devolve lista de function_calls do response."""
    calls = []
    if not response.candidates:
        return calls
    parts = response.candidates[0].content.parts or []
    for p in parts:
        fc = getattr(p, "function_call", None)
        if fc and fc.name:
            calls.append({"name": fc.name, "args": dict(fc.args or {})})
    return calls


def extract_text(response: types.GenerateContentResponse) -> str:
    """Devolve apenas o texto (concatena partes)."""
    if not response.candidates:
        return ""
    parts = response.candidates[0].content.parts or []
    texts = []
    for p in parts:
        if t := getattr(p, "text", None):
            texts.append(t)
    return "".join(texts).strip()
