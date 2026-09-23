"""
API de pedidos: list, get, atualizar status, cancelar.

Atualização de status dispara:
  - Mensagem automática pro cliente via Evolution
  - Broadcast WS pro painel
  - Evento de auditoria
"""
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user, membership
from app.models import Pedido, PedidoEvento, Usuario
from app.services.broadcaster import broadcaster
from app.services.order_audit import registrar_evento_pedido
from app.services.order_flow import ORDER_STATUSES, validate_transition
from app.services.status_messages import enviar_mensagem_status

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/pedidos", tags=["pedidos"])

VALID_STATUSES = ORDER_STATUSES


class ClienteMinOut(BaseModel):
    nome: str | None
    telefone: str

    model_config = {"from_attributes": True}


class EntregadorMinOut(BaseModel):
    id: uuid.UUID
    nome: str

    model_config = {"from_attributes": True}


class PedidoOut(BaseModel):
    id: uuid.UUID
    pizzaria_id: uuid.UUID
    cliente_id: uuid.UUID
    numero_pedido: int | None
    itens: list[dict]
    valor_total: Decimal
    status: str
    tipo: str
    endereco_entrega: str | None
    endereco_lat: float | None = None
    endereco_lon: float | None = None
    forma_pagamento: str | None
    observacoes: str | None
    payment_status: str
    link_pagamento: str | None
    bot_ativo: bool
    nps_nota: int | None = None
    nps_comentario: str | None = None
    entregador_id: uuid.UUID | None = None
    atribuido_em: datetime | None = None
    entregador: EntregadorMinOut | None = None
    em_problema: bool = False
    problema_motivo: str | None = None
    problema_aberto_em: datetime | None = None
    created_at: datetime
    updated_at: datetime
    cliente: ClienteMinOut | None = None

    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: str
    motivo: str | None = None


class CorrecaoIn(BaseModel):
    status: str
    justificativa: str = Field(min_length=5, max_length=800)


class ProblemaIn(BaseModel):
    motivo: str = Field(min_length=5, max_length=800)


class ResolverProblemaIn(BaseModel):
    motivo: str | None = Field(default=None, max_length=800)


class PedidoEventoOut(BaseModel):
    id: uuid.UUID
    tipo: str
    status_anterior: str | None
    status_novo: str | None
    motivo: str | None
    ator_nome: str | None
    ator_tipo: str
    detalhes: dict
    created_at: datetime

    model_config = {"from_attributes": True}


def _ator(usuario: Usuario, vinculo: object) -> tuple[uuid.UUID, str, str]:
    nome = usuario.nome or usuario.email
    role = getattr(vinculo, "role", "admin")
    return usuario.id, nome, role


def _pode_corrigir(usuario: Usuario, vinculo: object) -> bool:
    return usuario.is_platform_admin or getattr(vinculo, "role", "") in {"admin", "proprietario", "gerente"}


async def apply_status_change(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    p: Pedido,
    novo_status: str,
    motivo: str | None = None,
    *,
    ator_id: uuid.UUID | None = None,
    ator_nome: str | None = None,
    ator_tipo: str = "sistema",
    correcao: bool = False,
) -> Pedido:
    """Aplica a troca de status + efeitos (mensagem ao cliente, NPS, broadcast).
    Reutilizado pelo painel do dono e pelo painel do entregador. `p` já deve
    estar carregado e escopado à pizzaria."""
    if novo_status not in VALID_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Status inválido. Use: {VALID_STATUSES}")

    if p.status == novo_status:
        return p  # idempotente

    if not correcao:
        erro = validate_transition(p.status, novo_status, p.tipo)
        if erro:
            raise HTTPException(status.HTTP_409_CONFLICT, erro)
    if novo_status == "cancelado" and not (motivo or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o motivo do cancelamento.")

    old_status = p.status
    p.status = novo_status
    if novo_status == "cancelado":
        p.cancelado_at = datetime.now(UTC)
        p.cancelamento_motivo = motivo

    registrar_evento_pedido(
        db, p, tipo="correcao" if correcao else "status_alterado",
        status_anterior=old_status, status_novo=novo_status, motivo=motivo,
        ator_id=ator_id, ator_nome=ator_nome, ator_tipo=ator_tipo,
    )
    await db.commit()
    await db.refresh(p)

    # Mensagem automática ao cliente em BACKGROUND (não trava a resposta da API).
    # Se o agendamento falhar, manda inline como fallback (best-effort).
    try:
        from app.workers.tasks import enviar_status_msg
        enviar_status_msg.apply_async(args=[str(pizzaria_id), str(p.id), novo_status])
    except Exception:  # noqa: BLE001
        try:
            await enviar_mensagem_status(db, p, novo_status)
            await db.commit()
        except Exception:  # noqa: BLE001
            pass

    # Pós-venda: ao sair para entrega, agenda a pesquisa de satisfação (NPS).
    if novo_status == "a_caminho":
        try:
            import os

            from app.workers.tasks import enviar_nps
            delay = int(os.getenv("NPS_DELAY_SECONDS", "3000"))  # ~50 min
            enviar_nps.apply_async(args=[str(pizzaria_id), str(p.id)], countdown=delay)
        except Exception:  # noqa: BLE001
            pass

    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(pizzaria_id),
            "payload": {
                "pedido_id": str(p.id),
                "numero_pedido": p.numero_pedido,
                "status_anterior": old_status,
                "status_novo": p.status,
            },
        },
    )
    return p


# ============================================
# Listar
# ============================================
@router.get("", response_model=list[PedidoOut])
async def list_pedidos(
    pizzaria_id: uuid.UUID,
    status_filter: str | None = Query(None, alias="status"),
    hoje: bool = Query(False, description="Só pedidos de hoje (fuso America/Sao_Paulo)"),
    desde: datetime | None = Query(None, description="Filtra created_at >= desde"),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Pedido]:
    stmt = (
        select(Pedido)
        .where(Pedido.pizzaria_id == pizzaria_id)
        .order_by(desc(Pedido.created_at))
        .limit(limit)
    )
    if status_filter:
        stmt = stmt.where(Pedido.status == status_filter)
    if hoje:
        # Início do dia atual no fuso de São Paulo (predicado SQL puro).
        stmt = stmt.where(text(
            "pedidos.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')"
        ))
    elif desde:
        stmt = stmt.where(Pedido.created_at >= desde)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/problemas", response_model=list[PedidoOut])
async def listar_pedidos_problema(
    pizzaria_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Pedido]:
    stmt = (
        select(Pedido)
        .where(Pedido.pizzaria_id == pizzaria_id, Pedido.em_problema.is_(True))
        .order_by(desc(Pedido.problema_aberto_em), desc(Pedido.created_at))
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


# ============================================
# Get único
# ============================================
@router.get("/{pedido_id}", response_model=PedidoOut)
async def get_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    return p


@router.get("/{pedido_id}/historico", response_model=list[PedidoEventoOut])
async def historico_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[PedidoEvento]:
    return list((await db.execute(
        select(PedidoEvento)
        .where(PedidoEvento.pizzaria_id == pizzaria_id, PedidoEvento.pedido_id == pedido_id)
        .order_by(desc(PedidoEvento.created_at))
    )).scalars().all())


@router.post("/{pedido_id}/problema", response_model=PedidoOut)
async def sinalizar_problema(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: ProblemaIn,
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
    usuario: Usuario = Depends(current_user),
) -> Pedido:
    p = (await db.execute(select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    ator_id, ator_nome, ator_tipo = _ator(usuario, vinculo)
    p.em_problema = True
    p.problema_motivo = body.motivo.strip()
    p.problema_aberto_em = datetime.now(UTC)
    registrar_evento_pedido(db, p, tipo="problema_aberto", motivo=p.problema_motivo,
                            ator_id=ator_id, ator_nome=ator_nome, ator_tipo=ator_tipo)
    await db.commit()
    await db.refresh(p)
    return p


@router.post("/{pedido_id}/problema/resolver", response_model=PedidoOut)
async def resolver_problema(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: ResolverProblemaIn,
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
    usuario: Usuario = Depends(current_user),
) -> Pedido:
    p = (await db.execute(select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    if not p.em_problema:
        return p
    ator_id, ator_nome, ator_tipo = _ator(usuario, vinculo)
    p.em_problema = False
    p.problema_motivo = None
    p.problema_aberto_em = None
    registrar_evento_pedido(db, p, tipo="problema_resolvido", motivo=body.motivo,
                            ator_id=ator_id, ator_nome=ator_nome, ator_tipo=ator_tipo)
    await db.commit()
    await db.refresh(p)
    return p


@router.post("/{pedido_id}/corrigir", response_model=PedidoOut)
async def corrigir_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: CorrecaoIn,
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
    usuario: Usuario = Depends(current_user),
) -> Pedido:
    if not _pode_corrigir(usuario, vinculo):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Somente proprietarios e gestores podem corrigir um pedido.")
    p = (await db.execute(select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    ator_id, ator_nome, ator_tipo = _ator(usuario, vinculo)
    return await apply_status_change(
        db, pizzaria_id, p, body.status, body.justificativa.strip(),
        ator_id=ator_id, ator_nome=ator_nome, ator_tipo=ator_tipo, correcao=True,
    )


# ============================================
# Atualizar status (dispara efeitos colaterais)
# ============================================
@router.patch("/{pedido_id}/status", response_model=PedidoOut)
async def update_status(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    vinculo: object = Depends(membership),
    usuario: Usuario = Depends(current_user),
) -> Pedido:
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    ator_id, ator_nome, ator_tipo = _ator(usuario, vinculo)
    return await apply_status_change(db, pizzaria_id, p, body.status, body.motivo,
                                     ator_id=ator_id, ator_nome=ator_nome, ator_tipo=ator_tipo)


# ============================================
# Atribuição de entregador (painel do dono)
# ============================================
class AtribuirIn(BaseModel):
    entregador_id: uuid.UUID


async def _broadcast_atribuicao(pizzaria_id: uuid.UUID, p: Pedido) -> None:
    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "entregador.atribuicao",
            "pizzaria_id": str(pizzaria_id),
            "payload": {
                "pedido_id": str(p.id),
                "numero_pedido": p.numero_pedido,
                "entregador_id": str(p.entregador_id) if p.entregador_id else None,
            },
        },
    )


@router.post("/{pedido_id}/atribuir", response_model=PedidoOut)
async def atribuir_entregador(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: AtribuirIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    """Dono atribui um pedido a um entregador ativo da pizzaria (não altera o status)."""
    from app.models import Entregador

    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.id == body.entregador_id,
                Entregador.pizzaria_id == pizzaria_id,
                Entregador.ativo.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entregador não encontrado")

    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    p.entregador_id = ent.id
    p.atribuido_em = datetime.now(UTC)
    registrar_evento_pedido(db, p, tipo="entregador_atribuido",
                            detalhes={"entregador_id": str(ent.id), "entregador_nome": ent.nome})
    await db.commit()
    await db.refresh(p)
    await _broadcast_atribuicao(pizzaria_id, p)
    return p


@router.post("/{pedido_id}/desatribuir", response_model=PedidoOut)
async def desatribuir_entregador(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    """Remove o entregador atribuído a um pedido."""
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    p.entregador_id = None
    p.atribuido_em = None
    registrar_evento_pedido(db, p, tipo="entregador_desatribuido")
    await db.commit()
    await db.refresh(p)
    await _broadcast_atribuicao(pizzaria_id, p)
    return p


# ============================================
# Pagamento manual: confirmar / rejeitar (conferência do comprovante)
# ============================================
async def _broadcast_pagamento(pizzaria_id: uuid.UUID, p: Pedido, old_payment: str) -> None:
    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(pizzaria_id),
            "payload": {
                "pedido_id": str(p.id),
                "numero_pedido": p.numero_pedido,
                "payment_status": p.payment_status,
                "payment_status_anterior": old_payment,
                "status": p.status,
            },
        },
    )


@router.post("/{pedido_id}/pagamento/confirmar", response_model=PedidoOut)
async def confirmar_pagamento(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    """Confirma manualmente o pagamento (Pix manual conferido pela equipe).
    Avança o pedido para 'confirmado' e avisa o cliente."""
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    old_payment = p.payment_status
    old_status = p.status
    if old_payment == "approved":
        return p  # idempotente

    p.payment_status = "approved"
    if p.status == "novo":
        p.status = "confirmado"
    registrar_evento_pedido(db, p, tipo="pagamento_confirmado",
                            detalhes={"payment_status_anterior": old_payment, "payment_status_novo": p.payment_status})
    if old_status != p.status:
        registrar_evento_pedido(db, p, tipo="status_alterado", status_anterior=old_status,
                                status_novo=p.status, motivo="Confirmacao de pagamento manual",
                                ator_nome="Sistema de pagamentos", ator_tipo="sistema")
    await db.flush()
    await enviar_mensagem_status(db, p, "pagamento_aprovado")
    await db.commit()
    await db.refresh(p)
    await _broadcast_pagamento(pizzaria_id, p, old_payment)
    return p


@router.post("/{pedido_id}/pagamento/rejeitar", response_model=PedidoOut)
async def rejeitar_pagamento(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Pedido:
    """Rejeita o pagamento manual (comprovante não bateu). Mantém o pedido em 'novo'
    e avisa o cliente pra tentar de novo ou pagar na entrega."""
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    old_payment = p.payment_status
    if old_payment == "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Pagamento já aprovado; não pode ser rejeitado.")

    p.payment_status = "rejected"
    registrar_evento_pedido(db, p, tipo="pagamento_rejeitado",
                            detalhes={"payment_status_anterior": old_payment, "payment_status_novo": p.payment_status})
    await db.flush()
    await enviar_mensagem_status(db, p, "pagamento_falhou")
    await db.commit()
    await db.refresh(p)
    await _broadcast_pagamento(pizzaria_id, p, old_payment)
    return p


# ============================================
# Apagar TODOS os pedidos da pizzaria (painel + banco)
# ============================================
@router.delete("/todos")
async def apagar_todos_pedidos(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
    x_confirm_delete: str | None = Header(None),
) -> dict:
    """
    Apaga TODOS os pedidos de uma pizzaria, do painel e do banco de dados.

    Requer header `X-Confirm-Delete: true`. Ação irreversível.
    """
    if x_confirm_delete != "true":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Header X-Confirm-Delete: true é obrigatório para confirmar esta ação destrutiva.",
        )

    result = await db.execute(delete(Pedido).where(Pedido.pizzaria_id == pizzaria_id))
    deletados = result.rowcount

    # Zera contadores de clientes (total_pedidos/total_gasto) desta pizzaria.
    await db.execute(
        text("""
            UPDATE public.clientes
            SET total_pedidos = 0, total_gasto = 0
            WHERE pizzaria_id = :pid
        """),
        {"pid": str(pizzaria_id)},
    )
    # Limpa também a memória do agente (chat) e o estado de atendimento, pra que
    # zerar os pedidos dê um recomeço de verdade (ela não "lembra" da conversa).
    for tabela in ("public.agente_memoria", "public.atendimento_estado"):
        try:
            await db.execute(text(f"DELETE FROM {tabela} WHERE pizzaria_id = :pid"), {"pid": str(pizzaria_id)})
        except Exception:  # noqa: BLE001  (tabela pode não existir em ambientes antigos)
            pass
    await db.commit()

    await broadcaster.publish(
        pizzaria_id,
        {
            "tipo": "pedidos.limpos",
            "pizzaria_id": str(pizzaria_id),
            "payload": {"pedidos_deletados": deletados},
        },
    )
    return {"ok": True, "pedidos_deletados": deletados}


# ============================================
# Apagar UM pedido (painel + banco)
# ============================================
# IMPORTANTE: declarada DEPOIS de "/todos" para que o roteamento case a rota
# literal "/todos" antes deste path param "/{pedido_id}".
@router.delete("/{pedido_id}")
async def deletar_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Exclui um pedido específico (irreversível). Notifica o painel via WS."""
    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")

    raise HTTPException(
        status.HTTP_409_CONFLICT,
        "Pedidos nao podem ser excluidos. Cancele, corrija ou sinalize um problema para preservar o historico.",
    )
