"""Diagnóstico da atendente: pagamento online coerente com o modo escolhido.

Caso real (Palazio): modo Pix manual sem o copia-e-cola cadastrado — a atendente
tratava como pagamento na entrega e nunca pedia o comprovante, sem aviso à loja.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock


def _health(**campos):
    from app.routes.agente import agent_health

    pizz = SimpleNamespace(
        pipeline_fsm=True, instancia="x", whatsapp_estado="open", horario_funcionamento={"seg": 1},
        formas_pagamento_aceitas=["pix"], taxa_entrega_fixa=5, taxas_bairro=[], taxa_entrega_info=None,
        modo_pagamento_online="automatico", gateway_pagamento="asaas", asaas_api_key="k",
        mp_access_token=None, pix_manual_copia_cola=None,
    )
    for k, v in campos.items():
        setattr(pizz, k, v)

    def res(one=None, scalar=None, lista=()):
        r = MagicMock()
        r.scalar_one.return_value = one if one is not None else scalar
        r.scalar_one_or_none.return_value = None
        r.scalars.return_value.all.return_value = list(lista)
        return r

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[res(one=pizz), res(), res(scalar=3), res(lista=[])])
    out = asyncio.run(agent_health(uuid.uuid4(), db, None))
    return {c["key"]: c for c in out["checks"]}


def test_pix_manual_sem_codigo_e_erro():
    c = _health(modo_pagamento_online="manual")["pagamento_online"]
    assert c["status"] == "error" and "copia-e-cola não foi cadastrado" in c["message"]


def test_pix_manual_com_codigo_ok():
    c = _health(modo_pagamento_online="manual", pix_manual_copia_cola="000201PIX")["pagamento_online"]
    assert c["status"] == "ok" and "pede o comprovante" in c["message"]


def test_gateway_sem_chave_e_erro():
    c = _health(gateway_pagamento="mercadopago", mp_access_token=None)["pagamento_online"]
    assert c["status"] == "error" and "Mercado Pago" in c["label"]
