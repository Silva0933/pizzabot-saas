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
# Self-claim atômico: dois entregadores, um vencedor (A14, análise de 01/10)
# ============================================================
class TestSelfClaimAtomico:
    """Antes: lia o pedido, via "sem entregador" e gravava. Dois toques juntos
    liam o mesmo estado, os dois recebiam OK e o último sobrescrevia o primeiro."""

    def _db(self, *resultados):
        fila = list(resultados)
        db = MagicMock()

        async def _exec(stmt, *_a, **_k):
            return fila.pop(0)

        db.execute = _exec
        db.commit = AsyncMock()
        return db

    def _res(self, scalar_one=None, scalar_one_or_none=None, one_or_none=None):
        r = MagicMock()
        r.scalar_one.return_value = scalar_one
        r.scalar_one_or_none.return_value = scalar_one_or_none
        r.one_or_none.return_value = one_or_none
        return r

    def test_vencedor_pega_o_pedido(self):
        from unittest.mock import patch

        from app.routes import entregadores
        pedido = MagicMock()
        db = self._db(
            self._res(scalar_one=_pizzaria(autoatribuicao=True)),   # pizzaria
            self._res(scalar_one_or_none=uuid.uuid4()),             # UPDATE ... RETURNING: ganhou
            self._res(scalar_one=pedido),                           # pedido atualizado
        )
        with patch.object(entregadores, "_broadcast_atribuicao", AsyncMock()) as aviso:
            out = asyncio.run(entregadores.pegar_pedido(uuid.uuid4(), uuid.uuid4(), db=db, ent=MagicMock()))
        assert out is pedido
        db.commit.assert_awaited_once()
        aviso.assert_awaited_once()

    def test_segundo_entregador_recebe_conflito(self):
        from app.routes import entregadores
        db = self._db(
            self._res(scalar_one=_pizzaria(autoatribuicao=True)),
            self._res(scalar_one_or_none=None),                     # UPDATE não pegou nenhuma linha
            self._res(one_or_none=(uuid.uuid4(),)),                 # já tem entregador
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(entregadores.pegar_pedido(uuid.uuid4(), uuid.uuid4(), db=db, ent=MagicMock()))
        assert exc.value.status_code == 409
        db.commit.assert_not_awaited()

    def test_pedido_cancelado_nao_pode_ser_pego(self):
        from app.routes import entregadores
        db = self._db(
            self._res(scalar_one=_pizzaria(autoatribuicao=True)),
            self._res(scalar_one_or_none=None),
            self._res(one_or_none=(None,)),                         # sem entregador, mas fora de pronto_entrega
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(entregadores.pegar_pedido(uuid.uuid4(), uuid.uuid4(), db=db, ent=MagicMock()))
        assert exc.value.status_code == 409
        assert "disponível" in exc.value.detail

    def test_update_e_condicional(self):
        """A trava está no WHERE do UPDATE (não numa leitura anterior)."""
        from app.routes import entregadores
        capturado = []
        db = MagicMock()
        db.commit = AsyncMock()
        resultados = [self._res(scalar_one=_pizzaria(autoatribuicao=True)), self._res(scalar_one_or_none=None),
                      self._res(one_or_none=None)]

        async def _exec(stmt, *_a, **_k):
            capturado.append(stmt)
            return resultados.pop(0)

        db.execute = _exec
        with pytest.raises(HTTPException):
            asyncio.run(entregadores.pegar_pedido(uuid.uuid4(), uuid.uuid4(), db=db, ent=MagicMock()))
        sql = str(capturado[1])
        assert sql.startswith("UPDATE pedidos")
        assert "entregador_id IS NULL" in sql and "status IN" in sql and "tipo" in sql


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
