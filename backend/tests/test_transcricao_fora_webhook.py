"""
Áudio não é mais transcrito dentro do webhook da Evolution.

Antes o webhook baixava e transcrevia o áudio antes de responder 200; áudio
longo estourava o timeout da Evolution, que reentregava o evento. Agora a
mensagem entra como "[áudio]" e quem transcreve é o worker/dispatcher.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.transcricao import referencia_midia, transcrever_pendentes

_DATA = {
    "key": {"id": "AUD1", "remoteJid": "5511999999999@s.whatsapp.net"},
    "message": {
        "audioMessage": {"url": "https://mmg/x.enc", "mimetype": "audio/ogg; codecs=opus"},
        "base64": "A" * 10_000,   # alguns webhooks mandam a mídia embutida
    },
    "pushName": "Cliente",
}


class TestReferenciaMidia:
    def test_guarda_so_o_necessario_sem_base64(self):
        ref = referencia_midia(_DATA)
        assert ref == {"key": _DATA["key"], "message": {"audioMessage": _DATA["message"]["audioMessage"]}}
        assert "base64" not in str(ref)

    def test_sem_audio_devolve_none(self):
        assert referencia_midia({"key": {"id": "1"}, "message": {"conversation": "oi"}}) is None


class TestWebhookNaoTranscreve:
    def test_audio_vai_para_a_fila_sem_transcrever(self):
        from app.routes.webhook import evolution_webhook
        from app.schemas import EvolutionWebhookPayload

        payload = EvolutionWebhookPayload(event="messages.upsert", instance="inst1", data=_DATA)
        request = MagicMock()
        request.query_params.get = MagicMock(return_value=None)

        pizz = MagicMock()
        pizz.id = "00000000-0000-0000-0000-000000000001"
        pizz.instancia = "inst1"
        pizz.suspensa = False
        pizz.bot_ativo_global = True
        pizz.usar_dispatcher = True
        pizz.horario_funcionamento = {}
        pizz.aberto_manual = True

        def _res(valor):
            r = MagicMock()
            r.scalar_one_or_none = MagicMock(return_value=valor)
            r.scalars.return_value.first.return_value = valor
            return r

        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(side_effect=[_res(pizz), _res(MagicMock()), _res(MagicMock())])
        conv = MagicMock()
        conv.unread_count = 0
        conv.bot_ativo = True

        with patch("app.redis_client.redis.set", new=AsyncMock(return_value=True)), \
             patch("app.routes.webhook._get_or_create_conversa", new=AsyncMock(return_value=conv)), \
             patch("app.routes.webhook.broadcaster.publish", new=AsyncMock()), \
             patch("app.routes.webhook.evolution.get_media_base64", new=AsyncMock()) as baixar, \
             patch("app.services.business_hours.esta_aberto", return_value=True), \
             patch("app.routes.webhook.enqueue_message", new=AsyncMock()) as enfileirar, \
             patch("app.services.queue.arm_dispatcher", new=AsyncMock()):
            out = asyncio.run(evolution_webhook(payload, request, db))

        assert out["ok"] is True
        baixar.assert_not_awaited()                      # nada de download no webhook
        kw = enfileirar.await_args.kwargs
        assert kw["conteudo"] == "[áudio]"
        assert kw["metadata"]["tipo"] == "audio"
        assert kw["metadata"]["midia"]["key"]["id"] == "AUD1"
        assert "base64" not in str(kw["metadata"])       # a fila no Redis fica leve


class TestTranscreverPendentes:
    def test_troca_audio_pela_transcricao(self):
        pending = [
            {"mensagem_id": "m1", "conteudo": "oi", "metadata": {"tipo": "texto"}},
            {"mensagem_id": "m2", "conteudo": "[áudio]",
             "metadata": {"tipo": "audio", "midia": referencia_midia(_DATA)}},
        ]
        sessao = MagicMock()
        sessao.__aenter__ = AsyncMock(return_value=MagicMock())
        sessao.__aexit__ = AsyncMock(return_value=False)
        with patch("app.db.AsyncSessionLocal", return_value=sessao), \
             patch("app.services.transcricao.transcrever_mensagem_audio",
                   new=AsyncMock(return_value="quero uma calabresa")) as tr:
            asyncio.run(transcrever_pendentes("00000000-0000-0000-0000-000000000001", pending))

        assert [p["conteudo"] for p in pending] == ["oi", "quero uma calabresa"]
        tr.assert_awaited_once()

    def test_falha_mantem_audio(self):
        pending = [{"mensagem_id": "m2", "conteudo": "[áudio]",
                    "metadata": {"tipo": "audio", "midia": referencia_midia(_DATA)}}]
        sessao = MagicMock()
        sessao.__aenter__ = AsyncMock(return_value=MagicMock())
        sessao.__aexit__ = AsyncMock(return_value=False)
        with patch("app.db.AsyncSessionLocal", return_value=sessao), \
             patch("app.services.transcricao.transcrever_mensagem_audio", new=AsyncMock(return_value=None)):
            asyncio.run(transcrever_pendentes("00000000-0000-0000-0000-000000000001", pending))
        assert pending[0]["conteudo"] == "[áudio]"
