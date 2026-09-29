"""
Memória do atendimento humano.

As mensagens do atendente (painel) e as do cliente durante o atendimento humano
não entravam na agente_memoria: ao devolver a conversa ao bot, ele voltava sem
saber o que foi combinado e respondia fora de contexto.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


def test_mensagem_do_atendente_entra_na_memoria_do_agente():
    from app.routes.conversas import enviar_manual
    from app.schemas import EnviarMensagemIn

    conv = MagicMock()
    conv.id = uuid.uuid4()
    conv.bot_ativo = False
    conv.cliente_telefone = "5598999999999"
    pizz = MagicMock()
    pizz.id = uuid.uuid4()
    pizz.instancia = "loja"

    res_conv = MagicMock()
    res_conv.scalar_one_or_none.return_value = conv
    res_pizz = MagicMock()
    res_pizz.scalar_one.return_value = pizz
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock(side_effect=[res_conv, res_pizz])
    append = AsyncMock()

    with patch("app.routes.conversas.evolution.send_text", new=AsyncMock()), \
         patch("app.routes.conversas.broadcaster.publish", new=AsyncMock()), \
         patch("app.agent.memory.append_turn", new=append):
        asyncio.run(enviar_manual(
            pizz.id, conv.id, EnviarMensagemIn(conteudo="Seu pedido sai em 10 min, pode ser?"), db, None,
        ))

    append.assert_awaited_once()
    args, kwargs = append.await_args
    assert args[1] == pizz.id and args[2] == "5598999999999"
    assert kwargs["role"] == "assistant"
    assert kwargs["content"] == "(atendente da loja) Seu pedido sai em 10 min, pode ser?"
