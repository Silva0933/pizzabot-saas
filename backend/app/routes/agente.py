"""Playground seguro, diagnóstico e configuração do atendente IA."""
from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.behavior import AtendimentoConfig, sanitize_list, sanitize_text
from app.agent.context import load_context
from app.agent.prompt import build_system_prompt
from app.agent.runner import run_agent
from app.db import get_db
from app.deps import membership
from app.models import PersonalidadeAtendente, Pizzaria, Produto

router = APIRouter(prefix="/pizzarias/{pizzaria_id}/agente", tags=["agente"])


def _simulation_phone(pizzaria_id: uuid.UUID, sessao: uuid.UUID) -> str:
    return f"sim:{pizzaria_id.hex[:10]}:{sessao.hex}"


# ============================================
# Playground seguro (sem WhatsApp nem pedidos)
# ============================================
class TestAgentIn(BaseModel):
    telefone: str = Field(default="5511900000000", min_length=8, max_length=30)
    mensagem: str = Field(min_length=1, max_length=2000)
    sessao: uuid.UUID = Field(default_factory=uuid.uuid4)


class TestAgentOut(BaseModel):
    texto: str | None
    iteracoes: int
    tool_calls: list[str]
    sessao: uuid.UUID
    modo_seguro: bool = True
    trace: dict[str, Any] = Field(default_factory=dict)


@router.post("/testar", response_model=TestAgentOut)
async def testar_agente(
    pizzaria_id: uuid.UUID,
    body: TestAgentIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> TestAgentOut:
    """Executa a conversa numa sessão isolada e bloqueia efeitos externos."""
    pizz = (await db.execute(
        select(Pizzaria).where(Pizzaria.id == pizzaria_id)
    )).scalar_one()
    telefone_simulado = _simulation_phone(pizzaria_id, body.sessao)

    result = None
    if getattr(pizz, "pipeline_fsm", False):
        from app.agent.fsm.pipeline import run_fsm_agent
        result = await run_fsm_agent(
            db, pizzaria_id, telefone_simulado, body.mensagem, simulation=True
        )
    if result is None:
        result = await run_agent(
            db, pizzaria_id, telefone_simulado, body.mensagem,
            max_iterations=3, simulation=True,
        )
        if not result.trace:
            result.trace = {
                "pipeline": "legacy",
                "simulation": True,
                "decision": "tool_calling",
                "tool_calls": result.tool_calls,
            }

    return TestAgentOut(
        texto=result.texto,
        iteracoes=result.iteracoes,
        tool_calls=result.tool_calls,
        sessao=body.sessao,
        trace=result.trace,
    )


class ResetTestIn(BaseModel):
    sessao: uuid.UUID


@router.post("/testar/reset")
async def resetar_teste(
    pizzaria_id: uuid.UUID,
    body: ResetTestIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, bool]:
    telefone = _simulation_phone(pizzaria_id, body.sessao)
    await db.execute(
        text("DELETE FROM public.agente_memoria WHERE pizzaria_id = :pid AND telefone = :tel"),
        {"pid": str(pizzaria_id), "tel": telefone},
    )
    await db.execute(
        text("DELETE FROM public.atendimento_estado WHERE pizzaria_id = :pid AND telefone = :tel"),
        {"pid": str(pizzaria_id), "tel": telefone},
    )
    await db.commit()
    return {"ok": True}


# ============================================
# Preview fiel: FSM real + legado
# ============================================
@router.get("/prompt")
async def preview_prompt(
    pizzaria_id: uuid.UUID,
    telefone: str = "5511900000000",
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, Any]:
    ctx = await load_context(db, pizzaria_id, telefone)
    legacy_prompt = build_system_prompt(
        ctx.pizzaria,
        ctx.personalidade,
        cliente_nome=ctx.cliente_nome,
        cliente_total_pedidos=ctx.cliente_total_pedidos,
        cliente_ultimo_pedido=ctx.ultimo_pedido_resumo,
        estado_atendimento=ctx.estado_atendimento,
    )
    from app.agent.fsm.voice import montar_comando
    fsm_prompt = montar_comando(
        personalidade=ctx.personalidade,
        pizzaria_nome=ctx.pizzaria.nome,
        decisao={
            "acao": "coletar_item",
            "fatos": ["Cliente iniciou um atendimento; nenhum preço foi consultado."],
            "proxima_pergunta": "Cumprimente e pergunte se gostaria de ver o cardápio.",
        },
        ja_apresentou=False,
        user_input="Oi, gostaria de fazer um pedido",
    )
    principal = fsm_prompt if getattr(ctx.pizzaria, "pipeline_fsm", False) else legacy_prompt
    return {
        "prompt": principal,
        "pipeline": "fsm" if getattr(ctx.pizzaria, "pipeline_fsm", False) else "legacy",
        "fsm_prompt": fsm_prompt,
        "legacy_prompt": legacy_prompt,
        "tamanho_chars": len(principal),
    }


# ============================================
# CRUD tipado da personalidade
# ============================================
class ExemploConversa(BaseModel):
    cliente: str = Field(min_length=1, max_length=300)
    atendente: str = Field(min_length=1, max_length=500)

    @field_validator("cliente", "atendente")
    @classmethod
    def _sanitize(cls, value: str) -> str:
        return sanitize_text(value, max_length=500)


class PersonalidadeIn(BaseModel):
    nome: str = Field(default="Camila", min_length=2, max_length=50)
    estilo: Literal["casual", "profissional", "proximo"] = "casual"
    nivel_emoji: Literal["nenhum", "pouco", "moderado", "muito"] = "moderado"
    vocabulario_regional: str | None = Field(default=None, max_length=300)
    diferenciais: list[str] = Field(default_factory=list, max_length=12)
    restricoes: list[str] = Field(default_factory=list, max_length=12)
    exemplos_conversa: list[ExemploConversa] = Field(default_factory=list, max_length=6)
    instrucoes_extras: str | None = Field(default=None, max_length=2000)
    config_atendimento: AtendimentoConfig = Field(default_factory=AtendimentoConfig)

    @field_validator("nome")
    @classmethod
    def _sanitize_nome(cls, value: str) -> str:
        return sanitize_text(value, max_length=50)

    @field_validator("vocabulario_regional", "instrucoes_extras")
    @classmethod
    def _sanitize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = sanitize_text(value, max_length=2000)
        return clean or None

    @field_validator("diferenciais", "restricoes", mode="before")
    @classmethod
    def _sanitize_items(cls, value: Any) -> list[str]:
        return sanitize_list(value)


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
    return (await db.execute(
        select(PersonalidadeAtendente).where(
            PersonalidadeAtendente.pizzaria_id == pizzaria_id
        )
    )).scalar_one_or_none()


@router.put("/personalidade", response_model=PersonalidadeOut)
async def upsert_personalidade(
    pizzaria_id: uuid.UUID,
    body: PersonalidadeIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> PersonalidadeAtendente:
    payload = body.model_dump(mode="json")
    existing = (await db.execute(
        select(PersonalidadeAtendente).where(
            PersonalidadeAtendente.pizzaria_id == pizzaria_id
        )
    )).scalar_one_or_none()

    if existing:
        for key, value in payload.items():
            setattr(existing, key, value)
        await db.commit()
        await db.refresh(existing)
        return existing

    new = PersonalidadeAtendente(pizzaria_id=pizzaria_id, **payload)
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return new


# ============================================
# Diagnóstico de prontidão
# ============================================
@router.get("/health")
async def agent_health(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict[str, Any]:
    pizz = (await db.execute(
        select(Pizzaria).where(Pizzaria.id == pizzaria_id)
    )).scalar_one()
    personalidade = (await db.execute(
        select(PersonalidadeAtendente).where(
            PersonalidadeAtendente.pizzaria_id == pizzaria_id
        )
    )).scalar_one_or_none()
    produtos = int((await db.execute(
        select(func.count(Produto.id)).where(
            Produto.pizzaria_id == pizzaria_id,
            Produto.disponivel.is_(True),
        )
    )).scalar_one() or 0)

    checks: list[dict[str, str]] = []

    def add(key: str, label: str, level: str, message: str) -> None:
        checks.append({"key": key, "label": label, "status": level, "message": message})

    add("pipeline", "Pipeline", "ok" if pizz.pipeline_fsm else "warning",
        "FSM determinístico ativo." if pizz.pipeline_fsm else "Pipeline legado ativo; o FSM oferece mais blindagem.")
    add("personalidade", "Personalidade", "ok" if personalidade else "warning",
        "Personalidade configurada." if personalidade else "Usando a personalidade padrão.")
    add("cardapio", "Cardápio", "ok" if produtos else "error",
        f"{produtos} produto(s) disponível(is)." if produtos else "Nenhum produto disponível para o agente consultar.")
    add("whatsapp", "WhatsApp", "ok" if pizz.instancia and pizz.whatsapp_estado == "open" else "error",
        "Instância conectada." if pizz.instancia and pizz.whatsapp_estado == "open"
        else "A instância precisa estar configurada e conectada.")
    add("horarios", "Horários", "ok" if pizz.horario_funcionamento else "warning",
        "Agenda configurada." if pizz.horario_funcionamento else "Cadastre horários para evitar atendimento fora da operação.")
    add("pagamentos", "Pagamentos", "ok" if pizz.formas_pagamento_aceitas else "warning",
        "Formas de pagamento configuradas." if pizz.formas_pagamento_aceitas else "Nenhuma forma de pagamento cadastrada.")
    taxa_ok = bool(pizz.taxa_entrega_fixa is not None or pizz.taxas_bairro or pizz.taxa_entrega_info)
    add("entrega", "Taxa de entrega", "ok" if taxa_ok else "warning",
        "Regra de entrega configurada." if taxa_ok else "Sem taxa cadastrada; casos de delivery podem exigir humano.")

    errors = sum(1 for item in checks if item["status"] == "error")
    warnings = sum(1 for item in checks if item["status"] == "warning")
    return {
        "status": "ready" if errors == 0 and warnings == 0 else ("blocked" if errors else "attention"),
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
    }
