"""
Painel do dono do SaaS (platform admin).

Foco em ASSINATURAS / PLANOS / FATURAMENTO DA PLATAFORMA — não no
operacional das pizzarias (faturamento delas, pedidos, ticket, etc.).

MRR = soma do preço mensal do plano de cada pizzaria ativa.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_platform_admin
from app.models import Usuario
from app.services.plans import DEFAULT_PLAN, PLANS, plan_info, plans_catalog

router = APIRouter(prefix="/admin", tags=["admin"])


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
    """Altera o plano de assinatura de uma pizzaria."""
    plano = (plano or "").lower()
    if plano not in PLANS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Plano inválido. Use: {list(PLANS)}")

    res = await db.execute(
        text("UPDATE public.pizzarias SET plano = :plano, updated_at = now() WHERE id = :id RETURNING id"),
        {"plano": plano, "id": pizzaria_id},
    )
    if res.fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    await db.commit()
    return {"ok": True, "plano": plano, "info": plan_info(plano)}
