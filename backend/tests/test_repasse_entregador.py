"""
Valor por entrega do entregador e histórico no app.

A loja liga um valor fixo por entrega; ao concluir, o valor é congelado no
pedido (mudar depois não altera o que já foi ganho). Com o repasse desligado,
o app do entregador não mostra valores.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _db_linha(linha):
    res = MagicMock()
    res.first.return_value = linha
    db = AsyncMock()
    db.execute = AsyncMock(return_value=res)
    return db


class TestValorDoRepasse:
    def test_ligado_devolve_o_valor(self):
        from app.services.entregas import valor_repasse
        assert asyncio.run(valor_repasse(_db_linha((True, Decimal("7.00"))), uuid.uuid4())) == Decimal("7.00")

    def test_desligado_ou_sem_valor(self):
        from app.services.entregas import valor_repasse
        assert asyncio.run(valor_repasse(_db_linha((False, Decimal("7.00"))), uuid.uuid4())) is None
        assert asyncio.run(valor_repasse(_db_linha((True, None)), uuid.uuid4())) is None


class TestEntregueCongelaOValor:
    def _entregar(self, ped, valor):
        from app.routes import pedidos as P
        db = AsyncMock()
        db.add = MagicMock()
        with patch("app.services.entregas.valor_repasse", new=AsyncMock(return_value=valor)), \
             patch.object(P, "registrar_evento_pedido", new=MagicMock()), \
             patch.object(P.broadcaster, "publish", new=AsyncMock()), \
             patch("app.workers.tasks.enviar_status_msg.apply_async", new=MagicMock()):
            asyncio.run(P.apply_status_change(db, uuid.uuid4(), ped, "entregue", correcao=True))
        return ped

    def _ped(self, **kw):
        base = dict(id=uuid.uuid4(), numero_pedido=9, status="a_caminho", tipo="delivery",
                    entregador_id=uuid.uuid4(), repasse_entregador=None, entregue_em=None,
                    codigo_entrega=None, aguardando_revisao=False)
        base.update(kw)
        return SimpleNamespace(**base)

    def test_registra_quando_e_quanto(self):
        ped = self._entregar(self._ped(), Decimal("7.00"))
        assert ped.entregue_em is not None and ped.repasse_entregador == Decimal("7.00")

    def test_valor_ja_congelado_nao_muda(self):
        ped = self._entregar(self._ped(repasse_entregador=Decimal("5.00")), Decimal("9.00"))
        assert ped.repasse_entregador == Decimal("5.00")

    def test_sem_entregador_nao_tem_repasse(self):
        ped = self._entregar(self._ped(entregador_id=None), Decimal("7.00"))
        assert ped.repasse_entregador is None and ped.entregue_em is not None


class TestConfigDaLoja:
    def _config(self, pizz, **body):
        from app.routes import entregadores as R
        res = MagicMock()
        res.scalar_one.return_value = pizz
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)
        with patch.object(R, "listar_entregadores", new=AsyncMock(return_value="ok")):
            return asyncio.run(R.set_config(uuid.uuid4(), R.ConfigIn(**body), db, None))

    def _pizz(self, **kw):
        base = dict(permitir_autoatribuicao_entregador=False, repasse_entregador_ativo=False,
                    repasse_entregador_valor=None)
        base.update(kw)
        return SimpleNamespace(**base)

    def test_liga_com_valor(self):
        pizz = self._pizz()
        self._config(pizz, repasse_ativo=True, repasse_valor=7.5)
        assert pizz.repasse_entregador_ativo is True and pizz.repasse_entregador_valor == Decimal("7.5")
        assert pizz.permitir_autoatribuicao_entregador is False  # campo ausente não muda

    def test_ligar_sem_valor_e_recusado(self):
        with pytest.raises(HTTPException) as e:
            self._config(self._pizz(), repasse_ativo=True)
        assert e.value.status_code == 422

    def test_valor_negativo_recusado(self):
        from pydantic import ValidationError

        from app.routes import entregadores as R
        with pytest.raises(ValidationError):
            R.ConfigIn(repasse_valor=-1)


class TestHistorico:
    def _historico(self, repasse_ativo):
        from app.routes import entregadores as R
        pizz = SimpleNamespace(repasse_entregador_ativo=repasse_ativo)
        ped = SimpleNamespace(
            id=uuid.uuid4(), numero_pedido=12, cliente=SimpleNamespace(nome="Ana"),
            endereco_entrega="Rua A, 1", entregue_em=datetime.now(UTC), valor_total=Decimal("55"),
            forma_pagamento="dinheiro", repasse_entregador=Decimal("7.00"),
        )
        r_pizz = MagicMock()
        r_pizz.scalar_one.return_value = pizz
        r_ped = MagicMock()
        r_ped.scalars.return_value.all.return_value = [ped]
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[r_pizz, r_ped])
        return asyncio.run(R.historico_entregador(uuid.uuid4(), 30, db, SimpleNamespace(id=uuid.uuid4())))

    def test_com_repasse_mostra_o_valor(self):
        h = self._historico(True)
        assert h["repasse_ativo"] and h["entregas"][0]["repasse"] == 7.0
        assert h["entregas"][0]["numero_pedido"] == 12

    def test_sem_repasse_esconde_o_valor(self):
        h = self._historico(False)
        assert not h["repasse_ativo"] and h["entregas"][0]["repasse"] is None
