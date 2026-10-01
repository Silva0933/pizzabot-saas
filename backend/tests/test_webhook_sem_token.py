"""
Em produção, webhook sem token configurado recusa em vez de aceitar tudo (A12,
análise de 01/10).

O fail-open era de propósito para o setup inicial, mas um token apagado por
engano em produção deixava qualquer um POSTar "mensagens de cliente" (o agente
responderia) ou "pagamento de assinatura" (renova o plano e reativa loja
suspensa só pelo corpo). Fora de produção continua aceitando, para o setup.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _settings(producao: bool):
    s = MagicMock()
    s.is_production = producao
    s.evolution_webhook_token = ""
    s.asaas_platform_webhook_token = ""
    return s


class TestEvolution:
    def _payload(self):
        # "Digitando…": o primeiro desvio depois da autenticação — dá para ver se
        # passou da porta sem montar a pizzaria/conversa inteira.
        from app.schemas import EvolutionWebhookPayload
        return EvolutionWebhookPayload(event="presence.update", instance="inst1", data={})

    def _chamar(self, producao: bool):
        from app.routes import webhook
        request = MagicMock()
        request.query_params.get = MagicMock(return_value=None)
        with patch("app.config.get_settings", return_value=_settings(producao)), \
             patch("app.services.evolution.evolution.config_atual", new=AsyncMock(return_value={"webhook_token": ""})), \
             patch.object(webhook, "_handle_presence", new=AsyncMock(return_value={"ok": "presenca"})) as presenca:
            out = asyncio.run(webhook.evolution_webhook(self._payload(), request, AsyncMock()))
        return out, presenca

    def test_producao_sem_token_recusa(self):
        out, presenca = self._chamar(producao=True)
        assert out == {"ignored": "sem_token_configurado"}
        presenca.assert_not_awaited()

    def test_fora_de_producao_segue_aceitando(self):
        out, presenca = self._chamar(producao=False)
        assert out == {"ok": "presenca"}
        presenca.assert_awaited_once()


class TestAsaasPlataforma:
    def _chamar(self, producao: bool):
        from app.routes import webhook_pagamento
        request = MagicMock()
        request.json = AsyncMock(return_value={"event": "PAYMENT_RECEIVED", "payment": {"id": "pay_1"}})
        with patch.object(webhook_pagamento, "_settings", _settings(producao)), \
             patch("app.services.billing_plataforma.carregar_config", new=AsyncMock(return_value={"webhook_token": ""})), \
             patch("app.services.billing_plataforma.aplicar_pagamento_plataforma",
                   new=AsyncMock(return_value={"ok": True})) as aplicar:
            out = asyncio.run(webhook_pagamento.webhook_asaas_plataforma(request, AsyncMock(), None))
        return out, aplicar

    def test_producao_sem_token_recusa(self):
        with pytest.raises(HTTPException) as exc:
            self._chamar(producao=True)
        assert exc.value.status_code == 503

    def test_fora_de_producao_segue_aceitando(self):
        out, aplicar = self._chamar(producao=False)
        assert out == {"ok": True}
        aplicar.assert_awaited_once()
