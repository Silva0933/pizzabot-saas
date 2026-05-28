"""Smoke test do módulo de fila (precisa de Redis rodando)."""
import os
import uuid

import pytest

pytestmark = pytest.mark.asyncio


@pytest.mark.skipif(
    not os.environ.get("REDIS_URL"),
    reason="Sem REDIS_URL — skip teste de fila",
)
async def test_enqueue_and_drain():
    from app.services.queue import drain_pending, enqueue_message, should_flush_now

    pid = uuid.uuid4()
    phone = "5511999999999"

    await enqueue_message(
        pizzaria_id=pid,
        telefone=phone,
        mensagem_id=uuid.uuid4(),
        conteudo="oi",
    )
    await enqueue_message(
        pizzaria_id=pid,
        telefone=phone,
        mensagem_id=uuid.uuid4(),
        conteudo="boa noite",
    )

    can, wait = await should_flush_now(pid, phone)
    assert not can, "Acabou de empilhar, não deveria poder flush"
    assert wait > 0

    drained = await drain_pending(pid, phone)
    assert len(drained) == 2
    assert drained[0]["conteudo"] == "oi"
    assert drained[1]["conteudo"] == "boa noite"

    can_after, _ = await should_flush_now(pid, phone)
    assert can_after, "Após drain, deveria liberar flush"
