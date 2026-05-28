"""
Métricas históricas para o dashboard "Análise" do painel.

Endpoints agregam dados do Postgres usando window functions / group by por dia.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import membership

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/metricas", tags=["metricas"])


@router.get("")
async def metricas_periodo(
    pizzaria_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """
    Retorna métricas agregadas do período (default últimos 30 dias).

    Inclui:
      - resumo: total_pedidos, total_vendido, ticket_medio, taxa_cancelamento
      - serie_diaria: [{ dia, pedidos, vendido }] para o gráfico
      - top_produtos: [{ nome, qtd_vendida }]
      - horarios_pico: [{ hora, pedidos }]
      - comparativo: % vs período anterior
    """
    desde = datetime.now(timezone.utc) - timedelta(days=days)
    desde_anterior = desde - timedelta(days=days)

    params = {"pid": str(pizzaria_id), "desde": desde, "desde_ant": desde_anterior}

    # --- Resumo do período ---
    resumo_q = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido,
            COUNT(*) FILTER (WHERE status = 'cancelado') AS cancelados,
            COUNT(*) AS total
        FROM public.pedidos
        WHERE pizzaria_id = :pid AND created_at >= :desde
    """), params)
    r = resumo_q.fetchone()
    pedidos, vendido, cancelados, total = r[0] or 0, float(r[1] or 0), r[2] or 0, r[3] or 0
    ticket_medio = (vendido / pedidos) if pedidos else 0
    taxa_cancelamento = (cancelados / total * 100) if total else 0

    # --- Período anterior (pra comparativo) ---
    ant_q = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido
        FROM public.pedidos
        WHERE pizzaria_id = :pid AND created_at >= :desde_ant AND created_at < :desde
    """), params)
    ra = ant_q.fetchone()
    pedidos_ant, vendido_ant = ra[0] or 0, float(ra[1] or 0)

    def pct_diff(novo, antigo):
        if not antigo:
            return None
        return round((novo - antigo) / antigo * 100, 1)

    # --- Série diária ---
    serie_q = await db.execute(text("""
        SELECT
            DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
            COUNT(*) FILTER (WHERE status != 'cancelado') AS pedidos,
            COALESCE(SUM(valor_total) FILTER (WHERE status != 'cancelado'), 0) AS vendido
        FROM public.pedidos
        WHERE pizzaria_id = :pid AND created_at >= :desde
        GROUP BY dia
        ORDER BY dia
    """), params)
    serie_diaria = [
        {"dia": str(r[0]), "pedidos": r[1] or 0, "vendido": float(r[2] or 0)}
        for r in serie_q.fetchall()
    ]

    # --- Top produtos (extrai do jsonb itens) ---
    top_q = await db.execute(text("""
        SELECT
            item->>'nome' AS nome,
            SUM((item->>'qtd')::int) AS qtd
        FROM public.pedidos,
             jsonb_array_elements(itens) AS item
        WHERE pizzaria_id = :pid
          AND created_at >= :desde
          AND status != 'cancelado'
          AND (item->>'nome') IS NOT NULL
        GROUP BY item->>'nome'
        ORDER BY qtd DESC
        LIMIT 5
    """), params)
    top_produtos = [{"nome": r[0], "qtd_vendida": r[1] or 0} for r in top_q.fetchall()]

    # --- Horários de pico (hora local) ---
    hora_q = await db.execute(text("""
        SELECT
            EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
            COUNT(*) AS pedidos
        FROM public.pedidos
        WHERE pizzaria_id = :pid AND created_at >= :desde AND status != 'cancelado'
        GROUP BY hora
        ORDER BY hora
    """), params)
    horarios_pico = [{"hora": r[0], "pedidos": r[1]} for r in hora_q.fetchall()]

    return {
        "periodo_dias": days,
        "desde": desde.isoformat(),
        "resumo": {
            "pedidos": pedidos,
            "vendido": vendido,
            "ticket_medio": round(ticket_medio, 2),
            "cancelados": cancelados,
            "taxa_cancelamento": round(taxa_cancelamento, 1),
        },
        "comparativo": {
            "pedidos_anterior": pedidos_ant,
            "vendido_anterior": vendido_ant,
            "pct_pedidos": pct_diff(pedidos, pedidos_ant),
            "pct_vendido": pct_diff(vendido, vendido_ant),
        },
        "serie_diaria": serie_diaria,
        "top_produtos": top_produtos,
        "horarios_pico": horarios_pico,
    }
