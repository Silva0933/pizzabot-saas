"""
Integração com gateways de pagamento (Mercado Pago + Asaas).

Cada pizzaria configura seu próprio gateway. Os tokens vêm da tabela `pizzarias`,
não do .env (multi-tenant). O .env só guarda secrets globais (ex: webhook validation).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

import httpx

from app.config import get_settings
from app.models import Pizzaria
from app.services.secrets import decrypt_secret

log = logging.getLogger(__name__)
_settings = get_settings()

# Janela de validade do Pix. Após esse tempo sem pagamento, o gateway dispara o
# webhook "expired" e o cliente recebe o aviso de "não consegui confirmar /
# pague na entrega" (status_messages.pagamento_falhou). Mantida curta de
# propósito: com o padrão de 24h do MP, esse aviso só chegava no dia seguinte.
PIX_EXPIRATION_MINUTES = 30


@dataclass
class CobrancaResult:
    """Resultado da criação de uma cobrança.

    `payment_id` só vem preenchido quando a cobrança JÁ nasce como um pagamento
    (Pix). No checkout por link o pagamento ainda não existe no momento da
    criação — o que temos é `preference_id`, e o pagamento só é conhecido quando
    o webhook chega. Misturar os dois era o que deixava o pedido pago como
    'pending' para sempre.
    """
    payment_id: str | None
    link_pagamento: str
    preference_id: str | None = None    # checkout por link (/checkout/preferences)
    qr_code: str | None = None          # Pix copia-e-cola
    qr_code_base64: str | None = None   # imagem PNG do QR (base64)
    expires_at: str | None = None
    metodo: str = "link"                # "pix" | "link"


class PagamentoError(Exception):
    pass


# ============================================
# Mercado Pago
# ============================================
class MercadoPagoClient:
    BASE = "https://api.mercadopago.com"

    def __init__(self, access_token: str) -> None:
        if not access_token:
            raise PagamentoError("Mercado Pago: access_token não configurado")
        self.token = access_token

    async def criar_cobranca(
        self,
        *,
        valor: Decimal,
        descricao: str,
        nome_cliente: str,
        telefone: str,
        external_reference: str,
        notification_url: str | None = None,
    ) -> CobrancaResult:
        # Sanitiza nome (MP rejeita caracteres especiais)
        import re
        first_name = re.sub(r"[^a-zA-ZÀ-ɏ ]", "", (nome_cliente or "Cliente"))[:30].strip() or "Cliente"

        body = {
            "items": [
                {
                    "title": descricao[:60],
                    "quantity": 1,
                    "unit_price": float(valor),
                    "currency_id": "BRL",
                }
            ],
            "payer": {
                "name": first_name,
                "phone": {"area_code": telefone[:2] if telefone else "11", "number": telefone[2:] if telefone else ""},
            },
            "external_reference": external_reference,
            "payment_methods": {
                "excluded_payment_types": [{"id": "ticket"}],  # sem boleto
                "installments": 1,
            },
        }
        if notification_url:
            body["notification_url"] = notification_url

        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{self.BASE}/checkout/preferences",
                json=body,
                headers={"Authorization": f"Bearer {self.token}"},
            )
            if r.is_error:
                log.error("MP error %s: %s", r.status_code, r.text[:300])
                raise PagamentoError(f"MP {r.status_code}: {r.text[:200]}")
            data = r.json()

        # ATENÇÃO: aqui `data["id"]` é o id da PREFERÊNCIA, não o de um pagamento
        # — o pagamento só nasce quando o cliente paga no checkout. Guardamos em
        # `preference_id` (e não em payment_id) justamente para o webhook não
        # tentar casar um id de preferência com o id de pagamento que ele recebe.
        # Quem liga os dois é o `external_reference`. Ver routes/webhook_pagamento.
        return CobrancaResult(
            payment_id=None,
            preference_id=str(data["id"]),
            link_pagamento=data.get("init_point") or data.get("sandbox_init_point", ""),
            metodo="link",
        )

    async def criar_pix(
        self,
        *,
        valor: Decimal,
        descricao: str,
        nome_cliente: str,
        telefone: str,
        external_reference: str,
        notification_url: str | None = None,
    ) -> CobrancaResult:
        """Cria um pagamento Pix e devolve o copia-e-cola + QR (base64)."""
        import re
        import uuid as _uuid
        from datetime import datetime, timedelta, timezone

        first_name = re.sub(r"[^a-zA-ZÀ-ɏ ]", "", (nome_cliente or "Cliente"))[:30].strip() or "Cliente"
        tel_digits = re.sub(r"\D", "", telefone or "")
        email = f"cliente{tel_digits}@pizzabot.app" if tel_digits else "cliente@pizzabot.app"

        body: dict[str, Any] = {
            "transaction_amount": float(valor),
            "description": descricao[:200],
            "payment_method_id": "pix",
            "payer": {"email": email, "first_name": first_name},
            "external_reference": external_reference,
            # ISO 8601 com offset (ex.: 2026-06-07T18:30:00.000+00:00). Sem este
            # campo o MP usa o padrão de 24h e o aviso de falha só chegaria no
            # dia seguinte. Ver PIX_EXPIRATION_MINUTES.
            "date_of_expiration": (
                datetime.now(timezone.utc) + timedelta(minutes=PIX_EXPIRATION_MINUTES)
            ).isoformat(timespec="milliseconds"),
        }
        if notification_url:
            body["notification_url"] = notification_url

        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{self.BASE}/v1/payments",
                json=body,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "X-Idempotency-Key": str(_uuid.uuid4()),
                },
            )
            if r.is_error:
                log.error("MP pix error %s: %s", r.status_code, r.text[:300])
                raise PagamentoError(f"MP pix {r.status_code}: {r.text[:200]}")
            data = r.json()

        poi = ((data.get("point_of_interaction") or {}).get("transaction_data")) or {}
        return CobrancaResult(
            payment_id=str(data["id"]),
            link_pagamento=poi.get("ticket_url", ""),
            qr_code=poi.get("qr_code"),
            qr_code_base64=poi.get("qr_code_base64"),
            metodo="pix",
        )

    async def consultar_pagamento(self, payment_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{self.BASE}/v1/payments/{payment_id}",
                headers={"Authorization": f"Bearer {self.token}"},
            )
            if r.is_error:
                raise PagamentoError(f"MP consulta {r.status_code}: {r.text[:200]}")
            return r.json()

    async def consultar_usuario(self) -> dict[str, Any]:
        """Dados da conta dona do token (GET /users/me).

        Usado para gravar `pizzarias.mp_user_id`: é o `user_id` que vem no corpo
        da notificação do webhook, e sem ele não dá pra saber de qual pizzaria é
        o pagamento antes de consultá-lo.
        """
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{self.BASE}/users/me",
                headers={"Authorization": f"Bearer {self.token}"},
            )
            if r.is_error:
                raise PagamentoError(f"MP /users/me {r.status_code}: {r.text[:200]}")
            return r.json()

    @staticmethod
    def validar_webhook(*, x_signature: str, x_request_id: str, data_id: str, secret: str) -> bool:
        """Valida assinatura HMAC SHA256 enviada pelo Mercado Pago."""
        if not secret:
            log.warning("MP_WEBHOOK_SECRET vazio — não valida assinatura")
            return True
        try:
            # Formato do x_signature: "ts=1234567890,v1=abc123..."
            parts = dict(p.strip().split("=", 1) for p in x_signature.split(","))
            ts = parts.get("ts", "")
            v1 = parts.get("v1", "")
            manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
            computed = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(computed, v1)
        except Exception as e:
            log.exception("Erro validando MP webhook: %s", e)
            return False


# ============================================
# Asaas
# ============================================
class AsaasClient:
    BASE = "https://api.asaas.com/v3"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise PagamentoError("Asaas: api_key não configurado")
        self.key = api_key

    async def _criar_cliente(self, *, nome: str, telefone: str) -> str:
        body = {"name": nome[:60] or "Cliente", "mobilePhone": telefone}
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(
                f"{self.BASE}/customers",
                json=body,
                headers={"access_token": self.key},
            )
            if r.is_error:
                raise PagamentoError(f"Asaas customer {r.status_code}: {r.text[:200]}")
            return r.json()["id"]

    async def criar_cobranca_pix(
        self,
        *,
        valor: Decimal,
        descricao: str,
        nome_cliente: str,
        telefone: str,
        external_reference: str,
    ) -> CobrancaResult:
        from datetime import date, timedelta
        customer_id = await self._criar_cliente(nome=nome_cliente, telefone=telefone)
        body = {
            "customer": customer_id,
            "billingType": "PIX",
            "value": float(valor),
            "dueDate": (date.today() + timedelta(days=1)).isoformat(),
            "description": descricao[:200],
            "externalReference": external_reference,
        }
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{self.BASE}/payments",
                json=body,
                headers={"access_token": self.key},
            )
            if r.is_error:
                raise PagamentoError(f"Asaas {r.status_code}: {r.text[:200]}")
            data = r.json()
            pid = data["id"]

            # Busca QR code do Pix
            r2 = await c.get(
                f"{self.BASE}/payments/{pid}/pixQrCode",
                headers={"access_token": self.key},
            )
            qr = r2.json() if r2.is_success else {}

        return CobrancaResult(
            payment_id=pid,
            link_pagamento=data.get("invoiceUrl", ""),
            qr_code=qr.get("payload"),
            expires_at=qr.get("expirationDate"),
        )

    async def consultar_pagamento(self, payment_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{self.BASE}/payments/{payment_id}",
                headers={"access_token": self.key},
            )
            if r.is_error:
                raise PagamentoError(f"Asaas consulta {r.status_code}: {r.text[:200]}")
            return r.json()


# ============================================
# Helpers
# ============================================
def gateway_for(pizzaria: Pizzaria) -> MercadoPagoClient | AsaasClient | None:
    """Retorna o cliente do gateway configurado para a pizzaria."""
    gw = pizzaria.gateway_pagamento
    mp_token = decrypt_secret(pizzaria.mp_access_token)
    asaas_key = decrypt_secret(pizzaria.asaas_api_key)
    if gw == "mercadopago" and mp_token:
        return MercadoPagoClient(mp_token)
    if gw == "asaas" and asaas_key:
        return AsaasClient(asaas_key)
    return None


def mp_status_para_interno(status: str) -> Literal["pending", "approved", "rejected", "expired"]:
    """Mapeia status MP → nosso enum interno."""
    return {
        "approved": "approved",
        "in_process": "pending",
        "pending": "pending",
        "rejected": "rejected",
        "cancelled": "rejected",
        "refunded": "rejected",
        "charged_back": "rejected",
        "expired": "expired",
    }.get(status, "pending")  # type: ignore[return-value]


def asaas_status_para_interno(status: str) -> Literal["pending", "approved", "rejected", "expired"]:
    return {
        "RECEIVED": "approved",
        "CONFIRMED": "approved",
        "PENDING": "pending",
        "OVERDUE": "expired",
        "REFUNDED": "rejected",
        "CHARGEBACK_REQUESTED": "rejected",
    }.get(status, "pending")  # type: ignore[return-value]
