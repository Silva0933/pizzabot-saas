"""
Negativa determinística: produto que não existe no catálogo.

Teste com o agente real (Fornalha, 29/09): "tem fanta?" → "Não tenho essa
informação no cardápio disponível agora"; "tem coca de 600ml?" → "não tenho
informação sobre a versão de 600 ml". Agora o sistema responde "não temos X"
com as alternativas reais da categoria (ou "está em falta", se desligado).
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.fsm.catalogo import Catalogo, ProdutoCat


def _cat():
    return Catalogo(pizzaria_id="p", produtos=[
        ProdutoCat(id="b1", codigo="P1", nome="Coca-Cola 2L", categoria="bebida", preco=Decimal("15.90")),
        ProdutoCat(id="b2", codigo="P2", nome="Guaraná Antarctica 2L", categoria="bebida", preco=Decimal("13.90")),
        ProdutoCat(id="z1", codigo="P3", nome="Pizza Calabresa", categoria="pizza", preco=Decimal("0"),
                   tamanhos=[("M", Decimal("46.90")), ("G", Decimal("59.90"))]),
    ])


def _db(indisponiveis=()):
    res = MagicMock()
    res.fetchall.return_value = [(n,) for n in indisponiveis]
    db = MagicMock()
    db.execute = AsyncMock(return_value=res)
    return db


def _ctx():
    ctx = MagicMock()
    ctx.pizzaria.id = "p"
    ctx.pizzaria.nome = "Fornalha"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxas_bairro = None
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.tema_cardapio = {}
    ctx.ultimo_pedido_resumo = None
    return ctx


class TestConverter:
    def test_le_os_nao_encontrados(self):
        from app.agent.fsm.nlu_comandos import converter
        out = converter({"intencao": "duvida_geral", "produtos_nao_encontrados": [
            {"texto": "fanta", "categoria": "bebida"}, {"texto": "x", "categoria": "inexistente"},
        ]}, _cat(), {"carrinho": []})
        assert out["dados"]["_nao_encontrados"] == [
            {"texto": "fanta", "categoria": "bebida"}, {"texto": "x", "categoria": None},
        ]

    def test_schema_estrito_tem_o_campo(self):
        from app.agent.fsm.nlu_comandos import montar_schema
        sch = montar_schema(_cat(), [])
        assert "produtos_nao_encontrados" in sch["required"]


class TestNegativa:
    def _neg(self, nao_enc, indisponiveis=(), cardapio_enviado=False):
        from app.agent.fsm import engine
        with patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=_cat())):
            return asyncio.run(engine._negativa_catalogo(
                _db(indisponiveis), _ctx(), nao_enc, cardapio_enviado=cardapio_enviado,
            ))

    def test_nao_temos_com_alternativas_reais(self):
        txt = self._neg([{"texto": "Fanta", "categoria": "bebida"}])
        assert txt.startswith("Poxa, não temos Fanta 😕")
        assert "Das bebidas, temos: Coca-Cola 2L (R$ 15,90), Guaraná Antarctica 2L (R$ 13,90). Quer alguma?" in txt

    def test_produto_desligado_esta_em_falta(self):
        txt = self._neg([{"texto": "coca", "categoria": "bebida"}], indisponiveis=["Coca Cola 2L"])
        assert "a Coca Cola 2L está em falta no momento" in txt

    def test_pizza_mostra_a_partir_de(self):
        txt = self._neg([{"texto": "pizza de jaca", "categoria": "pizza"}])
        assert "Pizza Calabresa (a partir de R$ 46,90)" in txt

    def test_sem_categoria_oferece_o_cardapio(self):
        txt = self._neg([{"texto": "sushi", "categoria": None}])
        assert "Quer que eu te mande o cardápio?" in txt
        assert "Quer que eu" not in self._neg([{"texto": "sushi", "categoria": None}], cardapio_enviado=True)


class TestNoFluxo:
    def test_tem_fanta_vira_resposta_do_sistema(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "duvida_geral", "dados": {
            "_nlu": "comandos", "_citados": [], "_nao_encontrados": [{"texto": "fanta", "categoria": "bebida"}],
        }}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=_cat())):
            out = asyncio.run(engine.processar(_db(), _ctx(), estado, nlu, user_input="tem fanta?"))
        assert out["decisao"]["acao"] == "responder_duvida"
        assert out["decisao"]["mensagem_pronta"].startswith("Poxa, não temos fanta 😕")
        assert out["decisao"]["mensagem_pronta_acao"] == "responder_duvida"
