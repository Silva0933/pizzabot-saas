"""
Troco no pagamento em dinheiro na entrega.

Teste com o agente real (29/09): entrega em dinheiro fechava sem perguntar o
troco — o motoboy saía sem saber quanto levar. Agora é um passo do funil, com
texto fixo, e o troco vai no resumo e nas observações do pedido.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.fsm import engine
from app.agent.fsm.catalogo import Catalogo, ProdutoCat
from app.agent.fsm.nlu_comandos import garantir_ids_itens


@pytest.fixture
def cat():
    return Catalogo(pizzaria_id="pz-1", produtos=[
        ProdutoCat(id="id-coca", codigo="P1", nome="Coca-Cola 2L", categoria="bebida", preco=Decimal("15.90")),
    ])


def _estado(**kw):
    est = engine.estado_inicial()
    est.update({
        "apresentou": True, "tipo": "delivery", "endereco": "Rua X, 10", "pagamento": "dinheiro",
        "pagar_agora": False, "upsell_feito": True, "upsell_ofertas": 9, "upsell_ultimo_tamanho": 9,
        "carrinho": [{"nome": "Coca-Cola 2L", "produto_id": "id-coca", "qtd": 1}],
    })
    est.update(kw)
    garantir_ids_itens(est)
    return est


def _calc():
    return {"ok": True, "itens": [{"nome": "Coca-Cola 2L", "quantidade": 1, "preco_unit": 15.9}],
            "taxa_entrega": 5.0, "valor_total": 20.9}


def _ctx():
    ctx = MagicMock()
    ctx.pizzaria.id = "pz-1"
    ctx.simulation = True
    return ctx


def _turno(cat, est, intencao, texto, registrar=None):
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
         patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=_calc())), \
         patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)), \
         patch("app.agent.fsm.engine._modo_pagamento", return_value="automatico"), \
         patch("app.agent.tools.registrar_pedido", new=registrar or AsyncMock()):
        return asyncio.run(engine.processar(MagicMock(), _ctx(), est,
                                            {"intencao": intencao, "dados": {}}, user_input=texto))


class TestLerTroco:
    def test_valores(self):
        assert engine._ler_troco("pra 100") == 100.0
        assert engine._ler_troco("troco de 50,00") == 50.0
        assert engine._ler_troco("não precisa") == 0.0
        assert engine._ler_troco("tenho trocado") == 0.0
        assert engine._ler_troco("hmm") is None

    def test_nas_observacoes_so_com_a_palavra_troco(self):
        assert engine._ler_troco("casa 12, portão azul", so_valor=True) is None
        assert engine._ler_troco("sem cebola, troco pra 100", so_valor=True) == 100.0


class TestFluxoDoTroco:
    def test_pergunta_o_troco_antes_do_resumo(self, cat):
        out = _turno(cat, _estado(), "informar_pagamento", "dinheiro")
        assert out["decisao"]["mensagem_pronta"] == "Vai precisar de troco? Se sim, pra quanto? 💵"
        assert out["estado"]["aguardando_troco"] is True

    def test_resposta_vai_para_o_resumo(self, cat):
        est = _estado(aguardando_troco=True)
        out = _turno(cat, est, "informar_pagamento", "pra 50")
        assert out["decisao"]["acao"] == "resumo_confirmar"
        assert "💵 Troco para R$ 50,00" in out["decisao"]["mensagem_pronta"]

    def test_troco_nao_aparece_duas_vezes_no_resumo(self):
        msg = engine._montar_resumo_msg(
            [{"quantidade": 1, "nome": "Coca-Cola 2L", "preco_unit": 15.9}], 5.0, 20.9, "delivery", "Rua X, 10",
            "dinheiro", False, "sem cebola, troco pra 50", troco=50.0,
        )
        assert msg.count("roco") == 1
        assert "📝 Obs: sem cebola" in msg

    def test_sem_troco(self, cat):
        out = _turno(cat, _estado(aguardando_troco=True), "confirmar_resumo", "não precisa")
        assert "💵 Sem troco" in out["decisao"]["mensagem_pronta"]

    def test_troco_menor_que_o_total_pergunta_de_novo(self, cat):
        out = _turno(cat, _estado(aguardando_troco=True), "informar_pagamento", "pra 10")
        assert out["decisao"]["mensagem_pronta"] == "O total ficou R$ 20,90 😊 Pra quanto você vai precisar de troco?"

    def test_troco_dito_antes_nao_pergunta_de_novo(self, cat):
        out = _turno(cat, _estado(observacoes="troco pra 100"), "informar_pagamento", "dinheiro")
        assert out["decisao"]["acao"] == "resumo_confirmar"

    def test_retirada_nao_pergunta(self, cat):
        out = _turno(cat, _estado(tipo="retirada", endereco=None), "informar_pagamento", "dinheiro")
        assert out["decisao"]["acao"] == "resumo_confirmar"

    def test_troco_vai_nas_observacoes_do_pedido(self, cat):
        registrar = AsyncMock(return_value={"ok": True, "numero_pedido": 5, "tempo_estimado": "30-45 min"})
        est = _estado(troco=50.0, etapa="AGUARDANDO_CONFIRMACAO")
        _turno(cat, est, "confirmar_resumo", "sim", registrar=registrar)
        assert registrar.await_args.kwargs["observacoes"] == "Troco para R$ 50,00"
