"""
Cobrança da PLATAFORMA: assinatura mensal das pizzarias via Asaas.

Conta Asaas do DONO da plataforma (ASAAS_PLATFORM_API_KEY) — separada das
contas Asaas das pizzarias (que recebem os pedidos dos clientes finais).

Fluxo:
  1. Dono da pizzaria (ou admin) ativa a cobrança → criamos customer +
     subscription no Asaas (ciclo mensal, billingType UNDEFINED = o Asaas
     oferece Pix/boleto/cartão e notifica o cliente por e-mail).
  2. O Asaas gera um payment por ciclo → webhook /webhook/asaas-plataforma.
  3. PAYMENT_RECEIVED/CONFIRMED → fatura paga + renova plano_vence_em (+30d),
     reativa pizzaria suspensa e converte trial no plano contratado.
  4. Dunning (Beat diário em workers/periodic.py): avisos D-3/D-1/D0 e
     suspensão automática após GRACE_DAYS de atraso.

O plano contratado viaja no externalReference da subscription no formato
"{pizzaria_id}|{plano}" — assim o plano só vira oficial quando o pagamento
confirma (trial não ganha cota cheia antes de pagar).
"""
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Fatura, Pizzaria
from app.services.plans import PLANS, plan_price

log = logging.getLogger(__name__)
_settings = get_settings()

# Dias de carência após o vencimento antes da suspensão automática (dunning).
GRACE_DAYS = 5
# Duração do ciclo da assinatura (espelha CICLO_DIAS do admin).
CICLO_DIAS = 30


class BillingError(Exception):
    pass


def billing_configurado() -> bool:
    return bool((_settings.asaas_platform_api_key or "").strip())


# ============================================
# Cliente HTTP do Asaas da plataforma
# ============================================
class PlatformAsaasClient:
    def __init__(self) -> None:
        key = (_settings.asaas_platform_api_key or "").strip()
        if not key:
            raise BillingError(
                "Cobrança da plataforma não configurada (ASAAS_PLATFORM_API_KEY)."
            )
        self.key = key
        self.base = (_settings.asaas_platform_base_url or "https://api.asaas.com/v3").rstrip("/")

    async def _req(self, method: str, path: str, json: dict | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.request(
                method, f"{self.base}{path}", json=json,
                headers={"access_token": self.key},
            )
            if r.is_error:
                raise BillingError(f"Asaas {method} {path} {r.status_code}: {r.text[:300]}")
            try:
                return r.json()
            except Exception:  # noqa: BLE001
                return {}

    async def criar_cliente(self, *, nome: str, email: str, cpf_cnpj: str) -> str:
        data = await self._req("POST", "/customers", {
            "name": (nome or "Pizzaria")[:60],
            "email": email,
            "cpfCnpj": cpf_cnpj,
        })
        return data["id"]

    async def criar_assinatura(
        self, *, customer_id: str, valor: float, descricao: str,
        next_due_date: date, external_reference: str,
    ) -> dict[str, Any]:
        return await self._req("POST", "/subscriptions", {
            "customer": customer_id,
            "billingType": "UNDEFINED",  # cliente escolhe Pix/boleto/cartão
            "value": valor,
            "cycle": "MONTHLY",
            "nextDueDate": next_due_date.isoformat(),
            "description": descricao[:200],
            "externalReference": external_reference,
        })

    async def cancelar_assinatura(self, subscription_id: str) -> None:
        await self._req("DELETE", f"/subscriptions/{subscription_id}")

    async def pagamentos_da_assinatura(self, subscription_id: str) -> list[dict[str, Any]]:
        data = await self._req("GET", f"/subscriptions/{subscription_id}/payments")
        return data.get("data") or []

    async def pix_qr(self, payment_id: str) -> dict[str, Any]:
        """QR Pix de uma cobrança: {encodedImage (base64 PNG), payload (copia-e-cola),
        expirationDate}. Permite renderizar o Pix no NOSSO checkout (sem a página
        hospedada do Asaas)."""
        return await self._req("GET", f"/payments/{payment_id}/pixQrCode")


# ============================================
# Operações de negócio
# ============================================
def _ext_ref(pizzaria_id: uuid.UUID, plano: str) -> str:
    return f"{pizzaria_id}|{plano}"


def parse_ext_ref(ref: str | None) -> tuple[str | None, str | None]:
    """'{pizzaria_id}|{plano}' → (pizzaria_id, plano). Tolerante a formato antigo."""
    if not ref:
        return None, None
    parts = str(ref).split("|", 1)
    pid = parts[0].strip() or None
    plano = parts[1].strip().lower() if len(parts) > 1 else None
    return pid, plano


async def ativar_assinatura(db: AsyncSession, pizz: Pizzaria, plano: str) -> dict[str, Any]:
    """
    Cria (ou recria, em upgrade/downgrade) a assinatura mensal no Asaas.
    Exige cobranca_email + cobranca_cpf_cnpj preenchidos na pizzaria.
    Retorna {"subscription_id", "primeira_fatura": {...} | None}.
    """
    plano = (plano or "").lower()
    if plano not in PLANS or PLANS[plano]["ordem"] <= 0:
        raise BillingError(f"Plano inválido para assinatura: {plano}")
    email = (pizz.cobranca_email or "").strip()
    cpf_cnpj = "".join(ch for ch in (pizz.cobranca_cpf_cnpj or "") if ch.isdigit())
    if not email or len(cpf_cnpj) not in (11, 14):
        raise BillingError("Preencha o e-mail de cobrança e um CPF/CNPJ válido.")

    client = PlatformAsaasClient()

    # Customer (cria 1x e reaproveita).
    if not pizz.asaas_customer_id:
        pizz.asaas_customer_id = await client.criar_cliente(
            nome=pizz.nome, email=email, cpf_cnpj=cpf_cnpj,
        )

    # Troca de plano: cancela a assinatura anterior (best-effort) e recria.
    if pizz.asaas_subscription_id:
        try:
            await client.cancelar_assinatura(pizz.asaas_subscription_id)
        except BillingError as e:
            log.warning("Falha ao cancelar assinatura antiga (seguindo): %s", e)
        pizz.asaas_subscription_id = None

    # 1ª cobrança: hoje se vencido/trial; senão no fim do ciclo já pago.
    hoje = date.today()
    vence = pizz.plano_vence_em.date() if pizz.plano_vence_em else None
    em_dia = vence is not None and vence > hoje and (pizz.plano or "") == plano
    next_due = vence if em_dia else hoje

    sub = await client.criar_assinatura(
        customer_id=pizz.asaas_customer_id,
        valor=plan_price(plano),
        descricao=f"PizzaBot — plano {PLANS[plano]['nome']} ({pizz.nome})",
        next_due_date=next_due,
        external_reference=_ext_ref(pizz.id, plano),
    )
    pizz.asaas_subscription_id = sub.get("id")

    # Registra já a 1ª fatura (sem esperar o webhook) pra UI mostrar o link.
    primeira = None
    try:
        pagamentos = await client.pagamentos_da_assinatura(pizz.asaas_subscription_id)
        if pagamentos:
            primeira = await upsert_fatura(db, pizz.id, pagamentos[0])
    except Exception as e:  # noqa: BLE001
        log.warning("Não consegui buscar a 1ª fatura da assinatura (webhook cobre): %s", e)

    await db.commit()
    return {"subscription_id": pizz.asaas_subscription_id, "primeira_fatura": primeira}


def _status_fatura(asaas_status: str) -> str:
    s = (asaas_status or "").upper()
    if s in ("RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"):
        return "paga"
    if s == "OVERDUE":
        return "vencida"
    if s in ("REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "DELETED"):
        return "cancelada"
    return "pendente"


async def upsert_fatura(db: AsyncSession, pizzaria_id: uuid.UUID, payment: dict[str, Any]) -> dict[str, Any]:
    """Cria/atualiza a fatura local a partir de um payment do Asaas (idempotente)."""
    pid = payment.get("id")
    fat = None
    if pid:
        fat = (await db.execute(select(Fatura).where(Fatura.asaas_payment_id == pid))).scalar_one_or_none()
    if fat is None:
        fat = Fatura(pizzaria_id=pizzaria_id, asaas_payment_id=pid, valor=payment.get("value") or 0)
        db.add(fat)

    fat.asaas_subscription_id = payment.get("subscription") or fat.asaas_subscription_id
    fat.valor = payment.get("value") or fat.valor
    fat.status = _status_fatura(payment.get("status") or "")
    if payment.get("dueDate"):
        try:
            fat.vencimento = date.fromisoformat(str(payment["dueDate"])[:10])
        except ValueError:
            pass
    if fat.status == "paga" and not fat.pago_em:
        fat.pago_em = datetime.now(timezone.utc)
    fat.link_pagamento = payment.get("invoiceUrl") or fat.link_pagamento
    fat.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return fatura_dict(fat)


def fatura_dict(f: Fatura) -> dict[str, Any]:
    return {
        "id": str(f.id),
        "valor": float(f.valor or 0),
        "status": f.status,
        "vencimento": f.vencimento.isoformat() if f.vencimento else None,
        "pago_em": f.pago_em.isoformat() if f.pago_em else None,
        "link_pagamento": f.link_pagamento,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


async def pix_da_fatura(db: AsyncSession, pizzaria_id: uuid.UUID, fatura_id: uuid.UUID) -> dict[str, Any]:
    """QR Pix de uma fatura da pizzaria, pro checkout branded no painel.
    {ok, qr_base64, copia_cola, expira_em}. ok=False se não houver Pix disponível."""
    fat = (await db.execute(
        select(Fatura).where(Fatura.id == fatura_id, Fatura.pizzaria_id == pizzaria_id)
    )).scalar_one_or_none()
    if fat is None or not fat.asaas_payment_id or fat.status in ("paga", "cancelada"):
        return {"ok": False}
    try:
        data = await PlatformAsaasClient().pix_qr(fat.asaas_payment_id)
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao buscar Pix da fatura %s: %s", fatura_id, e)
        return {"ok": False}
    if not data.get("encodedImage") or not data.get("payload"):
        return {"ok": False}
    return {
        "ok": True,
        "qr_base64": data.get("encodedImage"),
        "copia_cola": data.get("payload"),
        "expira_em": data.get("expirationDate"),
        "valor": float(fat.valor or 0),
        "link_pagamento": fat.link_pagamento,  # fallback boleto/cartão (página Asaas)
    }


async def aplicar_pagamento_plataforma(
    db: AsyncSession, evento: str, payment: dict[str, Any]
) -> dict[str, Any]:
    """
    Aplica um webhook de pagamento da plataforma:
      - localiza a pizzaria pelo externalReference ("{pizzaria_id}|{plano}")
        ou pela subscription;
      - upsert da fatura;
      - pagamento confirmado → renova +30d, reativa, promove trial → plano.
    """
    ref_pid, ref_plano = parse_ext_ref(payment.get("externalReference"))
    pizz = None
    if ref_pid:
        try:
            pizz = (await db.execute(
                select(Pizzaria).where(Pizzaria.id == uuid.UUID(ref_pid))
            )).scalar_one_or_none()
        except ValueError:
            pizz = None
    if pizz is None and payment.get("subscription"):
        pizz = (await db.execute(
            select(Pizzaria).where(Pizzaria.asaas_subscription_id == payment["subscription"])
        )).scalar_one_or_none()
    if pizz is None:
        log.warning(
            "Webhook plataforma: pizzaria não encontrada (ref=%s sub=%s)",
            payment.get("externalReference"), payment.get("subscription"),
        )
        return {"ignored": "pizzaria_nao_encontrada"}

    fat = await upsert_fatura(db, pizz.id, payment)

    pago = (evento or "").upper() in ("PAYMENT_RECEIVED", "PAYMENT_CONFIRMED")
    if pago:
        plano_novo = ref_plano if ref_plano in PLANS and PLANS[ref_plano]["ordem"] > 0 else None
        await db.execute(
            text(
                f"UPDATE public.pizzarias SET "
                f"plano = COALESCE(:plano, plano), "
                f"plano_vence_em = GREATEST(now(), COALESCE(plano_vence_em, now())) + interval '{CICLO_DIAS} days', "
                f"plano_ativado_em = COALESCE(plano_ativado_em, now()), "
                f"trial_fim = NULL, "
                f"suspensa = FALSE, suspensa_motivo = NULL, updated_at = now() "
                f"WHERE id = :id"
            ),
            {"id": str(pizz.id), "plano": plano_novo},
        )
        log.info(
            "Assinatura paga: pizzaria=%s plano=%s fatura=%s",
            pizz.id, plano_novo or pizz.plano, fat.get("id"),
        )
    elif (evento or "").upper() == "PAYMENT_OVERDUE":
        from app.services.alertas import registrar_alerta
        await registrar_alerta(
            db, tipo="fatura_vencida", pizzaria_id=pizz.id, nivel="warning",
            detalhe=(
                f"Fatura da assinatura de '{pizz.nome}' venceu sem pagamento "
                f"(R$ {fat.get('valor'):.2f}, venc. {fat.get('vencimento')}). "
                f"Suspensão automática após {GRACE_DAYS} dias de atraso."
            ),
        )

    await db.commit()
    return {"ok": True, "pago": pago, "fatura": fat}
