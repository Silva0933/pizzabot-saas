"""
Testes do Pix da fatura (checkout branded no painel).

`pix_da_fatura` valida a fatura da pizzaria e busca o QR no Asaas; retorna
{ok, qr_base64, copia_cola, ...} ou {ok: False} quando não há Pix.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


def _db_com_fatura(fat):
    db = MagicMock()
    res = MagicMock()
    res.scalar_one_or_none = MagicMock(return_value=fat)
    db.execute = AsyncMock(return_value=res)
    return db


def test_pix_da_fatura_ok():
    from app.services import billing_plataforma as bp

    fat = MagicMock(asaas_payment_id="pay_1", status="pendente", valor=97.0,
                    link_pagamento="https://asaas/i/123")
    client = MagicMock()
    client.pix_qr = AsyncMock(return_value={"encodedImage": "BASE64PNG", "payload": "00020126..."})
    with patch.object(bp, "PlatformAsaasClient", return_value=client):
        out = asyncio.run(bp.pix_da_fatura(_db_com_fatura(fat), uuid.uuid4(), uuid.uuid4()))
    assert out["ok"] is True
    assert out["qr_base64"] == "BASE64PNG"
    assert out["copia_cola"] == "00020126..."
    assert out["valor"] == 97.0
    assert out["link_pagamento"] == "https://asaas/i/123"


def test_pix_da_fatura_paga_retorna_false_sem_chamar_asaas():
    from app.services import billing_plataforma as bp

    fat = MagicMock(asaas_payment_id="pay_1", status="paga")
    # Se chamasse o Asaas, PlatformAsaasClient() exigiria a key e quebraria —
    # o early-return garante que nem instancia.
    out = asyncio.run(bp.pix_da_fatura(_db_com_fatura(fat), uuid.uuid4(), uuid.uuid4()))
    assert out == {"ok": False}


def test_pix_da_fatura_inexistente_false():
    from app.services import billing_plataforma as bp

    out = asyncio.run(bp.pix_da_fatura(_db_com_fatura(None), uuid.uuid4(), uuid.uuid4()))
    assert out == {"ok": False}


def test_pix_da_fatura_sem_qr_cai_para_false():
    from app.services import billing_plataforma as bp

    fat = MagicMock(asaas_payment_id="pay_1", status="pendente", valor=97.0, link_pagamento=None)
    client = MagicMock()
    client.pix_qr = AsyncMock(return_value={})  # Asaas não devolveu QR
    with patch.object(bp, "PlatformAsaasClient", return_value=client):
        out = asyncio.run(bp.pix_da_fatura(_db_com_fatura(fat), uuid.uuid4(), uuid.uuid4()))
    assert out == {"ok": False}
