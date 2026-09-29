"""Qualidade do cardápio: o caso real da Fanta com descrição de Coca (Palazio)."""
from __future__ import annotations

from types import SimpleNamespace

from app.services.cardapio_qualidade import problemas_cardapio


def P(**kw):
    base = dict(descricao="", preco=10, disponivel=True, tamanhos=[], categoria="bebida")
    base.update(kw)
    return SimpleNamespace(**base)


def test_descricao_copiada_de_outro_produto():
    produtos = [
        P(nome="Coca Cola 2L", descricao="Uma Coca-Cola de 2 l", preco=12, disponivel=False),
        P(nome="Fanta 1L", descricao="Uma Coca-Cola de 2 l"),
    ]
    probs = problemas_cardapio(produtos)
    assert len(probs) == 1
    assert "'Fanta 1L' é igual à de 'Coca Cola 2L'" in probs[0]


def test_ingredientes_de_pizza_nao_sao_alarme():
    """Falso alarme visto na Palazio: 'Bacon' lista calabresa como ingrediente."""
    pizzas = [
        P(nome="Calabresa", categoria="pizza", descricao="Mussarela, calabresa e cebola"),
        P(nome="Bacon", categoria="pizza", descricao="Mussarela, bacon, calabresa e orégano"),
        P(nome="The Pizza", categoria="pizza", descricao="Calabresa, frango, bacon e catupiry"),
    ]
    assert problemas_cardapio(pizzas) == []


def test_bebida_descrita_com_nome_de_pizza():
    produtos = [
        P(nome="Pizza Calabresa", categoria="pizza", descricao="Mussarela e calabresa"),
        P(nome="Suco de Uva", descricao="Pizza calabresa grande com borda"),
    ]
    probs = problemas_cardapio(produtos)
    assert len(probs) == 1 and "'Suco de Uva' fala de 'Pizza Calabresa'" in probs[0]


def test_produto_sem_preco():
    produtos = [
        P(nome="Pizza Brasa", categoria="pizza", preco=0,
          tamanhos=[{"tamanho": "M", "preco": 49.9}, {"tamanho": "G", "preco": 0}]),
        P(nome="Suco", preco=0),
    ]
    probs = problemas_cardapio(produtos)
    assert any("'Pizza Brasa'" in p for p in probs)
    assert any("'Suco'" in p for p in probs)
