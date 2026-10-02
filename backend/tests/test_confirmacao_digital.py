"""
Confirmação do pedido do cardápio que NÃO chega ao cliente (teste de 02/10 com o
cardápio real: número sem WhatsApp). Era só um warning no log — a loja preparava
a pizza sem saber que não conseguia falar com o cliente. Agora vira alerta,
aviso na observação do pedido e evento para o painel.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


def test_numero_sem_whatsapp_avisa_a_loja():
    from app.routes import cardapio_publico as cp
    ped = SimpleNamespace(id=uuid.uuid4(), observacoes="troco pra 100")
    db = MagicMock()
    db.commit = AsyncMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = ped
    db.execute = AsyncMock(return_value=res)

    class _S:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    erro = RuntimeError('HTTP 400: {"message":[{"jid":"5598000000000@s.whatsapp.net","exists":false}]}')
    with patch("app.db.AsyncSessionLocal", new=lambda: _S()), \
         patch("app.services.alertas.registrar_alerta", new=AsyncMock()) as alerta, \
         patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()) as pub:
        asyncio.run(cp._avisar_confirmacao_nao_entregue("pz", ped.id, 3, "5598000000000", erro))
    assert "troco pra 100" in ped.observacoes
    assert "NÃO chegou ao cliente (o número não tem WhatsApp" in ped.observacoes
    assert alerta.await_args.kwargs["nivel"] == "error"
    assert pub.await_args.args[1]["tipo"] == "pedido.atualizado"
    db.commit.assert_awaited()
