"""
Regressões achadas testando o agente real da Fornalha no playground:

  - Pós-venda de pedido feito FORA do estado do FSM (cardápio digital, ou pelo
    WhatsApp depois do TTL de 2h): "quero cancelar" caía no ramo de rascunho e a
    atendente confirmava o cancelamento sem cancelar nada.
  - Telefone do cardápio (com o 9) × JID do WhatsApp (muitas vezes sem o 9).
  - Borda/adicional que a casa não tem prendia o item em pendência até o
    atendimento ir pro humano.
  - Recusa do upsell ("não, só isso") respondida com "Coca anotada!".
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.nome = "Fornalha Burger & Pizza"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.taxas_bairro = None
    ctx.telefone = "559891234567"
    return ctx, MagicMock()


def _pedido(numero=42, status="confirmado", origem="cardapio_digital"):
    ped = MagicMock()
    ped.numero_pedido = numero
    ped.status = status
    ped.origem = origem
    return ped


def _calc_ok(itens, total):
    return {
        "ok": True, "itens": itens, "valor_itens": total, "taxa_entrega": 0.0,
        "valor_total": total, "bairro_detectado": None, "fingerprint": "x",
    }


class TestTelefonesEquivalentes:
    def test_com_e_sem_nono_digito(self):
        from app.services.telefones import telefones_equivalentes
        v = telefones_equivalentes("(98) 99123-4567")
        assert "5598991234567" in v   # como o cardápio grava
        assert "559891234567" in v    # como o WhatsApp costuma entregar

    def test_jid_sem_nono_acha_o_formato_do_cardapio(self):
        from app.services.telefones import telefones_equivalentes
        assert "5598991234567" in telefones_equivalentes("559891234567")


class TestPosVendaPedidoExterno:
    def test_cancelar_pedido_do_cardapio_cancela_de_verdade(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()  # sem estado: pedido veio do cardápio
        nlu = {"intencao": "cancelar", "dados": {}}
        cancelar = AsyncMock(return_value={"ok": True, "numero_pedido": 42, "cancelado": True})
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=_pedido())), \
             patch("app.agent.tools.cancelar_pedido", new=cancelar):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero cancelar"))

        cancelar.assert_awaited_once()
        assert out["decisao"]["acao"] == "cancelado"
        assert "#42 cancelado" in " ".join(out["decisao"]["fatos"])

    def test_cancelamento_que_falha_nao_e_confirmado(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        nlu = {"intencao": "cancelar", "dados": {}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=_pedido(status="a_caminho"))), \
             patch("app.agent.tools.cancelar_pedido",
                   new=AsyncMock(return_value={"ok": False, "erro": "já está 'a_caminho'"})), \
             patch("app.agent.tools.escalar_humano", new=AsyncMock(return_value={"ok": True})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="cancela"))

        assert out["decisao"]["acao"] == "escalado"
        assert "NÃO afirme" in out["decisao"]["proxima_pergunta"]

    def test_sem_pedido_ativo_cancelar_so_limpa_rascunho(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        nlu = {"intencao": "cancelar", "dados": {}}
        cancelar = AsyncMock()
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools.cancelar_pedido", new=cancelar):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="cancela"))

        cancelar.assert_not_awaited()
        assert "rascunho" in " ".join(out["decisao"]["fatos"]).lower()

    def test_pergunta_do_pedido_recebe_o_status_real(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "duvida_geral", "dados": {}}
        with patch("app.agent.tools.pedido_ativo_do_cliente",
                   new=AsyncMock(return_value=_pedido(numero=77, status="no_forno"))):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="meu pedido já tá pronto?"))

        fatos = " ".join(out["decisao"]["fatos"])
        assert "#77" in fatos
        assert "em preparo" in fatos
        assert "cardápio digital" in fatos


class TestAdicionalInexistente:
    def test_borda_inexistente_sai_do_item_e_o_pedido_segue(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{
            "nome": "Pizza Frango com Catupiry", "qtd": 1, "tamanho": "G",
            "adicionais": ["borda recheada de cheddar"],
        }]}}
        calc = AsyncMock(side_effect=[
            {"ok": False, "erro": "Adicional não disponível",
             "adicional_invalido": ["borda recheada de cheddar"], "adicionais_validos": []},
            _calc_ok([{"nome": "Pizza Frango com Catupiry (G)", "quantidade": 1, "preco_unit": 66.9}], 66.9),
        ])
        with patch("app.agent.tools._calcular_pedido", new=calc), \
             patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": [], "bordas": [], "adicionais": [], "sobremesas": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="frango G com borda de cheddar"))

        item = out["estado"]["carrinho"][0]
        assert item["adicionais"] == []
        assert out["decisao"]["acao"] != "pendencia"
        fatos = " ".join(out["decisao"]["fatos"])
        assert "NÃO tem" in fatos and "cheddar" in fatos
        assert calc.await_count == 2


class TestConfirmacaoDeItem:
    def _estado_upsell(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True
        estado["carrinho"] = [{
            "nome": "Pizza Calabresa", "tamanho": "G", "qtd": 1,
            "preco_congelado": 59.9, "nome_congelado": "Pizza Calabresa (G)",
        }]
        return estado

    def test_recusa_do_upsell_nao_manda_dizer_anotado(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        nlu = {"intencao": "confirmar_resumo", "dados": {}}  # "não, só isso"
        out = asyncio.run(engine.processar(db, ctx, self._estado_upsell(), nlu, user_input="não, só isso"))

        pergunta = out["decisao"]["proxima_pergunta"]
        assert "entrega" in pergunta.lower()
        assert "Coca anotada" not in pergunta
        assert "NÃO diga que anotou" in pergunta

    def test_item_pedido_no_turno_e_confirmado_pelo_nome(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "Coca-Cola 2L", "qtd": 1}]}}
        calc = AsyncMock(return_value=_calc_ok([
            {"nome": "Pizza Calabresa (G)", "quantidade": 1, "preco_unit": 59.9},
            {"nome": "Coca-Cola 2L", "quantidade": 1, "preco_unit": 15.9},
        ], 75.8))
        with patch("app.agent.tools._calcular_pedido", new=calc):
            out = asyncio.run(engine.processar(db, ctx, self._estado_upsell(), nlu, user_input="uma coca 2l"))

        assert "Coca-Cola 2L" in out["decisao"]["proxima_pergunta"]


class TestTaxaNaDuvida:
    def _pizz(self, bairros, fixa=None):
        pizz = MagicMock()
        pizz.taxas_bairro = bairros
        pizz.taxa_entrega_fixa = fixa
        return pizz

    def test_bairro_citado_recebe_a_taxa_dele(self):
        from app.agent.fsm.engine import _fatos_taxa_entrega
        fato, valores = _fatos_taxa_entrega(
            self._pizz([{"bairro": "Cohatrac", "taxa": 8}, {"bairro": "Cidade Operária", "taxa": 6.9}]),
            "quanto é a entrega pro cohatrac?",
        )
        assert "Cohatrac" in fato and "R$ 8,00" in fato
        assert valores == [8.0]

    def test_bairro_fora_da_lista_nao_inventa(self):
        from app.agent.fsm.engine import _fatos_taxa_entrega
        fato, valores = _fatos_taxa_entrega(
            self._pizz([{"bairro": "Cidade Operária", "taxa": 6.9}]), "entrega no Renascença?",
        )
        assert "NÃO invente" in fato
        assert 6.9 in valores

    def test_sem_taxa_cadastrada_nao_gera_fato(self):
        from app.agent.fsm.engine import _fatos_taxa_entrega
        assert _fatos_taxa_entrega(self._pizz([], None), "qual a taxa?") == (None, [])


class TestPerguntaPagarAgora:
    def test_retirada_fala_na_retirada(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado.update({"apresentou": True, "upsell_feito": True, "tipo": "retirada", "pagamento": "pix"})
        estado["carrinho"] = [{"nome": "Pizza Calabresa", "tamanho": "G", "qtd": 1,
                               "preco_congelado": 59.9, "nome_congelado": "Pizza Calabresa (G)"}]
        nlu = {"intencao": "informar_pagamento", "dados": {"forma_pagamento": "pix"}}
        calc = AsyncMock(return_value=_calc_ok(
            [{"nome": "Pizza Calabresa (G)", "quantidade": 1, "preco_unit": 59.9}], 59.9))
        with patch("app.agent.tools._calcular_pedido", new=calc):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="pix"))
        pergunta = out["decisao"]["proxima_pergunta"]
        assert "NA RETIRADA" in pergunta and "NA ENTREGA" not in pergunta


class TestRespostaDePagamentoNaoViraObservacao:
    def _estado_pagamento(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado.update({"apresentou": True, "upsell_feito": True, "tipo": "retirada",
                       "pagamento": "pix", "etapa": "PAGAMENTO"})
        estado["carrinho"] = [{"nome": "Pizza Calabresa", "tamanho": "G", "qtd": 1,
                               "preco_congelado": 59.9, "nome_congelado": "Pizza Calabresa (G)"}]
        return estado

    def _rodar(self, obs):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        nlu = {"intencao": "informar_pagamento", "dados": {"pagar_agora": False, "observacoes": obs}}
        calc = AsyncMock(return_value=_calc_ok(
            [{"nome": "Pizza Calabresa (G)", "quantidade": 1, "preco_unit": 59.9}], 59.9))
        with patch("app.agent.tools._calcular_pedido", new=calc):
            return asyncio.run(engine.processar(db, ctx, self._estado_pagamento(), nlu, user_input=obs))

    def test_na_hora_de_pegar_nao_vira_observacao(self):
        out = self._rodar("na hora de pegar")
        assert not out["estado"].get("observacoes")
        assert out["estado"]["pagar_agora"] is False

    def test_observacao_de_verdade_continua(self):
        out = self._rodar("sem cebola")
        assert out["estado"]["observacoes"] == "sem cebola"
