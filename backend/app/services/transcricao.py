"""
Transcrição de áudios do WhatsApp (voz → texto) para o agente.

WhatsApp envia voz em OGG/Opus. Para provedores OpenAI-compatíveis
(OpenRouter/OpenAI) convertemos para mp3 via ffmpeg e enviamos como
input_audio. Para Gemini (google-genai) mandamos o áudio inline direto
(aceita ogg). A config de provedor/modelo vem do painel admin.
"""
from __future__ import annotations

import asyncio
import base64
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_config import get_llm_config

log = logging.getLogger(__name__)

_PROMPT = (
    "Transcreva o áudio a seguir em português do Brasil. "
    "Responda SOMENTE com a transcrição literal, sem comentários."
)


async def _ogg_to_mp3(audio_bytes: bytes) -> bytes:
    """Converte qualquer áudio (ogg/opus) para mp3 mono 16kHz via ffmpeg."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "mp3", "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(input=audio_bytes)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou: {err[:200].decode('utf-8', 'replace')}")
    return out


async def transcrever_audio(db: AsyncSession, audio_b64: str, mimetype: str = "audio/ogg") -> str | None:
    """
    Transcreve um áudio (base64) usando o provedor de LLM configurado.
    Retorna o texto ou None se não der.
    """
    cfg = await get_llm_config(db)
    provider = cfg["provider"]
    model = cfg["model"]
    keys = cfg["keys"]

    try:
        raw = base64.b64decode(audio_b64)
    except Exception:
        return None
    if not raw:
        return None

    if provider in ("openrouter", "openai"):
        key = keys.get(provider)
        if not key:
            return None
        try:
            mp3 = await _ogg_to_mp3(raw)
        except Exception as e:  # noqa: BLE001
            log.warning("Conversão de áudio falhou: %s", e)
            return None
        b64mp3 = base64.b64encode(mp3).decode()
        from app.agent.providers import openai_chat
        res = await openai_chat(
            provider=provider, api_key=key, model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "input_audio", "input_audio": {"data": b64mp3, "format": "mp3"}},
                ],
            }],
            temperature=0.0, max_tokens=512,
        )
        return (res.get("content") or "").strip() or None

    # Gemini (google-genai) — aceita ogg inline
    key = keys.get("gemini")
    if not key:
        return None
    try:
        from google.genai import types
        from app.agent.llm import get_client
        client = get_client(key)
        resp = await client.aio.models.generate_content(
            model=model,
            contents=[
                _PROMPT,
                types.Part.from_bytes(data=raw, mime_type=mimetype or "audio/ogg"),
            ],
        )
        return (resp.text or "").strip() or None
    except Exception as e:  # noqa: BLE001
        log.warning("Transcrição Gemini falhou: %s", e)
        return None
