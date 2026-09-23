"""Modelos SQLAlchemy 2.0 (declarativos, type-annotated).

Espelham o schema definido em migrations/001_initial.sql.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# ============================================
# Usuarios
# ============================================
class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    senha_hash: Mapped[str] = mapped_column(Text, nullable=False)
    nome: Mapped[str | None] = mapped_column(String)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Pizzarias
# ============================================
class Pizzaria(Base):
    __tablename__ = "pizzarias"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    nome: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str | None] = mapped_column(String, unique=True)
    logo_url: Mapped[str | None] = mapped_column(Text)
    # Banner largo do topo do cardápio digital (URL). Migration 021.
    banner_url: Mapped[str | None] = mapped_column(Text)
    plano: Mapped[str] = mapped_column(String, default="basico", nullable=False)
    bot_ativo_global: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Sons de alerta de pedido no painel (chegada e fechamento). Migration 031.
    alertas_sonoros: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    # NULL segue o horário; True/False força abertura/fechamento temporário.
    aberto_manual: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Suspensão administrativa (ex.: inadimplência). Desliga TODO o atendimento
    # sem excluir os dados. Controlada só pelo admin da plataforma.
    suspensa: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspensa_motivo: Mapped[str | None] = mapped_column(Text)
    # Assinatura: quando o plano foi ativado e quando vence (ciclo de 30 dias).
    plano_ativado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plano_vence_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Cobrança da PLATAFORMA (assinatura mensal via Asaas da plataforma).
    asaas_customer_id: Mapped[str | None] = mapped_column(Text)
    asaas_subscription_id: Mapped[str | None] = mapped_column(Text)
    cobranca_email: Mapped[str | None] = mapped_column(Text)
    cobranca_cpf_cnpj: Mapped[str | None] = mapped_column(Text)
    # Fim do período de teste grátis (plano 'trial'). Nulo = não é/foi trial.
    trial_fim: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Pipeline FSM (NLU→backend→voz): quando True, o atendimento usa o novo
    # pipeline determinístico em vez do agente de tool-calling. Padrão = True
    # (ambiente de testes; fallback automático pro agente legado em baixa confiança).
    pipeline_fsm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Dispatcher assíncrono (Redis Streams) como caminho PADRÃO. O worker Celery
    # vira fallback: basta voltar esta flag pra False numa pizzaria pra ela cair
    # de novo no worker (rollback por tenant, sem deploy).
    usar_dispatcher: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Permite que entregadores peguem pedidos livres (self-claim). Quando False,
    # só o dono atribui as entregas.
    permitir_autoatribuicao_entregador: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    endereco: Mapped[str | None] = mapped_column(Text)
    # Link do endereço no Google Maps (enviado ao cliente quando ele pergunta o
    # endereço ou escolhe retirada).
    endereco_maps_url: Mapped[str | None] = mapped_column(Text)
    telefone_admin: Mapped[str | None] = mapped_column(String)
    telefone_contato: Mapped[str | None] = mapped_column(String)
    instagram: Mapped[str | None] = mapped_column(String)

    horario_funcionamento: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Identidade visual do cardápio público (preset, fontes, cores e acabamento).
    tema_cardapio: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    formas_pagamento_aceitas: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    taxa_entrega_info: Mapped[str | None] = mapped_column(Text)
    taxa_entrega_fixa: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    taxas_bairro: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # Adicionais/bordas da casa (aplicáveis a qualquer pizza): lista de
    # {nome, preco, tipo: 'borda'|'adicional'}. A IA oferece SÓ o que está aqui.
    adicionais: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    tempo_entrega_min: Mapped[int | None] = mapped_column(Integer, default=30)
    tempo_entrega_max: Mapped[int | None] = mapped_column(Integer, default=60)
    tempo_retirada_min: Mapped[int | None] = mapped_column(Integer, default=15)
    tempo_retirada_max: Mapped[int | None] = mapped_column(Integer, default=25)

    mensagens_status: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    nomes_colunas: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    instancia: Mapped[str | None] = mapped_column(String, unique=True)
    # Estado da conexão WhatsApp (Evolution): 'open' | 'connecting' | 'close'.
    # Atualizado pelo webhook CONNECTION_UPDATE e pelo poll periódico do Beat.
    whatsapp_estado: Mapped[str | None] = mapped_column(String)
    whatsapp_estado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gateway_pagamento: Mapped[str] = mapped_column(String, default="mercadopago", nullable=False)
    mp_access_token: Mapped[str | None] = mapped_column(Text)
    # Id da conta vendedora no Mercado Pago (GET /users/me). É o que liga o
    # `user_id` da notificação do webhook à pizzaria dona da cobrança — sem isso
    # não dá pra saber com qual token consultar o pagamento (multi-tenant).
    mp_user_id: Mapped[str | None] = mapped_column(Text)
    # Secret de assinatura do webhook. No MP ele é POR APLICAÇÃO, então cada
    # pizzaria tem o seu; o MP_WEBHOOK_SECRET do .env é só fallback.
    mp_webhook_secret: Mapped[str | None] = mapped_column(Text)
    asaas_api_key: Mapped[str | None] = mapped_column(Text)
    # Modo de pagamento na conversa: 'automatico' (gateway MP/Asaas — padrão),
    # 'manual' (Pix copia-e-cola próprio + conferência manual) ou 'desativado'
    # (só na entrega/retirada; a atendente não oferece pagamento online).
    modo_pagamento_online: Mapped[str] = mapped_column(String, default="automatico", nullable=False)
    # Pix copia-e-cola próprio da pizzaria (modo manual). NÃO é segredo — é
    # compartilhado com o cliente — então guardado em texto puro (sem cripto).
    pix_manual_copia_cola: Mapped[str | None] = mapped_column(Text)
    pix_manual_titular: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def aberto_agora(self) -> bool:
        """Estado efetivo: override manual primeiro, agenda em seguida."""
        from app.services.business_hours import esta_aberto

        return esta_aberto(
            self.horario_funcionamento or {},
            override=self.aberto_manual,
        )


# ============================================
# Faturas (cobrança da plataforma — assinatura mensal via Asaas)
# ============================================
class Fatura(Base):
    __tablename__ = "faturas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    asaas_payment_id: Mapped[str | None] = mapped_column(Text, unique=True)
    asaas_subscription_id: Mapped[str | None] = mapped_column(Text)
    valor: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # pendente | paga | vencida | cancelada
    status: Mapped[str] = mapped_column(String, default="pendente", nullable=False)
    vencimento: Mapped[date | None] = mapped_column(Date)
    pago_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    link_pagamento: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Equipe (vínculo usuário ↔ pizzaria)
# ============================================
class EquipePizzaria(Base):
    __tablename__ = "equipe_pizzaria"
    __table_args__ = (UniqueConstraint("pizzaria_id", "email"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    email: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="atendente", nullable=False)
    status: Mapped[str] = mapped_column(String, default="pendente", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Personalidade do Atendente (Fase 4)
# ============================================
class PersonalidadeAtendente(Base):
    __tablename__ = "personalidade_atendente"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), unique=True, nullable=False)
    nome: Mapped[str] = mapped_column(String, default="Camila", nullable=False)
    estilo: Mapped[str] = mapped_column(String, default="casual", nullable=False)
    nivel_emoji: Mapped[str] = mapped_column(String, default="moderado", nullable=False)
    vocabulario_regional: Mapped[str | None] = mapped_column(Text)
    diferenciais: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    restricoes: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    exemplos_conversa: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    instrucoes_extras: Mapped[str | None] = mapped_column(Text)
    config_atendimento: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Produtos (cardápio com embedding)
# ============================================
class Produto(Base):
    __tablename__ = "produtos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    categoria: Mapped[str | None] = mapped_column(String)
    nome: Mapped[str] = mapped_column(String, nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text)
    preco: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    imagem_url: Mapped[str | None] = mapped_column(Text)
    ordem: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tamanhos_json: Mapped[list[dict[str, Any]] | None] = mapped_column("tamanhos", JSONB, nullable=True, default=None)
    aliases: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    opcoes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    regras: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # embedding: vector(768) — registrado via raw SQL na migration; lemos como array
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tamanhos_rel: Mapped[list[ProdutoTamanho]] = relationship("ProdutoTamanho", back_populates="produto", cascade="all, delete-orphan", lazy="selectin")
    grupos_complementos: Mapped[list[GrupoComplementos]] = relationship("GrupoComplementos", secondary="produto_complementos", back_populates="produtos", lazy="selectin")

    @property
    def tamanhos(self) -> list[dict[str, Any]] | None:
        if self.tamanhos_rel:
            return [{"tamanho": t.tamanho, "preco": float(t.preco)} for t in self.tamanhos_rel]
        return None

    @tamanhos.setter
    def tamanhos(self, value: list[dict[str, Any]] | None) -> None:
        self.tamanhos_rel = []
        if value:
            for v in value:
                t_nome = v.get("tamanho") or v.get("nome")
                t_preco = v.get("preco")
                if t_nome:
                    self.tamanhos_rel.append(ProdutoTamanho(
                        tamanho=str(t_nome),
                        preco=Decimal(str(t_preco or 0))
                    ))


class ProdutoTamanho(Base):
    __tablename__ = "produto_tamanhos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    produto_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("produtos.id", ondelete="CASCADE"), nullable=False)
    tamanho: Mapped[str] = mapped_column(String(30), nullable=False)
    preco: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    produto: Mapped[Produto] = relationship("Produto", back_populates="tamanhos_rel")


class ProdutoComplemento(Base):
    __tablename__ = "produto_complementos"

    produto_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("produtos.id", ondelete="CASCADE"), primary_key=True)
    grupo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grupo_complementos.id", ondelete="CASCADE"), primary_key=True)


class GrupoComplementos(Base):
    __tablename__ = "grupo_complementos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    nome: Mapped[str] = mapped_column(String(100), nullable=False)
    obrigatorio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    min_opcoes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_opcoes: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    complementos: Mapped[list[Complemento]] = relationship("Complemento", back_populates="grupo", cascade="all, delete-orphan", lazy="selectin")
    produtos: Mapped[list[Produto]] = relationship("Produto", secondary="produto_complementos", back_populates="grupos_complementos")


class Complemento(Base):
    __tablename__ = "complementos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    grupo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grupo_complementos.id", ondelete="CASCADE"), nullable=False)
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    preco: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00, nullable=False)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    grupo: Mapped[GrupoComplementos] = relationship("GrupoComplementos", back_populates="complementos")


# ============================================
# Clientes
# ============================================
class Cliente(Base):
    __tablename__ = "clientes"
    __table_args__ = (UniqueConstraint("pizzaria_id", "telefone"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    telefone: Mapped[str] = mapped_column(String, nullable=False)
    nome: Mapped[str | None] = mapped_column(String)
    endereco_padrao: Mapped[str | None] = mapped_column(Text)
    endereco_dados: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    preferencias: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(String)
    senha_hash: Mapped[str | None] = mapped_column(Text)
    conta_ativa: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    conta_versao: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    conta_atualizada_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    memoria_resumo: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    memoria_atualizada_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_pedidos: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_gasto: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    ultima_visita: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Pedidos
# ============================================
class Pedido(Base):
    __tablename__ = "pedidos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    cliente_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clientes.id", ondelete="CASCADE"), nullable=False)
    numero_pedido: Mapped[int | None] = mapped_column(Integer)

    cliente: Mapped[Cliente] = relationship("Cliente", lazy="joined")

    itens: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    valor_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # status: novo, confirmado, no_forno, pronto_entrega (só delivery, pronto p/ sair),
    # a_caminho, entregue, cancelado. Constraint em migration 020.
    status: Mapped[str] = mapped_column(String, default="novo", nullable=False)
    tipo: Mapped[str] = mapped_column(String, default="delivery", nullable=False)

    endereco_entrega: Mapped[str | None] = mapped_column(Text)
    # Coordenadas exatas (pino do mapa do entregador) — nulo quando só há texto.
    endereco_lat: Mapped[float | None] = mapped_column(Float)
    endereco_lon: Mapped[float | None] = mapped_column(Float)
    forma_pagamento: Mapped[str | None] = mapped_column(String)
    observacoes: Mapped[str | None] = mapped_column(Text)

    payment_id: Mapped[str | None] = mapped_column(String)
    payment_status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    link_pagamento: Mapped[str | None] = mapped_column(Text)

    origem: Mapped[str] = mapped_column(String(30), default="whatsapp", nullable=False)
    chave_idempotencia: Mapped[str | None] = mapped_column(String(120))
    valor_subtotal: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    valor_desconto: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    taxa_entrega: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    cupom_codigo: Mapped[str | None] = mapped_column(String(40))
    em_problema: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    problema_motivo: Mapped[str | None] = mapped_column(Text)
    problema_aberto_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    bot_ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    cancelado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelamento_motivo: Mapped[str | None] = mapped_column(Text)

    # Entregador atribuído (painel de entregador). Nulo = sem entregador.
    entregador_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("entregadores.id", ondelete="SET NULL"))
    atribuido_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entregador: Mapped[Entregador | None] = relationship("Entregador", lazy="joined")

    # Pós-venda (NPS): nota de 0-10 e comentário opcional do cliente.
    nps_nota: Mapped[int | None] = mapped_column(Integer)
    nps_comentario: Mapped[str | None] = mapped_column(Text)
    nps_enviado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PedidoEvento(Base):
    """Append-only audit trail for operational order events."""
    __tablename__ = "pedido_eventos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    pedido_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    tipo: Mapped[str] = mapped_column(String(40), nullable=False)
    status_anterior: Mapped[str | None] = mapped_column(String(30))
    status_novo: Mapped[str | None] = mapped_column(String(30))
    motivo: Mapped[str | None] = mapped_column(Text)
    ator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("usuarios.id", ondelete="SET NULL"))
    ator_nome: Mapped[str | None] = mapped_column(String(160))
    ator_tipo: Mapped[str] = mapped_column(String(30), default="sistema", nullable=False)
    detalhes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ============================================
# Entregadores (painel de entregador)
# ============================================
class Entregador(Base):
    __tablename__ = "entregadores"
    __table_args__ = (UniqueConstraint("pizzaria_id", "usuario_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    # Conta de login do entregador (reusa a tabela usuarios / mesmo /auth/login).
    usuario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False)
    nome: Mapped[str] = mapped_column(String, nullable=False)
    telefone: Mapped[str | None] = mapped_column(String)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    usuario: Mapped[Usuario] = relationship("Usuario", lazy="joined")


# ============================================
# Conversas + Mensagens
# ============================================
class Conversa(Base):
    __tablename__ = "conversas"
    __table_args__ = (UniqueConstraint("pizzaria_id", "cliente_telefone"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    cliente_telefone: Mapped[str] = mapped_column(String, nullable=False)
    cliente_nome: Mapped[str | None] = mapped_column(String)
    last_message: Mapped[str | None] = mapped_column(Text)
    last_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    bot_ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String, default="bot_ativo", nullable=False)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Mensagem(Base):
    __tablename__ = "mensagens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    conversa_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversas.id", ondelete="CASCADE"), nullable=False)
    pizzaria_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pizzarias.id", ondelete="CASCADE"), nullable=False)
    origem: Mapped[str] = mapped_column(String, nullable=False)
    tipo: Mapped[str] = mapped_column(String, default="texto", nullable=False)
    conteudo: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
