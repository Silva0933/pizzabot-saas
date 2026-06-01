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


async def _transcrever_gemini_nativo(key: str, model: str, raw: bytes, mimetype: str) -> str | None:
    """Transcrição via API NATIVA do Gemini (google-genai) — caminho confiável p/ áudio."""
    gem_model = model or "gemini-2.5-flash"
    if gem_model.startswith("google/"):
        gem_model = gem_model.split("/", 1)[1]
    if "gemini" not in gem_model.lower():
        gem_model = "gemini-2.5-flash"  # modelo configurado não é Gemini → usa um que ouve áudio
    from google.genai import types
    from app.agent.llm import get_client
    client = get_client(key)
    resp = await client.aio.models.generate_content(
        model=gem_model,
        contents=[_PROMPT, types.Part.from_bytes(data=raw, mime_type=mimetype or "audio/ogg")],
    )
    return (resp.text or "").strip() or None


async def _transcrever_openai_compat(provider: str, key: str, model: str, raw: bytes) -> str | None:
    """Transcrição via OpenRouter/OpenAI (input_audio em mp3). Menos confiável p/ Gemini."""
    mp3 = await _ogg_to_mp3(raw)
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


async def transcrever_audio(db: AsyncSession, audio_b64: str, mimetype: str = "audio/ogg") -> str | None:
    """
    Transcreve um áudio (base64). Estratégia (independente do modelo de RESPOSTA):
      1) Gemini NATIVO se houver chave gemini (confiável p/ áudio, aceita ogg inline);
      2) Fallback OpenRouter/OpenAI (input_audio em mp3).
    Retorna o texto ou None. Loga o caminho/erro pra diagnóstico.
    """
    cfg = await get_llm_config(db)
    model = cfg.get("transcription_model") or cfg["model"]
    keys = cfg["keys"]

    try:
        raw = base64.b64decode(audio_b64)
    except Exception:
        log.warning("Transcrição: base64 inválido")
        return None
    if not raw:
        log.warning("Transcrição: áudio vazio")
        return None

    log.info("Transcrição: %d bytes, modelo=%s, gemini_key=%s, openrouter_key=%s",
             len(raw), model, bool(keys.get("gemini")), bool(keys.get("openrouter")))

    # 1) Gemini nativo (preferencial)
    if keys.get("gemini"):
        try:
            txt = await _transcrever_gemini_nativo(keys["gemini"], model, raw, mimetype)
            if txt:
                log.info("Transcrição OK (Gemini nativo): %s", txt[:80])
                return txt
            log.warning("Transcrição Gemini nativo veio vazia")
        except Exception as e:  # noqa: BLE001
            log.warning("Transcrição Gemini nativo falhou: %s", e)

    # 2) Fallback OpenRouter/OpenAI (input_audio)
    for prov in ("openrouter", "openai"):
        if keys.get(prov):
            try:
                txt = await _transcrever_openai_compat(prov, keys[prov], model, raw)
                if txt:
                    log.info("Transcrição OK (%s input_audio): %s", prov, txt[:80])
                    return txt
                log.warning("Transcrição %s veio vazia", prov)
            except Exception as e:  # noqa: BLE001
                log.warning("Transcrição %s falhou: %s", prov, e)

    log.warning("Transcrição: nenhum caminho disponível/funcionou (configure uma chave Gemini)")
    return None
