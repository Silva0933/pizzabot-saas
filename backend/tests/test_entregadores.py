"""
Testes do painel de entregador (unitários, no estilo mock da suíte).

Travam os guardas que protegem o fluxo:
  - entregador só pode usar status 'a_caminho'/'entregue' (não 'novo'/'cancelado');
  - self-claim ('pegar' / 'disponiveis') é barrado no BACKEND quando o toggle da
    pizzaria está desligado — não basta esconder na UI;
  - apply_status_change rejeita status inválido antes de tocar no banco.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException


def _db_scalar_one(value):
    """db.execute(...).scalar_one() -> value (1ª consulta da rota)."""
    exec_result = MagicMock()
    exec_result.scalar_one.return_value = value
    db = MagicMock()
    db.execute = AsyncMock(return_value=exec_result)
    return db


def _pizzaria(autoatribuicao: bool):
    p = MagicMock()
    p.permitir_autoatribuicao_entregador = autoatribuicao
    return p


# ============================================================
# Status restrito do entregador
# ============================================================
class TestStatusRestrito:
    def test_entregador_nao_pode_status_arbitrario(self):
        from app.routes.entregadores import DriverStatusIn, atualizar_status_entregador

        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                atualizar_status_entregador(
                    uuid.uuid4(), uuid.uuid4(),
                    DriverStatusIn(status="novo"),
                    db=MagicMock(), ent=MagicMock(),
                )
            )
        assert exc.value.status_code == 400

    def test_status_permitidos(self):
        from app.routes.entregadores import DRIVER_STATUSES
        assert set(DRIVER_STATUSES) == {"a_caminho", "entregue"}


# ============================================================
# Pedido só fica DISPONÍVEL pro entregador quando 'pronto_entrega'
# (pizza ainda no forno não aparece); e segue visível em "minhas" depois de pego.
# ============================================================
class TestDisponivelStatus:
    def test_disponivel_exige_pronto_entrega(self):
        from app.routes.entregadores import DISPONIVEL_STATUS
        assert DISPONIVEL_STATUS == ("pronto_entrega",)
        assert "no_forno" not in DISPONIVEL_STATUS

    def test_pronto_entrega_segue_em_minhas_entregas(self):
        from app.routes.entregadores import ENTREGA_ATIVA
        # Pego pelo entregador, o pedido continua 'pronto_entrega' até ele sair —
        # precisa aparecer em "minhas entregas".
        assert "pronto_entrega" in ENTREGA_ATIVA


# ============================================================
# Self-claim barrado quando o toggle está desligado
# ============================================================
class TestSelfClaimGate:
    def test_disponiveis_vazio_com_toggle_off(self):
        from app.routes.entregadores import entregas_disponiveis

        db = _db_scalar_one(_pizzaria(autoatribuicao=False))
        res = asyncio.run(entregas_disponiveis(uuid.uuid4(), db=db, ent=MagicMock()))
        assert res == []

    def test_pegar_bloqueado_com_toggle_off(self):
        from app.routes.entregadores import pegar_pedido

        db = _db_scalar_one(_pizzaria(autoatribuicao=False))
        with pytest.raises(HTTPException) as exc:
            asyncio.run(pegar_pedido(uuid.uuid4(), uuid.uuid4(), db=db, ent=MagicMock()))
        assert exc.value.status_code == 403


# ============================================================
# apply_status_change rejeita status inválido antes do banco
# ============================================================
class TestApplyStatusChange:
    def test_status_invalido(self):
        from app.routes.pedidos import apply_status_change

        ped = MagicMock()
        ped.status = "novo"
        with pytest.raises(HTTPException) as exc:
            asyncio.run(apply_status_change(MagicMock(), uuid.uuid4(), ped, "voando"))
        assert exc.value.status_code == 400
