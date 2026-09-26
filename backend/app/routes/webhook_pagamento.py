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
from app.services.secrets import decrypt_secret
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
    if payment_status == "approved" and old_payment != "approved" and pedido.status == "cancelado":
        # Pagou um pedido já cancelado (ex.: Pix pago depois do cancelamento). A
        # mensagem padrão diria "enviado pro preparo" — mentira. Não avisa o
        # cliente e alerta a loja: o dinheiro entrou e precisa de estorno/contato.
        from app.services.alertas import registrar_alerta
        await registrar_alerta(
            db, tipo="pagamento_pedido_cancelado", nivel="error",
            pizzaria_id=pedido.pizzaria_id,
            detalhe=(
                f"Pagamento {payment_id} aprovado para o pedido #{pedido.numero_pedido}, "
                "que está cancelado. Verifique estorno ou reabertura com o cliente."
            ),
        )
    elif payment_status == "approved" and old_payment != "approved":
        # Pedido esperando a conferência da loja continua "novo": pagamento
        # aprovado não substitui a aprovação humana.
        if pedido.status == "novo" and not pedido.aguardando_revisao:
            pedido.status = "confirmado"
        await db.flush()
        await enviar_mensagem_status(db, pedido, "pagamento_aprovado")
    # Se falhou (rejeitado/expirado): avisa o cliente pra tentar de novo.
    elif payment_status in ("rejected", "expired") and old_payment not in ("rejected", "expired", "approved"):
        await db.flush()
        await enviar_mensagem_status(db, pedido, "pagamento_falhou")

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
def _e_notificacao_de_pagamento(body: dict) -> bool:
    """Só processa o tópico `payment`.

    Uma preferência de checkout também gera notificações de `merchant_order`,
    cujo `data.id` é de outro espaço de ids. Tratar tudo como pagamento fazia a
    gente consultar /v1/payments com um id de merchant_order.
    """
    tipo = (body.get("type") or body.get("topic") or "").strip().lower()
    if tipo:
        return tipo == "payment"
    # Notificações antigas (IPN) não mandam `type`, só `action`.
    acao = (body.get("action") or "").strip().lower()
    return acao.startswith("payment.") if acao else True


async def _pizzaria_do_webhook_mp(db: AsyncSession, user_id: object) -> Pizzaria | None:
    """Descobre de qual pizzaria é a notificação.

    `user_id` no corpo é o id da conta vendedora no MP, gravado em
    `pizzarias.mp_user_id` quando a pizzaria salva o access_token.
    """
    uid = str(user_id or "").strip()
    if uid:
        pizz = (
            await db.execute(select(Pizzaria).where(Pizzaria.mp_user_id == uid))
        ).scalars().first()
        if pizz:
            return pizz

    # Fallback para quem ainda não tem mp_user_id gravado (pizzarias que
    # configuraram o token antes desta versão): se só existe uma pizzaria usando
    # Mercado Pago, a notificação só pode ser dela.
    candidatas = (
        await db.execute(
            select(Pizzaria).where(
                Pizzaria.gateway_pagamento == "mercadopago",
                Pizzaria.mp_access_token.is_not(None),
            ).limit(2)
        )
    ).scalars().all()
    if len(candidatas) == 1:
        log.info("MP webhook: tenant resolvido por fallback (única pizzaria com MP)")
        return candidatas[0]
    return None


async def _pedido_por_external_reference(
    db: AsyncSession, external_reference: str | None, pizzaria_id: uuid.UUID
) -> Pedido | None:
    """O external_reference que mandamos na cobrança É o id do pedido."""
    ref = (external_reference or "").strip()
    if not ref:
        return None
    try:
        pedido_uuid = uuid.UUID(ref)
    except (ValueError, AttributeError):
        log.warning("MP webhook: external_reference não é um uuid: %r", ref[:60])
        return None
    return (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_uuid, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()


@router.post("/mercadopago", status_code=status.HTTP_200_OK)
async def webhook_mp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
) -> dict:
    """
    Recebe notificação do Mercado Pago (cobrança dos pedidos, conta da pizzaria).

    Formato:
      { "type": "payment", "action": "payment.updated",
        "data": { "id": "<payment_id>" }, "user_id": "<conta vendedora>" }

    O pedido é encontrado por `payment_id` (caminho rápido, Pix) ou pelo
    `external_reference` do pagamento (checkout por link, onde o payment_id só
    passa a existir quando o cliente paga). O segundo caminho também serve de
    rede de segurança quando uma notificação anterior se perdeu.
    """
    body = await request.json()
    log.info("MP webhook: %s", body)

    if not _e_notificacao_de_pagamento(body):
        return {"ignored": f"topico_{body.get('type') or body.get('topic') or body.get('action')}"}

    data_id = str((body.get("data") or {}).get("id") or "").strip()
    if not data_id:
        return {"ignored": "no_data_id"}

    # 1) Tenant. Caminho rápido: o pedido já conhece o payment_id (Pix).
    pedido = (
        await db.execute(select(Pedido).where(Pedido.payment_id == data_id))
    ).scalar_one_or_none()
    pizzaria: Pizzaria | None = None
    if pedido:
        pizzaria = (
            await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))
        ).scalar_one_or_none()
    if pizzaria is None:
        pizzaria = await _pizzaria_do_webhook_mp(db, body.get("user_id"))
    if pizzaria is None:
        # Sem tenant não há token para consultar o pagamento. Alerta em vez de
        # silenciar: é um pagamento real que pode ficar sem confirmação.
        from app.services.alertas import registrar_alerta
        await registrar_alerta(
            db, tipo="webhook_mp_sem_tenant", nivel="error",
            detalhe=(
                f"Notificação MP (payment_id={data_id}, user_id={body.get('user_id')}) "
                "sem pizzaria correspondente. Confira o mp_user_id no cadastro."
            ),
        )
        await db.commit()
        return {"ignored": "tenant_nao_resolvido"}

    # 2) Assinatura, com o secret DA PIZZARIA (no MP o secret é por aplicação).
    secret = decrypt_secret(pizzaria.mp_webhook_secret) or _settings.mp_webhook_secret or ""
    if secret:
        if not (x_signature and x_request_id):
            log.warning("MP webhook sem x-signature/x-request-id com secret configurado")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Assinatura MP ausente")
        ok = MercadoPagoClient.validar_webhook(
            x_signature=x_signature,
            x_request_id=x_request_id,
            data_id=data_id,
            secret=secret,
        )
        if not ok:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Assinatura MP inválida")

    mp_token = decrypt_secret(pizzaria.mp_access_token)
    if not mp_token:
        return {"ignored": "no_mp_token"}

    mp = MercadoPagoClient(mp_token)
    try:
        payment_data = await mp.consultar_pagamento(data_id)
    except Exception as e:
        # 502 faz o MP reenviar depois — melhor que engolir e perder o pagamento.
        log.exception("Falha consultando MP: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "MP indisponível") from e

    # 3) Se o caminho rápido não achou, resolve pelo external_reference.
    if pedido is None:
        pedido = await _pedido_por_external_reference(
            db, payment_data.get("external_reference"), pizzaria.id
        )
    if pedido is None:
        log.warning(
            "MP webhook: pedido não encontrado (payment_id=%s, ext_ref=%s)",
            data_id, payment_data.get("external_reference"),
        )
        return {"ignored": "pedido_nao_encontrado"}

    # Auto-cura: se chegamos aqui sem mp_user_id, o `collector_id` do pagamento
    # (que só veio porque o token DESTA pizzaria conseguiu consultá-lo) ensina o
    # id da conta vendedora. As próximas notificações resolvem o tenant direto,
    # sem depender do fallback de pizzaria única.
    if not (pizzaria.mp_user_id or "").strip():
        collector = str(payment_data.get("collector_id") or body.get("user_id") or "").strip()
        if collector:
            pizzaria.mp_user_id = collector
            log.info("mp_user_id da pizzaria %s aprendido do webhook: %s", pizzaria.id, collector)

    novo_status = mp_status_para_interno(payment_data.get("status", "pending"))
    await _aplicar_pagamento(db, pedido.id, payment_id=data_id, payment_status=novo_status)
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

    # SEGURANÇA: o webhook do Asaas não é autenticado e o corpo é forjável. NUNCA
    # confiamos no status do corpo — reconsultamos o pagamento na API do Asaas com
    # a chave da própria pizzaria (fonte de verdade), igual ao fluxo do Mercado Pago.
    pedido = (
        await db.execute(select(Pedido).where(Pedido.id == pedido_id))
    ).scalar_one_or_none()
    if not pedido:
        log.info("Asaas webhook: pedido inexistente (%s)", pedido_id)
        return {"ignored": "pedido_nao_encontrado"}

    pizzaria = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))
    ).scalar_one()
    asaas_key = decrypt_secret(pizzaria.asaas_api_key)
    if not asaas_key:
        return {"ignored": "no_asaas_key"}

    try:
        pago = await AsaasClient(asaas_key).consultar_pagamento(str(payment_id))
    except Exception as e:  # noqa: BLE001
        log.exception("Falha consultando Asaas: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Asaas indisponível") from e

    # O pagamento consultado precisa ser DESTE pedido. Sem isto, bastava pagar um
    # pedido barato e forjar o webhook com o payment_id dele e o externalReference
    # de outro pedido (caro, do mesmo cliente) para o caro virar "pago".
    if str(pago.get("externalReference") or "").strip() != str(pedido_id):
        log.warning(
            "Asaas webhook: pagamento %s não pertence ao pedido %s (externalReference=%r)",
            payment_id, pedido_id, pago.get("externalReference"),
        )
        return {"ignored": "pagamento_de_outro_pedido"}

    novo_status = asaas_status_para_interno(pago.get("status", "PENDING"))
    await _aplicar_pagamento(db, pedido_id, payment_id=str(payment_id), payment_status=novo_status)
    return {"ok": True, "status": novo_status}


# ============================================
# Asaas — cobrança da PLATAFORMA (assinatura mensal das pizzarias)
# ============================================
@router.post("/asaas-plataforma", status_code=status.HTTP_200_OK)
async def webhook_asaas_plataforma(
    request: Request,
    db: AsyncSession = Depends(get_db),
    asaas_access_token: str | None = Header(default=None),
) -> dict:
    """
    Webhook da conta Asaas do DONO da plataforma (assinaturas das pizzarias).

    Eventos tratados:
      PAYMENT_CREATED            → registra a fatura pendente
      PAYMENT_RECEIVED/CONFIRMED → fatura paga + renova plano_vence_em (+30d),
                                   reativa suspensa e converte trial no plano
      PAYMENT_OVERDUE            → fatura vencida + alerta no admin
    """
    # Autenticação: token configurado no Asaas (Webhooks → Token de autenticação).
    # Vem do painel (Administração → Planos → Gateway) com fallback no ambiente.
    from app.services.billing_plataforma import carregar_config
    try:
        token = ((await carregar_config(db)).get("webhook_token") or "").strip()
    except Exception:  # noqa: BLE001
        token = (_settings.asaas_platform_webhook_token or "").strip()
    if token and asaas_access_token != token:
        log.warning("Webhook plataforma rejeitado: token inválido")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")
    if not token:
        log.warning("ASAAS_PLATFORM_WEBHOOK_TOKEN vazio — webhook SEM autenticação")

    body = await request.json()
    evento = (body.get("event") or "").upper()
    payment = body.get("payment") or {}
    log.info("Asaas plataforma webhook: event=%s payment=%s", evento, payment.get("id"))

    # Mesma lista que usamos para CADASTRAR o webhook no Asaas. Estava duplicada:
    # acrescentar um evento no cadastro sem acrescentar aqui faria o Asaas mandar
    # algo que a gente descarta calado.
    from app.services.billing_plataforma import PlatformAsaasClient
    if evento not in PlatformAsaasClient.EVENTOS_ASSINATURA:
        return {"ignored": evento or "no_event"}
    if not payment.get("id"):
        return {"ignored": "no_payment"}

    from app.services.billing_plataforma import aplicar_pagamento_plataforma
    return await aplicar_pagamento_plataforma(db, evento, payment)
