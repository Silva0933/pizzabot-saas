"""
Configurações globais da plataforma (key/value em JSONB).

Usado para guardar a config de LLM escolhida pelo admin (provider, modelo,
chaves de API). Tabela criada de forma idempotente no startup.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import engine

_settings = get_settings()

LLM_KEY = "llm"

_DDL = """
CREATE TABLE IF NOT EXISTS public.app_config (
    chave text PRIMARY KEY,
    valor jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
)
"""


async def ensure_table() -> None:
    """Cria a tabela app_config se não existir (chamado no startup)."""
    async with engine.begin() as conn:
        await conn.execute(text(_DDL))


async def get_config(db: AsyncSession, chave: str) -> dict[str, Any]:
    try:
        row = (await db.execute(
            text("SELECT valor FROM public.app_config WHERE chave = :k"),
            {"k": chave},
        )).first()
    except Exception:
        # Tabela ainda não criada (ex.: worker antes do startup da API).
        await db.rollback()
        return {}
    if not row or row[0] is None:
        return {}
    v = row[0]
    return v if isinstance(v, dict) else json.loads(v)


async def set_config(db: AsyncSession, chave: str, valor: dict[str, Any]) -> None:
    await db.execute(
        text("""
            INSERT INTO public.app_config (chave, valor, updated_at)
            VALUES (:k, CAST(:v AS jsonb), now())
            ON CONFLICT (chave) DO UPDATE
              SET valor = EXCLUDED.valor, updated_at = now()
        """),
        {"k": chave, "v": json.dumps(valor)},
    )
    await db.commit()


# ============================================
# Config de LLM
# ============================================
DEFAULT_LLM_CONFIG: dict[str, Any] = {
    "provider": "gemini",            # gemini | openai | openrouter
    "model": "gemini-2.0-flash",
    "keys": {"gemini": "", "openai": "", "openrouter": ""},
}


async def get_llm_config(db: AsyncSession) -> dict[str, Any]:
    """
    Config de LLM atual (merge com defaults). A chave do Gemini cai para a
    variável de ambiente quando não cadastrada no painel.
    """
    cfg = await get_config(db, LLM_KEY)
    provider = (cfg.get("provider") or DEFAULT_LLM_CONFIG["provider"]).lower()
    model = cfg.get("model") or DEFAULT_LLM_CONFIG["model"]
    keys = {**DEFAULT_LLM_CONFIG["keys"], **(cfg.get("keys") or {})}
    if not keys.get("gemini"):
        keys["gemini"] = _settings.gemini_api_key or ""
    return {"provider": provider, "model": model, "keys": keys}
