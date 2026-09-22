"""
Preenche o slug das pizzarias que ficaram sem.

O cadastro público (`auth.py /signup`) criava a pizzaria definindo a instância do
WhatsApp mas NÃO o slug. Como o cardápio digital vive em `/m/<slug>`, toda
pizzaria que entrou por ali nascia sem cardápio: `/menu/<slug>` não encontrava
ninguém e devolvia 404.

Feito em Python, e não em SQL, de propósito: assim reusa o MESMO `slug_unico`
que as rotas usam, em vez de uma segunda implementação de slugify em SQL que
poderia divergir (e que eu não teria como testar).

Roda no startup da API, é idempotente e só toca em quem está sem slug.
"""
from __future__ import annotations

import logging

from sqlalchemy import or_, select

log = logging.getLogger(__name__)


async def preencher_slugs_faltantes() -> int:
    """Dá slug a quem não tem. Devolve quantas pizzarias foram corrigidas."""
    from app.db import AsyncSessionLocal
    from app.models import Pizzaria
    from app.routes.pizzarias import slug_unico

    corrigidas = 0
    async with AsyncSessionLocal() as db:
        sem_slug = (
            await db.execute(
                select(Pizzaria).where(or_(Pizzaria.slug.is_(None), Pizzaria.slug == ""))
            )
        ).scalars().all()

        if not sem_slug:
            return 0

        for pizz in sem_slug:
            pizz.slug = await slug_unico(db, pizz.nome, pizz.id)
            # Flush a cada uma: slug_unico consulta o banco pra achar um livre, e
            # sem isso duas casas de mesmo nome receberiam o mesmo slug.
            await db.flush()
            corrigidas += 1
            log.info("Slug preenchido: '%s' -> /m/%s", pizz.nome, pizz.slug)

        await db.commit()

    log.warning(
        "%d pizzaria(s) estavam sem slug e ficaram sem cardápio digital; corrigidas.",
        corrigidas,
    )
    return corrigidas
