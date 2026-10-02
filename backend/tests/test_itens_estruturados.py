"""
Pedido do WhatsApp grava a mesma estrutura do pedido do cardápio (auditoria de
01/10).

Antes o item salvo pelo agente tinha só nome/quantidade/preço. O "pedir de novo"
do cardápio reconstrói pelo produto_id + tamanho (+ sabores_ids, adicionais): a
pizza sem tamanho falhava no cálculo e a meia ("Pizza Meia Brasa / Meia ...")
nem casava com produto — tudo aparecia como "indisponível".
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.fsm.catalogo import montar_catalogo
from app.agent.tools import _calcular_pedido, _estrutura_item


def _prod(pid, nome, tamanhos, meia=None):
    return SimpleNamespace(
        id=pid, nome=nome, categoria="pizza", preco=Decimal("40"), disponivel=True, ordem=0,
        tamanhos=[{"tamanho": t, "preco": p} for t, p in tamanhos],
        opcoes={"adicionais": []}, regras={"meia_meia": meia} if meia else {}, aliases=[], descricao="",
    )


CAT = montar_catalogo("pz", [
    _prod("brasa", "Pizza Brasa", [("M", 49.9), ("G", 64.9)], {"permitido": True}),
    _prod("calab", "Pizza Calabresa", [("M", 46.9), ("G", 59.9)]),
], [{"nome": "Queijo extra", "preco": 4}])


def _calc(itens):
    ctx = MagicMock()
    ctx.pizzaria = SimpleNamespace(id="pz", taxa_entrega_fixa=None, taxas_bairro=[], adicionais=[])
    with patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=CAT)):
        return asyncio.run(_calcular_pedido(ctx, MagicMock(), itens=itens, tipo="retirada",
                                            forma_pagamento="dinheiro"))


def test_meia_com_adicional_sai_estruturada():
    r = _calc([{"iid": "I1", "nome": "pizza", "sabores": ["Pizza Brasa", "Pizza Calabresa"],
                "sabores_ids": ["brasa", "calab"], "tamanho": "grande", "qtd": 1, "adicionais": ["queijo extra"]}])
    it = r["itens"][0]
    assert it["produto_id"] == "brasa" and it["sabores_ids"] == ["brasa", "calab"]
    assert it["tamanho"] == "G"                      # canônico, não "grande"
    assert it["adicionais"] == ["Queijo extra"]      # nome exato do cadastro
    assert it["preco_unit"] == 68.9                  # 64,90 + 4,00
    # O "pedir de novo" reconstrói exatamente o mesmo item a partir disso
    pi = CAT.precificar([it["produto_id"], *[s for s in it["sabores_ids"] if s != it["produto_id"]]],
                        it["tamanho"], it["adicionais"])
    assert pi.preco_unit == Decimal("68.90")


def test_item_congelado_tambem_leva_a_estrutura():
    r = _calc([{"iid": "I1", "nome": "Pizza Brasa", "produto_id": "brasa", "tamanho": "M", "qtd": 2,
                "preco_congelado": 49.9, "nome_congelado": "Pizza Brasa (M)"}])
    it = r["itens"][0]
    assert it["produto_id"] == "brasa" and it["tamanho"] == "M" and "sabores_ids" not in it


def test_item_sem_id_nao_ganha_estrutura():
    assert _estrutura_item({"nome": "coca de 1l", "qtd": 1}) == {}


def test_tamanho_por_sinonimo_e_nao_pela_inicial():
    """"gigante" casava com G pela inicial (preço do G para quem pediu GG) e
    "família"/"broto" não casavam com nada (auditoria de 01/10)."""
    from app.agent.fsm.catalogo import ProdutoCat
    pal = ProdutoCat(id="1", codigo="P1", nome="The Pizza", categoria="pizza", preco=Decimal("30"),
                     tamanhos=[("P", Decimal("27.9")), ("M", Decimal("31.9")), ("G", Decimal("42")),
                               ("GG", Decimal("50"))])
    assert pal.tamanho("gigante")[0] == "GG"
    assert pal.tamanho("família")[0] == "GG"
    assert pal.tamanho("broto")[0] == "P"
    assert pal.tamanho("grande")[0] == "G"
    sem_gg = ProdutoCat(id="2", codigo="P2", nome="Brasa", categoria="pizza", preco=Decimal("49.9"),
                        tamanhos=[("M", Decimal("49.9")), ("G", Decimal("64.9"))])
    assert sem_gg.tamanho("gigante") is None        # a loja não tem: a atendente pergunta
    nomes = ProdutoCat(id="3", codigo="P3", nome="X", categoria="pizza", preco=Decimal("1"),
                       tamanhos=[("Broto", Decimal("20")), ("Média", Decimal("30")), ("Família", Decimal("45"))])
    assert nomes.tamanho("P")[0] == "Broto" and nomes.tamanho("gg")[0] == "Família"
