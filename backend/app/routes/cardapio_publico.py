"""
API pública do cardápio digital — SEM autenticação.

Endpoints consumidos pelo frontend público (link do cardápio):
  GET  /menu/{slug}         → dados da pizzaria + produtos disponíveis
  POST /menu/{slug}/pedido   → cria pedido vindo do cardápio digital
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.db import get_db
from app.models import Cliente, Conversa, Mensagem, Pedido, Pizzaria, Produto

log = logging.getLogger(__name__)
router = APIRouter(prefix="/menu", tags=["cardapio_digital"])


# ============================================
# Rate limiting simples em memória (por IP)
# ============================================
_rate_store: dict[str, list[float]] = {}
_RATE_WINDOW = 60  # segundos
_RATE_LIMIT_GET = 30   # req/min
_RATE_LIMIT_POST = 5   # req/min


def _check_rate(ip: str, limit: int) -> None:
    import time
    now = time.time()
    key = f"{ip}:{limit}"
    hits = _rate_store.get(key, [])
    hits = [t for t in hits if now - t < _RATE_WINDOW]
    if len(hits) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas requisições. Tente novamente em instantes.")
    hits.append(now)
    _rate_store[key] = hits


# ============================================
# Schemas de saída pública (SEM dados sensíveis)
# ============================================
class ProdutoPublico(BaseModel):
    id: str
    categoria: str | None
    nome: str
    descricao: str | None
    preco: float
    imagem_url: str | None
    ordem: int
    tamanhos: list[dict[str, Any]] | None = None
    opcoes: dict[str, Any] = Field(default_factory=dict)
    regras: dict[str, Any] = Field(default_factory=dict)


class PizzariaPublica(BaseModel):
    nome: str
    slug: str | None
    logo_url: str | None
    banner_url: str | None
    endereco: str | None
    endereco_maps_url: str | None
    telefone_contato: str | None
    instagram: str | None
    horario_funcionamento: dict[str, Any]
    formas_pagamento_aceitas: list[str]
    taxa_entrega_info: str | None
    taxa_entrega_fixa: float | None
    taxas_bairro: list[dict[str, Any]]
    adicionais: list[dict[str, Any]]
    tempo_entrega_min: int | None
    tempo_entrega_max: int | None
    tempo_retirada_min: int | None
    tempo_retirada_max: int | None
    aberto: bool


class MenuResponse(BaseModel):
    pizzaria: PizzariaPublica
    produtos: list[ProdutoPublico]


# ============================================
# Schemas de entrada (pedido do cliente)
# ============================================
class ItemPedidoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    quantidade: int = Field(ge=1, le=50)
    tamanho: str | None = None
    preco_unit: float = Field(ge=0)
    observacao: str | None = Field(default=None, max_length=500)
    adicionais: list[str] = Field(default_factory=list)


class PedidoDigitalIn(BaseModel):
    nome_cliente: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=10, max_length=20)
    tipo: str = Field(pattern=r"^(delivery|retirada)$")
    endereco_rua: str | None = Field(default=None, max_length=300)
    endereco_numero: str | None = Field(default=None, max_length=20)
    endereco_bairro: str | None = Field(default=None, max_length=100)
    endereco_referencia: str | None = Field(default=None, max_length=200)
    # Coordenadas exatas via GPS do navegador (botão "usar minha localização").
    endereco_lat: float | None = None
    endereco_lon: float | None = None
    forma_pagamento: str = Field(min_length=1, max_length=30)
    observacoes: str | None = Field(default=None, max_length=500)
    itens: list[ItemPedidoIn] = Field(min_length=1, max_length=50)
    # Honeypot anti-bot (campo invisível no form — se preenchido, é bot)
    website: str | None = Field(default=None, max_length=0)


# ============================================
# Helper: verificar horário
# ============================================
def _esta_aberto(horario: dict[str, Any]) -> bool:
    """Verifica se a pizzaria está aberta agora (simplificado)."""
    try:
        from app.services.business_hours import esta_aberto
        return esta_aberto(horario)
    except Exception:
        return True  # na dúvida, permite o pedido


# ============================================
# Helper: limpar telefone
# ============================================
def _limpar_telefone(tel: str) -> str:
    """Remove caracteres não-numéricos e garante formato brasileiro."""
    digits = re.sub(r"\D", "", tel)
    if len(digits) == 11:
        digits = "55" + digits
    elif len(digits) == 10:
        digits = "55" + digits
    elif not digits.startswith("55") and len(digits) >= 12:
        pass  # já tem DDI
    return digits


# ============================================
# GET /menu/{slug} — Cardápio público
# ============================================
@router.get("/{slug}", response_model=MenuResponse)
async def get_menu(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MenuResponse:
    """Retorna dados públicos da pizzaria + produtos disponíveis."""
    _check_rate(request.client.host if request.client else "unknown", _RATE_LIMIT_GET)

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))
    ).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cardápio não encontrado")

    # Pizzaria suspensa: não exibe o cardápio
    if getattr(pizz, "suspensa", False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cardápio não disponível no momento")

    # Busca produtos disponíveis, ordenados
    stmt = (
        select(Produto)
        .where(Produto.pizzaria_id == pizz.id, Produto.disponivel == True)  # noqa: E712
        .order_by(Produto.ordem, Produto.nome)
    )
    produtos_db = list((await db.execute(stmt)).scalars().all())

    produtos = [
        ProdutoPublico(
            id=str(p.id),
            categoria=p.categoria,
            nome=p.nome,
            descricao=p.descricao,
            preco=float(p.preco),
            imagem_url=p.imagem_url,
            ordem=p.ordem,
            tamanhos=p.tamanhos,
            opcoes=p.opcoes or {},
            regras=p.regras or {},
        )
        for p in produtos_db
    ]

    pizzaria_pub = PizzariaPublica(
        nome=pizz.nome,
        slug=pizz.slug,
        logo_url=pizz.logo_url,
        banner_url=getattr(pizz, "banner_url", None),
        endereco=pizz.endereco,
        endereco_maps_url=pizz.endereco_maps_url,
        telefone_contato=pizz.telefone_contato or pizz.telefone_admin,
        instagram=getattr(pizz, "instagram", None),
        horario_funcionamento=pizz.horario_funcionamento or {},
        formas_pagamento_aceitas=pizz.formas_pagamento_aceitas or [],
        taxa_entrega_info=pizz.taxa_entrega_info,
        taxa_entrega_fixa=float(pizz.taxa_entrega_fixa) if pizz.taxa_entrega_fixa else None,
        taxas_bairro=pizz.taxas_bairro or [],
        adicionais=pizz.adicionais or [],
        tempo_entrega_min=pizz.tempo_entrega_min,
        tempo_entrega_max=pizz.tempo_entrega_max,
        tempo_retirada_min=pizz.tempo_retirada_min,
        tempo_retirada_max=pizz.tempo_retirada_max,
        aberto=_esta_aberto(pizz.horario_funcionamento or {}),
    )

    return MenuResponse(pizzaria=pizzaria_pub, produtos=produtos)


# ============================================
# POST /menu/{slug}/pedido — Finalizar pedido
# ============================================
@router.post("/{slug}/pedido", status_code=status.HTTP_201_CREATED)
async def criar_pedido_digital(
    slug: str,
    body: PedidoDigitalIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Cria um pedido vindo do cardápio digital."""
    _check_rate(request.client.host if request.client else "unknown", _RATE_LIMIT_POST)

    # Honeypot: se o campo 'website' invisível foi preenchido, é bot
    if body.website:
        log.info("Honeypot triggered from %s", request.client.host if request.client else "?")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Erro ao processar pedido.")

    # Busca a pizzaria
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))
    ).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    if getattr(pizz, "suspensa", False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta pizzaria não está recebendo pedidos no momento.")

    # ── Verificação de cota do plano ──────────────────────────────────────────
    # O cardápio digital também consome a cota de atendimentos mensais.
    try:
        from app.services.app_config import conversas_atendidas_mes
        from app.services.plans import plan_info
        limites = plan_info(pizz.plano).get("limites") or {}
        limite_conversas = int(limites.get("conversas_mes") or 0)
        if limite_conversas > 0:
            usados = await conversas_atendidas_mes(db, pizz.id)
            if usados >= limite_conversas:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Esta pizzaria atingiu o limite de atendimentos do plano este mês. "
                    "Tente novamente no próximo mês ou entre em contato com a pizzaria.",
                )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao verificar cota do plano para cardápio digital: %s", e)
    # ─────────────────────────────────────────────────────────────────────────

    # Validações
    telefone = _limpar_telefone(body.telefone)
    if len(telefone) < 12:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Telefone inválido. Use o formato (DD) 9XXXX-XXXX.")

    if body.tipo == "delivery" and not body.endereco_rua:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Endereço é obrigatório para entrega.")

    # Valida forma de pagamento
    formas_aceitas = pizz.formas_pagamento_aceitas or []
    if formas_aceitas and body.forma_pagamento not in formas_aceitas:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Forma de pagamento '{body.forma_pagamento}' não aceita.")


    # Monta endereço
    endereco_parts = [body.endereco_rua]
    if body.endereco_numero:
        endereco_parts.append(f"nº {body.endereco_numero}")
    if body.endereco_bairro:
        endereco_parts.append(f"- {body.endereco_bairro}")
    if body.endereco_referencia:
        endereco_parts.append(f"(Ref: {body.endereco_referencia})")
    endereco = ", ".join(filter(None, endereco_parts)) if body.tipo == "delivery" else None

    # Calcula valor total
    itens_json: list[dict[str, Any]] = []
    subtotal = Decimal("0")
    for item in body.itens:
        preco = Decimal(str(item.preco_unit))
        qtd = item.quantidade
        total_item = preco * qtd
        subtotal += total_item
        itens_json.append({
            "nome": item.nome,
            "quantidade": qtd,
            "preco_unit": float(preco),
            "tamanho": item.tamanho,
            "observacao": item.observacao,
            "adicionais": item.adicionais,
        })

    # Taxa de entrega
    taxa_entrega = Decimal("0")
    if body.tipo == "delivery":
        # Tenta taxa por bairro primeiro
        if body.endereco_bairro and pizz.taxas_bairro:
            bairro_lower = body.endereco_bairro.strip().lower()
            for tb in pizz.taxas_bairro:
                if (tb.get("bairro") or "").strip().lower() == bairro_lower:
                    taxa_entrega = Decimal(str(tb.get("taxa", 0)))
                    break
        # Senão, usa taxa fixa
        if taxa_entrega == 0 and pizz.taxa_entrega_fixa:
            taxa_entrega = Decimal(str(pizz.taxa_entrega_fixa))

    valor_total = subtotal + taxa_entrega

    # Cria ou busca cliente
    cli = (
        await db.execute(
            select(Cliente).where(
                Cliente.pizzaria_id == pizz.id,
                Cliente.telefone == telefone,
            )
        )
    ).scalar_one_or_none()
    if not cli:
        cli = Cliente(
            pizzaria_id=pizz.id,
            telefone=telefone,
            nome=body.nome_cliente,
            endereco_padrao=endereco,
        )
        db.add(cli)
        await db.flush()
    else:
        # Atualiza nome e endereço se mudou
        if body.nome_cliente and body.nome_cliente != cli.nome:
            cli.nome = body.nome_cliente
        if endereco:
            cli.endereco_padrao = endereco

    # Gera número do pedido (incremental por pizzaria)
    max_num = (await db.execute(
        text("SELECT COALESCE(MAX(numero_pedido), 0) FROM public.pedidos WHERE pizzaria_id = :pid"),
        {"pid": str(pizz.id)},
    )).scalar() or 0

    # Cria o pedido
    pedido = Pedido(
        pizzaria_id=pizz.id,
        cliente_id=cli.id,
        numero_pedido=max_num + 1,
        itens=itens_json,
        valor_total=valor_total,
        status="confirmado",
        tipo=body.tipo,
        endereco_entrega=endereco,
        endereco_lat=body.endereco_lat if body.tipo == "delivery" else None,
        endereco_lon=body.endereco_lon if body.tipo == "delivery" else None,
        forma_pagamento=body.forma_pagamento,
        observacoes=body.observacoes,
        origem="cardapio_digital",
        bot_ativo=False,  # Pedidos digitais não passam pelo bot
    )
    db.add(pedido)
    await db.flush()

    # Cria/atualiza conversa (para a confirmação via WhatsApp)
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizz.id,
                Conversa.cliente_telefone == telefone,
            )
        )
    ).scalar_one_or_none()
    if not conv:
        conv = Conversa(
            pizzaria_id=pizz.id,
            cliente_telefone=telefone,
            cliente_nome=body.nome_cliente,
        )
        db.add(conv)
        await db.flush()

    # ── Registra o atendimento digital na cota do plano ──────────────────────
    # A função `conversas_atendidas_mes` conta conversas distintas com ao menos
    # uma mensagem de origem='bot'. Inserimos um marcador com esse origem para
    # que pedidos do cardápio digital também sejam contabilizados na cota.
    atendimento_marker = Mensagem(
        conversa_id=conv.id,
        pizzaria_id=pizz.id,
        origem="bot",
        tipo="texto",
        conteudo=f"[Pedido #{max_num + 1} via Cardápio Digital]",
        metadata_json={"trigger": "pedido_digital_quota", "pedido_num": max_num + 1},
    )
    db.add(atendimento_marker)
    # ─────────────────────────────────────────────────────────────────────────

    await db.commit()
    await db.refresh(pedido)

    # Broadcast do novo pedido para o painel (WebSocket) — fire-and-forget
    asyncio.create_task(
        _broadcast_novo_pedido(pizz.id, pedido)
    )

    # Envia confirmação no WhatsApp do cliente (fire-and-forget: não bloqueia a resposta)
    asyncio.create_task(
        _enviar_confirmacao_whatsapp(pizz.id, pedido.id, cli.telefone, cli.nome, float(taxa_entrega))
    )

    return {
        "ok": True,
        "numero_pedido": pedido.numero_pedido,
        "valor_total": float(pedido.valor_total),
        "taxa_entrega": float(taxa_entrega),
        "tempo_estimado": f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
            if body.tipo == "delivery"
            else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min",
    }


async def _broadcast_novo_pedido(pizzaria_id: Any, pedido: "Pedido") -> None:
    """Broadcast do novo pedido digital para o painel (WebSocket). Best-effort."""
    try:
        from app.services.broadcaster import broadcaster
        await broadcaster.publish(
            pizzaria_id,
            {
                "tipo": "pedido.novo",
                "pizzaria_id": str(pizzaria_id),
                "payload": {
                    "pedido_id": str(pedido.id),
                    "numero_pedido": pedido.numero_pedido,
                    "status": pedido.status,
                    "origem": "cardapio_digital",
                },
            },
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao broadcast novo pedido digital: %s", e)


# ============================================
# Enviar confirmação no WhatsApp
# ============================================
async def _enviar_confirmacao_whatsapp(
    pizzaria_id: uuid.UUID,
    pedido_id: uuid.UUID,
    cliente_telefone: str,
    cliente_nome: str | None,
    taxa_entrega: float,
) -> None:
    """Envia mensagem de confirmação do pedido digital no WhatsApp do cliente. Segura para background."""
    from app.services.evolution import evolution
    from app.db import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()
        if not pizz or not pizz.instancia:
            log.info("Pizzaria %s sem instância WhatsApp — skip confirmação", pizzaria_id)
            return
            
        pedido = (await db.execute(select(Pedido).where(Pedido.id == pedido_id))).scalar_one_or_none()
        if not pedido:
            return

    # Monta resumo dos itens
    linhas_itens = []
    for item in (pedido.itens or []):
        nome = item.get("nome", "?")
        qtd = item.get("quantidade", 1)
        preco = item.get("preco_unit", 0)
        tamanho = item.get("tamanho")
        obs = item.get("observacao")
        adicionais = item.get("adicionais", [])

        linha = f"  {qtd}x {nome}"
        if tamanho:
            linha += f" ({tamanho})"
        linha += f" — R$ {preco * qtd:.2f}".replace(".", ",")
        if adicionais:
            linha += f"\n      + {', '.join(adicionais)}"
        if obs:
            linha += f"\n      📝 {obs}"
        linhas_itens.append(linha)

    itens_texto = "\n".join(linhas_itens)

    # Monta mensagem
    primeiro_nome = (cliente_nome or "").split(" ")[0].strip() or "cliente"
    tempo = (
        f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
        if pedido.tipo == "delivery"
        else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min"
    )

    msg_parts = [
        f"🍕 *Pedido #{pedido.numero_pedido} recebido!*",
        f"",
        f"Olá, {primeiro_nome}! Seu pedido pelo cardápio digital foi recebido com sucesso. ✅",
        f"",
        f"📋 *Resumo:*",
        itens_texto,
    ]

    if taxa_entrega > 0:
        msg_parts.append(f"  🚚 Taxa de entrega — R$ {float(taxa_entrega):.2f}".replace(".", ","))

    msg_parts.extend([
        f"",
        f"💰 *Total: R$ {float(pedido.valor_total):.2f}*".replace(".", ","),
    ])

    if pedido.tipo == "delivery" and pedido.endereco_entrega:
        msg_parts.append(f"📍 *Entrega:* {pedido.endereco_entrega}")
    elif pedido.tipo == "retirada":
        msg_parts.append(f"🏪 *Retirada no balcão*")

    msg_parts.extend([
        f"💳 *Pagamento:* {pedido.forma_pagamento}",
        f"⏰ *Previsão:* {tempo}",
        f"",
        f"Qualquer dúvida, é só responder aqui! 😊",
    ])

    texto = "\n".join(msg_parts)

    try:
        # "Digitando…" + delay humanizado
        delay_ms = int(min(max(len(texto) * 55, 2000), 8000))
        try:
            await evolution.send_presence(instancia=pizz.instancia, numero=cliente_telefone, tipo="composing")
        except Exception:  # noqa: BLE001
            pass
        await evolution.send_text(
            instancia=pizz.instancia,
            numero=cliente_telefone,
            texto=texto,
            delay_ms=delay_ms,
        )
    except Exception as e:
        log.warning("Falha ao enviar confirmação WhatsApp do pedido digital: %s", e)
        return

    # Persiste como mensagem do sistema
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizz.id,
                Conversa.cliente_telefone == cliente_telefone,
            )
        )
    ).scalar_one_or_none()
    if conv:
        msg = Mensagem(
            conversa_id=conv.id,
            pizzaria_id=pizz.id,
            origem="sistema",
            tipo="texto",
            conteudo=texto,
            metadata_json={"trigger": "pedido_digital", "pedido_id": str(pedido.id)},
        )
        db.add(msg)
        conv.last_message = texto
        conv.last_timestamp = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(msg)

        # Broadcast da mensagem pro painel
        try:
            from app.services.broadcaster import broadcaster
            await broadcaster.publish(
                pizz.id,
                {
                    "tipo": "mensagem.nova",
                    "pizzaria_id": str(pizz.id),
                    "payload": {
                        "conversa_id": str(conv.id),
                        "mensagem_id": str(msg.id),
                        "telefone": cliente_telefone,
                        "conteudo": texto,
                        "origem": "sistema",
                    },
                },
            )
        except Exception:  # noqa: BLE001
            pass

    log.info("Confirmação WhatsApp enviada: pedido #%s para %s", pedido.numero_pedido, cliente_telefone)
