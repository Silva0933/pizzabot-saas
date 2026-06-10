"""
Painel do dono do SaaS (platform admin).

Foco em ASSINATURAS / PLANOS / FATURAMENTO DA PLATAFORMA — não no
operacional das pizzarias (faturamento delas, pedidos, ticket, etc.).

MRR = soma do preço mensal do plano de cada pizzaria ativa.
"""
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from app.db import get_db
from app.deps import require_platform_admin
from app.models import Usuario
from app.services.app_config import LLM_KEY, get_config, get_llm_config, set_config
from app.services.plans import DEFAULT_PLAN, PLANS, plan_info, plans_catalog
from app.services.secrets import decrypt_secret, encrypt_secret, mask_secret

router = APIRouter(prefix="/admin", tags=["admin"])

import os

# Ciclo de cobrança: 30 dias rolando a partir da ativação do plano.
CICLO_DIAS = 30
# Custo estimado de IA por 1M de tokens (em R$). Ajustável por ambiente conforme
# o modelo/câmbio. Usado só para a estimativa de custo no painel admin.
CUSTO_POR_1M_TOKENS_BRL = float(os.getenv("CUSTO_POR_1M_TOKENS_BRL", "2.50"))

# Provedores de LLM suportados + sugestões de modelo (o admin pode digitar outro).
LLM_PROVIDERS = {
    "gemini": {
        "nome": "Google Gemini",
        "modelos": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash-lite"],
    },
    "openai": {
        "nome": "OpenAI",
        "modelos": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    },
    "openrouter": {
        "nome": "OpenRouter",
        "modelos": [
            "google/gemini-2.5-flash-lite", "google/gemini-2.5-flash",
            "google/gemini-2.0-flash-001", "openai/gpt-4o-mini",
            "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat",
        ],
    },
}


def _mask(key: str | None) -> str:
    return mask_secret(key)


@router.get("/overview")
async def platform_overview(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Visão de assinaturas e faturamento recorrente da plataforma."""
    desde = datetime.now(timezone.utc) - timedelta(days=days)
    params = {"desde": desde}

    # --- Pizzarias com plano, status e uso ---
    q = await db.execute(text("""
        SELECT
            p.id,
            p.nome,
            COALESCE(p.plano, 'basico') AS plano,
            p.bot_ativo_global AS ativa,
            p.instancia,
            p.created_at,
            (SELECT COUNT(*) FROM public.produtos pr WHERE pr.pizzaria_id = p.id) AS produtos,
            (SELECT COUNT(*) FROM public.conversas c WHERE c.pizzaria_id = p.id) AS conversas
        FROM public.pizzarias p
        ORDER BY p.created_at DESC
    """))
    rows = q.fetchall()

    assinaturas = []
    mrr = 0.0
    ativas = 0
    novas = 0
    por_plano: dict[str, dict] = {
        pid: {"plano": pid, "nome": pl["nome"], "preco": pl["preco_mensal"], "qtd": 0, "subtotal": 0.0}
        for pid, pl in PLANS.items()
    }

    for r in rows:
        plano = (r[2] or DEFAULT_PLAN).lower()
        info = plan_info(plano)
        preco = float(info["preco_mensal"])
        ativa = bool(r[3])
        created_at = r[5]

        if ativa:
            ativas += 1
            mrr += preco
        if created_at and created_at >= desde:
            novas += 1

        bucket = por_plano.setdefault(
            plano,
            {"plano": plano, "nome": info["nome"], "preco": preco, "qtd": 0, "subtotal": 0.0},
        )
        bucket["qtd"] += 1
        if ativa:
            bucket["subtotal"] += preco

        assinaturas.append({
            "id": str(r[0]),
            "nome": r[1],
            "plano": plano,
            "plano_nome": info["nome"],
            "preco_mensal": preco,
            "ativa": ativa,
            "instancia_conectada": bool(r[4]),
            "created_at": created_at.isoformat() if created_at else None,
            "uso": {
                "produtos": r[6] or 0,
                "conversas": r[7] or 0,
            },
            "limites": info["limites"],
        })

    total_pizz = len(rows)

    # --- Novas assinaturas por dia (série para gráfico de crescimento) ---
    serie_q = await db.execute(text("""
        SELECT DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia, COUNT(*) AS qtd
        FROM public.pizzarias
        WHERE created_at >= :desde
        GROUP BY dia
        ORDER BY dia
    """), params)
    serie_novas = [{"dia": str(r[0]), "qtd": r[1] or 0} for r in serie_q.fetchall()]

    return {
        "periodo_dias": days,
        "desde": desde.isoformat(),
        "resumo": {
            "total_pizzarias": total_pizz,
            "pizzarias_ativas": ativas,
            "pizzarias_inativas": total_pizz - ativas,
            "pizzarias_novas": novas,
            "mrr": round(mrr, 2),
            "arr": round(mrr * 12, 2),
            "ticket_medio_plano": round(mrr / ativas, 2) if ativas else 0.0,
        },
        "planos": [
            {**c, "subtotal": round(c["subtotal"], 2)}
            for c in sorted(por_plano.values(), key=lambda x: PLANS.get(x["plano"], {}).get("ordem", 99))
        ],
        "catalogo": plans_catalog(),
        "assinaturas": assinaturas,
        "serie_novas": serie_novas,
    }


@router.patch("/pizzarias/{pizzaria_id}/plano")
async def alterar_plano(
    pizzaria_id: str,
    plano: str = Body(..., embed=True),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Ativa/altera o plano de uma pizzaria e inicia um ciclo de 30 dias."""
    plano = (plano or "").lower()
    if plano not in PLANS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Plano inválido. Use: {list(PLANS)}")

    # Ativar/trocar plano (re)inicia o ciclo: vence em 30 dias a partir de agora.
    res = await db.execute(
        text(
            f"UPDATE public.pizzarias SET plano = :plano, plano_ativado_em = now(), "
            f"plano_vence_em = now() + interval '{CICLO_DIAS} days', updated_at = now() "
            f"WHERE id = :id RETURNING plano_vence_em"
        ),
        {"plano": plano, "id": pizzaria_id},
    )
    row = res.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    await db.commit()
    return {"ok": True, "plano": plano, "info": plan_info(plano), "vence_em": row[0].isoformat() if row[0] else None}


@router.patch("/pizzarias/{pizzaria_id}/renovar")
async def renovar_assinatura(
    pizzaria_id: str,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """
    Renova +30 dias (cliente pagou). Estende a partir do vencimento atual se ainda
    no futuro, senão a partir de hoje. Também reativa a pizzaria se estava suspensa.
    """
    res = await db.execute(
        text(
            f"UPDATE public.pizzarias SET "
            f"plano_vence_em = GREATEST(now(), COALESCE(plano_vence_em, now())) + interval '{CICLO_DIAS} days', "
            f"plano_ativado_em = COALESCE(plano_ativado_em, now()), "
            f"suspensa = FALSE, suspensa_motivo = NULL, updated_at = now() "
            f"WHERE id = :id RETURNING plano_vence_em"
        ),
        {"id": pizzaria_id},
    )
    row = res.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    await db.commit()
    return {"ok": True, "vence_em": row[0].isoformat() if row[0] else None, "reativada": True}


@router.get("/assinaturas")
async def listar_assinaturas(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """
    Lista as assinaturas com vencimento e ALERTAS (vence amanhã / vencida) para o
    painel do admin. A suspensão é manual — aqui só sinalizamos.
    """
    rows = (await db.execute(text(
        "SELECT id, nome, COALESCE(plano,'basico') AS plano, plano_ativado_em, "
        "plano_vence_em, suspensa FROM public.pizzarias ORDER BY plano_vence_em NULLS LAST"
    ))).fetchall()

    from app.services.app_config import conversas_atendidas_mes_todas, uso_mes_todas
    uso = await uso_mes_todas(db)
    atend = await conversas_atendidas_mes_todas(db)  # atendimentos (cota) por pizzaria

    agora = datetime.now(timezone.utc)
    itens = []
    contagem = {"vence_amanha": 0, "vencida": 0, "suspensas": 0, "limite_ia": 0}
    tokens_total = 0
    custo_total = 0.0
    receita_total = 0.0
    for r in rows:
        vence = r[4]
        dias = None
        alerta = "sem_plano"
        if vence is not None:
            # dias restantes (arredonda pra cima quando ainda há fração de dia futura)
            dias = math.ceil((vence - agora).total_seconds() / 86400)
            if dias < 0:
                alerta = "vencida"
                contagem["vencida"] += 1
            elif dias <= 1:
                alerta = "vence_amanha"
                contagem["vence_amanha"] += 1
            else:
                alerta = "em_dia"
        if r[5]:
            contagem["suspensas"] += 1
        info = plan_info(r[2])
        pid = str(r[0])
        u = uso.get(pid, {"mensagens": 0, "tokens": 0})
        atendimentos = int(atend.get(pid, 0))
        # Cota do plano = atendimentos (conversas/mês), não rodadas de IA.
        limite_ia = int((info.get("limites") or {}).get("conversas_mes") or 0)
        if limite_ia and atendimentos >= limite_ia:
            contagem["limite_ia"] += 1
        custo = round(u["tokens"] / 1_000_000 * CUSTO_POR_1M_TOKENS_BRL, 2)
        tokens_total += u["tokens"]
        custo_total += custo
        if not r[5]:  # não conta receita de suspensa
            receita_total += float(info["preco_mensal"])
        itens.append({
            "pizzaria_id": pid,
            "nome": r[1],
            "plano": r[2],
            "plano_nome": info["nome"],
            "preco_mensal": info["preco_mensal"],
            "ativado_em": r[3].isoformat() if r[3] else None,
            "vence_em": vence.isoformat() if vence else None,
            "dias_restantes": dias,
            "alerta": alerta,
            "suspensa": bool(r[5]),
            # ia_mensagens/ia_limite passam a refletir a COTA (atendimentos do mês).
            "ia_mensagens": atendimentos,
            "ia_limite": limite_ia,
            "ia_rodadas": u["mensagens"],
            "ia_tokens": u["tokens"],
            "ia_custo": custo,
            # Economia/saúde por tenant: custo médio por atendimento e margem
            # estimada do mês (preço do plano − custo de IA).
            "custo_por_atendimento": round(custo / atendimentos, 3) if atendimentos else None,
            "margem": round(float(info["preco_mensal"]) - custo, 2),
        })

    custo_total = round(custo_total, 2)
    return {
        "assinaturas": itens,
        "alertas": contagem,
        "ciclo_dias": CICLO_DIAS,
        "custo": {
            "tokens_total": tokens_total,
            "custo_total_estimado": custo_total,
            "receita_total": round(receita_total, 2),
            "margem_estimada": round(receita_total - custo_total, 2),
            "preco_por_1m_tokens": CUSTO_POR_1M_TOKENS_BRL,
        },
    }


@router.get("/faturas")
async def listar_faturas(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Faturas da cobrança da plataforma (assinaturas das pizzarias via Asaas)."""
    rows = (await db.execute(text("""
        SELECT f.id, f.pizzaria_id, COALESCE(pz.nome,'(removida)') AS pizzaria_nome,
               f.valor, f.status, f.vencimento, f.pago_em, f.link_pagamento, f.created_at
        FROM public.faturas f
        LEFT JOIN public.pizzarias pz ON pz.id = f.pizzaria_id
        ORDER BY f.created_at DESC
        LIMIT :lim
    """), {"lim": limit})).fetchall()

    tot = (await db.execute(text("""
        SELECT
            COALESCE(SUM(valor) FILTER (WHERE status = 'paga'
                AND pago_em >= date_trunc('month', now())), 0) AS recebido_mes,
            COUNT(*) FILTER (WHERE status = 'pendente') AS pendentes,
            COUNT(*) FILTER (WHERE status = 'vencida') AS vencidas
        FROM public.faturas
    """))).fetchone()

    return {
        "faturas": [
            {
                "id": str(r[0]), "pizzaria_id": str(r[1]), "pizzaria_nome": r[2],
                "valor": float(r[3] or 0), "status": r[4],
                "vencimento": r[5].isoformat() if r[5] else None,
                "pago_em": r[6].isoformat() if r[6] else None,
                "link_pagamento": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
            }
            for r in rows
        ],
        "recebido_mes": float(tot[0] or 0),
        "pendentes": int(tot[1] or 0),
        "vencidas": int(tot[2] or 0),
    }


@router.get("/alertas")
async def listar_alertas_endpoint(
    limit: int = Query(50, ge=1, le=200),
    apenas_abertos: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Lista os alertas da plataforma (falhas + preços suspeitos) — Fase 2."""
    from app.services.alertas import contar_alertas_abertos, listar_alertas
    itens = await listar_alertas(db, limit=limit, apenas_abertos=apenas_abertos)
    abertos = await contar_alertas_abertos(db)
    return {"alertas": itens, "abertos": abertos}


@router.patch("/alertas/{alerta_id}/resolver")
async def resolver_alerta(
    alerta_id: str,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Marca um alerta como resolvido."""
    await db.execute(
        text("UPDATE public.plataforma_alertas SET resolvido = true WHERE id = :id"),
        {"id": alerta_id},
    )
    await db.commit()
    return {"ok": True}


@router.patch("/pizzarias/{pizzaria_id}/pipeline")
async def alterar_pipeline(
    pizzaria_id: str,
    fsm: bool = Body(..., embed=True),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Liga/desliga o pipeline FSM (NLU→backend→voz) de uma pizzaria (experimental)."""
    res = await db.execute(
        text("UPDATE public.pizzarias SET pipeline_fsm = :v, updated_at = now() WHERE id = :id RETURNING id"),
        {"v": fsm, "id": pizzaria_id},
    )
    if res.fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    await db.commit()
    return {"ok": True, "pipeline_fsm": fsm}


@router.patch("/pizzarias/{pizzaria_id}/suspensao")
async def alterar_suspensao(
    pizzaria_id: str,
    suspensa: bool = Body(..., embed=True),
    motivo: str | None = Body(None, embed=True),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """
    Suspende (ou reativa) uma pizzaria sem excluir os dados. Suspensa = atendimento
    100% desligado (o webhook ignora as mensagens). Reativar é só passar suspensa=false.
    """
    res = await db.execute(
        text(
            "UPDATE public.pizzarias SET suspensa = :s, suspensa_motivo = :m, updated_at = now() "
            "WHERE id = :id RETURNING id"
        ),
        {"s": suspensa, "m": (motivo if suspensa else None), "id": pizzaria_id},
    )
    if res.fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    await db.commit()
    return {"ok": True, "suspensa": suspensa, "motivo": motivo if suspensa else None}


# ============================================
# Config de LLM (provider / modelo / chaves)
# ============================================
class LLMConfigIn(BaseModel):
    provider: str
    model: str
    keys: dict[str, str] = {}
    # Modelo por plano (opcional): {"basico": "...", "pro": "...", "premium": "..."}.
    modelos_plano: dict[str, str] = {}
    # Modelo separado p/ transcrever áudio (ex.: google/gemini-2.5-flash-lite).
    transcription_model: str | None = None
    # Provedor reserva (failover) quando o primário falha. Vazio = sem failover.
    fallback_provider: str | None = None
    fallback_model: str | None = None
    # Modelo barato p/ NLU (extração JSON). Vazio = mesmo modelo principal.
    nlu_model: str | None = None


@router.get("/llm")
async def get_llm(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    cfg = await get_llm_config(db)
    raw = await get_config(db, LLM_KEY)
    raw_keys = {**{"gemini": "", "openai": "", "openrouter": ""}, **(raw.get("keys") or {})}
    return {
        "provider": cfg["provider"],
        "model": cfg["model"],
        "providers": LLM_PROVIDERS,
        # nunca devolve a chave crua — só máscara + flag de configurada
        "keys_mascaradas": {k: _mask(v) for k, v in raw_keys.items()},
        "keys_configuradas": {k: bool(v) for k, v in cfg["keys"].items()},
        "modelos_plano": cfg.get("modelos_plano") or {},
        "planos": list(PLANS.keys()),
        "transcription_model": cfg.get("transcription_model") or "",
        "fallback_provider": cfg.get("fallback_provider") or "",
        "fallback_model": cfg.get("fallback_model") or "",
        # Devolve o valor CONFIGURADO (cru), não o resolvido — vazio = herda o principal.
        "nlu_model": (raw.get("nlu_model") or "").strip(),
    }


@router.put("/llm")
async def put_llm(
    body: LLMConfigIn,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    provider = (body.provider or "").lower()
    if provider not in LLM_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Provider inválido. Use: {list(LLM_PROVIDERS)}")
    if not body.model.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe o modelo.")

    raw = await get_config(db, LLM_KEY)
    keys = {**{"gemini": "", "openai": "", "openrouter": ""}, **(raw.get("keys") or {})}
    # Só atualiza chaves enviadas não-vazias (mantém as já salvas).
    for k, v in (body.keys or {}).items():
        if k in keys and v and v.strip():
            keys[k] = encrypt_secret(v.strip())

    # Modelo por plano: mantém só entradas válidas (plano conhecido + modelo não-vazio).
    modelos_plano = {
        p.lower(): m.strip()
        for p, m in (body.modelos_plano or {}).items()
        if p.lower() in PLANS and (m or "").strip()
    }

    # Failover (opcional): provider precisa ser conhecido; vazio desliga.
    fallback_provider = (body.fallback_provider or "").lower().strip()
    if fallback_provider and fallback_provider not in LLM_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Fallback provider inválido. Use: {list(LLM_PROVIDERS)}")
    fallback_model = (body.fallback_model or "").strip()

    await set_config(db, LLM_KEY, {
        "provider": provider, "model": body.model.strip(),
        "keys": keys, "modelos_plano": modelos_plano,
        "transcription_model": (body.transcription_model or "").strip(),
        "fallback_provider": fallback_provider,
        "fallback_model": fallback_model,
        "nlu_model": (body.nlu_model or "").strip(),
    })
    return {"ok": True, "provider": provider, "model": body.model.strip(),
            "modelos_plano": modelos_plano,
            "transcription_model": (body.transcription_model or "").strip(),
            "fallback_provider": fallback_provider,
            "fallback_model": fallback_model,
            "nlu_model": (body.nlu_model or "").strip(),
            "keys_configuradas": {k: bool(decrypt_secret(v) or v) for k, v in keys.items()}}


@router.get("/llm/usage")
async def llm_usage(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Consumo de tokens da LLM: total, por pizzaria e por dia."""
    desde = datetime.now(timezone.utc) - timedelta(days=days)
    p = {"desde": desde}

    try:
        tot = (await db.execute(text("""
            SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
                   COALESCE(SUM(total_tokens),0), COALESCE(SUM(calls),0)
            FROM public.llm_usage WHERE created_at >= :desde
        """), p)).fetchone()

        por_pizz = (await db.execute(text("""
            SELECT u.pizzaria_id, COALESCE(pz.nome,'(desconhecida)') AS nome,
                   SUM(u.total_tokens) AS tokens, SUM(u.calls) AS calls
            FROM public.llm_usage u
            LEFT JOIN public.pizzarias pz ON pz.id = u.pizzaria_id
            WHERE u.created_at >= :desde
            GROUP BY u.pizzaria_id, pz.nome
            ORDER BY tokens DESC
        """), p)).fetchall()

        por_dia = (await db.execute(text("""
            SELECT DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
                   SUM(total_tokens) AS tokens
            FROM public.llm_usage WHERE created_at >= :desde
            GROUP BY dia ORDER BY dia
        """), p)).fetchall()
    except Exception:
        await db.rollback()
        return {"total": {"prompt": 0, "completion": 0, "total": 0, "calls": 0}, "por_pizzaria": [], "por_dia": []}

    return {
        "periodo_dias": days,
        "total": {
            "prompt": int(tot[0]), "completion": int(tot[1]),
            "total": int(tot[2]), "calls": int(tot[3]),
        },
        "por_pizzaria": [
            {"pizzaria_id": str(r[0]) if r[0] else None, "nome": r[1],
             "tokens": int(r[2] or 0), "calls": int(r[3] or 0)}
            for r in por_pizz
        ],
        "por_dia": [{"dia": str(r[0]), "tokens": int(r[1] or 0)} for r in por_dia],
    }


@router.delete("/llm/usage")
async def zerar_llm_usage(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Zera a contagem de consumo de tokens."""
    try:
        await db.execute(text("DELETE FROM public.llm_usage"))
        await db.commit()
    except Exception:
        await db.rollback()
    return {"ok": True}


@router.post("/llm/test")
async def test_llm(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Faz uma chamada simples ao provider configurado para validar a chave/modelo."""
    cfg = await get_llm_config(db)
    provider = cfg["provider"]
    model = cfg["model"]
    try:
        if provider in ("openai", "openrouter"):
            from app.agent.providers import openai_chat
            key = cfg["keys"].get(provider)
            if not key:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Chave do {provider} não configurada.")
            res = await openai_chat(
                provider=provider, api_key=key, model=model,
                messages=[{"role": "user", "content": "Responda apenas: ok"}],
                max_tokens=10,
            )
            texto = (res.get("content") or "").strip()
        else:
            from app.agent.llm import call_gemini, extract_text, to_content
            resp = await call_gemini(
                system="Responda apenas: ok",
                history=[to_content("user", text="ok")],
                model=model, api_key=cfg["keys"].get("gemini") or None,
                max_tokens=10,
            )
            texto = extract_text(resp)
        return {"ok": True, "provider": provider, "model": model, "resposta": texto[:200]}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "provider": provider, "model": model, "erro": str(e)[:400]}
