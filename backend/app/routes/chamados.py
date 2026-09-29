"""API do painel para os chamados internos da atendente e a base de conhecimento."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import membership
from app.models import ChamadoInterno, ConhecimentoLoja, Conversa

router = APIRouter(prefix="/pizzarias/{pizzaria_id}", tags=["chamados"])


class ChamadoOut(BaseModel):
    id: uuid.UUID
    conversa_id: uuid.UUID | None
    telefone: str
    cliente_nome: str | None = None
    pergunta: str
    motivo: str
    contexto: dict[str, Any]
    status: str
    resposta: str | None
    respondido_em: datetime | None
    created_at: datetime


class ResponderIn(BaseModel):
    resposta: str = Field(min_length=1, max_length=2000)
    salvar_conhecimento: bool = False


class ConhecimentoIn(BaseModel):
    pergunta: str = Field(min_length=3, max_length=500)
    resposta: str = Field(min_length=1, max_length=2000)


class ConhecimentoOut(BaseModel):
    id: uuid.UUID
    pergunta: str
    resposta: str
    ativo: bool
    created_at: datetime


@router.get("/chamados", response_model=list[ChamadoOut])
async def listar_chamados(
    pizzaria_id: uuid.UUID,
    status_filtro: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[ChamadoOut]:
    stmt = (
        select(ChamadoInterno, Conversa.cliente_nome)
        .outerjoin(Conversa, Conversa.id == ChamadoInterno.conversa_id)
        .where(ChamadoInterno.pizzaria_id == pizzaria_id)
        .order_by(desc(ChamadoInterno.created_at))
        .limit(limit)
    )
    if status_filtro:
        stmt = stmt.where(ChamadoInterno.status == status_filtro)
    rows = (await db.execute(stmt)).all()
    return [
        ChamadoOut(
            id=ch.id, conversa_id=ch.conversa_id, telefone=ch.telefone, cliente_nome=nome,
            pergunta=ch.pergunta, motivo=ch.motivo, contexto=ch.contexto or {}, status=ch.status,
            resposta=ch.resposta, respondido_em=ch.respondido_em, created_at=ch.created_at,
        )
        for ch, nome in rows
    ]


@router.post("/chamados/{chamado_id}/responder")
async def responder_chamado(
    pizzaria_id: uuid.UUID,
    chamado_id: uuid.UUID,
    body: ResponderIn,
    db: AsyncSession = Depends(get_db),
    vinculo: Any = Depends(membership),
) -> dict[str, Any]:
    from app.services import chamados
    from app.services.broadcaster import broadcaster
    from app.workers.periodic import entregar_resposta_chamado

    ch = await chamados.responder(
        db, pizzaria_id, chamado_id, resposta=body.resposta,
        usuario_id=getattr(vinculo, "usuario_id", None), salvar_conhecimento=body.salvar_conhecimento,
    )
    if ch is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Chamado não encontrado ou já encerrado.")
    # A voz leva a resposta ao cliente no worker (não segura a requisição do painel).
    entregar_resposta_chamado.delay(str(ch.id))
    await broadcaster.publish(pizzaria_id, {
        "tipo": "chamado.respondido", "pizzaria_id": str(pizzaria_id),
        "payload": {"chamado_id": str(ch.id), "conversa_id": str(ch.conversa_id) if ch.conversa_id else None},
    })
    return {"ok": True, "status": ch.status, "conhecimento_salvo": body.salvar_conhecimento}


@router.get("/conhecimento", response_model=list[ConhecimentoOut])
async def listar_conhecimento(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[ConhecimentoLoja]:
    return list((await db.execute(
        select(ConhecimentoLoja).where(
            ConhecimentoLoja.pizzaria_id == pizzaria_id, ConhecimentoLoja.ativo.is_(True),
        ).order_by(desc(ConhecimentoLoja.created_at))
    )).scalars().all())


@router.post("/conhecimento", response_model=ConhecimentoOut, status_code=status.HTTP_201_CREATED)
async def criar_conhecimento(
    pizzaria_id: uuid.UUID,
    body: ConhecimentoIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> ConhecimentoLoja:
    item = ConhecimentoLoja(pizzaria_id=pizzaria_id, pergunta=body.pergunta.strip(), resposta=body.resposta.strip())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/conhecimento/{item_id}")
async def remover_conhecimento(
    pizzaria_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, bool]:
    item = (await db.execute(
        select(ConhecimentoLoja).where(ConhecimentoLoja.id == item_id, ConhecimentoLoja.pizzaria_id == pizzaria_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item não encontrado")
    item.ativo = False
    await db.commit()
    return {"ok": True}
