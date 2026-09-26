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


class TestDrainAtomico:
    def test_drain_e_uma_operacao_unica_no_redis(self):
        """REGRESSÃO: o drain eram duas pipelines (lê/apaga pending; regrava o
        inflight). Um crash entre elas perdia as mensagens. Agora é um EVAL só."""
        import asyncio
        import json
        import uuid
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.services import queue

        pid = uuid.uuid4()
        lote = [json.dumps({"mensagem_id": "1", "conteudo": "oi"}),
                json.dumps({"mensagem_id": "2", "conteudo": "quero pizza"})]
        with patch.object(queue.redis, "eval", new=AsyncMock(return_value=lote)) as ev, \
             patch.object(queue.redis, "pipeline", new=MagicMock()) as pipe:
            out = asyncio.run(queue.drain_pending(pid, "5511999999999"))

        assert [i["conteudo"] for i in out] == ["oi", "quero pizza"]
        ev.assert_awaited_once()
        pipe.assert_not_called()
        chaves = ev.await_args.args[2:]
        assert chaves == (
            f"pending:{pid}:5511999999999", f"inflight:{pid}:5511999999999",
            f"flush_at:{pid}:5511999999999", f"batch_start:{pid}:5511999999999",
        )
