"""
Testes do comportamento de saudação/cardápio do FSM.

Regra de negócio (pedida pelo cliente do produto):
  - Na saudação/coleta sem itens, em vez de perguntar "qual sabor", o bot OFERECE
    ver o cardápio.
  - Se ele acabou de oferecer e o cliente confirma ("sim"), manda o cardápio.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.nome = "Pizzaria Palazio"
    ctx.telefone = "5511999999999"
    db = MagicMock()
    return ctx, db


class TestSaudacaoOfereceCardapio:
    def test_saudacao_oferece_cardapio_em_vez_de_perguntar_sabor(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        nlu = {"intencao": "saudacao", "dados": {}}

        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="boa noite"))

        decisao = out["decisao"]
        assert decisao["acao"] == "saudacao"
        # A instrução à voz deve oferecer o cardápio, não perguntar "qual sabor".
        assert "cardápio" in decisao["proxima_pergunta"].lower()
        assert "qual sabor" not in decisao["proxima_pergunta"].lower()
        assert out["estado"]["cardapio_ofertado"] is True

    def test_coleta_sem_apresentar_de_novo_oferece_cardapio(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True  # já cumprimentou antes
        nlu = {"intencao": "conversa_fiada", "dados": {}}

        # conversa_fiada cai no responder_duvida; usamos intenção neutra que não
        # adiciona item nem vira dúvida → coleta. Forçamos via intenção 'saudacao'
        # repetida (sem itens) para exercitar o ramo coletar_item.
        nlu = {"intencao": "saudacao", "dados": {}}
        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="oi de novo"))

        decisao = out["decisao"]
        assert decisao["acao"] == "coletar_item"
        assert "cardápio" in decisao["proxima_pergunta"].lower()
        assert out["estado"]["cardapio_ofertado"] is True


class TestConfirmaVerCardapio:
    def test_sim_apos_oferta_envia_o_cardapio(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        estado["cardapio_ofertado"] = True  # acabamos de oferecer

        nlu = {"intencao": "confirmar_resumo", "dados": {}}  # "sim"

        with patch("app.agent.tools.enviar_cardapio_arquivo",
                   new=AsyncMock(return_value={"ok": True})) as mock_card:
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="sim"))

        mock_card.assert_awaited_once()
        assert out["decisao"]["acao"] == "cardapio"
        assert out["estado"]["cardapio_enviado"] is True
        # Mensagem verbatim do backend: NÃO oferece "mostrar sabores em texto".
        msg = out["decisao"].get("mensagem_pronta") or ""
        assert "👆" in msg
        assert "texto" not in msg.lower()
        assert "sabores" not in msg.lower()

    def test_sim_sem_oferta_previa_nao_dispara_cardapio(self):
        """Sem ter oferecido antes, um 'sim' solto não deve mandar o cardápio."""
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        # cardapio_ofertado = False (padrão)

        nlu = {"intencao": "confirmar_resumo", "dados": {}}

        with patch("app.agent.tools.enviar_cardapio_arquivo",
                   new=AsyncMock(return_value={"ok": True})) as mock_card:
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="sim"))

        mock_card.assert_not_awaited()
        assert out["decisao"]["acao"] != "cardapio"


class TestFluxoNaoTravaAoRecusarUpsell:
    def test_conversa_fiada_com_carrinho_avanca_o_funil(self):
        """Recusar o upsell ('só a pizza mesmo') NÃO pode parar o fluxo: com itens
        no carrinho, a conversa fiada deve cair no funil e perguntar entrega/retirada."""
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        ctx.pizzaria.adicionais = []
        ctx.pizzaria.taxa_entrega_fixa = None
        ctx.pizzaria.taxas_bairro = None

        estado = engine.estado_inicial()
        estado["apresentou"] = True
        estado["upsell_feito"] = True  # upsell já foi feito
        # Item com preço congelado → _calcular_pedido não toca no banco.
        estado["carrinho"] = [{
            "nome": "Portuguesa", "tamanho": "M", "qtd": 1,
            "preco_congelado": 45.0, "nome_congelado": "Portuguesa (M)",
        }]

        nlu = {"intencao": "conversa_fiada", "dados": {}}
        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="só a pizza mesmo"))

        # NÃO pode dead-end em responder_duvida; tem que avançar pra entrega/retirada.
        assert out["decisao"]["acao"] == "pedir_info"
        assert "entrega" in out["decisao"]["proxima_pergunta"].lower()


class TestRascunhoAoVivo:
    def test_sincroniza_itens_no_card_e_faz_broadcast(self):
        """O pedido em construção deve espelhar no rascunho (card "Novos") em tempo
        real, atualizando o MESMO pedido (sem criar duplicado) e avisando o painel."""
        from app.agent.fsm import engine

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.telefone = "5511999999999"
        ctx.cliente = MagicMock()
        ctx.cliente.id = "00000000-0000-0000-0000-0000000000c1"

        ped = MagicMock()
        ped.id = "00000000-0000-0000-0000-0000000000p1"
        ped.numero_pedido = 1
        ped.status = "novo"

        res = MagicMock()
        res.scalars.return_value.first.return_value = ped
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)

        estado = {"tipo": "delivery", "endereco": "Rua X, 10", "pagamento": "pix"}
        calc = {
            "itens": [{"nome": "Calabresa (M)", "preco_unit": 40.0, "quantidade": 1}],
            "valor_total": 45.0,
        }

        with patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()) as mock_pub:
            asyncio.run(engine._sincronizar_rascunho(db, ctx, estado, calc))

        assert ped.itens == calc["itens"]
        assert float(ped.valor_total) == 45.0
        assert ped.tipo == "delivery"
        assert ped.endereco_entrega == "Rua X, 10"
        assert ped.forma_pagamento == "pix"
        mock_pub.assert_awaited_once()


class TestVozTruncada:
    def test_detecta_respostas_cortadas(self):
        from app.agent.fsm.voice import _parece_truncado

        # Cortadas no meio (o bug real visto em produção).
        for ruim in ["Beleza! Mais", "Ok, só a", "", "   ", "Vou anotar a"]:
            assert _parece_truncado(ruim) is True, ruim

        # Completas (pontuação final ou emoji).
        for ok in [
            "Mais alguma coisa pra acompanhar? 😊",
            "Quer uma bebida?",
            "Vai ser entrega ou retirada?",
            "Perfeito!",
            "Te mandei o cardápio aí em cima 👆",
            "Anotado, portuguesa sem cebola.",
        ]:
            assert _parece_truncado(ok) is False, ok
