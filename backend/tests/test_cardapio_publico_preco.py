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
