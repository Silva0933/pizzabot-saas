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

DEFAULT_MODEL = "gemini-2.0-flash-exp"

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not _settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY não configurado")
        _client = genai.Client(api_key=_settings.gemini_api_key)
    return _client


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
) -> types.GenerateContentResponse:
    """Faz uma chamada ao Gemini com tools."""
    client = get_client()

    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_tokens,
        tools=tools,
    )

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
