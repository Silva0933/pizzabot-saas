"""
Webhooks de pagamento (Mercado Pago + Asaas).

Recebem notificações, validam, atualizam o pedido e disparam mensagem
de "pagamento aprovado" pro cliente.
"""
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import Pedido, Pizzaria
from app.services.broadcaster import broadcaster
from app.services.pagamentos import (
    AsaasClient,
    MercadoPagoClient,
    asaas_status_para_interno,
    mp_status_para_interno,
)
from app.services.status_messages import enviar_mensagem_status

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])

_settings = get_settings()


async def _aplicar_pagamento(
    db: AsyncSession,
    pedido_id: uuid.UUID,
    *,
    payment_id: str,
    payment_status: str,
) -> Pedido | None:
    """Aplica o status do pagamento ao pedido + dispara confirmação se aprovado."""
    pedido = (
        await db.execute(select(Pedido).where(Pedido.id == pedido_id))
    ).scalar_one_or_none()
    if not pedido:
        log.warning("Webhook para pedido inexistente: %s", pedido_id)
        return None

    old_payment = pedido.payment_status
    pedido.payment_id = payment_id
    pedido.payment_status = payment_status

    # Se aprovou agora: avisa "Pagamento confirmado" e avança o status.
    if payment_status == "approved" and old_payment != "approved":
        if pedido.status == "novo":
            pedido.status = "confirmado"
        await db.flush()
        await enviar_mensagem_status(db, pedido, "pagamento_aprovado")

    await db.commit()
    await db.refresh(pedido)

    await broadcaster.publish(
        pedido.pizzaria_id,
        {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(pedido.pizzaria_id),
            "payload": {
                "pedido_id": str(pedido.id),
                "numero_pedido": pedido.numero_pedido,
                "payment_status": payment_status,
                "status": pedido.status,
            },
        },
    )
    return pedido


# ============================================
# Mercado Pago
# ============================================
@router.post("/mercadopago", status_code=status.HTTP_200_OK)
async def webhook_mp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
) -> dict:
    """
    Recebe notificação do Mercado Pago.

    Formato:
      { "action": "payment.updated", "data": { "id": "<payment_id>" }, ... }
    """
    body = await request.json()
    log.info("MP webhook: %s", body)

    data_id = (body.get("data") or {}).get("id")
    if not data_id:
        return {"ignored": "no_data_id"}

    # Validação opcional (se secret configurado)
    if x_signature and x_request_id and _settings.mp_webhook_secret:
        ok = MercadoPagoClient.validar_webhook(
            x_signature=x_signature,
            x_request_id=x_request_id,
            data_id=str(data_id),
            secret=_settings.mp_webhook_secret,
        )
        if not ok:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Assinatura MP inválida")

    # Para descobrir a pizzaria, precisamos consultar o pagamento (que tem external_reference)
    # Procuramos por payment_id em qualquer pedido — single tenant resolveria mais rápido,
    # mas multi-tenant precisa do external_reference.
    pedido = (
        await db.execute(select(Pedido).where(Pedido.payment_id == str(data_id)))
    ).scalar_one_or_none()

    if not pedido:
        # Primeira notificação — busca via external_reference
        # Tenta com o primeiro gateway disponível (não temos contexto ainda)
        # Solução: o external_reference É o pedido_id em nosso fluxo
        # Aqui apenas registramos e ignoramos
        log.info("MP webhook recebido mas pedido ainda não foi linkado (payment_id=%s)", data_id)
        return {"queued": True}

    pizzaria = (await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))).scalar_one()
    if not pizzaria.mp_access_token:
        return {"ignored": "no_mp_token"}

    mp = MercadoPagoClient(pizzaria.mp_access_token)
    try:
        payment_data = await mp.consultar_pagamento(str(data_id))
    except Exception as e:
        log.exception("Falha consultando MP: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "MP indisponível") from e

    novo_status = mp_status_para_interno(payment_data.get("status", "pending"))
    await _aplicar_pagamento(db, pedido.id, payment_id=str(data_id), payment_status=novo_status)
    return {"ok": True, "status": novo_status}


# ============================================
# Asaas
# ============================================
@router.post("/asaas", status_code=status.HTTP_200_OK)
async def webhook_asaas(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """
    Recebe notificação do Asaas.

    Formato:
      { "event": "PAYMENT_RECEIVED", "payment": { "id": "...", "externalReference": "...", "status": "RECEIVED" } }
    """
    body = await request.json()
    log.info("Asaas webhook: event=%s", body.get("event"))

    pagamento = body.get("payment") or {}
    payment_id = pagamento.get("id")
    external_ref = pagamento.get("externalReference")
    if not payment_id or not external_ref:
        return {"ignored": "missing_fields"}

    try:
        pedido_id = uuid.UUID(external_ref)
    except ValueError:
        return {"ignored": "invalid_external_reference"}

    novo_status = asaas_status_para_interno(pagamento.get("status", "PENDING"))
    await _aplicar_pagamento(db, pedido_id, payment_id=payment_id, payment_status=novo_status)
    return {"ok": True, "status": novo_status}
