"""
Volume da bebida faz parte do produto.

Conversa real (29/09): "Quero uma pizza portuguesa e uma coca cola de 1l". A casa
só tem Coca Cola 2L; a NLU marcou a coca como não encontrada, mas o cálculo por
nome casou "coca" + "cola" com a Coca Cola 2L e cobrou R$ 12 — o cliente pediu
uma 1L e recebeu o total com a 2L. Volume diferente agora é "não encontrado", e o
fluxo de negativa oferece as bebidas que existem.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

PID = "00000000-0000-0000-0000-000000000001"


def _db(produtos: list[tuple]):
    vazio = MagicMock()
    vazio.first.return_value = None
    todos = MagicMock()
    todos.fetchall.return_value = produtos
    db = AsyncMock()
    # busca exata, busca parcial, varredura por palavra-chave
    db.execute = AsyncMock(side_effect=[vazio, vazio, todos])
    return db


def _preco(db, nome: str, tamanho: str | None = None):
    from app.agent.tools import _obter_preco_produto
    return asyncio.run(_obter_preco_produto(db, PID, nome, tamanho))


COCA_2L = ("Coca Cola 2L", 12.0, None, "", "Bebidas")


class TestVolume:
    def test_coca_1l_nao_vira_coca_2l(self):
        with pytest.raises(ValueError, match="nao encontrado"):
            _preco(_db([COCA_2L]), "coca cola de 1l")

    def test_mesmo_volume_escrito_de_outro_jeito_casa(self):
        assert _preco(_db([COCA_2L]), "coca cola 2 litros") == (12.0, "Coca Cola 2L")

    def test_sem_volume_segue_casando(self):
        assert _preco(_db([COCA_2L]), "coca cola") == (12.0, "Coca Cola 2L")

    def test_volumes_ml(self):
        from app.agent.tools import _volumes_ml
        assert _volumes_ml("Coca Cola 2L") == {2000}
        assert _volumes_ml("guaraná 1,5 litro") == {1500}
        assert _volumes_ml("coca lata 350ml") == {350}
        assert _volumes_ml("Pizza Calabresa") == set()
