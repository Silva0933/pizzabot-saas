"""
Regressões da bateria de testes do agente real (playground da Fornalha):

  - "troco pra 100" virava "troco para (valor a confirmar)";
  - sem arquivo de cardápio, a voz listava sabores que a casa não tem;
  - "tem cupom?" → cupom inventado ("10% na primeira compra");
  - pergunta de preço colocava a pizza no carrinho e não dizia o preço do tamanho.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class TestTrocoNoGuard:
    def test_valor_do_troco_nao_e_neutralizado(self):
        from app.agent.fsm.guard import neutralizar_precos
        out, removidos = neutralizar_precos("Anotei o troco para R$ 100,00!", validos=[59.9])
        assert "R$ 100,00" in out
        assert removidos == []

    def test_preco_inventado_continua_neutralizado(self):
        from app.agent.fsm.guard import neutralizar_precos
        out, removidos = neutralizar_precos("A pizza sai por R$ 10,00, troco para R$ 50,00.", validos=[59.9])
        assert 10.0 in removidos
        assert "R$ 50,00" in out


class TestLinkCardapio:
    def test_usa_origem_do_painel_do_cors(self):
        from app.config import Settings
        s = Settings(
            app_secret_key="x" * 40, database_url="postgresql+asyncpg://a:b@h/d",
            database_url_sync="postgresql://a:b@h/d",
            cors_origins="https://painel.exemplo.com,https://api.exemplo.com",
            public_base_url="https://api.exemplo.com",
        )
        assert s.url_cardapio("forno") == "https://painel.exemplo.com/m/forno"
        assert s.url_cardapio(None) == ""


class TestCardapioEmTexto:
    def test_lista_so_o_que_existe_por_categoria(self):
        from app.agent.fsm import engine
        ctx = MagicMock()
        ctx.pizzaria.id = "p"
        ctx.pizzaria.slug = "fornalha"
        res = MagicMock()
        res.fetchall.return_value = [
            ("Pizza Calabresa", "pizza", 46.9, 46.9),
            ("Coca-Cola 2L", "bebida", 15.9, None),
        ]
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        with patch("app.agent.fsm.engine._link_cardapio", return_value="https://x/m/fornalha"):
            texto = asyncio.run(engine._cardapio_em_texto(ctx, db))
        assert "*Pizzas*" in texto and "*Bebidas*" in texto
        assert "Pizza Calabresa — a partir de R$ 46,90" in texto
        assert "Coca-Cola 2L — R$ 15,90" in texto
        assert "https://x/m/fornalha" in texto
        assert "Pepperoni" not in texto

    def test_sem_produtos_devolve_none(self):
        from app.agent.fsm import engine
        ctx = MagicMock()
        res = MagicMock()
        res.fetchall.return_value = []
        db = MagicMock()
        db.execute = AsyncMock(return_value=res)
        assert asyncio.run(engine._cardapio_em_texto(ctx, db)) is None


class TestPromocoesReais:
    def test_sem_cupom_proibe_inventar(self):
        from app.agent.fsm.engine import _fatos_promocoes
        pizz = MagicMock()
        pizz.tema_cardapio = {}
        fato, valores = _fatos_promocoes(pizz)
        assert "NÃO há nenhum" in fato and "NUNCA invente" in fato
        assert valores == []

    def test_cupom_real_com_minimo(self):
        from app.agent.fsm.engine import _fatos_promocoes
        pizz = MagicMock()
        pizz.slug = None
        pizz.tema_cardapio = {"cupons": [
            {"codigo": "brasa15", "tipo": "percentual", "valor": 15, "pedido_minimo": 30, "ativo": True},
            {"codigo": "VELHO", "tipo": "percentual", "valor": 50, "ativo": True, "validade": "2000-01-01"},
            {"codigo": "OFF", "tipo": "percentual", "valor": 90, "ativo": False},
        ]}
        fato, valores = _fatos_promocoes(pizz)
        assert "BRASA15" in fato and "15% OFF" in fato and "R$ 30,00" in fato
        assert "VELHO" not in fato and "OFF (" not in fato.replace("15% OFF", "")
        assert 30.0 in valores


class TestDuvidaNaoEntraNoCarrinho:
    def test_pergunta_de_preco_nao_adiciona_item(self):
        from app.agent.fsm import engine
        ctx = MagicMock()
        ctx.pizzaria.id = "p"
        ctx.pizzaria.nome = "Fornalha"
        ctx.pizzaria.taxas_bairro = None
        ctx.pizzaria.taxa_entrega_fixa = None
        ctx.pizzaria.tema_cardapio = {}
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "duvida_geral", "dados": {"produtos": [{"nome": "Pizza Frango", "tamanho": "G", "qtd": 1}]}}
        busca = AsyncMock(return_value={"items": [{
            "nome": "Pizza Frango", "preco": 40.9,
            "tamanhos": [{"tamanho": "M", "preco": 53.9}, {"tamanho": "G", "preco": 66.9}],
        }]})
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools.buscar_cardapio", new=busca):
            out = asyncio.run(engine.processar(MagicMock(), ctx, estado, nlu,
                                               user_input="quanto é a pizza de frango grande?"))
        assert out["estado"]["carrinho"] == []
        assert out["decisao"]["acao"] == "responder_duvida"
        fatos = " ".join(out["decisao"]["fatos"])
        assert "G R$ 66,90" in fatos
        assert 66.9 in out["decisao"]["precos_validos"]


def _ctx_basico():
    ctx = MagicMock()
    ctx.pizzaria.id = "p"
    ctx.pizzaria.nome = "Fornalha"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxas_bairro = None
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.tema_cardapio = {}
    ctx.ultimo_pedido_resumo = None
    return ctx


class TestBateria2:
    def test_duas_meias_diferentes_nao_viram_uma(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        engine._aplicar_nlu(estado, {"produtos": [
            {"nome": "pizza", "qtd": 1, "tamanho": "G", "sabores_meia": ["calabresa", "brasa"]},
            {"nome": "pizza", "qtd": 1, "tamanho": "M", "sabores_meia": ["margherita", "portuguesa"]},
        ]})
        assert len(estado["carrinho"]) == 2
        assert {it["tamanho"] for it in estado["carrinho"]} == {"G", "M"}

    def test_mesma_meia_repetida_continua_sendo_esclarecimento(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        engine._aplicar_nlu(estado, {"produtos": [{"nome": "pizza", "qtd": 1, "sabores_meia": ["calabresa", "brasa"]}]})
        engine._aplicar_nlu(estado, {"produtos": [{"nome": "pizza", "qtd": 1, "tamanho": "G", "sabores_meia": ["brasa", "calabresa"]}]})
        assert len(estado["carrinho"]) == 1
        assert estado["carrinho"][0]["tamanho"] == "G"

    def test_de_sempre_sem_historico_nao_vira_produto(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "o de sempre", "qtd": 1}]}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="quero o de sempre"))
        assert out["estado"]["carrinho"] == []
        assert "não há pedidos anteriores" in " ".join(out["decisao"]["fatos"])

    def test_pedido_grande_vai_para_a_equipe(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "Pizza Calabresa", "qtd": 60, "tamanho": "G"}]}}
        escalar = AsyncMock(return_value={"ok": True})
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools.escalar_humano", new=escalar):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="60 calabresas G"))
        escalar.assert_awaited_once()
        assert out["decisao"]["acao"] == "escalado"
        assert out["estado"]["carrinho"][0]["qtd"] == 60

    def test_bate_papo_fora_do_tema_nao_e_respondido(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "conversa_fiada", "dados": {}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools.buscar_cardapio", new=AsyncMock(return_value={"items": []})):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="qual a capital da França?"))
        assert "NÃO responda o conteúdo" in out["decisao"]["proxima_pergunta"]


class TestReasoningNoProvedor:
    def _payload(self, provider, reasoning):
        from unittest.mock import patch as _p
        from app.agent import providers
        capturado = {}

        class _Resp:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": "ok"}}], "usage": {}}

        async def _post(self, url, headers=None, json=None):
            capturado.update(json)
            return _Resp()

        with _p("httpx.AsyncClient.post", new=_post):
            asyncio.run(providers.openai_chat(
                provider=provider, api_key="k", model="m",
                messages=[{"role": "user", "content": "oi"}], reasoning=reasoning,
            ))
        return capturado

    def test_openrouter_usa_objeto_reasoning(self):
        assert self._payload("openrouter", "low")["reasoning"] == {"effort": "low"}
        assert self._payload("openrouter", "none")["reasoning"] == {"enabled": False}

    def test_openai_usa_reasoning_effort(self):
        p = self._payload("openai", "low")
        assert p["reasoning_effort"] == "low" and "reasoning" not in p

    def test_sem_config_nao_manda_nada(self):
        p = self._payload("openrouter", None)
        assert "reasoning" not in p and "reasoning_effort" not in p


def test_normalizar_reasoning():
    from app.services.app_config import normalizar_reasoning
    assert normalizar_reasoning("LOW") == "low"
    assert normalizar_reasoning("turbo") == ""
    assert normalizar_reasoning(None) == ""


class TestBateria3:
    def test_termo_generico_nao_e_produto(self):
        from app.agent.tools import eh_termo_generico
        assert eh_termo_generico("pizzas") and eh_termo_generico("Refrigerante")
        assert not eh_termo_generico("Pizza Calabresa")

    def test_produto_sem_tamanho_nao_ganha_tamanho_no_nome(self):
        from app.agent.tools import _calcular_pedido
        ctx = MagicMock()
        ctx.pizzaria.id = "p"
        ctx.pizzaria.adicionais = []
        with patch("app.agent.tools._obter_preco_produto", new=AsyncMock(return_value=(15.9, "Coca-Cola 2L"))):
            r = asyncio.run(_calcular_pedido(ctx, MagicMock(), itens=[{"nome": "coca", "tamanho": "2l", "qtd": 1}],
                                             tipo="retirada", forma_pagamento="dinheiro"))
        assert r["itens"][0]["nome"] == "Coca-Cola 2L"

    def test_meia_pede_categoria_pizza_e_nome_limpo(self):
        from app.agent.tools import _calcular_pedido
        ctx = MagicMock()
        ctx.pizzaria.id = "p"
        ctx.pizzaria.adicionais = []
        busca = AsyncMock(side_effect=[(59.9, "Pizza Calabresa (Grande)"), (64.9, "Pizza Brasa (Grande)")])
        with patch("app.agent.tools._obter_preco_produto", new=busca), \
             patch("app.agent.tools._obter_regras_produto", new=AsyncMock(return_value={})):
            r = asyncio.run(_calcular_pedido(ctx, MagicMock(), itens=[{"sabores": ["calabresa", "brasa"], "tamanho": "grande", "qtd": 1}],
                                             tipo="retirada", forma_pagamento="dinheiro"))
        assert all(c.kwargs.get("categoria") == "pizza" for c in busca.await_args_list)
        assert r["itens"][0]["nome"] == "Pizza Meia Calabresa / Meia Brasa (Grande)"
        assert r["itens"][0]["preco_unit"] == 64.9

    def test_duas_pizzas_grandes_pergunta_sabor_e_herda_qtd_tamanho(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "pizzas", "qtd": 2, "tamanho": "grande"}]}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.fsm.engine._nomes_da_categoria", new=AsyncMock(return_value=["Pizza Calabresa", "Pizza Brasa"])):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="quero 2 pizzas grandes"))
        assert out["estado"]["carrinho"] == []
        assert out["estado"]["aguardando_sabores"] == {"qtd": 2, "tamanho": "grande"}
        assert "Pizza Calabresa" in " ".join(out["decisao"]["fatos"])

        estado2 = out["estado"]
        nlu2 = {"intencao": "adicionar_item", "dados": {"produtos": [
            {"nome": "calabresa", "qtd": 1}, {"nome": "frango", "qtd": 1}]}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value={"ok": False, "erro": "x"})):
            out2 = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado2, nlu2, user_input="calabresa e frango"))
        cart = out2["estado"]["carrinho"]
        assert len(cart) == 2 and all(it["tamanho"] == "grande" and it["qtd"] == 1 for it in cart)
        assert "aguardando_sabores" not in out2["estado"]


class TestTaxaAoMudarEndereco:
    def _pizz(self, fixa=None):
        pizz = MagicMock()
        pizz.taxas_bairro = [{"bairro": "Cidade Operária", "taxa": 6.9}, {"bairro": "Cohatrac", "taxa": 10}]
        pizz.taxa_entrega_fixa = fixa
        return pizz

    def test_outro_bairro_ajusta_a_diferenca(self):
        from app.agent.tools import _ajuste_taxa_endereco
        ped = MagicMock()
        ped.taxa_entrega = 0
        ped.endereco_entrega = "Rua A, 10, Cidade Operaria"
        r = _ajuste_taxa_endereco(self._pizz(), ped, "Rua B, 5, Cohatrac")
        assert r["antes"] == 6.9 and r["depois"] == 10.0 and r["diferenca"] == 3.1

    def test_mesmo_bairro_sem_diferenca(self):
        from app.agent.tools import _ajuste_taxa_endereco
        ped = MagicMock()
        ped.taxa_entrega = 0
        ped.endereco_entrega = "Rua A, 10, Cidade Operária"
        assert _ajuste_taxa_endereco(self._pizz(), ped, "Rua B, 20, Cidade Operária")["diferenca"] == 0

    def test_bairro_desconhecido_sem_fixa_fica_a_confirmar(self):
        from app.agent.tools import _ajuste_taxa_endereco
        ped = MagicMock()
        ped.taxa_entrega = 6.9
        ped.endereco_entrega = "Rua A, Cidade Operária"
        assert _ajuste_taxa_endereco(self._pizz(), ped, "Rua X, Renascença") == {"a_confirmar": True}


class TestBateria4:
    def test_meia_de_um_sabor_vira_pizza_inteira(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        engine._aplicar_nlu(estado, {"produtos": [
            {"nome": "pizza", "qtd": 1, "tamanho": "G", "sabores_meia": ["calabresa"]},
            {"nome": "pizza", "qtd": 1, "tamanho": "G", "sabores_meia": ["frango"]},
        ]})
        assert [(it["nome"], it["sabores"]) for it in estado["carrinho"]] == [("calabresa", []), ("frango", [])]


class TestBateria5:
    def _cmd(self, acao, precos):
        from app.agent.fsm.voice import montar_comando
        pers = MagicMock()
        pers.nome = "Camila"
        with patch("app.agent.behavior.get_behavior") as gb:
            gb.return_value.comunicacao.tamanho_resposta = "curta"
            gb.return_value.comunicacao.uma_pergunta_por_vez = True
            gb.return_value.comunicacao.max_baloes = 2
            return montar_comando(personalidade=pers, pizzaria_nome="Fornalha",
                                  decisao={"acao": acao, "precos_validos": precos, "fatos": []},
                                  ja_apresentou=True, user_input="quanto é?")

    def test_duvida_com_preco_pode_citar_valor(self):
        cmd = self._cmd("responder_duvida", [54.9])
        assert "EXATAMENTE como aparece nos FATOS" in cmd
        assert "NUNCA cite preço" not in cmd

    def test_fora_de_duvida_continua_proibido(self):
        assert "NUNCA cite preço" in self._cmd("upsell", [59.9])
        assert "NUNCA cite preço" in self._cmd("responder_duvida", [])

    def test_sabores_apos_generico_viram_pizzas_inteiras(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado.update({"apresentou": True, "aguardando_sabores": {"qtd": 2, "tamanho": "grande"}})
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [
            {"nome": "pizza", "qtd": 2, "tamanho": "grande", "sabores_meia": ["calabresa", "frango"]}]}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value={"ok": False, "erro": "x"})):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="calabresa e frango"))
        cart = out["estado"]["carrinho"]
        assert sorted(it["nome"] for it in cart) == ["calabresa", "frango"]
        assert all(it["qtd"] == 1 and not it["sabores"] for it in cart)

    def test_meia_explicita_continua_meia(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado.update({"apresentou": True, "aguardando_sabores": {"qtd": 2, "tamanho": "grande"}})
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [
            {"nome": "pizza", "qtd": 2, "tamanho": "grande", "sabores_meia": ["calabresa", "frango"]}]}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value={"ok": False, "erro": "x"})):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu,
                                               user_input="as duas meia calabresa meia frango"))
        assert out["estado"]["carrinho"][0]["sabores"] == ["calabresa", "frango"]

    def test_duvida_nao_vira_observacao(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "duvida_geral", "dados": {"observacoes": "perguntou o preço"}}
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
             patch("app.agent.tools.buscar_cardapio", new=AsyncMock(return_value={"items": []})):
            out = asyncio.run(engine.processar(MagicMock(), _ctx_basico(), estado, nlu, user_input="quanto é?"))
        assert not out["estado"].get("observacoes")
