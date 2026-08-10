"""
Testes da cobrança da plataforma (assinatura mensal via Asaas).

Travam:
  - o plano trial no catálogo (cota reduzida, fora do catálogo de venda);
  - o parse do externalReference ("{pizzaria_id}|{plano}");
  - o mapeamento de status do Asaas → status da fatura;
  - aplicar_pagamento_plataforma: pagamento confirmado renova/reativa/promove,
    pizzaria desconhecida é ignorada;
  - upsert idempotente da fatura por asaas_payment_id.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


# ============================================
# Plano trial
# ============================================
class TestPlanoTrial:
    def test_trial_existe_com_cota_reduzida(self):
        from app.services.plans import plan_info
        t = plan_info("trial")
        assert t["id"] == "trial"
        assert t["preco_mensal"] == 0.0
        assert t["limites"]["conversas_mes"] == 20

    def test_trial_fora_do_catalogo_de_venda(self):
        from app.services.plans import plans_catalog
        ids = [p["id"] for p in plans_catalog()]
        assert "trial" not in ids
        assert ids == ["basico", "pro", "premium"]


# ============================================
# externalReference
# ============================================
class TestExtRef:
    def test_roundtrip(self):
        from app.services.billing_plataforma import _ext_ref, parse_ext_ref
        pid = uuid.uuid4()
        ref = _ext_ref(pid, "pro")
        assert parse_ext_ref(ref) == (str(pid), "pro")

    def test_formato_antigo_sem_plano(self):
        from app.services.billing_plataforma import parse_ext_ref
        assert parse_ext_ref("abc-123") == ("abc-123", None)

    def test_vazio(self):
        from app.services.billing_plataforma import parse_ext_ref
        assert parse_ext_ref(None) == (None, None)
        assert parse_ext_ref("") == (None, None)


# ============================================
# Status da fatura
# ============================================
class TestStatusFatura:
    def test_mapeamentos(self):
        from app.services.billing_plataforma import _status_fatura
        assert _status_fatura("RECEIVED") == "paga"
        assert _status_fatura("CONFIRMED") == "paga"
        assert _status_fatura("OVERDUE") == "vencida"
        assert _status_fatura("REFUNDED") == "cancelada"
        assert _status_fatura("PENDING") == "pendente"
        assert _status_fatura("") == "pendente"


# ============================================
# aplicar_pagamento_plataforma
# ============================================
def _db_com_pizzaria(pizz):
    """db.execute: 1ª chamada (select pizzaria) → pizz; demais → genérico."""
    res_pizz = MagicMock()
    res_pizz.scalar_one_or_none.return_value = pizz
    db = MagicMock()
    db.execute = AsyncMock(return_value=res_pizz)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


def _payment(pizz_id, plano="pro", status="RECEIVED", pid="pay_1"):
    return {
        "id": pid,
        "value": 197.0,
        "status": status,
        "dueDate": "2026-06-15",
        "invoiceUrl": "https://asaas/i/x",
        "subscription": "sub_1",
        "externalReference": f"{pizz_id}|{plano}",
    }


class TestAplicarPagamento:
    def test_pagamento_confirmado_renova_e_promove(self, monkeypatch):
        from app.services import billing_plataforma as bp

        pizz = MagicMock()
        pizz.id = uuid.uuid4()
        pizz.nome = "Pizza Teste"
        db = _db_com_pizzaria(pizz)

        fat = {"id": "f1", "valor": 197.0, "vencimento": "2026-06-15"}
        monkeypatch.setattr(bp, "upsert_fatura", AsyncMock(return_value=fat))

        out = asyncio.run(bp.aplicar_pagamento_plataforma(
            db, "PAYMENT_RECEIVED", _payment(pizz.id, "pro")
        ))
        assert out["ok"] is True and out["pago"] is True
        # O UPDATE de renovação foi executado com o plano contratado.
        sqls = [str(c.args[0]) for c in db.execute.await_args_list]
        update = next(s for s in sqls if "plano_vence_em" in s and "UPDATE" in s)
        assert "suspensa = FALSE" in update
        assert "trial_fim = NULL" in update
        params = next(c.args[1] for c in db.execute.await_args_list
                      if isinstance(c.args[-1], dict) and "plano" in c.args[-1])
        assert params["plano"] == "pro"
        db.commit.assert_awaited()

    def test_overdue_gera_alerta_sem_renovar(self, monkeypatch):
        from app.services import billing_plataforma as bp

        pizz = MagicMock()
        pizz.id = uuid.uuid4()
        pizz.nome = "Pizza Teste"
        db = _db_com_pizzaria(pizz)

        monkeypatch.setattr(bp, "upsert_fatura", AsyncMock(return_value={
            "id": "f1", "valor": 197.0, "vencimento": "2026-06-15",
        }))
        alerta = AsyncMock()
        import app.services.alertas as alertas_mod
        monkeypatch.setattr(alertas_mod, "registrar_alerta", alerta)

        out = asyncio.run(bp.aplicar_pagamento_plataforma(
            db, "PAYMENT_OVERDUE", _payment(pizz.id, status="OVERDUE")
        ))
        assert out["pago"] is False
        alerta.assert_awaited_once()
        sqls = [str(c.args[0]) for c in db.execute.await_args_list]
        assert not any("plano_vence_em = GREATEST" in s for s in sqls)

    def test_pizzaria_desconhecida_ignorada(self, monkeypatch):
        from app.services import billing_plataforma as bp

        res = MagicMock()
        res.scalar_one_or_none.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)

        out = asyncio.run(bp.aplicar_pagamento_plataforma(
            db, "PAYMENT_RECEIVED", _payment(uuid.uuid4())
        ))
        assert out == {"ignored": "pizzaria_nao_encontrada"}

    def test_plano_invalido_nao_promove(self, monkeypatch):
        """Plano fora do catálogo de venda (ex.: 'trial') não entra no UPDATE."""
        from app.services import billing_plataforma as bp

        pizz = MagicMock()
        pizz.id = uuid.uuid4()
        pizz.nome = "Pizza Teste"
        db = _db_com_pizzaria(pizz)
        monkeypatch.setattr(bp, "upsert_fatura", AsyncMock(return_value={"id": "f1"}))

        asyncio.run(bp.aplicar_pagamento_plataforma(
            db, "PAYMENT_CONFIRMED", _payment(pizz.id, plano="trial")
        ))
        params = next(c.args[1] for c in db.execute.await_args_list
                      if isinstance(c.args[-1], dict) and "plano" in c.args[-1])
        assert params["plano"] is None  # COALESCE mantém o plano atual


# ============================================
# upsert_fatura (idempotência)
# ============================================
class TestCancelarAssinatura:
    def test_cancela_no_asaas_e_sincroniza_faturas(self, monkeypatch):
        from app.services import billing_plataforma as bp

        pizz = MagicMock()
        pizz.id = uuid.uuid4()
        pizz.asaas_subscription_id = "sub_ativa"
        pizz.plano_vence_em = None
        db = MagicMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        client = MagicMock()
        client.cancelar_assinatura = AsyncMock()
        monkeypatch.setattr(bp, "PlatformAsaasClient", lambda: client)

        out = asyncio.run(bp.cancelar_assinatura(db, pizz))

        client.cancelar_assinatura.assert_awaited_once_with("sub_ativa")
        assert pizz.asaas_subscription_id is None
        assert out["cancelada"] is True
        assert out["renovacao_automatica"] is False
        sql = str(db.execute.await_args.args[0])
        assert "status = 'cancelada'" in sql
        assert "pendente" in sql and "vencida" in sql
        db.commit.assert_awaited_once()

    def test_sem_recorrencia_e_idempotente(self):
        from app.services import billing_plataforma as bp

        pizz = MagicMock()
        pizz.id = uuid.uuid4()
        pizz.asaas_subscription_id = None
        pizz.plano_vence_em = None
        db = MagicMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()

        out = asyncio.run(bp.cancelar_assinatura(db, pizz))

        assert out["cancelada"] is False
        db.execute.assert_not_awaited()
        db.commit.assert_not_awaited()


class TestUpsertFatura:
    def test_cria_quando_nao_existe(self):
        from app.services.billing_plataforma import upsert_fatura

        res = MagicMock()
        res.scalar_one_or_none.return_value = None
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        db.add = MagicMock()
        db.flush = AsyncMock()

        out = asyncio.run(upsert_fatura(db, uuid.uuid4(), {
            "id": "pay_9", "value": 97.0, "status": "PENDING",
            "dueDate": "2026-07-01", "invoiceUrl": "https://x",
        }))
        db.add.assert_called_once()
        assert out["status"] == "pendente"
        assert out["valor"] == 97.0
        assert out["vencimento"] == "2026-07-01"

    def test_atualiza_existente_sem_duplicar(self):
        from app.models import Fatura
        from app.services.billing_plataforma import upsert_fatura

        existente = Fatura(pizzaria_id=uuid.uuid4(), asaas_payment_id="pay_9", valor=97)
        existente.status = "pendente"
        res = MagicMock()
        res.scalar_one_or_none.return_value = existente
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        db.add = MagicMock()
        db.flush = AsyncMock()

        out = asyncio.run(upsert_fatura(db, existente.pizzaria_id, {
            "id": "pay_9", "value": 97.0, "status": "RECEIVED",
        }))
        db.add.assert_not_called()
        assert out["status"] == "paga"
        assert existente.pago_em is not None
