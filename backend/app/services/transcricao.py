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


# --------------------------------------------------------------------------- #
# Transcrição FORA do webhook
# --------------------------------------------------------------------------- #
# Antes o webhook baixava e transcrevia o áudio antes de responder 200 à
# Evolution. Um áudio longo (ou o provedor lento) estourava o timeout dela, que
# reentregava o evento. Agora o webhook salva "[áudio]" e responde na hora; quem
# transcreve é o worker/dispatcher, antes de chamar o agente (ou uma tarefa em
# segundo plano, quando a mensagem não vai para o agente).
def referencia_midia(data: dict) -> dict | None:
    """O mínimo que a Evolution precisa para baixar a mídia (vai para a fila no
    Redis). Descarta o base64 que alguns webhooks já mandam embutido."""
    msg = data.get("message") or {}
    audio = msg.get("audioMessage")
    if not audio or not data.get("key"):
        return None
    return {"key": data["key"], "message": {"audioMessage": audio}}


async def transcrever_mensagem_audio(
    db: AsyncSession, pizzaria_id, mensagem_id, midia: dict
) -> str | None:
    """Baixa, transcreve e grava a transcrição na mensagem. Best-effort: devolve
    None (e a mensagem fica como "[áudio]") se algo falhar."""
    import uuid as _uuid

    from sqlalchemy import select

    from app.models import Conversa, Mensagem, Pizzaria
    from app.services.broadcaster import broadcaster
    from app.services.evolution import evolution

    try:
        pid = _uuid.UUID(str(pizzaria_id))
        pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pid))).scalar_one_or_none()
        if not pizz or not pizz.instancia:
            return None
        b64 = await evolution.get_media_base64(instancia=pizz.instancia, message=midia)
        if not b64:
            return None
        audio = (midia.get("message") or {}).get("audioMessage") or {}
        texto = await transcrever_audio(db, b64, audio.get("mimetype") or "audio/ogg")
        if not texto:
            return None

        msg = (await db.execute(select(Mensagem).where(
            Mensagem.id == _uuid.UUID(str(mensagem_id)), Mensagem.pizzaria_id == pid,
        ))).scalar_one_or_none()
        if msg is None:
            return texto
        msg.conteudo = texto
        msg.tipo = "texto"
        msg.metadata_json = {**(msg.metadata_json or {}), "transcrito_de": "audio"}
        conv = (await db.execute(select(Conversa).where(Conversa.id == msg.conversa_id))).scalar_one_or_none()
        if conv is not None and conv.last_message == "[áudio]":
            conv.last_message = texto
        await db.commit()
        await broadcaster.publish(pid, {
            "tipo": "mensagem.atualizada",
            "pizzaria_id": str(pid),
            "payload": {
                "conversa_id": str(msg.conversa_id),
                "mensagem_id": str(msg.id),
                "conteudo": texto,
                "tipo": "texto",
            },
        })
        return texto
    except Exception as e:  # noqa: BLE001
        log.warning("Falha na transcrição de áudio (mensagem=%s): %s", mensagem_id, e)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None


async def transcrever_pendentes(pizzaria_id, pending: list[dict]) -> None:
    """Troca "[áudio]" pela transcrição nos itens do lote antes de ir ao agente.
    Abre a própria sessão: o commit da transcrição não se mistura com o agente."""
    audios = [
        p for p in pending
        if (p.get("metadata") or {}).get("tipo") == "audio" and (p.get("metadata") or {}).get("midia")
    ]
    if not audios:
        return
    from app.db import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        for item in audios:
            texto = await transcrever_mensagem_audio(
                db, pizzaria_id, item.get("mensagem_id"), item["metadata"]["midia"],
            )
            if texto:
                item["conteudo"] = texto


async def transcrever_em_segundo_plano(pizzaria_id, mensagem_id, midia: dict) -> None:
    """Para áudio que não vai ao agente (bot desligado, fora do horário): a
    equipe ainda lê a transcrição no painel."""
    from app.db import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await transcrever_mensagem_audio(db, pizzaria_id, mensagem_id, midia)
