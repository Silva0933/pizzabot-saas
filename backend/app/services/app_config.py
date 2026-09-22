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
from app.services.secrets import decrypt_secret

_settings = get_settings()

LLM_KEY = "llm"
# Config da Evolution API (URL base + apikey global + token do webhook),
# editável pelo painel admin. Cai nas variáveis de ambiente quando vazia.
EVOLUTION_KEY = "evolution"
# Última saúde conhecida da Evolution (usado pelo monitor para alertar só na
# TRANSIÇÃO online → offline, em vez de repetir alerta a cada 5 min).
EVOLUTION_STATUS_KEY = "evolution_status"
# Gateway de cobrança da PLATAFORMA (Asaas que cobra as pizzarias), editável
# pelo painel admin. Cai nas variáveis de ambiente quando vazio — igual à
# Evolution e ao LLM.
BILLING_KEY = "billing"

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

_DDL_CARDAPIO_ARQUIVO = """
CREATE TABLE IF NOT EXISTS public.cardapio_arquivo (
    pizzaria_id uuid PRIMARY KEY,
    filename text,
    content_type text,
    tamanho integer NOT NULL DEFAULT 0,
    dados bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
)
"""


async def ensure_table() -> None:
    """Cria as tabelas auxiliares se não existirem (chamado no startup)."""
    async with engine.begin() as conn:
        await conn.execute(text(_DDL))
        await conn.execute(text(_DDL_USAGE))
        await conn.execute(text(_DDL_USAGE_IDX))
        await conn.execute(text(_DDL_CARDAPIO_ARQUIVO))


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


async def uso_mes(db: AsyncSession, pizzaria_id: Any, *, mes: str | None = None) -> dict[str, int]:
    """
    Uso de IA da pizzaria no mês corrente (fuso America/Sao_Paulo):
      - mensagens: nº de respostas da IA (1 linha em llm_usage por rodada do agente)
      - tokens: soma de total_tokens
    """
    try:
        row = (await db.execute(text("""
            SELECT COUNT(*) AS msgs, COALESCE(SUM(total_tokens), 0) AS toks
            FROM public.llm_usage
            WHERE pizzaria_id = :pid
              AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo'
        """), {"pid": str(pizzaria_id)})).first()
        if not row:
            return {"mensagens": 0, "tokens": 0}
        return {"mensagens": int(row[0] or 0), "tokens": int(row[1] or 0)}
    except Exception:  # noqa: BLE001
        return {"mensagens": 0, "tokens": 0}


async def conversas_atendidas_mes(db: AsyncSession, pizzaria_id: Any) -> int:
    """Nº de ATENDIMENTOS da IA no mês: conversas DISTINTAS que receberam ao menos
    uma resposta do bot (1 por cliente/mês, mesmo trocando várias mensagens).
    É a métrica de cota dos planos."""
    try:
        row = (await db.execute(text("""
            SELECT COUNT(DISTINCT conversa_id)
            FROM public.mensagens
            WHERE pizzaria_id = :pid AND origem = 'bot'
              AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo'
        """), {"pid": str(pizzaria_id)})).first()
        return int(row[0] or 0) if row else 0
    except Exception:  # noqa: BLE001
        return 0


async def conversa_ja_atendida_mes(db: AsyncSession, pizzaria_id: Any, conversa_id: Any) -> bool:
    """True se ESTA conversa já recebeu resposta do bot no mês — ou seja, já conta
    como atendimento. Usado para NÃO bloquear (nem recontar) conversas em andamento."""
    try:
        row = (await db.execute(text("""
            SELECT 1 FROM public.mensagens
            WHERE pizzaria_id = :pid AND origem = 'bot' AND conversa_id = :cid
              AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo'
            LIMIT 1
        """), {"pid": str(pizzaria_id), "cid": str(conversa_id)})).first()
        return bool(row)
    except Exception:  # noqa: BLE001
        return False


async def conversas_atendidas_mes_todas(db: AsyncSession) -> dict[str, int]:
    """Atendimentos do mês por pizzaria (pizzaria_id → nº de conversas distintas)."""
    out: dict[str, int] = {}
    try:
        rows = (await db.execute(text("""
            SELECT pizzaria_id, COUNT(DISTINCT conversa_id)
            FROM public.mensagens
            WHERE pizzaria_id IS NOT NULL AND origem = 'bot'
              AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo'
            GROUP BY pizzaria_id
        """))).fetchall()
        for r in rows:
            out[str(r[0])] = int(r[1] or 0)
    except Exception:  # noqa: BLE001
        pass
    return out


async def uso_mes_todas(db: AsyncSession) -> dict[str, dict[str, int]]:
    """Uso de IA do mês corrente por pizzaria (mapa pizzaria_id → {mensagens, tokens})."""
    out: dict[str, dict[str, int]] = {}
    try:
        rows = (await db.execute(text("""
            SELECT pizzaria_id, COUNT(*) AS msgs, COALESCE(SUM(total_tokens), 0) AS toks
            FROM public.llm_usage
            WHERE pizzaria_id IS NOT NULL
              AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                AT TIME ZONE 'America/Sao_Paulo'
            GROUP BY pizzaria_id
        """))).fetchall()
        for r in rows:
            out[str(r[0])] = {"mensagens": int(r[1] or 0), "tokens": int(r[2] or 0)}
    except Exception:  # noqa: BLE001
        pass
    return out


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
    # Provedor reserva (failover): usado quando o primário falha (timeout/5xx/
    # chave inválida). Vazio = sem failover.
    "fallback_provider": "",
    "fallback_model": "",
    # Modelo BARATO para a NLU (extração de JSON — não precisa do modelo bom).
    # Vazio = usa o modelo principal. Ex.: gemini-2.0-flash-lite.
    "nlu_model": "",
}


async def get_llm_config(db: AsyncSession) -> dict[str, Any]:
    """
    Config de LLM atual (merge com defaults).

    Prioridade para cada campo:
      1. Valor salvo no banco (painel admin)
      2. Variável de ambiente (LLM_PROVIDER / LLM_MODEL / *_API_KEY)
      3. Default hard-coded (gemini / gemini-2.0-flash)
    """
    cfg = await get_config(db, LLM_KEY)

    # --- Provider ---
    provider = (
        cfg.get("provider")
        or _settings.llm_provider
        or DEFAULT_LLM_CONFIG["provider"]
    ).lower()

    # --- Modelo ---
    model = (
        cfg.get("model")
        or _settings.llm_model
        or DEFAULT_LLM_CONFIG["model"]
    )

    # --- Chaves (decrypt se salvas criptografadas) ---
    keys = {**DEFAULT_LLM_CONFIG["keys"], **(cfg.get("keys") or {})}
    keys = {k: (decrypt_secret(v) or "") for k, v in keys.items()}

    # Fallback para variáveis de ambiente quando a chave não está no banco.
    if not keys.get("gemini"):
        keys["gemini"] = _settings.gemini_api_key or ""
    if not keys.get("openrouter"):
        keys["openrouter"] = _settings.openrouter_api_key or ""
    if not keys.get("openai"):
        keys["openai"] = _settings.openai_api_key or ""

    # Modelo por plano (opcional): {"basico": "...", "pro": "...", "premium": "..."}.
    # Permite usar um modelo mais barato no Básico e melhor no Premium.
    modelos_plano = cfg.get("modelos_plano") or {}

    # Modelo de TRANSCRIÇÃO de áudio (separado do modelo de texto). Útil quando o
    # modelo de resposta não ouve áudio (ex.: Gemma) — aí o áudio é transcrito por
    # um modelo multimodal barato (ex.: google/gemini-2.5-flash-lite) e o TEXTO vai
    # pro modelo de resposta. Cai no modelo de texto se não configurado.
    transcription_model = (cfg.get("transcription_model") or "").strip() or model

    # Provedor reserva (failover) — opcional, configurado no painel admin.
    fallback_provider = (cfg.get("fallback_provider") or "").lower().strip()
    fallback_model = (cfg.get("fallback_model") or "").strip()

    # Modelo barato para a NLU (extração JSON). Cai no modelo principal se vazio.
    nlu_model = (cfg.get("nlu_model") or "").strip() or model

    return {
        "provider": provider, "model": model, "keys": keys,
        "modelos_plano": modelos_plano, "transcription_model": transcription_model,
        "fallback_provider": fallback_provider, "fallback_model": fallback_model,
        "nlu_model": nlu_model,
    }


def modelo_para_plano(cfg: dict[str, Any], plano: str | None) -> str:
    """Retorna o modelo configurado para o plano, ou o modelo global como padrão."""
    mp = cfg.get("modelos_plano") or {}
    return (mp.get((plano or "").lower()) or cfg.get("model") or "").strip() or cfg.get("model")


# ============================================
# Config da Evolution API (WhatsApp)
# ============================================
DEFAULT_EVOLUTION_CONFIG: dict[str, Any] = {
    "base_url": "",
    "api_key": "",
    "webhook_token": "",
}


async def get_evolution_config(db: AsyncSession) -> dict[str, Any]:
    """
    Config da Evolution em uso (merge com as variáveis de ambiente).

    Prioridade para cada campo:
      1. Valor salvo no banco (painel admin → IA e integrações)
      2. Variável de ambiente (EVOLUTION_BASE_URL / EVOLUTION_API_KEY / ...)
      3. Vazio (integração desligada)

    `origem` diz de onde veio cada campo — o painel mostra isso pro admin
    entender se está editando o que realmente está valendo.
    """
    cfg = await get_config(db, EVOLUTION_KEY)

    salvo_url = (cfg.get("base_url") or "").strip()
    salvo_key = decrypt_secret(cfg.get("api_key") or "") or ""
    salvo_token = decrypt_secret(cfg.get("webhook_token") or "") or ""

    base_url = salvo_url or (_settings.evolution_base_url or "").strip()
    api_key = salvo_key or (_settings.evolution_api_key or "")
    webhook_token = salvo_token or (_settings.evolution_webhook_token or "")

    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "webhook_token": webhook_token,
        "origem": {
            "base_url": "banco" if salvo_url else ("env" if base_url else "vazio"),
            "api_key": "banco" if salvo_key else ("env" if api_key else "vazio"),
            "webhook_token": "banco" if salvo_token else ("env" if webhook_token else "vazio"),
        },
        "configurada": bool(base_url and api_key),
    }


BILLING_PADRAO = {
    "api_key": "",
    "webhook_token": "",
    "base_url": "",
}


async def get_billing_config(db: AsyncSession) -> dict[str, Any]:
    """
    Config do Asaas da plataforma em uso (merge com as variáveis de ambiente).

    Prioridade por campo:
      1. Valor salvo no banco (painel admin → Planos → Gateway de cobrança)
      2. Variável de ambiente (ASAAS_PLATFORM_*)
      3. Vazio (cobrança desligada — nenhuma pizzaria assina nem paga)

    `origem` diz de onde veio cada campo, pro admin saber se está editando o
    que realmente está valendo.
    """
    cfg = await get_config(db, BILLING_KEY)

    salvo_key = decrypt_secret(cfg.get("api_key") or "") or ""
    salvo_token = decrypt_secret(cfg.get("webhook_token") or "") or ""
    salvo_url = (cfg.get("base_url") or "").strip()

    api_key = salvo_key or (_settings.asaas_platform_api_key or "").strip()
    webhook_token = salvo_token or (_settings.asaas_platform_webhook_token or "").strip()
    base_url = salvo_url or (_settings.asaas_platform_base_url or "https://api.asaas.com/v3").strip()

    return {
        "api_key": api_key,
        "webhook_token": webhook_token,
        "base_url": base_url.rstrip("/"),
        "origem": {
            "api_key": "banco" if salvo_key else ("env" if api_key else "vazio"),
            "webhook_token": "banco" if salvo_token else ("env" if webhook_token else "vazio"),
            "base_url": "banco" if salvo_url else "env",
        },
        # Só a chave decide: sem ela não existe cobrança.
        "configurada": bool(api_key),
    }
