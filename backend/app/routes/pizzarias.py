"""CRUD básico de pizzarias (suficiente para testar a Fase 2)."""
import logging
import re
import unicodedata
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_serializer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password
from app.config import get_settings
from app.db import get_db
from app.deps import current_user, membership, require_platform_admin
from app.models import EquipePizzaria, Entregador, Pizzaria, Usuario
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
    slug: str | None = None
    instancia: str | None = None
    telefone_admin: str | None = None
    telefone_contato: str | None = None
    endereco: str | None = None
    endereco_maps_url: str | None = None
    logo_url: str | None = None
    banner_url: str | None = None
    bot_ativo_global: bool | None = None
    alertas_sonoros: bool | None = None
    aberto_manual: bool | None = None
    horario_funcionamento: dict | None = None
    tema_cardapio: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    mp_webhook_secret: str | None = None
    modo_pagamento_online: str | None = None
    pix_manual_copia_cola: str | None = None
    pix_manual_titular: str | None = None
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
    slug: str | None = None
    instancia: str | None
    whatsapp_estado: str | None = None
    plano: str
    bot_ativo_global: bool
    alertas_sonoros: bool = True
    aberto_manual: bool | None = None
    aberto_agora: bool = True
    suspensa: bool = False
    suspensa_motivo: str | None = None
    plano_vence_em: datetime | None = None
    trial_fim: datetime | None = None
    pipeline_fsm: bool = False
    endereco: str | None
    endereco_maps_url: str | None = None
    telefone_admin: str | None
    telefone_contato: str | None
    logo_url: str | None = None
    banner_url: str | None = None
    horario_funcionamento: dict | None = None
    tema_cardapio: dict | None = None
    formas_pagamento_aceitas: list[str] | None = None
    mensagens_status: dict | None = None
    nomes_colunas: dict | None = None
    gateway_pagamento: str | None = None
    asaas_api_key: str | None = None
    mp_access_token: str | None = None
    mp_webhook_secret: str | None = None
    modo_pagamento_online: str | None = None
    pix_manual_copia_cola: str | None = None
    pix_manual_titular: str | None = None
    tempo_entrega_min: int | None = None
    tempo_entrega_max: int | None = None
    tempo_retirada_min: int | None = None
    tempo_retirada_max: int | None = None
    taxa_entrega_info: str | None = None
    taxa_entrega_fixa: float | None = None
    taxas_bairro: list[dict] | None = None

    model_config = {"from_attributes": True}

    @field_serializer("asaas_api_key", "mp_access_token", "mp_webhook_secret")
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
        slug=_slugify(body.nome),
        instancia=body.instancia,
        telefone_admin=body.telefone_admin,
        endereco=body.endereco,
    )
    db.add(pizz)
    await db.flush()

    pizz.slug = await slug_unico(db, pizz.nome, pizz.id)
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
    """Atendimentos do mês vs. cota do plano (visível ao dono)."""
    from app.services.app_config import conversas_atendidas_mes, uso_mes
    from app.services.plans import plan_info

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    u = await uso_mes(db, pizzaria_id)
    limites = plan_info(pizz.plano).get("limites") or {}
    limite = int(limites.get("conversas_mes") or 0)
    usados = await conversas_atendidas_mes(db, pizzaria_id)
    pct = round(usados / limite * 100, 1) if limite else 0.0
    return {
        "plano": pizz.plano,
        # Atendimentos = conversas distintas atendidas pela IA no mês (cota do plano).
        "atendimentos": usados,
        "atendimentos_limite": limite,
        "atendimentos_restante": max(limite - usados, 0) if limite else 0,
        # Referência de IA (não é a cota): rodadas e tokens.
        "ia_mensagens": u["mensagens"],
        "ia_tokens": u["tokens"],
        "percentual": pct,
        "limite_atingido": bool(limite and usados >= limite),
        "proximo_do_limite": bool(limite and usados >= limite * 0.8),
    }


# ============================================
# Assinatura da plataforma (plano + faturas, visível ao dono)
# ============================================
class AssinaturaIn(BaseModel):
    plano: str = Field(min_length=2)
    cobranca_email: EmailStr
    cobranca_cpf_cnpj: str = Field(min_length=11)


def _status_assinatura(pizz: Pizzaria) -> str:
    from datetime import timezone as _tz
    agora = datetime.now(_tz.utc)
    if pizz.suspensa:
        return "suspensa"
    if (pizz.plano or "") == "trial":
        return "trial"
    if not pizz.plano_vence_em:
        return "sem_assinatura"
    if pizz.plano_vence_em < agora:
        return "vencida"
    if (pizz.plano_vence_em - agora).days <= 3:
        return "vence_breve"
    return "em_dia"


@router.get("/{pizzaria_id}/assinatura")
async def assinatura_pizzaria(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Plano, status, vencimento e faturas — alimenta a aba Assinatura."""
    from app.models import Fatura
    from app.services.billing_plataforma import (
        GRACE_DAYS,
        billing_configurado,
        fatura_dict,
    )
    from app.services.plans import plan_info, plans_catalog

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    faturas = (await db.execute(
        select(Fatura).where(Fatura.pizzaria_id == pizzaria_id)
        .order_by(Fatura.created_at.desc()).limit(12)
    )).scalars().all()

    # Distingue "pagar agora" de "próxima cobrança": uma fatura pendente cujo
    # vencimento ainda está no futuro (plano já ativo/concedido) NÃO é uma conta
    # vencida — é a próxima cobrança. Só vira "fatura_aberta" (pague agora) se já
    # venceu ou vence em até 2 dias. Evita o painel parecer "assinou e deve um mês".
    hoje = date.today()
    pendentes = [f for f in faturas if f.status in ("pendente", "vencida")]

    def _due_now(f: Fatura) -> bool:
        return f.status == "vencida" or f.vencimento is None or f.vencimento <= hoje + timedelta(days=2)

    aberta = next((f for f in pendentes if _due_now(f)), None)
    proxima = next((f for f in pendentes if not _due_now(f)), None)

    return {
        "plano": pizz.plano,
        "plano_info": plan_info(pizz.plano),
        "status": _status_assinatura(pizz),
        "vence_em": pizz.plano_vence_em.isoformat() if pizz.plano_vence_em else None,
        "trial_fim": pizz.trial_fim.isoformat() if pizz.trial_fim else None,
        "suspensa_motivo": pizz.suspensa_motivo,
        "carencia_dias": GRACE_DAYS,
        "tem_assinatura": bool(pizz.asaas_subscription_id),
        "cobranca_email": pizz.cobranca_email,
        "cobranca_cpf_cnpj": pizz.cobranca_cpf_cnpj,
        "billing_disponivel": billing_configurado(),
        "fatura_aberta": fatura_dict(aberta) if aberta else None,
        "proxima_cobranca": fatura_dict(proxima) if proxima else None,
        "faturas": [fatura_dict(f) for f in faturas],
        "planos": plans_catalog(),
    }


@router.get("/{pizzaria_id}/assinatura/fatura/{fatura_id}/pix")
async def fatura_pix(
    pizzaria_id: uuid.UUID,
    fatura_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """QR Pix de uma fatura — alimenta o checkout Pix branded no painel."""
    from app.services.billing_plataforma import pix_da_fatura

    return await pix_da_fatura(db, pizzaria_id, fatura_id)


@router.post("/{pizzaria_id}/assinatura")
async def contratar_assinatura(
    pizzaria_id: uuid.UUID,
    body: AssinaturaIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """
    Contrata/troca o plano: cria a assinatura mensal no Asaas da plataforma.
    O plano só vira oficial quando o 1º pagamento confirmar (webhook) —
    trial não ganha cota cheia antes de pagar.
    """
    from app.services.billing_plataforma import BillingError, ativar_assinatura

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    pizz.cobranca_email = body.cobranca_email.lower().strip()
    pizz.cobranca_cpf_cnpj = body.cobranca_cpf_cnpj.strip()

    try:
        resultado = await ativar_assinatura(db, pizz, body.plano)
    except BillingError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    log.info("Assinatura criada: pizzaria=%s plano=%s sub=%s",
             pizzaria_id, body.plano, resultado.get("subscription_id"))
    return {"ok": True, **resultado}


@router.delete("/{pizzaria_id}/assinatura")
async def cancelar_assinatura_pizzaria(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """
    Cancela a renovação no Asaas e mantém o acesso até o fim do período já pago.
    Cobranças pendentes/vencidas da recorrência são canceladas pelo Asaas.
    """
    from app.services.billing_plataforma import BillingError, cancelar_assinatura

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    try:
        return {"ok": True, **(await cancelar_assinatura(db, pizz))}
    except BillingError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e


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
    mp_token_novo: str | None = None
    for k, v in updates.items():
        if hasattr(pizz, k):
            if k == "alertas_sonoros" and v is None:
                continue  # coluna NOT NULL: null não significa nada aqui
            if k in ("asaas_api_key", "mp_access_token", "mp_webhook_secret"):
                if not v or looks_masked(v):
                    continue
                if k == "mp_access_token":
                    mp_token_novo = v
                v = encrypt_secret(v)
            if k == "slug" and v:
                # Valida slug informado manualmente: slugify + unicidade
                v = _slugify(v)
                dup = (await db.execute(
                    select(Pizzaria.id).where(Pizzaria.slug == v, Pizzaria.id != pizzaria_id)
                )).scalar_one_or_none()
                if dup:
                    raise HTTPException(status.HTTP_409_CONFLICT, f"O slug '{v}' já está em uso por outra pizzaria.")
            setattr(pizz, k, v)

    # Token do MP novo → descobre e guarda o id da conta vendedora. É o que liga
    # o `user_id` da notificação do webhook a esta pizzaria; sem ele, pagamento
    # feito por link (cartão) não tem como ser confirmado automaticamente.
    if mp_token_novo:
        from app.services.pagamentos import MercadoPagoClient
        try:
            dados = await MercadoPagoClient(mp_token_novo).consultar_usuario()
            pizz.mp_user_id = str(dados.get("id") or "") or None
        except Exception as e:  # noqa: BLE001
            # Não bloqueia o salvamento: o token pode estar certo e a API fora do ar.
            # O webhook ainda tem o fallback de pizzaria única.
            pizz.mp_user_id = None
            log.warning("Não consegui obter o mp_user_id da pizzaria %s: %s", pizzaria_id, e)

    # Rede de segurança: pizzaria antiga sem slug ganha um ao salvar qualquer campo.
    if not pizz.slug:
        pizz.slug = await slug_unico(db, pizz.nome, pizzaria_id)
    await db.commit()
    await db.refresh(pizz)
    return pizz


def _assinatura_ja_removida(e: Exception) -> bool:
    """404 do Asaas = assinatura que já não existe lá. O cancelamento virou no-op,
    não é falha — não faz sentido bloquear a exclusão por causa disso."""
    return " 404:" in str(e)


@router.delete("/{pizzaria_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pizzaria(
    pizzaria_id: uuid.UUID,
    forcar: bool = False,
    user: Usuario = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove pizzaria (e cascateia equipe, produtos, etc). Apenas platform admin.

    Também cancela a assinatura no Asaas e apaga os logins que ficaram sem nenhum
    vínculo. `forcar=true` exclui mesmo se o cancelamento no Asaas falhar — use só
    depois de cancelar a recorrência na mão, senão o cliente segue sendo cobrado.
    """
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")

    # Cancela a recorrência no Asaas ANTES de tocar em qualquer coisa: apagar a
    # pizzaria sem cancelar deixa a assinatura viva cobrando um cliente que não
    # existe mais aqui, e sem o subscription_id (que some junto) não há como
    # achá-la depois. Por isso este é o único passo que ABORTA a exclusão ao
    # falhar — o resto é best-effort.
    subscription_id = (pizz.asaas_subscription_id or "").strip()
    if subscription_id:
        from app.services.billing_plataforma import (
            BillingError,
            PlatformAsaasClient,
            billing_configurado,
        )
        try:
            await PlatformAsaasClient().cancelar_assinatura(subscription_id)
            log.info("delete_pizzaria: assinatura %s cancelada no Asaas (pizzaria=%s)",
                     subscription_id, pizzaria_id)
        except BillingError as e:
            if _assinatura_ja_removida(e):
                log.info("delete_pizzaria: assinatura %s já não existia no Asaas", subscription_id)
            elif forcar:
                log.error("delete_pizzaria: exclusão FORÇADA com assinatura %s ativa no Asaas "
                          "(pizzaria=%s): %s — cancele na mão!", subscription_id, pizzaria_id, e)
            else:
                # Gateway ausente e gateway fora do ar levam a ações diferentes, então
                # a mensagem separa os dois em vez de jogar o traceback cru na tela.
                motivo = (
                    "o gateway de cobrança da plataforma não está configurado "
                    "(Administração → Planos → Gateway de cobrança), então não há como "
                    "cancelar a recorrência a partir daqui"
                    if not billing_configurado()
                    else f"o Asaas recusou o cancelamento ({e})"
                )
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY,
                    f"A pizzaria NÃO foi excluída porque {motivo}. Apagá-la agora deixaria a "
                    f"assinatura {subscription_id} cobrando um cliente que não existe mais "
                    f"aqui, e sem esse registro não haveria como encontrá-la depois. "
                    f"Resolva o gateway e repita, cancele a assinatura direto no painel do "
                    f"Asaas, ou repita com ?forcar=true se souber que ela já não cobra.",
                ) from e

    # Best-effort: remove a instância da Evolution junto com a pizzaria.
    if pizz.instancia:
        try:
            await evolution.delete_instance(instancia=pizz.instancia)
        except Exception:  # noqa: BLE001
            log.warning("Falha ao remover instância %s da Evolution", pizz.instancia)

    # Quem tinha login por causa DESTA pizzaria (dono, equipe, entregadores).
    # Coletado ANTES dos deletes: depois que equipe_pizzaria e entregadores somem,
    # não há mais como descobrir. `usuarios` é tabela global (sem pizzaria_id), então
    # nenhum delete/cascade abaixo a toca — sem isto o login fica órfão e o e-mail
    # continua ocupando o índice único, bloqueando um recadastro com o mesmo e-mail.
    candidatos: set[uuid.UUID] = set(
        (await db.execute(
            select(EquipePizzaria.usuario_id).where(
                EquipePizzaria.pizzaria_id == pizzaria_id,
                EquipePizzaria.usuario_id.is_not(None),
            )
        )).scalars().all()
    )
    candidatos.update((await db.execute(
        select(Entregador.usuario_id).where(Entregador.pizzaria_id == pizzaria_id)
    )).scalars().all())

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
        "DELETE FROM public.llm_usage WHERE pizzaria_id = :pid",
        "DELETE FROM public.cardapio_arquivo WHERE pizzaria_id = :pid",
        "DELETE FROM public.plataforma_alertas WHERE pizzaria_id = :pid",
        # NÃO reintroduzir aqui:
        #   app_config          — é global (chave/valor), não tem coluna pizzaria_id;
        #   assinatura_pizzaria — tabela não existe (o estado da assinatura vive em
        #                         pizzarias.asaas_* e em faturas).
        # Ambas falhavam calado a cada exclusão, virando ruído nos warnings abaixo.
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
        for padrao in (f"pending:{pid}:*", f"flush_at:{pid}:*", f"batch_start:{pid}:*",
                       f"inflight:{pid}:*", f"lock:flush:{pid}:*"):
            chaves = await _redis.keys(padrao)
            if chaves:
                await _redis.delete(*chaves)

        # O ZSET de prazos do dispatcher é global e seus membros são
        # "{pizzaria_id}:{telefone}", então não saem pelos padrões de chave acima.
        # Sem o ZREM, o dispatcher segue acordando por uma pizzaria que não existe.
        from app.dispatcher.streams import DUE_KEY
        membros: list[str] = []
        cursor = 0
        while True:
            cursor, lote = await _redis.zscan(DUE_KEY, cursor=cursor, match=f"{pid}:*", count=500)
            # zscan devolve pares (membro, score); só o membro interessa pro ZREM.
            membros.extend(par[0] if isinstance(par, (tuple, list)) else par for par in lote)
            if cursor == 0:
                break
        if membros:
            await _redis.zrem(DUE_KEY, *membros)
    except Exception as e:  # noqa: BLE001
        # Best-effort de verdade (a pizzaria já foi apagada do banco), mas registrado:
        # engolir calado aqui foi o que escondeu esse resíduo até agora.
        log.warning("delete_pizzaria: limpeza do Redis incompleta para %s: %s", pizzaria_id, e)

    await db.delete(pizz)
    # flush, não commit: emite o DELETE e dispara os ON DELETE CASCADE já dentro da
    # transação, então a varredura abaixo enxerga equipe/entregadores SEM esta
    # pizzaria. Se algo falhar daqui pra frente, o rollback desfaz tudo junto.
    await db.flush()

    # Agora apaga os logins que ficaram sem NENHUM vínculo. Platform admins nunca
    # entram (o que também protege quem está executando a exclusão) e o NOT EXISTS
    # preserva quem ainda é equipe ou entregador em outra pizzaria. As FKs que
    # apontam pra usuarios são SET NULL ou CASCADE, então o histórico não quebra.
    if candidatos:
        from sqlalchemy import delete as _delete

        orfaos = await db.execute(
            _delete(Usuario)
            .where(
                Usuario.id.in_(list(candidatos)),
                Usuario.is_platform_admin.is_(False),
                ~select(EquipePizzaria.id)
                .where(EquipePizzaria.usuario_id == Usuario.id)
                .correlate(Usuario)
                .exists(),
                ~select(Entregador.id)
                .where(Entregador.usuario_id == Usuario.id)
                .correlate(Usuario)
                .exists(),
            )
            .execution_options(synchronize_session=False)
        )
        if orfaos.rowcount:
            log.info("delete_pizzaria: %s login(s) órfão(s) removido(s) junto da pizzaria %s",
                     orfaos.rowcount, pizzaria_id)

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
    """Nome da casa → slug de URL.

    Acento vira a letra base, não traço: antes "Pizzaria Açaí" virava
    `pizzaria-a-a`, um endereço que ninguém digita nem reconhece.
    """
    base = unicodedata.normalize("NFKD", s or "")
    base = "".join(c for c in base if not unicodedata.combining(c))
    base = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
    return base or "pizzaria"


async def slug_unico(db: AsyncSession, nome: str, self_id: uuid.UUID) -> str:
    """Slug livre para esta pizzaria (a coluna tem unique).

    Único ponto que gera slug no sistema. Estava duplicado entre a criação pelo
    admin e o PATCH, e o cadastro público simplesmente não gerava — toda
    pizzaria que entrou por lá ficou sem cardápio, com 404 no /m/<slug>.
    """
    base = _slugify(nome)
    for i in range(100):
        candidato = base if i == 0 else f"{base}-{i}"
        existe = (
            await db.execute(
                select(Pizzaria.id).where(Pizzaria.slug == candidato, Pizzaria.id != self_id)
            )
        ).scalar_one_or_none()
        if not existe:
            return candidato
    return f"{base}-{uuid.uuid4().hex[:6]}"


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

    from app.services.app_config import get_evolution_config

    cfg_evo = await get_evolution_config(db)
    if not cfg_evo["configurada"]:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Evolution API não configurada. O administrador da plataforma precisa "
            "informar a URL e a chave em Administração → IA e integrações.",
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
        from app.services.alertas import registrar_alerta_seguro

        await registrar_alerta_seguro(
            tipo="evolution_offline",
            detalhe=(
                f"Falha ao conectar o WhatsApp de '{pizz.nome}' (instância "
                f"{instancia}): a Evolution não respondeu. O QR Code não pôde ser "
                f"gerado. Detalhe: {e}"
            ),
            pizzaria_id=pizz.id,
            nivel="error",
        )
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
        from app.services.alertas import registrar_alerta_seguro

        await registrar_alerta_seguro(
            tipo="evolution_offline",
            detalhe=(
                f"Falha ao gerar o QR Code de '{pizz.nome}' (instância "
                f"{pizz.instancia}): a Evolution não respondeu. Detalhe: {e}"
            ),
            pizzaria_id=pizz.id,
            nivel="error",
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Evolution: {e}") from e
    return {
        "instancia": pizz.instancia,
        "qrcode": _extract_qr(conn),
        "state": state,
        "conectado": state == "open",
    }
