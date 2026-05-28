"""
Endpoints de teste do agente IA + gestão de personalidade.

Permite testar o atendente sem ter que mandar mensagem real no WhatsApp.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import load_context
from app.agent.prompt import build_system_prompt
from app.agent.runner import run_agent
from app.db import get_db
from app.deps import membership
from app.models import PersonalidadeAtendente

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/agente", tags=["agente"])


# ============================================
# Test agent (sem WhatsApp)
# ============================================
class TestAgentIn(BaseModel):
    telefone: str = Field(min_length=8, description="Telefone de teste (ex: 5511900000000)")
    mensagem: str = Field(min_length=1, max_length=2000)


class TestAgentOut(BaseModel):
    texto: str | None
    iteracoes: int
    tool_calls: list[str]


@router.post("/testar", response_model=TestAgentOut)
async def testar_agente(
    pizzaria_id: uuid.UUID,
    body: TestAgentIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> TestAgentOut:
    """
    Roda o agente sem enviar pelo WhatsApp. Útil pro botão "Testar Atendente" no painel.
    """
    result = await run_agent(db, pizzaria_id, body.telefone, body.mensagem)
    return TestAgentOut(
        texto=result.texto,
        iteracoes=result.iteracoes,
        tool_calls=result.tool_calls,
    )


# ============================================
# Ver prompt montado (debug / preview)
# ============================================
@router.get("/prompt")
async def preview_prompt(
    pizzaria_id: uuid.UUID,
    telefone: str = "5511900000000",
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    ctx = await load_context(db, pizzaria_id, telefone)
    prompt = build_system_prompt(
        ctx.pizzaria,
        ctx.personalidade,
        cliente_nome=ctx.cliente_nome,
        cliente_total_pedidos=ctx.cliente_total_pedidos,
    )
    return {"prompt": prompt, "tamanho_chars": len(prompt)}


# ============================================
# CRUD de personalidade (Fase 4 plugará o builder visual aqui)
# ============================================
class PersonalidadeIn(BaseModel):
    nome: str = "Camila"
    estilo: str = "casual"
    nivel_emoji: str = "moderado"
    vocabulario_regional: str | None = None
    diferenciais: list[str] = Field(default_factory=list)
    restricoes: list[str] = Field(default_factory=list)
    exemplos_conversa: list[dict] = Field(default_factory=list)
    instrucoes_extras: str | None = None


class PersonalidadeOut(PersonalidadeIn):
    id: uuid.UUID
    pizzaria_id: uuid.UUID

    model_config = {"from_attributes": True}


@router.get("/personalidade", response_model=PersonalidadeOut | None)
async def get_personalidade(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> PersonalidadeAtendente | None:
    return (
        await db.execute(
            select(PersonalidadeAtendente).where(PersonalidadeAtendente.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()


@router.put("/personalidade", response_model=PersonalidadeOut)
async def upsert_personalidade(
    pizzaria_id: uuid.UUID,
    body: PersonalidadeIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> PersonalidadeAtendente:
    if body.estilo not in ("casual", "profissional", "proximo"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "estilo inválido")
    if body.nivel_emoji not in ("nenhum", "pouco", "moderado", "muito"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "nivel_emoji inválido")

    existing = (
        await db.execute(
            select(PersonalidadeAtendente).where(PersonalidadeAtendente.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()

    if existing:
        for k, v in body.model_dump().items():
            setattr(existing, k, v)
        await db.commit()
        await db.refresh(existing)
        return existing

    new = PersonalidadeAtendente(pizzaria_id=pizzaria_id, **body.model_dump())
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return new
