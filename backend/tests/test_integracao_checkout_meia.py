"""
Pedido de meio a meio pelo cardápio digital, gravado num Postgres REAL (roda no
CI; localmente só com PG_INTEGRACAO=1).

Os outros testes conferem o cálculo com objetos falsos. Aqui o pedido percorre a
rota de verdade (`criar_pedido_digital`) com produtos, tamanhos e regras no
banco, e o que se confere é o que ficou GRAVADO: sabores, tamanho, adicional,
quantidade, subtotal, taxa e total — e que o checkout recusa o que a tela não
deveria oferecer (meia com sabor que não aceita, forma de pagamento que a loja
não aceita, adicional que não existe).
"""
from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif(
    os.environ.get("PG_INTEGRACAO") != "1",
    reason="Sem PG_INTEGRACAO=1 — precisa de Postgres real com as migrations aplicadas",
)


def _request():
    r = MagicMock()
    r.headers = {}
    r.client.host = "127.0.0.1"
    return r


def _body(itens, **kw):
    from app.routes.cardapio_publico import PedidoDigitalIn
    base = dict(nome_cliente="Cliente Teste", telefone=f"98{uuid.uuid4().int % 10**9:09d}", tipo="delivery",
                endereco_rua="Rua das Flores", endereco_numero="120", endereco_bairro="Centro",
                forma_pagamento="pix", itens=itens)
    base.update(kw)
    return PedidoDigitalIn(**base)


def _item(prod, tamanho, qtd=1, outros=(), adicionais=()):
    from app.routes.cardapio_publico import ItemPedidoIn
    return ItemPedidoIn(produto_id=str(prod.id), nome=prod.nome, quantidade=qtd, tamanho=tamanho,
                        sabores_ids=[str(o.id) for o in outros], adicionais=list(adicionais))


async def _cenario():
    from sqlalchemy import select, text

    from app.db import AsyncSessionLocal, engine
    from app.models import Pedido, Pizzaria, Produto
    from app.routes.cardapio_publico import criar_pedido_digital

    slug = f"integracao-meia-{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        pizz = Pizzaria(
            nome="Pizzaria Integração Meia", slug=slug, bot_ativo_global=False, aberto_manual=True,
            formas_pagamento_aceitas=["pix", "dinheiro"], taxa_entrega_fixa=Decimal("6.90"),
            adicionais=[{"nome": "Queijo extra", "preco": 4}],
        )
        db.add(pizz)
        await db.flush()
        meia = {"meia_meia": {"permitido": True, "max_sabores": 2, "calculo": "maior_valor"}}
        brasa = Produto(pizzaria_id=pizz.id, categoria="pizza", nome="Pizza Brasa", preco=Decimal("49.90"),
                        regras=meia, tamanhos=[{"tamanho": "M", "preco": 49.9}, {"tamanho": "G", "preco": 64.9}])
        frango = Produto(pizzaria_id=pizz.id, categoria="pizza", nome="Pizza Frango", preco=Decimal("40.90"),
                         regras={}, tamanhos=[{"tamanho": "P", "preco": 40.9}, {"tamanho": "M", "preco": 53.9},
                                              {"tamanho": "G", "preco": 66.9}])
        so_inteira = Produto(pizzaria_id=pizz.id, categoria="pizza", nome="Pizza Especial", preco=Decimal("70"),
                             regras={"meia_meia": {"permitido": False}},
                             tamanhos=[{"tamanho": "G", "preco": 70}])
        db.add_all([brasa, frango, so_inteira])
        await db.commit()
        pid = pizz.id

    resultados: dict = {}
    try:
        with patch("app.routes.cardapio_publico._check_rate", new=AsyncMock()), \
             patch("app.routes.cardapio_publico._broadcast_novo_pedido", new=AsyncMock()), \
             patch("app.routes.cardapio_publico._enviar_confirmacao_whatsapp", new=AsyncMock()):
            # 2x meia Brasa/Frango G + queijo extra, e 1 Especial G inteira
            async with AsyncSessionLocal() as db:
                resp = await criar_pedido_digital(slug, _body([
                    _item(brasa, "G", qtd=2, outros=[frango], adicionais=["Queijo extra"]),
                    _item(so_inteira, "G"),
                ]), _request(), None, db)
            resultados["resp"] = resp
            async with AsyncSessionLocal() as db:
                resultados["pedido"] = (await db.execute(
                    select(Pedido).where(Pedido.pizzaria_id == pid))).scalars().first()

            async def _recusa(body):
                async with AsyncSessionLocal() as db:
                    try:
                        await criar_pedido_digital(slug, body, _request(), None, db)
                    except HTTPException as e:
                        return e.status_code, str(e.detail)
                return None

            resultados["meia_proibida"] = await _recusa(_body([_item(brasa, "G", outros=[so_inteira])]))
            resultados["tamanho_sem_comum"] = await _recusa(_body([_item(brasa, "P", outros=[frango])]))
            resultados["forma_nao_aceita"] = await _recusa(_body([_item(brasa, "G")], forma_pagamento="cartao"))
            resultados["adicional_fantasma"] = await _recusa(_body([_item(brasa, "G", adicionais=["Borda X"])]))
            async with AsyncSessionLocal() as db:
                resultados["n_pedidos"] = len((await db.execute(
                    select(Pedido.id).where(Pedido.pizzaria_id == pid))).all())
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(text("DELETE FROM public.pizzarias WHERE id = :id"), {"id": str(pid)})
            await db.commit()
        await engine.dispose()
    return resultados


def test_pedido_de_meia_pelo_cardapio_grava_certo_e_recusa_o_invalido():
    r = asyncio.run(_cenario())
    ped = r["pedido"]
    itens = ped.itens
    meia = itens[0]
    # Meia G = maior valor (Frango G 66,90) + Queijo extra 4,00 = 70,90; 2 unidades
    assert meia["sabores"] == ["Pizza Brasa", "Pizza Frango"]
    assert meia["tamanho"] == "G" and meia["quantidade"] == 2
    assert meia["adicionais"] == ["Queijo extra"]
    assert Decimal(str(meia["preco_unit"])) == Decimal("70.90")
    assert Decimal(str(itens[1]["preco_unit"])) == Decimal("70.00")
    # subtotal 2×70,90 + 70,00 = 211,80; + taxa 6,90 = 218,70
    assert ped.valor_subtotal == Decimal("211.80")
    assert ped.taxa_entrega == Decimal("6.90")
    assert ped.valor_total == Decimal("218.70")
    assert ped.status == "confirmado" and ped.origem == "cardapio_digital"
    # O que a tela não deveria permitir, o checkout recusa — e nada é gravado
    assert r["meia_proibida"][0] == 400 and "Não aceita meio a meio" in r["meia_proibida"][1]
    assert r["tamanho_sem_comum"][0] == 400
    assert r["forma_nao_aceita"][0] == 400
    assert r["adicional_fantasma"][0] == 400 and "Borda X" in r["adicional_fantasma"][1]
    assert r["n_pedidos"] == 1
