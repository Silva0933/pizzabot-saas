"""
Regressão de segurança do checkout do cardápio digital público.

Trava o anti-adulteração de preço: o servidor SEMPRE recalcula o valor a partir
do cadastro (Produto + tamanho + adicionais) e IGNORA o preço enviado pelo
cliente. Antes, o `preco_unit` do payload era usado direto — um cliente podia
mandar preco_unit=0,01 e fechar o pedido por qualquer valor.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import pytest
from fastapi import HTTPException

from app.routes.cardapio_publico import ItemPedidoIn, _calcular_desconto, _recalcular_itens


@dataclass
class FakeProduto:
    id: str
    nome: str
    preco: float
    disponivel: bool = True
    tamanhos: list[dict[str, Any]] | None = field(default=None)
    opcoes: dict[str, Any] | None = field(default=None)


def _map(*prods: FakeProduto) -> dict[str, FakeProduto]:
    return {p.id: p for p in prods}


class TestPrecoNaoConfiaNoCliente:
    def test_ignora_preco_do_cliente_e_usa_o_cadastro(self):
        prod = FakeProduto(id="p1", nome="Pizza Calabresa", preco=49.90)
        itens = [ItemPedidoIn(produto_id="p1", nome="qualquer", quantidade=2, preco_unit=0.01)]
        itens_json, subtotal = _recalcular_itens(itens, _map(prod), {})
        # Ignora os R$0,01 enviados; usa 49,90 do cadastro × 2.
        assert subtotal == Decimal("99.80")
        assert itens_json[0]["preco_unit"] == 49.90
        assert itens_json[0]["nome"] == "Pizza Calabresa"

    def test_usa_preco_do_tamanho_escolhido(self):
        prod = FakeProduto(
            id="p1", nome="Pizza", preco=0,
            tamanhos=[{"tamanho": "G", "preco": 60}, {"tamanho": "P", "preco": 40}],
        )
        itens = [ItemPedidoIn(produto_id="p1", nome="Pizza", quantidade=1, tamanho="G", preco_unit=5)]
        itens_json, subtotal = _recalcular_itens(itens, _map(prod), {})
        assert subtotal == Decimal("60")
        assert itens_json[0]["tamanho"] == "G"

    def test_soma_apenas_adicionais_cadastrados(self):
        prod = FakeProduto(id="p1", nome="Pizza", preco=50)
        adicionais = {"borda catupiry": Decimal("8")}
        itens = [ItemPedidoIn(
            produto_id="p1", nome="Pizza", quantidade=1, preco_unit=0,
            adicionais=["Borda Catupiry", "Adicional Fantasma"],
        )]
        itens_json, subtotal = _recalcular_itens(itens, _map(prod), adicionais)
        assert subtotal == Decimal("58")  # 50 + 8; o "fantasma" é descartado
        assert itens_json[0]["adicionais"] == ["Borda Catupiry"]

    def test_adicionais_especificos_do_produto_opcoes(self):
        prod = FakeProduto(
            id="p1", nome="Pizza Especial", preco=60,
            opcoes={"adicionais": [{"nome": "Borda Cheddar", "preco": 12, "tipo": "borda"}]}
        )
        itens = [ItemPedidoIn(
            produto_id="p1", nome="Pizza Especial", quantidade=1, preco_unit=0,
            adicionais=["Borda Cheddar"],
        )]
        # Sem adicionais globais no terceiro argumento, deve buscar do prod.opcoes
        itens_json, subtotal = _recalcular_itens(itens, _map(prod), {})
        assert subtotal == Decimal("72")
        assert itens_json[0]["adicionais"] == ["Borda Cheddar"]

    def test_rejeita_produto_inexistente(self):
        itens = [ItemPedidoIn(produto_id="nao-existe", nome="x", quantidade=1, preco_unit=0)]
        with pytest.raises(HTTPException) as exc:
            _recalcular_itens(itens, {}, {})
        assert exc.value.status_code == 400

    def test_rejeita_produto_indisponivel(self):
        prod = FakeProduto(id="p1", nome="Pizza", preco=50, disponivel=False)
        itens = [ItemPedidoIn(produto_id="p1", nome="Pizza", quantidade=1, preco_unit=0)]
        with pytest.raises(HTTPException) as exc:
            _recalcular_itens(itens, _map(prod), {})
        assert exc.value.status_code == 400

    def test_rejeita_tamanho_invalido(self):
        prod = FakeProduto(id="p1", nome="Pizza", preco=0, tamanhos=[{"tamanho": "G", "preco": 60}])
        itens = [ItemPedidoIn(produto_id="p1", nome="Pizza", quantidade=1, tamanho="XGG", preco_unit=0)]
        with pytest.raises(HTTPException) as exc:
            _recalcular_itens(itens, _map(prod), {})
        assert exc.value.status_code == 400


class TestCupomSeguro:
    def test_percentual_e_normalizacao_do_codigo(self):
        tema = {"cupons": [{
            "codigo": "BRASA15", "tipo": "percentual", "valor": 15,
            "pedido_minimo": 30, "ativo": True,
        }]}
        desconto, codigo = _calcular_desconto(tema, " brasa15 ", Decimal("100"))
        assert desconto == Decimal("15.00")
        assert codigo == "BRASA15"

    def test_valor_fixo_nunca_ultrapassa_subtotal(self):
        tema = {"cupons": [{
            "codigo": "MENOS50", "tipo": "fixo", "valor": 50,
            "pedido_minimo": 0, "ativo": True,
        }]}
        desconto, _ = _calcular_desconto(tema, "MENOS50", Decimal("32"))
        assert desconto == Decimal("32.00")

    def test_rejeita_pedido_abaixo_do_minimo(self):
        tema = {"cupons": [{
            "codigo": "MINIMO", "tipo": "percentual", "valor": 10,
            "pedido_minimo": 80, "ativo": True,
        }]}
        with pytest.raises(HTTPException) as exc:
            _calcular_desconto(tema, "MINIMO", Decimal("79.99"))
        assert exc.value.status_code == 400

    def test_rejeita_expirado_e_inativo(self):
        expirado = {"cupons": [{
            "codigo": "VELHO", "tipo": "percentual", "valor": 10,
            "validade": "2000-01-01", "ativo": True,
        }]}
        with pytest.raises(HTTPException):
            _calcular_desconto(expirado, "VELHO", Decimal("100"))

        inativo = {"cupons": [{
            "codigo": "OFF", "tipo": "percentual", "valor": 10, "ativo": False,
        }]}
        with pytest.raises(HTTPException):
            _calcular_desconto(inativo, "OFF", Decimal("100"))


# ============================================================
# Meio a meio no cardápio digital (mesmas regras do agente do WhatsApp)
# ============================================================
@dataclass
class FakePizza:
    id: str
    nome: str
    preco: float
    tamanhos: list[dict[str, Any]] | None = None
    categoria: str = "pizza"
    disponivel: bool = True
    opcoes: dict[str, Any] | None = None
    regras: dict[str, Any] | None = None


def _pizzas():
    calabresa = FakePizza("c", "Pizza Calabresa", 46.9, [{"tamanho": "M", "preco": 46.9}, {"tamanho": "G", "preco": 59.9}])
    frango = FakePizza("f", "Pizza Frango", 40.9, [{"tamanho": "M", "preco": 53.9}, {"tamanho": "G", "preco": 66.9}])
    return calabresa, frango


class TestMeioAMeio:
    def test_cobra_o_maior_valor_por_padrao(self):
        calabresa, frango = _pizzas()
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f"], nome="meia", quantidade=1, tamanho="G", preco_unit=1)]
        itens_json, subtotal = _recalcular_itens(itens, _map(calabresa, frango), {})
        assert subtotal == Decimal("66.9")
        assert itens_json[0]["nome"] == "Meia Pizza Calabresa / Meia Pizza Frango (G)"
        assert itens_json[0]["sabores"] == ["Pizza Calabresa", "Pizza Frango"]

    def test_cobra_a_media_quando_configurado(self):
        calabresa, frango = _pizzas()
        calabresa.regras = {"meia_meia": {"calculo": "media"}}
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f"], nome="meia", quantidade=1, tamanho="G")]
        _, subtotal = _recalcular_itens(itens, _map(calabresa, frango), {})
        assert subtotal == Decimal("63.40")  # (59,90 + 66,90) / 2

    def test_sabor_que_nao_aceita_meia_e_recusado(self):
        calabresa, frango = _pizzas()
        frango.regras = {"meia_meia": {"permitido": False}}
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f"], nome="meia", quantidade=1, tamanho="G")]
        with pytest.raises(HTTPException):
            _recalcular_itens(itens, _map(calabresa, frango), {})

    def test_limite_de_sabores(self):
        calabresa, frango = _pizzas()
        port = FakePizza("p", "Pizza Portuguesa", 40.9, [{"tamanho": "G", "preco": 66.9}])
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f", "p"], nome="3", quantidade=1, tamanho="G")]
        with pytest.raises(HTTPException):
            _recalcular_itens(itens, _map(calabresa, frango, port), {})

    def test_tamanho_precisa_existir_em_todos(self):
        calabresa, frango = _pizzas()
        frango.tamanhos = [{"tamanho": "G", "preco": 66.9}]  # sem M
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f"], nome="meia", quantidade=1, tamanho="M")]
        with pytest.raises(HTTPException):
            _recalcular_itens(itens, _map(calabresa, frango), {})

    def test_categorias_diferentes_sao_recusadas(self):
        calabresa, _ = _pizzas()
        brownie = FakePizza("b", "Brownie", 16.9, None, categoria="sobremesa")
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["b"], nome="x", quantidade=1, tamanho="G")]
        with pytest.raises(HTTPException):
            _recalcular_itens(itens, _map(calabresa, brownie), {})

    def test_sabor_indisponivel_e_recusado(self):
        calabresa, frango = _pizzas()
        frango.disponivel = False
        itens = [ItemPedidoIn(produto_id="c", sabores_ids=["f"], nome="meia", quantidade=1, tamanho="G")]
        with pytest.raises(HTTPException):
            _recalcular_itens(itens, _map(calabresa, frango), {})


def test_bairro_casa_sem_acento_e_caixa():
    from app.routes.cardapio_publico import _normalizar_bairro
    assert _normalizar_bairro("Cidade Operária ") == _normalizar_bairro("cidade  operaria")


def test_adicional_de_outro_produto_nao_aparece_para_quem_nao_tem_proprios():
    """Hambúrguer sem adicionais próprios não pode oferecer a borda da pizza:
    a tela mostrava, somava no preço, e o checkout descartava o adicional."""
    from app.routes.cardapio_publico import _adicionais_globais

    globais = [{"nome": "Bacon", "preco": 5}, "lixo", {"nome": "  "}]
    exibidos = _adicionais_globais(globais)
    assert [a["nome"] for a in exibidos] == ["Bacon"]

    burger = FakeProduto(id="b1", nome="X-Burger", preco=30)
    pizza = FakeProduto(
        id="p1", nome="Pizza", preco=50,
        opcoes={"adicionais": [{"nome": "Borda Catupiry", "preco": 10}]},
    )
    # Tudo que a tela oferece ao hambúrguer o checkout aceita e cobra.
    itens = [ItemPedidoIn(produto_id="b1", nome="X-Burger", quantidade=1, adicionais=["Bacon"])]
    itens_json, subtotal = _recalcular_itens(itens, _map(burger, pizza), {"bacon": Decimal("5")})
    assert subtotal == Decimal("35")
    assert itens_json[0]["adicionais"] == ["Bacon"]
