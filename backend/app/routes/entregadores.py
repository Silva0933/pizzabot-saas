"""
API de entregadores (painel de entregador).

Dois conjuntos de rotas:
  - Dono (escopo `membership`): CRUD de entregadores + toggle de self-claim.
  - Entregador (escopo `current_entregador`): minhas entregas, disponíveis,
    pegar pedido livre, atualizar status (saí/entreguei), disponibilidade.

O entregador reusa a conta `usuarios` (mesmo /auth/login). Atualização de
status reaproveita `apply_status_change` de pedidos.py (mensagem ao cliente +
broadcast). Sem aviso novo ao cliente — usa o "saiu para entrega" já existente.
"""
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, revogar_sessoes
from app.db import get_db
from app.deps import current_entregador, membership
from app.models import Entregador, EquipePizzaria, Pedido, Pizzaria, Usuario
from app.routes.pedidos import PedidoOut, _broadcast_atribuicao, apply_status_change

# O entregador enxerga o pedido desde que seja atribuído a ele (status confirmado em
# diante). "Minhas entregas" = atribuídos a ele e em qualquer status ativo (inclui
# 'pronto_entrega', que ele acabou de pegar e ainda não saiu).
ENTREGA_ATIVA = ("confirmado", "no_forno", "pronto_entrega", "a_caminho")
# "Disponíveis" para pegar = só os que já estão PRONTOS PARA ENTREGA (saíram do
# forno e estão prontos para sair). Pizza ainda no forno não fica disponível.
DISPONIVEL_STATUS = ("pronto_entrega",)
DRIVER_STATUSES = ("a_caminho", "entregue")

owner_router = APIRouter(prefix="/pizzarias/{pizzaria_id}/entregadores", tags=["entregadores"])
driver_router = APIRouter(prefix="/pizzarias/{pizzaria_id}/entregador", tags=["entregador"])


# ============================================
# Schemas
# ============================================
class EntregadorOut(BaseModel):
    id: uuid.UUID
    nome: str
    email: str
    telefone: str | None = None
    disponivel: bool
    ativo: bool
    entregas_concluidas: int = 0
    # Última posição enviada pelo app (turno ligado).
    lat: float | None = None
    lon: float | None = None
    localizacao_em: datetime | None = None
    # Ganhos de hoje (soma dos valores por entrega congelados), se a loja paga por entrega.
    ganhos_hoje: float = 0.0
    created_at: datetime


class EntregadoresResp(BaseModel):
    entregadores: list[EntregadorOut]
    permitir_autoatribuicao: bool
    repasse_ativo: bool = False
    repasse_valor: float | None = None


class EntregadorCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=6)
    telefone: str | None = None


class EntregadorUpdate(BaseModel):
    nome: str | None = Field(default=None, max_length=80)
    telefone: str | None = None
    ativo: bool | None = None
    nova_senha: str | None = Field(default=None, min_length=6)


class ConfigIn(BaseModel):
    # Campos ausentes mantêm o valor atual (cada cartão do painel salva o seu).
    permitir_autoatribuicao: bool | None = None
    repasse_ativo: bool | None = None
    repasse_valor: float | None = Field(default=None, ge=0, le=1000)


class DriverStatusIn(BaseModel):
    status: str
    # Confirmação da entrega: o código que o cliente recebeu no WhatsApp, ou o
    # motivo de confirmar sem ele (fica registrado no histórico do pedido).
    codigo: str | None = Field(default=None, max_length=10)
    sem_codigo_motivo: str | None = Field(default=None, max_length=300)


class LocalizacaoIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    precisao: float | None = Field(default=None, ge=0, le=100_000)


class DisponibilidadeIn(BaseModel):
    disponivel: bool


# Início do dia no fuso das pizzarias (o "hoje" do entregador e do painel).
_HOJE_SQL = "(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')"


def _out(ent: Entregador, entregas: int = 0, ganhos_hoje: float = 0.0) -> EntregadorOut:
    return EntregadorOut(
        ganhos_hoje=round(float(ganhos_hoje or 0), 2),
        id=ent.id,
        nome=ent.nome,
        email=ent.usuario.email if ent.usuario else "",
        telefone=ent.telefone,
        disponivel=ent.disponivel,
        ativo=ent.ativo,
        entregas_concluidas=entregas,
        lat=ent.lat,
        lon=ent.lon,
        localizacao_em=ent.localizacao_em,
        created_at=ent.created_at,
    )


# ============================================
# Dono — CRUD + config
# ============================================
@owner_router.get("", response_model=EntregadoresResp)
async def listar_entregadores(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadoresResp:
    rows = (
        await db.execute(
            select(Entregador).where(Entregador.pizzaria_id == pizzaria_id).order_by(Entregador.created_at)
        )
    ).scalars().all()
    # Quantas entregas cada entregador concluiu (status 'entregue').
    count_rows = (
        await db.execute(
            select(Pedido.entregador_id, func.count())
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.status == "entregue",
                Pedido.entregador_id.isnot(None),
            )
            .group_by(Pedido.entregador_id)
        )
    ).all()
    counts = {row[0]: row[1] for row in count_rows}
    ganhos_rows = (
        await db.execute(
            select(Pedido.entregador_id, func.coalesce(func.sum(Pedido.repasse_entregador), 0))
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.status == "entregue",
                Pedido.entregador_id.isnot(None),
                text(f"pedidos.entregue_em >= {_HOJE_SQL}"),
            )
            .group_by(Pedido.entregador_id)
        )
    ).all()
    ganhos = {row[0]: float(row[1] or 0) for row in ganhos_rows}
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    return EntregadoresResp(
        entregadores=[_out(e, counts.get(e.id, 0), ganhos.get(e.id, 0.0)) for e in rows],
        permitir_autoatribuicao=pizz.permitir_autoatribuicao_entregador,
        repasse_ativo=bool(pizz.repasse_entregador_ativo),
        repasse_valor=float(pizz.repasse_entregador_valor) if pizz.repasse_entregador_valor is not None else None,
    )


@owner_router.put("/config", response_model=EntregadoresResp)
async def set_config(
    pizzaria_id: uuid.UUID,
    body: ConfigIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadoresResp:
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    if body.permitir_autoatribuicao is not None:
        pizz.permitir_autoatribuicao_entregador = body.permitir_autoatribuicao
    if body.repasse_valor is not None:
        pizz.repasse_entregador_valor = Decimal(str(round(body.repasse_valor, 2)))
    if body.repasse_ativo is not None:
        if body.repasse_ativo and pizz.repasse_entregador_valor is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o valor por entrega.")
        pizz.repasse_entregador_ativo = body.repasse_ativo
    await db.commit()
    return await listar_entregadores(pizzaria_id, db, None)  # type: ignore[arg-type]


@owner_router.post("", response_model=EntregadorOut, status_code=status.HTTP_201_CREATED)
async def criar_entregador(
    pizzaria_id: uuid.UUID,
    body: EntregadorCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadorOut:
    """Cria a conta de login (usuarios) + o vínculo de entregador na pizzaria."""
    email = body.email.lower()
    existing = (
        await db.execute(select(Usuario).where(func.lower(Usuario.email) == email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este email já está em uso.")

    user = Usuario(email=email, senha_hash=hash_password(body.senha), nome=body.nome.strip())
    db.add(user)
    await db.flush()

    ent = Entregador(
        pizzaria_id=pizzaria_id,
        usuario_id=user.id,
        nome=body.nome.strip(),
        telefone=body.telefone,
    )
    db.add(ent)
    await db.commit()
    await db.refresh(ent)
    return _out(ent)


@owner_router.patch("/{entregador_id}", response_model=EntregadorOut)
async def atualizar_entregador(
    pizzaria_id: uuid.UUID,
    entregador_id: uuid.UUID,
    body: EntregadorUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> EntregadorOut:
    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.id == entregador_id, Entregador.pizzaria_id == pizzaria_id
            )
        )
    ).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entregador não encontrado")

    if body.nome is not None:
        ent.nome = body.nome.strip()
    if body.telefone is not None:
        ent.telefone = body.telefone
    if body.ativo is not None:
        ent.ativo = body.ativo
    if body.nova_senha and ent.usuario:
        ent.usuario.senha_hash = hash_password(body.nova_senha)
        # Senha trocada pelo dono: quem estava logado com a antiga cai.
        revogar_sessoes(ent.usuario)

    await db.commit()
    await db.refresh(ent)
    return _out(ent)


@owner_router.delete("/{entregador_id}")
async def remover_entregador(
    pizzaria_id: uuid.UUID,
    entregador_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    ent = (
        await db.execute(
            select(Entregador).where(
                Entregador.id == entregador_id, Entregador.pizzaria_id == pizzaria_id
            )
        )
    ).scalar_one_or_none()
    if not ent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entregador não encontrado")

    usuario_id = ent.usuario_id
    await db.execute(delete(Entregador).where(Entregador.id == entregador_id))

    # Se a conta de login era exclusiva de entregador (sem vínculo de equipe),
    # remove o usuário órfão para não deixar login pendurado.
    tem_equipe = (
        await db.execute(
            select(EquipePizzaria.id).where(EquipePizzaria.usuario_id == usuario_id).limit(1)
        )
    ).scalar_one_or_none()
    outro_entregador = (
        await db.execute(
            select(Entregador.id).where(Entregador.usuario_id == usuario_id).limit(1)
        )
    ).scalar_one_or_none()
    if not tem_equipe and not outro_entregador:
        await db.execute(delete(Usuario).where(Usuario.id == usuario_id))

    await db.commit()
    return {"ok": True}


# ============================================
# Entregador — entregas
# ============================================
@driver_router.get("/minhas-entregas", response_model=list[PedidoOut])
async def minhas_entregas(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> list[Pedido]:
    rows = (
        await db.execute(
            select(Pedido)
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id == ent.id,
                Pedido.status.in_(ENTREGA_ATIVA),
            )
            .order_by(desc(Pedido.atribuido_em))
        )
    ).scalars().all()
    return list(rows)


@driver_router.get("/disponiveis", response_model=list[PedidoOut])
async def entregas_disponiveis(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> list[Pedido]:
    """Pedidos delivery sem entregador, prontos para entrega — só se o self-claim
    estiver ligado para a pizzaria."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    if not pizz.permitir_autoatribuicao_entregador:
        return []
    rows = (
        await db.execute(
            select(Pedido)
            .where(
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id.is_(None),
                Pedido.tipo == "delivery",
                Pedido.status.in_(DISPONIVEL_STATUS),
            )
            .order_by(desc(Pedido.created_at))
        )
    ).scalars().all()
    return list(rows)


@driver_router.get("/resumo")
async def resumo_entregador(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    """Entregas concluídas (total e hoje) e, se a loja paga por entrega, os ganhos."""
    filtros = (
        Pedido.pizzaria_id == pizzaria_id,
        Pedido.entregador_id == ent.id,
        Pedido.status == "entregue",
    )
    soma = func.coalesce(func.sum(Pedido.repasse_entregador), 0)
    total, ganhos_total = (await db.execute(select(func.count(), soma).where(*filtros))).one()
    hoje, ganhos_hoje = (await db.execute(
        select(func.count(), soma).where(*filtros, text(f"pedidos.entregue_em >= {_HOJE_SQL}"))
    )).one()
    semana, ganhos_semana = (await db.execute(
        select(func.count(), soma).where(*filtros, text(f"pedidos.entregue_em >= {_HOJE_SQL} - interval '6 days'"))
    )).one()
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    repasse_ativo = bool(pizz.repasse_entregador_ativo)
    return {
        "entregas_total": int(total), "entregas_hoje": int(hoje), "entregas_semana": int(semana),
        "repasse_ativo": repasse_ativo,
        "repasse_valor": float(pizz.repasse_entregador_valor) if repasse_ativo and pizz.repasse_entregador_valor is not None else None,
        # Valores só com o repasse ligado: desligado, o app não mostra dinheiro.
        "ganhos_hoje": round(float(ganhos_hoje), 2) if repasse_ativo else None,
        "ganhos_semana": round(float(ganhos_semana), 2) if repasse_ativo else None,
        "ganhos_total": round(float(ganhos_total), 2) if repasse_ativo else None,
    }


@driver_router.get("/historico")
async def historico_entregador(
    pizzaria_id: uuid.UUID,
    dias: int = 30,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    """Entregas concluídas pelo entregador nos últimos `dias` (máx. 90), da mais
    recente para a mais antiga, com o valor ganho em cada uma se a loja paga
    por entrega."""
    dias = max(1, min(int(dias), 90))
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    repasse_ativo = bool(pizz.repasse_entregador_ativo)
    rows = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == pizzaria_id,
            Pedido.entregador_id == ent.id,
            Pedido.status == "entregue",
            text(f"pedidos.entregue_em >= {_HOJE_SQL} - make_interval(days => :dias)").bindparams(dias=dias - 1),
        ).order_by(desc(Pedido.entregue_em)).limit(300)
    )).scalars().all()
    return {
        "repasse_ativo": repasse_ativo,
        "entregas": [
            {
                "pedido_id": str(p.id),
                "numero_pedido": p.numero_pedido,
                "cliente": p.cliente.nome if p.cliente else None,
                "endereco": p.endereco_entrega,
                "entregue_em": p.entregue_em.isoformat() if p.entregue_em else None,
                "valor_total": float(p.valor_total or 0),
                "forma_pagamento": p.forma_pagamento,
                "repasse": float(p.repasse_entregador) if repasse_ativo and p.repasse_entregador is not None else None,
            }
            for p in rows
        ],
    }


@driver_router.post("/pedidos/{pedido_id}/pegar", response_model=PedidoOut)
async def pegar_pedido(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> Pedido:
    """Self-claim: o entregador pega um pedido livre (valida o toggle no backend)."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    if not pizz.permitir_autoatribuicao_entregador:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A pizzaria não permite pegar pedidos livres.")

    p = (
        await db.execute(
            select(Pedido).where(Pedido.id == pedido_id, Pedido.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    if p.entregador_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Pedido já tem entregador.")

    p.entregador_id = ent.id
    p.atribuido_em = datetime.now(UTC)
    await db.commit()
    await db.refresh(p)
    await _broadcast_atribuicao(pizzaria_id, p)
    return p


@driver_router.post("/pedidos/{pedido_id}/status", response_model=PedidoOut)
async def atualizar_status_entregador(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    body: DriverStatusIn,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> Pedido:
    """Entregador atualiza o status (apenas 'a_caminho' e 'entregue') do SEU pedido."""
    if body.status not in DRIVER_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Entregador só pode usar: {DRIVER_STATUSES}")

    p = (
        await db.execute(
            select(Pedido).where(
                Pedido.id == pedido_id,
                Pedido.pizzaria_id == pizzaria_id,
                Pedido.entregador_id == ent.id,
            )
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado ou não é seu")

    motivo = None
    if body.status == "entregue" and p.codigo_entrega:
        from app.services.entregas import codigo_confere
        sem_codigo = (body.sem_codigo_motivo or "").strip()
        if (body.codigo or "").strip():
            if not codigo_confere(p.codigo_entrega, body.codigo):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    "O código não confere. Confira com o cliente.")
        elif len(sem_codigo) >= 3:
            motivo = f"Entregue sem o código do cliente: {sem_codigo}"
        else:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Informe o código que o cliente recebeu no WhatsApp.")

    return await apply_status_change(
        db, pizzaria_id, p, body.status, motivo,
        ator_id=ent.usuario_id, ator_nome=ent.nome, ator_tipo="entregador",
    )


@driver_router.post("/localizacao")
async def registrar_localizacao(
    pizzaria_id: uuid.UUID,
    body: LocalizacaoIn,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    """Posição enviada pelo app durante o turno. A pizzaria vê o entregador no
    painel e a rota parte de onde ele está."""
    agora = datetime.now(UTC)
    ent.lat, ent.lon, ent.precisao_m, ent.localizacao_em = body.lat, body.lon, body.precisao, agora
    await db.commit()
    try:
        from app.services.broadcaster import broadcaster
        await broadcaster.publish(pizzaria_id, {
            "tipo": "entregador.localizacao",
            "pizzaria_id": str(pizzaria_id),
            "payload": {"entregador_id": str(ent.id), "nome": ent.nome, "lat": body.lat,
                        "lon": body.lon, "em": agora.isoformat()},
        })
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True}


# Posição do entregador mais velha que isso não serve de ponto de partida.
POSICAO_VALIDA_S = 10 * 60


@driver_router.get("/rota")
async def minha_rota(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    """Paradas do entregador em ordem (coleta na pizzaria, se houver pedido a
    retirar, e as entregas pelo vizinho mais próximo) + links do Maps e do Waze."""
    from app.services import entregas as E

    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
    pedidos = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == pizzaria_id,
            Pedido.entregador_id == ent.id,
            Pedido.tipo == "delivery",
            Pedido.status.in_(("pronto_entrega", "a_caminho")),
        ).order_by(Pedido.atribuido_em)
    )).scalars().all()

    cidade = E.cidade_da_pizzaria(pizz.endereco)
    ponto_pizzaria = await E.coordenadas(pizz.endereco) if pizz.endereco else None
    posicao = None
    if ent.lat is not None and ent.lon is not None and ent.localizacao_em is not None \
            and (datetime.now(UTC) - ent.localizacao_em).total_seconds() < POSICAO_VALIDA_S:
        posicao = (ent.lat, ent.lon)

    entregas = []
    for p in pedidos:
        ponto = (p.endereco_lat, p.endereco_lon) if p.endereco_lat is not None and p.endereco_lon is not None \
            else await E.coordenadas(p.endereco_entrega, cidade=cidade, perto_de=ponto_pizzaria)
        entregas.append({
            "tipo": "entrega", "pedido_id": str(p.id), "numero_pedido": p.numero_pedido,
            "status": p.status, "cliente": p.cliente.nome if p.cliente else None,
            "endereco": p.endereco_entrega, "lat": ponto[0] if ponto else None,
            "lon": ponto[1] if ponto else None,
        })

    # Algum pedido ainda não foi retirado: a rota começa pela pizzaria.
    coleta = None
    if any(p.status == "pronto_entrega" for p in pedidos):
        coleta = {"tipo": "coleta", "nome": pizz.nome, "endereco": pizz.endereco,
                  "lat": ponto_pizzaria[0] if ponto_pizzaria else None,
                  "lon": ponto_pizzaria[1] if ponto_pizzaria else None}
    inicio = (coleta and ponto_pizzaria) or posicao or ponto_pizzaria
    ordenadas = E.ordenar_paradas(inicio, entregas)
    paradas = ([coleta] if coleta else []) + ordenadas
    if coleta and posicao and ponto_pizzaria:
        coleta["distancia_km"] = round(E.distancia_km(posicao, ponto_pizzaria), 2)

    total = sum(p.get("distancia_km") or 0 for p in paradas)
    for p in paradas:
        p["waze_url"] = E.link_waze(p)
    return {
        "paradas": paradas,
        "distancia_km": round(total, 1),
        "google_maps_url": E.link_google_maps(paradas),
        "sem_coordenada": sum(1 for p in paradas if p.get("lat") is None),
        "origem": "posicao_atual" if posicao else ("pizzaria" if ponto_pizzaria else "desconhecida"),
    }


@driver_router.patch("/disponibilidade")
async def set_disponibilidade(
    pizzaria_id: uuid.UUID,
    body: DisponibilidadeIn,
    db: AsyncSession = Depends(get_db),
    ent: Entregador = Depends(current_entregador),
) -> dict:
    ent.disponivel = body.disponivel
    await db.commit()
    return {"ok": True, "disponivel": ent.disponivel}
