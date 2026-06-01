"""
Camada multi-provider de LLM (OpenAI-compatível: OpenAI + OpenRouter).

O caminho do Gemini continua em llm.py (google-genai). Aqui ficam:
  - conversão das tools (FunctionDeclaration → JSON schema OpenAI)
  - chamada de chat completions via httpx (OpenAI e OpenRouter)
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.agent.tools import TOOL_DECLARATIONS

log = logging.getLogger(__name__)

OPENAI_BASE = "https://api.openai.com/v1"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"

_TYPE_MAP = {
    "STRING": "string", "NUMBER": "number", "INTEGER": "integer",
    "BOOLEAN": "boolean", "ARRAY": "array", "OBJECT": "object",
}


def _type_name(t: Any) -> str:
    # google-genai Type enum → string JSON schema
    name = getattr(t, "name", None) or str(t)
    return _TYPE_MAP.get(str(name).upper().split(".")[-1], "string")


def _schema_to_json(schema: Any) -> dict[str, Any]:
    """Converte um google.genai types.Schema em JSON Schema (OpenAI)."""
    if schema is None:
        return {}
    out: dict[str, Any] = {"type": _type_name(getattr(schema, "type", "STRING"))}
    if desc := getattr(schema, "description", None):
        out["description"] = desc
    props = getattr(schema, "properties", None)
    if props:
        out["type"] = "object"
        out["properties"] = {k: _schema_to_json(v) for k, v in props.items()}
    items = getattr(schema, "items", None)
    if items:
        out["type"] = "array"
        out["items"] = _schema_to_json(items)
    req = getattr(schema, "required", None)
    if req:
        out["required"] = list(req)
    return out


def openai_tools() -> list[dict[str, Any]]:
    """Tools no formato OpenAI a partir das FunctionDeclaration do Gemini."""
    tools = []
    for d in TOOL_DECLARATIONS:
        tools.append({
            "type": "function",
            "function": {
                "name": d.name,
                "description": d.description or "",
                "parameters": _schema_to_json(getattr(d, "parameters", None)) or {"type": "object", "properties": {}},
            },
        })
    return tools


def _base_and_headers(provider: str, api_key: str) -> tuple[str, dict[str, str]]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://pizzabot.secretariaai.eu.cc"
        headers["X-Title"] = "PizzaBot"
        return OPENROUTER_BASE, headers
    return OPENAI_BASE, headers


async def openai_chat(
    *,
    provider: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    response_format: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Chama chat completions (OpenAI/OpenRouter). Retorna formato normalizado:
        {"content": str|None, "tool_calls": [{"id","name","args"}]}
    """
    base, headers = _base_and_headers(provider, api_key)
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if response_format:
        payload["response_format"] = response_format

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"{provider} {resp.status_code}: {resp.text[:400]}")
        data = resp.json()

    # OpenRouter às vezes devolve erro no corpo mesmo com HTTP 200.
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"{provider}: {str(data['error'])[:400]}")

    msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
    tool_calls = []
    for tc in (msg.get("tool_calls") or []):
        fn = tc.get("function", {}) or {}
        raw_args = fn.get("arguments") or "{}"
        try:
            args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
        except json.JSONDecodeError:
            args = {}
        tool_calls.append({"id": tc.get("id") or fn.get("name"), "name": fn.get("name"), "args": args})

    u = data.get("usage") or {}
    usage = {
        "prompt_tokens": u.get("prompt_tokens", 0) or 0,
        "completion_tokens": u.get("completion_tokens", 0) or 0,
        "total_tokens": u.get("total_tokens", 0) or 0,
    }
    return {"content": msg.get("content"), "tool_calls": tool_calls, "usage": usage}
