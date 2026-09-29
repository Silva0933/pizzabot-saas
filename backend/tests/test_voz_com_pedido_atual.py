"""
A voz sabe o que já está no pedido e não atropela o comentário do cliente.

Conversa real (29/09), Coca Cola 2L já no carrinho, bot esperando o troco:
  cliente: "Qual o valor da coca cola"  → bot: "custa R$ 12,00. Quer incluir no pedido?"
  cliente: "Mas você já incluiu"        → bot: "Vai precisar de troco? Se sim, pra quanto? 💵"
"""
from __future__ import annotations

from app.agent.fsm.pipeline import contextualizar_voz

TROCO = "Vai precisar de troco? Se sim, pra quanto? 💵"


def _estado():
    return {"carrinho": [
        {"iid": "I1", "qtd": 1, "nome": "Portuguesa", "produto_id": "p1", "nome_congelado": "Portuguesa (G)"},
        {"iid": "I2", "qtd": 1, "nome": "coca", "produto_id": "p2", "nome_congelado": "Coca Cola 2L"},
    ]}


def test_duvida_sobre_item_do_pedido_recebe_o_pedido_nos_fatos():
    decisao = {"acao": "responder_duvida", "fatos": []}
    msg, fixa = contextualizar_voz(decisao, _estado(), intencao="duvida_geral",
                                   user_input="Qual o valor da coca cola", msg_pronta=None)
    assert msg is None and fixa is None
    fato = decisao["fatos"][-1]
    assert "1x Coca Cola 2L" in fato and "NUNCA ofereça incluir" in fato


def test_comentario_fora_da_pergunta_e_respondido_antes_do_troco():
    decisao = {"acao": "pedir_info", "mensagem_pronta": TROCO, "mensagem_pronta_acao": "pedir_info", "fatos": []}
    msg, fixa = contextualizar_voz(decisao, _estado(), intencao="conversa_fiada",
                                   user_input="Mas você já incluiu", msg_pronta=TROCO)
    assert msg is None          # a voz responde o comentário...
    assert fixa == TROCO        # ...e a pergunta do troco vem depois, intacta
    assert "NÃO faça pergunta" in decisao["proxima_pergunta"]
    assert any("Coca Cola 2L" in f for f in decisao["fatos"])


def test_resposta_a_pergunta_segue_com_a_mensagem_fixa():
    decisao = {"acao": "pedir_info", "mensagem_pronta": TROCO, "mensagem_pronta_acao": "pedir_info", "fatos": []}
    msg, fixa = contextualizar_voz(decisao, _estado(), intencao="informar_pagamento",
                                   user_input="dinheiro", msg_pronta=TROCO)
    assert msg == TROCO and fixa is None
    assert decisao["fatos"] == []


def test_resumo_nunca_vira_voz():
    resumo = "Fechando seu pedido 📝 ..."
    decisao = {"acao": "resumo_confirmar", "mensagem_pronta": resumo, "mensagem_pronta_acao": "resumo_confirmar"}
    msg, fixa = contextualizar_voz(decisao, _estado(), intencao="conversa_fiada",
                                   user_input="ok pode ser", msg_pronta=resumo)
    assert msg == resumo and fixa is None
