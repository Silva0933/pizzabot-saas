"""
Com a loja fechada, a IA só responde pergunta informativa (cardápio, horário,
endereço, taxa). A conferência era por substring: "calabresa" contém "abre", e
"tem calabresa?" fora do horário ia para a IA como se fosse "que horas abre?".
Achado ao testar o reconciliador (Bloco 2, 01/10).
"""
from __future__ import annotations

import pytest

from app.routes.webhook import _pode_responder_fora_horario_com_ia as pode


@pytest.mark.parametrize("texto", [
    "tem calabresa?", "quero uma calabresa grande", "manda uma pizza de frango", "oi",
])
def test_pedido_nao_vai_para_a_ia_com_a_loja_fechada(texto):
    assert pode(texto) is False


@pytest.mark.parametrize("texto", [
    "que horas abre?", "vocês abrem hoje?", "me manda o cardápio", "qual o horário?",
    "qual o endereço?", "quanto é a taxa?", "tá aberto?", "até que horas funciona?",
])
def test_pergunta_informativa_vai(texto):
    assert pode(texto) is True


def test_pedido_de_fechamento_nao_vai_mesmo_com_termo_informativo():
    assert pode("quero pedir, me manda o cardápio") is False
