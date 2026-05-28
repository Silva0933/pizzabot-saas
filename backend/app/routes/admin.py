"""
Métricas agregadas da plataforma — exclusivo para platform admins.

Soma dados de TODAS as pizzarias para o dashboard do dono do SaaS:
faturamento total, pedidos, ranking de pizzarias, evolução diária, etc.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import require_platform_admin
from app.models import Usuario

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
async def platform_overview(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(require_platform_admin),
) -> dict:
    """Visão geral da plataforma agregando todas as pizzarias."""
    desde = datetime.now(timezone.utc) - timedelta(days=days)
    desde_anterior = desde - timedelta(days=days)
    params = {"desde": desde, "desde_ant": desde_anterior}

    # --- Pizzarias (totais) ---
    pizz_q = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE bot_ativo_global) AS ativas,
            COUNT(*) FILTER (WHERE created_at >= :desde) AS novas
        FROM public.pizzarias
    """), params)
    pr = pizz_q.fetchone()
    total_pizz, pizz_ativas, pizz_novas = pr[0] or 0, pr[1] or 0, pr[2] or 0

    # --- Pizzarias por plano ---
    plano_q = await db.execute(text("""
        SELECT plano, COUNT(*) AS qtd
        FROM public.pizzarias
        GROUP BY plano
        ORDER BY qtd DESC
    """))
    por_plano = [{"plano": r[0], "qtd": r[1]} for r in plano_q.fetchall()]

    # --- Resumo de pedidos no período (todas pizzarias) ---
    resumo_q = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido,
            COUNT(*) FILTER (WHERE status = 'cancelado') AS cancelados,
            COUNT(*) AS total
        FROM public.pedidos
        WHERE created_at >= :desde
    """), params)
    rs = resumo_q.fetchone()
    pedidos, vendido = rs[0] or 0, float(rs[1] or 0)
    cancelados, total_ped = rs[2] or 0, rs[3] or 0
    ticket_medio = (vendido / pedidos) if pedidos else 0
    taxa_cancelamento = (cancelados / total_ped * 100) if total_ped else 0

    # --- Período anterior (comparativo) ---
    ant_q = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido
        FROM public.pedidos
        WHERE created_at >= :desde_ant AND created_at < :desde
    """), params)
    ra = ant_q.fetchone()
    pedidos_ant, vendido_ant = ra[0] or 0, float(ra[1] or 0)

    def pct_diff(novo, antigo):
        if not antigo:
            return None
        return round((novo - antigo) / antigo * 100, 1)

    # --- Série diária agregada ---
    serie_q = await db.execute(text("""
        SELECT
            DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido
        FROM public.pedidos
        WHERE created_at >= :desde
        GROUP BY dia
        ORDER BY dia
    """), params)
    serie_diaria = [
        {"dia": str(r[0]), "pedidos": r[1] or 0, "vendido": float(r[2] or 0)}
        for r in serie_q.fetchall()
    ]

    # --- Ranking de pizzarias por faturamento no período ---
    rank_q = await db.execute(text("""
        SELECT
            p.id,
            p.nome,
            COUNT(o.*) FILTER (WHERE o.status != 'cancelado') AS pedidos,
            COALESCE(SUM(o.valor_total) FILTER (WHERE o.status != 'cancelado'), 0) AS vendido
        FROM public.pizzarias p
        LEFT JOIN public.pedidos o
            ON o.pizzaria_id = p.id AND o.created_at >= :desde
        GROUP BY p.id, p.nome
        ORDER BY vendido DESC, pedidos DESC
        LIMIT 10
    """), params)
    ranking = [
        {"id": str(r[0]), "nome": r[1], "pedidos": r[2] or 0, "vendido": float(r[3] or 0)}
        for r in rank_q.fetchall()
    ]

    # --- Contadores gerais ---
    cont_q = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM public.conversas) AS conversas,
            (SELECT COUNT(*) FROM public.clientes) AS clientes,
            (SELECT COUNT(*) FROM public.usuarios) AS usuarios,
            (SELECT COUNT(*) FROM public.produtos) AS produtos
    """))
    cc = cont_q.fetchone()

    return {
        "periodo_dias": days,
        "desde": desde.isoformat(),
        "resumo": {
            "total_pizzarias": total_pizz,
            "pizzarias_ativas": pizz_ativas,
            "pizzarias_novas": pizz_novas,
            "pedidos": pedidos,
            "vendido": round(vendido, 2),
            "ticket_medio": round(ticket_medio, 2),
            "cancelados": cancelados,
            "taxa_cancelamento": round(taxa_cancelamento, 1),
            "total_conversas": cc[0] or 0,
            "total_clientes": cc[1] or 0,
            "total_usuarios": cc[2] or 0,
            "total_produtos": cc[3] or 0,
        },
        "comparativo": {
            "pedidos_anterior": pedidos_ant,
            "vendido_anterior": round(vendido_ant, 2),
            "pct_pedidos": pct_diff(pedidos, pedidos_ant),
            "pct_vendido": pct_diff(vendido, vendido_ant),
        },
        "serie_diaria": serie_diaria,
        "ranking_pizzarias": ranking,
        "pizzarias_por_plano": por_plano,
    }
