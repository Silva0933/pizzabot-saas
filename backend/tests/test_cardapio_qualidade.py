"""Qualidade do cardápio: o caso real da Fanta com descrição de Coca (Palazio)."""
from __future__ import annotations

from types import SimpleNamespace as P

from app.services.cardapio_qualidade import problemas_cardapio


def test_descricao_copiada_de_outro_produto():
    produtos = [
        P(nome="Coca Cola 2L", descricao="Uma Coca-Cola de 2 l", preco=12, disponivel=False, tamanhos=[]),
        P(nome="Fanta 1L", descricao="Uma Coca-Cola de 2 l", preco=10, disponivel=True, tamanhos=[]),
    ]
    probs = problemas_cardapio(produtos)
    assert len(probs) == 1
    assert "'Fanta 1L' cita 'Coca Cola 2L'" in probs[0]


def test_produto_sem_preco():
    produtos = [
        P(nome="Pizza Brasa", descricao="", preco=0, disponivel=True,
          tamanhos=[{"tamanho": "M", "preco": 49.9}, {"tamanho": "G", "preco": 0}]),
        P(nome="Suco", descricao="", preco=0, disponivel=True, tamanhos=[]),
    ]
    probs = problemas_cardapio(produtos)
    assert any("'Pizza Brasa'" in p for p in probs)
    assert any("'Suco'" in p for p in probs)


def test_cardapio_limpo_e_nome_proprio_na_descricao():
    produtos = [
        P(nome="Pizza Calabresa", descricao="Calabresa artesanal, cebola roxa", preco=0, disponivel=True,
          tamanhos=[{"tamanho": "M", "preco": 46.9}]),
        P(nome="Coca-Cola 2L", descricao="Refrigerante gelado", preco=15.9, disponivel=True, tamanhos=[]),
    ]
    assert problemas_cardapio(produtos) == []
