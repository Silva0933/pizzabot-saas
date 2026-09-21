"""
Testes da cobrança via Mercado Pago (conta da PIZZARIA cobrando o cliente final).

Travam a regressão que deixava pedido pago como 'pending' para sempre: no
checkout por link, /checkout/preferences devolve o id da PREFERÊNCIA, enquanto a
notificação do webhook traz o id do PAGAMENTO. Guardar um no lugar do outro fazia
a busca no webhook nunca casar.

Cobrem:
  - criar_pix devolve payment_id real; criar_cobranca devolve preference_id e
    NÃO finge ser um pagamento;
  - webhook acha o pedido pelo payment_id (caminho rápido, Pix);
  - webhook acha o pedido pelo external_reference (cartão, e rede de segurança
    quando uma notificação se perde);
  - webhook só processa o tópico 'payment' (preferência também gera merchant_order);
  - assinatura HMAC validada com o secret da pizzaria.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ============================================================
# Helpers
# ============================================================
class _Res:
    """Resultado de db.execute() com as três formas usadas no código."""

    def __init__(self, value=None, many=None):
        self._value = value
        self._many = many if many is not None else ([] if value is None else [value])

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return self

    def first(self):
        return self._many[0] if self._many else None

    def all(self):
        return list(self._many)


class FakeDB:
    """Sessão falsa: devolve os resultados na ordem em que o código consulta."""

    def __init__(self, resultados):
        self._resultados = list(resultados)
        self.flush = AsyncMock()
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, *_a, **_k):
        return self._resultados.pop(0) if self._resultados else _Res(None)


def _resposta(payload: dict, erro: bool = False):
    r = MagicMock()
    r.is_error = erro
    r.status_code = 500 if erro else 200
    r.text = "erro" if erro else ""
    r.json.return_value = payload
    return r


def _mock_httpx(resposta):
    """Substitui httpx.AsyncClient usado como context manager assíncrono."""
    client = MagicMock()
    client.post = AsyncMock(return_value=resposta)
    client.get = AsyncMock(return_value=resposta)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    fabrica = MagicMock(return_value=ctx)
    return fabrica, client


def _pizzaria(**kw):
    p = MagicMock()
    p.id = kw.get("id", uuid.uuid4())
    p.mp_access_token = kw.get("mp_access_token", "APP_USR-token")
    p.mp_webhook_secret = kw.get("mp_webhook_secret", None)
    p.mp_user_id = kw.get("mp_user_id", "9988")
    return p


def _pedido(pizzaria_id, **kw):
    p = MagicMock()
    p.id = kw.get("id", uuid.uuid4())
    p.pizzaria_id = pizzaria_id
    p.payment_id = kw.get("payment_id", None)
    p.payment_status = kw.get("payment_status", "pending")
    p.status = kw.get("status", "novo")
    p.numero_pedido = 42
    return p


# ============================================================
# Criação da cobrança: que id vai parar no pedido
# ============================================================
class TestCriacaoCobranca:
    def test_pix_devolve_payment_id_real(self):
        from app.services.pagamentos import MercadoPagoClient
        from decimal import Decimal

        fabrica, client = _mock_httpx(_resposta({
            "id": 123456789,
            "point_of_interaction": {"transaction_data": {
                "qr_code": "00020126...", "qr_code_base64": "iVBOR", "ticket_url": "https://mp/t/1",
            }},
        }))
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            cob = asyncio.run(MercadoPagoClient("tok").criar_pix(
                valor=Decimal("55.00"), descricao="Pedido #42", nome_cliente="Ana",
                telefone="5511999999999", external_reference="ref-1",
                notification_url="https://api/webhook/mercadopago",
            ))

        assert cob.payment_id == "123456789"      # id de PAGAMENTO — o webhook casa por ele
        assert cob.preference_id is None
        assert cob.metodo == "pix"
        assert cob.qr_code == "00020126..."
        # /v1/payments, não /checkout/preferences
        assert "/v1/payments" in client.post.call_args.args[0]

    def test_link_nao_grava_preferencia_como_pagamento(self):
        """REGRESSÃO: preference id em payment_id fazia o pedido nunca confirmar."""
        from app.services.pagamentos import MercadoPagoClient
        from decimal import Decimal

        fabrica, client = _mock_httpx(_resposta({
            "id": "1234567890-abcd-efgh",           # id de PREFERÊNCIA
            "init_point": "https://mp/checkout/xyz",
        }))
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            cob = asyncio.run(MercadoPagoClient("tok").criar_cobranca(
                valor=Decimal("55.00"), descricao="Pedido #42", nome_cliente="Ana",
                telefone="5511999999999", external_reference="ref-1",
            ))

        assert cob.payment_id is None
        assert cob.preference_id == "1234567890-abcd-efgh"
        assert cob.link_pagamento == "https://mp/checkout/xyz"
        assert "/checkout/preferences" in client.post.call_args.args[0]

    def test_external_reference_vai_na_cobranca(self):
        """Sem ele o webhook não tem como ligar o pagamento ao pedido."""
        from app.services.pagamentos import MercadoPagoClient
        from decimal import Decimal

        fabrica, client = _mock_httpx(_resposta({"id": "pref-1", "init_point": "https://mp/x"}))
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            asyncio.run(MercadoPagoClient("tok").criar_cobranca(
                valor=Decimal("10"), descricao="d", nome_cliente="Ana",
                telefone="5511999999999", external_reference="pedido-uuid",
            ))
        assert client.post.call_args.kwargs["json"]["external_reference"] == "pedido-uuid"

    def test_consultar_usuario_devolve_id_da_conta(self):
        from app.services.pagamentos import MercadoPagoClient

        fabrica, client = _mock_httpx(_resposta({"id": 9988, "nickname": "PIZZARIA"}))
        with patch("app.services.pagamentos.httpx.AsyncClient", fabrica):
            dados = asyncio.run(MercadoPagoClient("tok").consultar_usuario())
        assert str(dados["id"]) == "9988"
        assert "/users/me" in client.get.call_args.args[0]


# ============================================================
# Filtro de tópico
# ============================================================
class TestTopico:
    def test_aceita_payment_e_recusa_merchant_order(self):
        from app.routes.webhook_pagamento import _e_notificacao_de_pagamento

        assert _e_notificacao_de_pagamento({"type": "payment", "data": {"id": "1"}})
        assert _e_notificacao_de_pagamento({"action": "payment.updated", "data": {"id": "1"}})
        # Preferência também notifica merchant_order, com id de outro espaço.
        assert not _e_notificacao_de_pagamento({"type": "merchant_order", "data": {"id": "1"}})
        assert not _e_notificacao_de_pagamento({"topic": "merchant_order", "data": {"id": "1"}})


# ============================================================
# external_reference → pedido
# ============================================================
class TestExternalReference:
    def test_resolve_uuid_valido(self):
        from app.routes.webhook_pagamento import _pedido_por_external_reference

        pid = uuid.uuid4()
        ped = _pedido(pid)
        db = FakeDB([_Res(ped)])
        achado = asyncio.run(_pedido_por_external_reference(db, str(ped.id), pid))
        assert achado is ped

    def test_ignora_referencia_invalida_sem_estourar(self):
        from app.routes.webhook_pagamento import _pedido_por_external_reference

        db = FakeDB([])
        assert asyncio.run(_pedido_por_external_reference(db, "nao-e-uuid", uuid.uuid4())) is None
        assert asyncio.run(_pedido_por_external_reference(db, None, uuid.uuid4())) is None


# ============================================================
# Webhook ponta a ponta
# ============================================================
def _request(body: dict):
    r = MagicMock()
    r.json = AsyncMock(return_value=body)
    return r


def _rodar_webhook(db, body, **kw):
    from app.routes import webhook_pagamento as wh

    with patch.object(wh, "decrypt_secret", side_effect=lambda v: v), \
         patch.object(wh, "enviar_mensagem_status", AsyncMock()) as msg, \
         patch.object(wh.broadcaster, "publish", AsyncMock()), \
         patch.object(
             wh.MercadoPagoClient, "consultar_pagamento",
             AsyncMock(return_value=kw.get("payment", {"status": "approved"})),
         ):
        out = asyncio.run(wh.webhook_mp(
            _request(body), db,
            kw.get("x_signature"), kw.get("x_request_id"),
        ))
    return out, msg


class TestWebhookMP:
    def test_cartao_confirma_pelo_external_reference(self):
        """REGRESSÃO: antes caía em {'queued': True} e o pedido ficava 'pending'."""
        pizz = _pizzaria()
        ped = _pedido(pizz.id)
        db = FakeDB([
            _Res(None),     # busca por payment_id: nada (link não tem payment_id ainda)
            _Res(pizz),     # tenant pelo user_id da notificação
            _Res(ped),      # external_reference → pedido
            _Res(ped),      # _aplicar_pagamento
        ])
        out, msg = _rodar_webhook(
            db,
            {"type": "payment", "action": "payment.updated",
             "data": {"id": "77777"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id)},
        )

        assert out == {"ok": True, "status": "approved"}
        assert ped.payment_id == "77777"        # passa a valer o id de pagamento real
        assert ped.payment_status == "approved"
        assert ped.status == "confirmado"
        msg.assert_awaited_once()               # avisou o cliente no WhatsApp

    def test_pix_confirma_pelo_payment_id(self):
        pizz = _pizzaria()
        ped = _pedido(pizz.id, payment_id="123456789")
        db = FakeDB([
            _Res(ped),      # caminho rápido
            _Res(pizz),     # pizzaria do pedido
            _Res(ped),      # _aplicar_pagamento
        ])
        out, msg = _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "123456789"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id)},
        )
        assert out == {"ok": True, "status": "approved"}
        assert ped.status == "confirmado"
        msg.assert_awaited_once()

    def test_recusado_avisa_cliente(self):
        pizz = _pizzaria()
        ped = _pedido(pizz.id, payment_id="55")
        db = FakeDB([_Res(ped), _Res(pizz), _Res(ped)])
        out, msg = _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "55"}, "user_id": "9988"},
            payment={"status": "rejected", "external_reference": str(ped.id)},
        )
        assert out["status"] == "rejected"
        assert ped.status == "novo"             # não avança o pedido
        msg.assert_awaited_once()

    def test_merchant_order_ignorado(self):
        db = FakeDB([])
        out, _ = _rodar_webhook(db, {"type": "merchant_order", "data": {"id": "999"}})
        assert out["ignored"].startswith("topico_")

    def test_tenant_desconhecido_gera_alerta(self):
        """Pagamento sem dono identificável não pode sumir em silêncio."""
        from app.routes import webhook_pagamento as wh

        db = FakeDB([
            _Res(None),          # sem pedido por payment_id
            _Res(None),          # sem pizzaria por mp_user_id
            _Res(None, many=[]),  # fallback de pizzaria única: nenhuma
        ])
        alerta = AsyncMock()
        with patch("app.services.alertas.registrar_alerta", alerta), \
             patch.object(wh, "decrypt_secret", side_effect=lambda v: v):
            out = asyncio.run(wh.webhook_mp(
                _request({"type": "payment", "data": {"id": "1"}, "user_id": "desconhecido"}), db
            ))

        assert out == {"ignored": "tenant_nao_resolvido"}
        alerta.assert_awaited_once()
        assert alerta.await_args.kwargs["tipo"] == "webhook_mp_sem_tenant"

    def test_fallback_pizzaria_unica(self):
        """Pizzarias cadastradas antes do mp_user_id continuam funcionando."""
        pizz = _pizzaria(mp_user_id=None)
        ped = _pedido(pizz.id)
        db = FakeDB([
            _Res(None),              # sem pedido por payment_id
            _Res(None),              # sem match por mp_user_id
            _Res(pizz, many=[pizz]),  # só uma pizzaria usa MP → é dela
            _Res(ped),               # external_reference → pedido
            _Res(ped),               # _aplicar_pagamento
        ])
        out, _ = _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "42"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id)},
        )
        assert out == {"ok": True, "status": "approved"}

    def test_aprende_mp_user_id_na_primeira_confirmacao(self):
        """Pizzaria sem mp_user_id passa a ter, sem precisar do backfill."""
        pizz = _pizzaria(mp_user_id=None)
        ped = _pedido(pizz.id)
        db = FakeDB([
            _Res(None), _Res(None), _Res(pizz, many=[pizz]), _Res(ped), _Res(ped),
        ])
        _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "42"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id),
                     "collector_id": 9988},
        )
        assert pizz.mp_user_id == "9988"

    def test_nao_sobrescreve_mp_user_id_existente(self):
        pizz = _pizzaria(mp_user_id="1111")
        ped = _pedido(pizz.id, payment_id="42")
        db = FakeDB([_Res(ped), _Res(pizz), _Res(ped)])
        _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "42"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id),
                     "collector_id": 9988},
        )
        assert pizz.mp_user_id == "1111"

    def test_assinatura_invalida_recusada(self):
        from fastapi import HTTPException

        pizz = _pizzaria(mp_webhook_secret="segredo-da-pizzaria")
        ped = _pedido(pizz.id, payment_id="99")
        db = FakeDB([_Res(ped), _Res(pizz)])
        with pytest.raises(HTTPException) as e:
            _rodar_webhook(
                db,
                {"type": "payment", "data": {"id": "99"}, "user_id": "9988"},
                x_signature="ts=1,v1=assinatura-errada", x_request_id="req-1",
            )
        assert e.value.status_code == 401

    def test_assinatura_ausente_com_secret_configurado_recusada(self):
        from fastapi import HTTPException

        pizz = _pizzaria(mp_webhook_secret="segredo-da-pizzaria")
        ped = _pedido(pizz.id, payment_id="99")
        db = FakeDB([_Res(ped), _Res(pizz)])
        with pytest.raises(HTTPException) as e:
            _rodar_webhook(db, {"type": "payment", "data": {"id": "99"}, "user_id": "9988"})
        assert e.value.status_code == 401

    def test_assinatura_valida_passa(self):
        pizz = _pizzaria(mp_webhook_secret="segredo-da-pizzaria")
        ped = _pedido(pizz.id, payment_id="99")
        db = FakeDB([_Res(ped), _Res(pizz), _Res(ped)])

        manifest = "id:99;request-id:req-1;ts:1700000000;"
        v1 = hmac.new(b"segredo-da-pizzaria", manifest.encode(), hashlib.sha256).hexdigest()
        out, _ = _rodar_webhook(
            db,
            {"type": "payment", "data": {"id": "99"}, "user_id": "9988"},
            payment={"status": "approved", "external_reference": str(ped.id)},
            x_signature=f"ts=1700000000,v1={v1}", x_request_id="req-1",
        )
        assert out == {"ok": True, "status": "approved"}


# ============================================================
# Mapeamento de status
# ============================================================
class TestStatus:
    def test_mapeia_status_do_mp(self):
        from app.services.pagamentos import mp_status_para_interno

        assert mp_status_para_interno("approved") == "approved"
        assert mp_status_para_interno("pending") == "pending"
        assert mp_status_para_interno("in_process") == "pending"
        assert mp_status_para_interno("rejected") == "rejected"
        # Pix vencido chega como 'cancelled' — precisa avisar o cliente, não sumir.
        assert mp_status_para_interno("cancelled") == "rejected"
        assert mp_status_para_interno("expired") == "expired"
        assert mp_status_para_interno("coisa_nova_do_mp") == "pending"
