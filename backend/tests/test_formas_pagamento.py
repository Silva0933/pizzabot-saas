"""
Formas de pagamento oferecidas e aceitas saem do cadastro da loja (auditoria de
01/10 com o agente real).

Com o pagamento online desligado, a pergunta era fixa — "dinheiro ou cartão na
retirada" — mesmo com a Fornalha aceitando Pix; e uma loja que não aceita cartão
ouviria cartão oferecido. A forma escolhida também não era conferida: qualquer
pix/cartão/dinheiro entrava no pedido.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.fsm import engine


def _pizz(formas):
    return SimpleNamespace(formas_pagamento_aceitas=formas, modo_pagamento_online="desativado")


class TestOpcoes:
    def test_oferece_o_pix_cadastrado(self):
        assert engine._opcoes_pagamento(_pizz(["pix", "cartao", "dinheiro"]), "desativado", "na retirada") == \
            "dinheiro, cartão ou Pix na retirada"

    def test_nao_oferece_o_que_a_loja_nao_aceita(self):
        assert engine._opcoes_pagamento(_pizz(["dinheiro", "pix"]), "desativado", "na entrega") == \
            "dinheiro ou Pix na entrega"

    def test_sem_cadastro_mantem_o_padrao(self):
        assert engine._opcoes_pagamento(_pizz([]), "desativado", "na entrega") == "dinheiro ou cartão na entrega"
        assert engine._formas_aceitas(_pizz(None)) is None

    def test_variantes_de_nome(self):
        assert engine._formas_aceitas(_pizz(["Cartão de Crédito", "PIX", "Dinheiro"])) == ["cartao", "pix", "dinheiro"]


def _ctx(formas):
    ctx = MagicMock()
    ctx.pizzaria = SimpleNamespace(
        id="pz-1", configuracoes={}, formas_pagamento_aceitas=formas, modo_pagamento_online="desativado",
        nome="Loja", taxa_entrega_fixa=None, taxas_bairro=[], adicionais=[],
    )
    ctx.simulation = True
    return ctx


def test_forma_nao_aceita_nao_entra_no_pedido():
    est = engine.estado_inicial()
    est.update({"apresentou": True, "tipo": "retirada", "upsell_feito": True})
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)):
        res = asyncio.run(engine.processar(
            MagicMock(), _ctx(["dinheiro", "pix"]), est,
            {"intencao": "informar_pagamento", "dados": {"forma_pagamento": "cartao"}}, user_input="cartão",
        ))
    assert res["estado"].get("pagamento") is None
    assert any("NÃO aceita cartão" in f and "dinheiro ou Pix" in f for f in res["decisao"]["fatos"])


def test_forma_aceita_entra():
    est = engine.estado_inicial()
    est.update({"apresentou": True, "tipo": "retirada", "upsell_feito": True})
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)):
        res = asyncio.run(engine.processar(
            MagicMock(), _ctx(["dinheiro", "pix"]), est,
            {"intencao": "informar_pagamento", "dados": {"forma_pagamento": "pix"}}, user_input="pix",
        ))
    assert res["estado"].get("pagamento") == "pix"
