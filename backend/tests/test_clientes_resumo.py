"""
Números do cliente saem dos pedidos, não dos contadores do cadastro.

Teste real (29/09): o Paulo fez o pedido #2 pelo cardápio digital e a tela de
Clientes mostrava "0 pedidos · R$ 0,00" — o checkout não atualizava os contadores.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.routes.clientes import _pedido_conta, _resumo


def _ped(valor, status="confirmado", dias=0, itens=None, forma="dinheiro"):
    return SimpleNamespace(
        valor_total=valor, status=status, forma_pagamento=forma,
        created_at=datetime.now(UTC) - timedelta(days=dias), itens=itens or [],
    )


def test_resumo_ignora_cancelado_e_rascunho_vazio():
    pedidos = [
        _ped(55.0, itens=[{"nome": "Frango Catupiry (G)", "quantidade": 1}, {"nome": "Fanta 1L", "quantidade": 1}]),
        _ped(45.0, dias=3, itens=[{"nome": "Frango Catupiry (G)", "quantidade": 2}], forma="pix"),
        _ped(60.0, status="cancelado", itens=[{"nome": "Calabresa (G)", "quantidade": 1}]),
        _ped(0, status="novo"),  # rascunho do funil sem itens
    ]
    r = _resumo(pedidos)
    assert r["pedidos"] == 2
    assert r["total_gasto"] == 100.0
    assert r["ticket_medio"] == 50.0
    assert r["cancelados"] == 1
    assert r["favoritos"][0] == {"nome": "Frango Catupiry (G)", "quantidade": 3}
    assert all(f["nome"] != "Calabresa (G)" for f in r["favoritos"])


def test_sem_pedidos():
    r = _resumo([])
    assert r["pedidos"] == 0 and r["ticket_medio"] == 0.0 and r["pagamento_preferido"] is None


def test_pedido_conta():
    assert _pedido_conta(_ped(10))
    assert not _pedido_conta(_ped(10, status="cancelado"))
    assert not _pedido_conta(_ped(0, status="novo"))
