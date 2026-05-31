"""
Central de alertas da plataforma (Fase 2 — C4/C5).

Registra sinais que o dono do SaaS precisa ver: falhas de envio/IA/pagamento e
possíveis preços inventados pela IA. NÃO bloqueia nada — é observabilidade.
Best-effort: nunca propaga exceção pro fluxo principal.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

TIPOS = ("preco_suspeito", "falha_envio", "falha_ia", "falha_pagamento")


async def registrar_alerta(
    db: AsyncSession,
    *,
    tipo: str,
    detalhe: str,
    pizzaria_id: Any = None,
    nivel: str = "warning",
) -> None:
    """Grava um alerta (best-effort) e loga. Não lança exceção."""
    log.warning("ALERTA[%s/%s] pizzaria=%s: %s", tipo, nivel, pizzaria_id, detalhe[:300])
    try:
        await db.execute(
            text("""
                INSERT INTO public.plataforma_alertas (pizzaria_id, tipo, nivel, detalhe)
                VALUES (:pid, :tipo, :nivel, :detalhe)
            """),
            {
                "pid": str(pizzaria_id) if pizzaria_id else None,
                "tipo": tipo, "nivel": nivel, "detalhe": detalhe[:1000],
            },
        )
        # Avisa o painel admin em tempo real (se houver alguém ouvindo).
        try:
            from app.services.broadcaster import broadcaster
            await broadcaster.publish(
                pizzaria_id,
                {"tipo": "alerta.plataforma", "pizzaria_id": str(pizzaria_id) if pizzaria_id else None,
                 "payload": {"tipo": tipo, "nivel": nivel}},
            )
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao gravar alerta (ignorado): %s", e)


async def registrar_alerta_seguro(*, tipo: str, detalhe: str, pizzaria_id: Any = None, nivel: str = "warning") -> None:
    """Versão que abre a própria sessão — para usar de dentro de except onde a
    sessão principal pode estar em rollback. Best-effort."""
    try:
        from app.db import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await registrar_alerta(db, tipo=tipo, detalhe=detalhe, pizzaria_id=pizzaria_id, nivel=nivel)
            await db.commit()
    except Exception as e:  # noqa: BLE001
        log.debug("registrar_alerta_seguro falhou (ignorado): %s", e)


async def listar_alertas(db: AsyncSession, *, limit: int = 50, apenas_abertos: bool = False) -> list[dict[str, Any]]:
    where = "WHERE resolvido = false" if apenas_abertos else ""
    rows = (await db.execute(text(f"""
        SELECT a.id, a.pizzaria_id, a.tipo, a.nivel, a.detalhe, a.resolvido, a.created_at,
               p.nome
        FROM public.plataforma_alertas a
        LEFT JOIN public.pizzarias p ON p.id = a.pizzaria_id
        {where}
        ORDER BY a.created_at DESC
        LIMIT :lim
    """), {"lim": max(1, min(limit, 200))})).fetchall()
    return [
        {
            "id": str(r[0]),
            "pizzaria_id": str(r[1]) if r[1] else None,
            "tipo": r[2],
            "nivel": r[3],
            "detalhe": r[4],
            "resolvido": bool(r[5]),
            "created_at": r[6].isoformat() if r[6] else None,
            "pizzaria_nome": r[7],
        }
        for r in rows
    ]


async def contar_alertas_abertos(db: AsyncSession) -> int:
    try:
        row = (await db.execute(text(
            "SELECT COUNT(*) FROM public.plataforma_alertas WHERE resolvido = false"
        ))).first()
        return int(row[0]) if row else 0
    except Exception:  # noqa: BLE001
        return 0
