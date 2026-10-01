"""
Cobrança repetida não pode virar um segundo Pix (achado A03 da análise de 01/10).

A criação do Pix no Mercado Pago mandava um X-Idempotency-Key aleatório a cada
chamada. Se o MP criava o pagamento e a resposta se perdia (timeout, queda antes
do commit), a próxima tentativa — o turno seguinte cai em `_registro_repetido`,
que gera a cobrança de novo porque o pedido ficou sem payment_id — ia com outra
chave e o cliente recebia dois Pix do mesmo pedido. No Asaas, que não tem chave
de idempotência, a nova tentativa reaproveita a cobrança pendente do pedido.
"""
from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.pagamentos import (
    AsaasClient,
    MercadoPagoClient,
    PagamentoError,
    chave_idempotencia_cobranca,
)

PED = uuid.uuid4()


def _resposta(payload, erro=False):
    r = MagicMock()
    r.is_error = erro
    r.is_success = not erro
    r.status_code = 500 if erro else 200
    r.text = "erro" if erro else ""
    r.json.return_value = payload
    return r


def _cliente_http(post=None, get=None):
    client = MagicMock()
    client.post = post or AsyncMock()
    client.get = get or AsyncMock()
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx), client


_PIX_OK = {"id": 111, "point_of_interaction": {"transaction_data": {"qr_code": "000201", "ticket_url": "u"}}}


class TestChave:
    def test_mesma_operacao_mesma_chave(self):
        a = chave_idempotencia_cobranca(PED, Decimal("55.00"), None)
        b = chave_idempotencia_cobranca(PED, 55.0, None)   # valor em outro tipo: mesma operação
        assert a == b

    def test_valor_diferente_muda_a_chave(self):
        assert chave_idempotencia_cobranca(PED, Decimal("55.00"), None) != \
            chave_idempotencia_cobranca(PED, Decimal("60.00"), None)

    def test_gerar_de_novo_com_pix_anterior_muda_a_chave(self):
        """Pix expirou e o cliente pede outro: a chave muda e o MP cria um novo."""
        assert chave_idempotencia_cobranca(PED, Decimal("55.00"), None) != \
            chave_idempotencia_cobranca(PED, Decimal("55.00"), "111")

    def test_pedidos_diferentes_chaves_diferentes(self):
        assert chave_idempotencia_cobranca(PED, Decimal("55.00"), None) != \
            chave_idempotencia_cobranca(uuid.uuid4(), Decimal("55.00"), None)


class TestMercadoPago:
    def _criar(self, fabrica, chave):
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            return asyncio.run(MercadoPagoClient("tok").criar_pix(
                valor=Decimal("55.00"), descricao="Pedido #1", nome_cliente="Ana",
                telefone="5511999999999", external_reference=str(PED), idempotency_key=chave,
            ))

    def test_repeticao_manda_a_mesma_chave(self):
        chave = chave_idempotencia_cobranca(PED, Decimal("55.00"), None)
        fabrica, client = _cliente_http(post=AsyncMock(return_value=_resposta(_PIX_OK)))
        self._criar(fabrica, chave)
        self._criar(fabrica, chave)
        enviadas = [c.kwargs["headers"]["X-Idempotency-Key"] for c in client.post.call_args_list]
        assert enviadas == [chave, chave]

    def test_timeout_vira_pagamento_error(self):
        """Sem resposta = resultado incerto: falha controlada (alerta + "erro_gateway"),
        não exceção solta que derruba o turno."""
        fabrica, _client = _cliente_http(post=AsyncMock(side_effect=httpx.ReadTimeout("timeout")))
        with pytest.raises(PagamentoError, match="incerto"):
            self._criar(fabrica, "k")


class TestGerarCobrancaNoAgente:
    def test_chave_vem_do_pedido(self):
        """Duas tentativas de cobrar o mesmo pedido (sem Pix ainda) mandam a mesma chave."""
        from app.agent import tools

        gw = MercadoPagoClient("tok")
        gw.criar_pix = AsyncMock(side_effect=PagamentoError("MP pix sem resposta; resultado incerto"))
        ctx = MagicMock()
        ctx.pizzaria.nome = "Pizzaria"
        ctx.pizzaria.id = uuid.uuid4()
        ctx.cliente_nome = "Ana"
        ctx.telefone = "5511999999999"
        ped = MagicMock()
        ped.id = PED
        ped.valor_total = Decimal("55.00")
        ped.payment_id = None
        ped.numero_pedido = 7
        db = MagicMock()
        db.execute = AsyncMock()

        with patch("app.services.pagamentos.gateway_for", return_value=gw), \
             patch("app.services.alertas.registrar_alerta", AsyncMock()):
            r1 = asyncio.run(tools._gerar_cobranca(ctx, db, ped, "pix"))
            r2 = asyncio.run(tools._gerar_cobranca(ctx, db, ped, "pix"))

        assert r1["ok"] is False and r2["ok"] is False
        chaves = [c.kwargs["idempotency_key"] for c in gw.criar_pix.call_args_list]
        assert chaves[0] == chaves[1] == chave_idempotencia_cobranca(PED, Decimal("55.00"), None)


class TestAsaas:
    def _criar(self, client_get, client_post):
        fabrica, client = _cliente_http(post=client_post, get=client_get)
        asaas = AsaasClient("key")
        asaas._criar_cliente = AsyncMock(return_value="cus_1")
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            cob = asyncio.run(asaas.criar_cobranca_pix(
                valor=Decimal("55.00"), descricao="Pedido #1", nome_cliente="Ana",
                telefone="5511999999999", external_reference=str(PED),
            ))
        return cob, client, asaas

    def test_reaproveita_cobranca_pendente_do_pedido(self):
        pendente = {"id": "pay_1", "externalReference": str(PED), "billingType": "PIX",
                    "value": 55.0, "invoiceUrl": "https://asaas/i/1"}

        async def _get(url, **_k):
            if url.endswith("/payments"):
                return _resposta({"data": [pendente]})
            return _resposta({"payload": "000201"})

        cob, client, asaas = self._criar(AsyncMock(side_effect=_get), AsyncMock())
        assert cob.payment_id == "pay_1"
        client.post.assert_not_awaited()
        asaas._criar_cliente.assert_not_awaited()

    def test_valor_diferente_cria_outra(self):
        """Pedido alterado (outro total): a cobrança antiga não serve."""
        antiga = {"id": "pay_1", "externalReference": str(PED), "billingType": "PIX", "value": 40.0}

        async def _get(url, **_k):
            if url.endswith("/payments"):
                return _resposta({"data": [antiga]})
            return _resposta({"payload": "000201"})

        post = AsyncMock(return_value=_resposta({"id": "pay_2", "invoiceUrl": "u"}))
        cob, _client, _asaas = self._criar(AsyncMock(side_effect=_get), post)
        assert cob.payment_id == "pay_2"
        post.assert_awaited_once()

    def test_timeout_vira_pagamento_error(self):
        with pytest.raises(PagamentoError, match="incerto"):
            self._criar(AsyncMock(side_effect=httpx.ConnectTimeout("t")), AsyncMock())
