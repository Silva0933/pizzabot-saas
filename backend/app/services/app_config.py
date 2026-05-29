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

_DDL_USAGE = """
CREATE TABLE IF NOT EXISTS public.llm_usage (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id uuid,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer NOT NULL DEFAULT 0,
    completion_tokens integer NOT NULL DEFAULT 0,
    total_tokens integer NOT NULL DEFAULT 0,
    calls integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
)
"""
_DDL_USAGE_IDX = (
    "CREATE INDEX IF NOT EXISTS llm_usage_pizz_idx "
    "ON public.llm_usage (pizzaria_id, created_at)"
)


async def ensure_table() -> None:
    """Cria as tabelas auxiliares se não existirem (chamado no startup)."""
    async with engine.begin() as conn:
        await conn.execute(text(_DDL))
        await conn.execute(text(_DDL_USAGE))
        await conn.execute(text(_DDL_USAGE_IDX))


async def record_usage(
    db: AsyncSession,
    *,
    pizzaria_id: Any,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    calls: int = 1,
) -> None:
    """Registra consumo de tokens de uma rodada do agente (best-effort)."""
    if not (prompt_tokens or completion_tokens or total_tokens):
        return
    try:
        await db.execute(
            text("""
                INSERT INTO public.llm_usage
                    (pizzaria_id, provider, model, prompt_tokens, completion_tokens, total_tokens, calls)
                VALUES (:pid, :prov, :model, :pt, :ct, :tt, :calls)
            """),
            {
                "pid": str(pizzaria_id) if pizzaria_id else None,
                "prov": provider, "model": model,
                "pt": int(prompt_tokens or 0), "ct": int(completion_tokens or 0),
                "tt": int(total_tokens or 0), "calls": int(calls or 1),
            },
        )
    except Exception:  # noqa: BLE001
        await db.rollback()


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
