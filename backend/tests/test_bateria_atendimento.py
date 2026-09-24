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
