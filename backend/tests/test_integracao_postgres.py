"""
Integração com Postgres REAL (roda no CI; localmente só com PG_INTEGRACAO=1).

Os outros testes usam mocks e não pegam corrida de banco. Aqui: as duas
primeiras mensagens de um contato novo chegando juntas. Antes a segunda batia no
UNIQUE de conversas/clientes e o webhook dava 500 (e a mensagem só voltava na
reentrega da Evolution); agora as duas entram na mesma conversa.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("PG_INTEGRACAO") != "1",
    reason="Sem PG_INTEGRACAO=1 — precisa de Postgres real com as migrations aplicadas",
)


def _payload(msg_id: str, texto: str, telefone: str):
    from app.schemas import EvolutionWebhookPayload
    return EvolutionWebhookPayload(
        event="messages.upsert",
        instance="inst-integracao",
        data={
            "key": {"id": msg_id, "remoteJid": f"{telefone}@s.whatsapp.net"},
            "message": {"conversation": texto},
            "pushName": "Cliente Novo",
        },
    )


async def _cenario():
    from sqlalchemy import delete, select, text

    from app.db import AsyncSessionLocal, engine
    from app.models import Cliente, Conversa, Mensagem, Pizzaria
    from app.routes.webhook import evolution_webhook

    telefone = "5511" + str(uuid.uuid4().int)[:9]
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Pizzaria).where(Pizzaria.instancia == "inst-integracao"))
        pizz = Pizzaria(nome="Pizzaria Integração", instancia="inst-integracao", bot_ativo_global=False)
        db.add(pizz)
        await db.commit()
        pid = pizz.id

    request = MagicMock()
    request.query_params.get = MagicMock(return_value=None)

    async def _uma(msg_id, texto):
        async with AsyncSessionLocal() as db:
            return await evolution_webhook(_payload(msg_id, texto, telefone), request, db)

    try:
        with patch("app.routes.webhook.broadcaster.publish", new=AsyncMock()), \
             patch("app.redis_client.redis.set", new=AsyncMock(return_value=True)):
            r1, r2 = await asyncio.gather(
                _uma(f"A-{uuid.uuid4()}", "oi"),
                _uma(f"B-{uuid.uuid4()}", "quero uma pizza"),
            )

        async with AsyncSessionLocal() as db:
            convs = (await db.execute(select(Conversa).where(Conversa.pizzaria_id == pid))).scalars().all()
            clis = (await db.execute(select(Cliente).where(Cliente.pizzaria_id == pid))).scalars().all()
            msgs = (await db.execute(select(Mensagem.conteudo).where(Mensagem.pizzaria_id == pid))).scalars().all()
        return r1, r2, convs, clis, sorted(msgs)
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(text("DELETE FROM public.pizzarias WHERE id = :id"), {"id": str(pid)})
            await db.commit()
        await engine.dispose()


def test_duas_primeiras_mensagens_simultaneas_de_contato_novo():
    r1, r2, convs, clis, msgs = asyncio.run(_cenario())
    assert r1.get("ok") and r2.get("ok")
    assert len(convs) == 1 and len(clis) == 1
    assert msgs == ["oi", "quero uma pizza"]
    assert r1["conversa_id"] == r2["conversa_id"]
