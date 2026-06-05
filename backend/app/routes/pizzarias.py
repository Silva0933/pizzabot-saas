"""CRUD básico de pizzarias (suficiente para testar a Fase 2)."""
import logging
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_serializer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.config import get_settings
from app.db import get_db
from app.deps import current_user, membership, require_platform_admin
from app.models import EquipePizzaria, Pizzaria, Usuario
from app.services.evolution import EvolutionError, evolution
from app.services.secrets import encrypt_secret, looks_masked, mask_secret

log = logging.getLogger(__name__)
_settings = get_settings()

router = APIRouter(prefix="/pizzarias", tags=["pizzarias"])


class PizzariaIn(BaseModel):
    nome: str = Field(min_length=2)
    instancia: str | None = None
    telefone_admin: str | None = None
    endereco: str | None = None
    # Login do dono da pizzaria (opcional). Se informado, cria/vincula o usuário
    # proprietário que vai acessar o painel operacional desta pizzaria.
    owner_email: EmailStr | None = None
    owner_senha: str | None = Field(default=None, min_length=8)
    owner_nome: str | None = None


class PizzariaPatch(BaseModel):
    """Todos opcionais — só atualiza o que vier."""
    nome: str | None = Field(default=None, min_length=2)
    instancia: str | None = None
    telefone_admin: str | None = None
    telefone_contato: str | None = None
    endereco: str | None = None
    endereco_maps_url: str | None = None
    logo_url: str | None = None
    bot_ativo_global: bool | None = None
    horario_funcionamento: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    tempo_entrega_min: int | None = None
    tempo_entrega_max: int | None = None
    tempo_retirada_min: int | None = None
    tempo_retirada_max: int | None = None
    taxa_entrega_info: str | None = None
    taxa_entrega_fixa: float | None = None
    taxas_bairro: list[dict] | None = None
    adicionais: list[dict] | None = None


class PizzariaOut(BaseModel):
    id: uuid.UUID
    nome: str
    instancia: str | None
    plano: str
    bot_ativo_global: bool
    suspensa: bool = False
    suspensa_motivo: str | None = None
    plano_vence_em: datetime | None = None
    pipeline_fsm: bool = False
    endereco: str | None
    endereco_maps_url: str | None = None
    telefone_admin: str | None
    telefone_contato: str | None
    logo_url: str | None = None
    horario_funcionamento: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    tempo_entrega_min: int | None = None
    tempo_entrega_max: int | None = None
    tempo_retirada_min: int | None = None
    tempo_retirada_max: int | None = None
    taxa_entrega_info: str | None = None
    taxa_entrega_fixa: float | None = None
    taxas_bairro: list[dict] | None = None

    model_config = {"from_attributes": True}

    @field_serializer("asaas_api_key", "mp_access_token")
    def _mask_secret_field(self, value: str | None, _info):
        return mask_secret(value)


@router.get("", response_model=list[PizzariaOut])
async def list_pizzarias(
    user: Usuario = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Pizzaria]:
    """Lista pizzarias do usuário (ou todas se for platform admin)."""
    if user.is_platform_admin:
        stmt = select(Pizzaria).order_by(Pizzaria.created_at.desc())
    else:
        stmt = (
            select(Pizzaria)
            .join(EquipePizzaria, EquipePizzaria.pizzaria_id == Pizzaria.id)
            .where(
                EquipePizzaria.usuario_id == user.id,
                EquipePizzaria.status.in_(("ativo", "proprietario")),
            )
        )
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.post("", response_model=PizzariaOut, status_code=status.HTTP_201_CREATED)
async def create_pizzaria(
    body: PizzariaIn,
    user: Usuario = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
) -> Pizzaria:
    pizz = Pizzaria(
        nome=body.nome.strip(),
        instancia=body.instancia,
        telefone_admin=body.telefone_admin,
        endereco=body.endereco,
    )
    db.add(pizz)
    await db.flush()

    if body.owner_email:
        # Cria (ou reutiliza) o usuário dono e o vincula como proprietário.
        owner_email = body.owner_email.lower()
        owner = (
            await db.execute(
                select(Usuario).where(func.lower(Usuario.email) == owner_email)
            )
        ).scalar_one_or_none()

        if owner is None:
            if not body.owner_senha:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Senha do dono é obrigatória para criar o login (mínimo 8 caracteres).",
                )
            owner = Usuario(
                email=owner_email,
                senha_hash=hash_password(body.owner_senha),
                nome=(body.owner_nome or body.nome).strip(),
                is_platform_admin=False,
            )
            db.add(owner)
            await db.flush()

        db.add(EquipePizzaria(
            pizzaria_id=pizz.id,
            usuario_id=owner.id,
            email=owner.email,
            role="admin",
            status="proprietario",
        ))
    else:
        # Sem dono informado: vincula o admin criador (fallback).
        db.add(EquipePizzaria(
            pizzaria_id=pizz.id,
            usuario_id=user.id,
            email=user.email,
            role="admin",
            status="proprietario",
        ))

    await db.commit()
    await db.refresh(pizz)
    return pizz


@router.get("/{pizzaria_id}", response_model=PizzariaOut)
async def get_pizzaria(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pizzaria:
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    return pizz


@router.get("/{pizzaria_id}/uso")
async def uso_pizzaria(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Consumo de IA do mês corrente vs. limite do plano (visível ao dono)."""
    from app.services.app_config import uso_mes
    from app.services.plans import plan_info

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    u = await uso_mes(db, pizzaria_id)
    limites = plan_info(pizz.plano).get("limites") or {}
    limite = int(limites.get("mensagens_ia_mes") or 0)
    usados = u["mensagens"]
    pct = round(usados / limite * 100, 1) if limite else 0.0
    return {
        "plano": pizz.plano,
        "ia_mensagens": usados,
        "ia_limite": limite,
        "ia_tokens": u["tokens"],
        "percentual": pct,
        "limite_atingido": bool(limite and usados >= limite),
        "proximo_do_limite": bool(limite and usados >= limite * 0.8),
    }


@router.patch("/{pizzaria_id}", response_model=PizzariaOut)
async def update_pizzaria(
    pizzaria_id: uuid.UUID,
    body: PizzariaPatch,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pizzaria:
    """Atualiza campos da pizzaria. Aceita qualquer subset dos campos."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    updates = body.model_dump(exclude_unset=True, exclude_none=False)
    for k, v in updates.items():
        if hasattr(pizz, k):
            if k in ("asaas_api_key", "mp_access_token"):
                if not v or looks_masked(v):
                    continue
                v = encrypt_secret(v)
            setattr(pizz, k, v)
    await db.commit()
    await db.refresh(pizz)
    return pizz


@router.delete("/{pizzaria_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pizzaria(
    pizzaria_id: uuid.UUID,
    user: Usuario = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove pizzaria (e cascateia equipe, produtos, etc). Apenas platform admin."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    # Best-effort: remove a instância da Evolution junto com a pizzaria.
    if pizz.instancia:
        try:
            await evolution.delete_instance(instancia=pizz.instancia)
        except Exception:  # noqa: BLE001
            log.warning("Falha ao remover instância %s da Evolution", pizz.instancia)

    # Apaga TODOS os filhos explicitamente, em ordem filho→pai. NÃO dependemos de
    # ON DELETE CASCADE estar configurado no banco: as tabelas foram criadas por
    # migrations SQL, e nem todo FK foi criado com cascade (ex.: cardápio relacional).
    # Cada DELETE roda num SAVEPOINT (begin_nested) pra que uma tabela ausente em
    # algum ambiente não aborte a transação inteira.
    from sqlalchemy import text as _text
    pid = str(pizzaria_id)
    deletes = (
        # Cardápio relacional (netos da pizzaria, via produtos/grupos)
        "DELETE FROM public.produto_complementos WHERE produto_id IN (SELECT id FROM public.produtos WHERE pizzaria_id = :pid)",
        "DELETE FROM public.produto_tamanhos WHERE produto_id IN (SELECT id FROM public.produtos WHERE pizzaria_id = :pid)",
        "DELETE FROM public.complementos WHERE grupo_id IN (SELECT id FROM public.grupo_complementos WHERE pizzaria_id = :pid)",
        # Filhos diretos (têm pizzaria_id) — ordem respeitando FKs entre eles
        "DELETE FROM public.mensagens WHERE pizzaria_id = :pid",
        "DELETE FROM public.pedidos WHERE pizzaria_id = :pid",
        "DELETE FROM public.conversas WHERE pizzaria_id = :pid",
        "DELETE FROM public.clientes WHERE pizzaria_id = :pid",
        "DELETE FROM public.produtos WHERE pizzaria_id = :pid",
        "DELETE FROM public.grupo_complementos WHERE pizzaria_id = :pid",
        "DELETE FROM public.personalidade_atendente WHERE pizzaria_id = :pid",
        "DELETE FROM public.equipe_pizzaria WHERE pizzaria_id = :pid",
        # Auxiliares (criadas via ensure_table; podem não existir em todo ambiente)
        "DELETE FROM public.agente_memoria WHERE pizzaria_id = :pid",
        "DELETE FROM public.atendimento_estado WHERE pizzaria_id = :pid",
        "DELETE FROM public.app_config WHERE pizzaria_id = :pid",
        "DELETE FROM public.llm_usage WHERE pizzaria_id = :pid",
        "DELETE FROM public.cardapio_arquivo WHERE pizzaria_id = :pid",
        "DELETE FROM public.assinatura_pizzaria WHERE pizzaria_id = :pid",
        "DELETE FROM public.plataforma_alertas WHERE pizzaria_id = :pid",
    )
    for sql in deletes:
        try:
            async with db.begin_nested():
                await db.execute(_text(sql), {"pid": pid})
        except Exception as e:  # noqa: BLE001
            log.warning("delete_pizzaria: falha ao limpar tabela filha: %s", e)

    # Limpa filas/locks no Redis desta pizzaria (best-effort).
    try:
        from app.redis_client import redis as _redis
        for padrao in (f"pending:{pid}:*", f"flush_at:{pid}:*", f"batch_start:{pid}:*", f"lock:flush:{pid}:*"):
            chaves = await _redis.keys(padrao)
            if chaves:
                await _redis.delete(*chaves)
    except Exception:  # noqa: BLE001
        pass

    await db.delete(pizz)
    await db.commit()


# ============================================
# WhatsApp / Evolution — conectar instância
# ============================================
class WhatsAppConnectIn(BaseModel):
    instancia: str | None = None  # opcional; usa a da pizzaria ou gera pelo nome


class WhatsAppStatusOut(BaseModel):
    instancia: str | None
    state: str  # open | connecting | close
    conectado: bool


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or "pizzaria"


async def _unique_instancia(db: AsyncSession, base: str, self_id: uuid.UUID) -> str:
    """Garante nome de instância único (constraint unique em pizzarias.instancia)."""
    candidate = base
    for i in range(0, 100):
        name = candidate if i == 0 else f"{base}-{i}"
        taken = (
            await db.execute(
                select(Pizzaria.id).where(
                    Pizzaria.instancia == name, Pizzaria.id != self_id
                )
            )
        ).scalar_one_or_none()
        if not taken:
            return name
    return f"{base}-{uuid.uuid4().hex[:6]}"


def _extract_qr(data: object) -> dict | None:
    if not isinstance(data, dict):
        return None
    qr = data.get("qrcode") if isinstance(data.get("qrcode"), dict) else data
    if not isinstance(qr, dict):
        return None
    b64 = qr.get("base64") or qr.get("qrcode")
    code = qr.get("code")
    pairing = qr.get("pairingCode")
    if b64 or code or pairing:
        return {"base64": b64, "code": code, "pairingCode": pairing}
    return None


@router.post("/{pizzaria_id}/whatsapp/conectar")
async def whatsapp_conectar(
    pizzaria_id: uuid.UUID,
    body: WhatsAppConnectIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """
    Cria (ou reaproveita) a instância na Evolution, configura o webhook e
    retorna o QR Code em base64 para o dono escanear no WhatsApp.
    """
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))
    ).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    if not _settings.evolution_base_url or not _settings.evolution_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Evolution API não configurada no servidor.",
        )

    base = _slugify(body.instancia or pizz.instancia or pizz.nome)
    instancia = await _unique_instancia(db, base, pizz.id)
    webhook_url = _settings.public_base_url.rstrip("/") + "/webhook/evolution"

    try:
        res = await evolution.create_instance(
            instancia=instancia,
            webhook_url=webhook_url,
            numero=pizz.telefone_admin,
        )
        # Garante o webhook configurado mesmo se a instância já existia.
        try:
            await evolution.set_webhook(instancia=instancia, webhook_url=webhook_url)
        except EvolutionError:
            log.warning("Falha ao (re)configurar webhook de %s", instancia)

        qr = _extract_qr(res)
        if not qr:
            conn = await evolution.connect_instance(instancia=instancia)
            qr = _extract_qr(conn)

        state = await evolution.connection_state(instancia=instancia)
    except EvolutionError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Evolution: {e}") from e

    # Persiste a instância na pizzaria.
    pizz.instancia = instancia
    await db.commit()

    return {
        "instancia": instancia,
        "qrcode": qr,
        "state": state,
        "conectado": state == "open",
        "webhook_url": webhook_url,
    }


@router.get("/{pizzaria_id}/whatsapp/status", response_model=WhatsAppStatusOut)
async def whatsapp_status(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> WhatsAppStatusOut:
    """Consulta o estado da conexão (para polling no frontend)."""
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))
    ).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    if not pizz.instancia:
        return WhatsAppStatusOut(instancia=None, state="close", conectado=False)
    try:
        state = await evolution.connection_state(instancia=pizz.instancia)
    except EvolutionError:
        state = "close"
    return WhatsAppStatusOut(
        instancia=pizz.instancia, state=state, conectado=state == "open"
    )


@router.get("/{pizzaria_id}/whatsapp/qrcode")
async def whatsapp_qrcode(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Regera o QR Code de uma instância já criada."""
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))
    ).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    if not pizz.instancia:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Instância ainda não criada.")
    try:
        conn = await evolution.connect_instance(instancia=pizz.instancia)
        state = await evolution.connection_state(instancia=pizz.instancia)
    except EvolutionError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Evolution: {e}") from e
    return {
        "instancia": pizz.instancia,
        "qrcode": _extract_qr(conn),
        "state": state,
        "conectado": state == "open",
    }
