"""Schemas Pydantic compartilhados entre rotas."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ============================================
# Webhook Evolution
# ============================================
class EvolutionMessageKey(BaseModel):
    remoteJid: str
    fromMe: bool = False
    id: str | None = None


class EvolutionMessageContent(BaseModel):
    conversation: str | None = None
    extendedTextMessage: dict[str, Any] | None = None
    imageMessage: dict[str, Any] | None = None
    audioMessage: dict[str, Any] | None = None
    stickerMessage: dict[str, Any] | None = None
    locationMessage: dict[str, Any] | None = None


class EvolutionWebhookPayload(BaseModel):
    """Payload do Evolution v2 (messages.upsert)."""
    event: str | None = None
    instance: str | None = None                       # nome da instância
    data: dict[str, Any] = Field(default_factory=dict)


# ============================================
# Conversas + mensagens (painel)
# ============================================
class MensagemOut(BaseModel):
    id: uuid.UUID
    conversa_id: uuid.UUID
    origem: Literal["cliente", "bot", "humano", "sistema"]
    tipo: Literal["texto", "audio", "imagem", "figurinha", "localizacao"]
    conteudo: str
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_json")
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class ConversaOut(BaseModel):
    id: uuid.UUID
    pizzaria_id: uuid.UUID
    cliente_telefone: str
    cliente_nome: str | None
    last_message: str | None
    last_timestamp: datetime
    bot_ativo: bool
    status: str
    unread_count: int

    model_config = {"from_attributes": True}


class EnviarMensagemIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=4096)


class ToggleBotIn(BaseModel):
    bot_ativo: bool


# ============================================
# Eventos WebSocket (para o painel)
# ============================================
class WsEvento(BaseModel):
    tipo: Literal[
        "mensagem.nova",
        "conversa.atualizada",
        "pedido.novo",
        "pedido.atualizado",
        "bot.toggled",
    ]
    pizzaria_id: uuid.UUID
    payload: dict[str, Any] = Field(default_factory=dict)
