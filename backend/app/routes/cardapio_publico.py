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

from fastapi import APIRouter, Header, HTTPException, Request, status
from app.auth import create_access_token, decode_token, hash_password, verify_password
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.db import get_db
from app.models import Cliente, Conversa, Mensagem, Pedido, Pizzaria, Produto
from app.services.order_audit import registrar_evento_pedido
from app.services.rate_limit import allow, client_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/menu", tags=["cardapio_digital"])

# Rate limiting por IP via Redis (distribuído, fail-open) — vale entre réplicas.
_RATE_LIMIT_GET = 30   # req/min
_RATE_LIMIT_POST = 5   # req/min


async def _check_rate(request: Request, *, max_hits: int, scope: str) -> None:
    if not await allow(f"menu:{scope}:{client_ip(request)}", max_hits=max_hits, window_seconds=60):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Muitas requisições. Tente novamente em instantes.",
        )


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
    tema_cardapio: dict[str, Any]
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
    aberto_manual: bool | None = None


class MenuResponse(BaseModel):
    pizzaria: PizzariaPublica
    produtos: list[ProdutoPublico]


# ============================================
# Schemas de entrada (pedido do cliente)
# ============================================
class ItemPedidoIn(BaseModel):
    # produto_id é a fonte de verdade do preço — o backend recalcula a partir dele.
    produto_id: str | None = None
    nome: str = Field(min_length=1, max_length=200)
    quantidade: int = Field(ge=1, le=50)
    tamanho: str | None = None
    # preco_unit é IGNORADO no servidor (recalculado); mantido só por compat. de payload.
    preco_unit: float = Field(default=0, ge=0)
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
    cupom: str | None = Field(default=None, max_length=40)
    observacoes: str | None = Field(default=None, max_length=500)
    itens: list[ItemPedidoIn] = Field(min_length=1, max_length=50)
    # Honeypot anti-bot (campo invisível no form — se preenchido, é bot)
    website: str | None = Field(default=None, max_length=0)


class ClienteContaCadastroIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=10, max_length=20)
    email: str = Field(min_length=5, max_length=254)
    senha: str = Field(min_length=10, max_length=128)


class ClienteContaLoginIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    senha: str = Field(min_length=10, max_length=128)


class ClienteEnderecoIn(BaseModel):
    cep: str = Field(min_length=8, max_length=10)
    rua: str = Field(min_length=2, max_length=180)
    numero: str = Field(min_length=1, max_length=30)
    bairro: str = Field(min_length=2, max_length=120)
    complemento: str | None = Field(default=None, max_length=120)
    referencia: str | None = Field(default=None, max_length=180)


class ClienteContaAtualizarIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=10, max_length=20)
    email: str = Field(min_length=5, max_length=254)
    endereco: ClienteEnderecoIn


# ============================================
# Helper: recálculo de preços (anti-tampering)
# ============================================
def _recalcular_itens(
    itens: list["ItemPedidoIn"],
    produtos_map: dict[str, Any],
    adicionais_precos: dict[str, Decimal],
) -> tuple[list[dict[str, Any]], Decimal]:
    """Recalcula itens/subtotal usando SEMPRE o preço do cadastro (Produto +
    tamanho + adicionais). O preço enviado pelo cliente é ignorado — isso impede
    adulteração de preço pelo checkout público. Levanta HTTP 400 em item inválido."""
    itens_json: list[dict[str, Any]] = []
    subtotal = Decimal("0")
    for item in itens:
        prod = produtos_map.get(item.produto_id or "")
        if prod is None or not getattr(prod, "disponivel", False):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Item indisponível ou inválido: {item.nome}. Atualize a página e tente novamente.",
            )
        preco_unit = Decimal(str(prod.preco))
        tamanho_final = None
        tamanhos = prod.tamanhos or []
        if tamanhos:
            match = next((t for t in tamanhos if str(t.get("tamanho")) == str(item.tamanho)), None)
            if not match:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tamanho inválido para {prod.nome}.")
            preco_unit = Decimal(str(match.get("preco") or 0))
            tamanho_final = match.get("tamanho")
        adicionais_validos: list[str] = []
        for a in (item.adicionais or []):
            preco_a = adicionais_precos.get((a or "").strip().lower())
            if preco_a is not None:
                adicionais_validos.append(a)
                preco_unit += preco_a
        subtotal += preco_unit * item.quantidade
        itens_json.append({
            "produto_id": str(prod.id),
            "nome": prod.nome + (f" ({tamanho_final})" if tamanho_final else ""),
            "quantidade": item.quantidade,
            "preco_unit": float(preco_unit),
            "tamanho": tamanho_final,
            "observacao": item.observacao,
            "adicionais": adicionais_validos,
        })
    return itens_json, subtotal


# ============================================
# Helper: verificar horário
# ============================================
def _esta_aberto(pizzaria: Pizzaria) -> bool:
    """Verifica o override manual antes do horário programado."""
    try:
        from app.services.business_hours import esta_aberto
        return esta_aberto(
            pizzaria.horario_funcionamento or {},
            override=getattr(pizzaria, "aberto_manual", None),
        )
    except Exception:
        return True  # na dúvida, permite o pedido


def _normalizar_email(email: str) -> str:
    normalizado = email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalizado):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe um e-mail válido.")
    return normalizado


def _token_conta(cliente: Cliente, pizzaria: Pizzaria) -> str:
    return create_access_token(str(cliente.id), extra={"typ": "cliente", "pizzaria_id": str(pizzaria.id), "slug": pizzaria.slug, "ver": int(cliente.conta_versao or 1)}, expires_minutes=43_200)


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

def _telefones_equivalentes(tel: str) -> set[str]:
    """Returns equivalent forms of a Brazilian WhatsApp number."""
    digits = re.sub(r"\D", "", tel)
    nacional = digits[2:] if digits.startswith("55") and len(digits) in {12, 13} else digits
    variantes = {digits, _limpar_telefone(digits), nacional}
    if len(nacional) == 11 and nacional[2:3] == "9":
        sem_nono = nacional[:2] + nacional[3:]
        variantes.update({sem_nono, "55" + sem_nono})
    elif len(nacional) == 10:
        com_nono = nacional[:2] + "9" + nacional[2:]
        variantes.update({com_nono, "55" + com_nono})
    return {numero for numero in variantes if numero}


def _calcular_desconto(
    tema_cardapio: dict[str, Any] | None,
    codigo: str | None,
    subtotal: Decimal,
) -> tuple[Decimal, str | None]:
    """Valida o cupom configurado pela loja e calcula o desconto no servidor."""
    codigo_normalizado = (codigo or "").strip().upper()
    if not codigo_normalizado:
        return Decimal("0"), None

    cupons = (tema_cardapio or {}).get("cupons") or []
    cupom = next(
        (
            item for item in cupons
            if isinstance(item, dict)
            and str(item.get("codigo") or "").strip().upper() == codigo_normalizado
        ),
        None,
    )
    if not cupom or not bool(cupom.get("ativo", True)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cupom inválido ou indisponível.")

    validade = cupom.get("validade")
    if validade:
        try:
            data_validade = datetime.fromisoformat(str(validade).replace("Z", "+00:00")).date()
            if data_validade < datetime.now(timezone.utc).date():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este cupom expirou.")
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cupom com validade inválida.") from exc

    pedido_minimo = Decimal(str(cupom.get("pedido_minimo") or 0))
    if subtotal < pedido_minimo:
        minimo_fmt = f"{float(pedido_minimo):.2f}".replace(".", ",")
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Este cupom exige pedido mínimo de R$ {minimo_fmt}.",
        )

    valor = max(Decimal("0"), Decimal(str(cupom.get("valor") or 0)))
    if cupom.get("tipo") == "percentual":
        valor = min(valor, Decimal("100"))
        desconto = subtotal * valor / Decimal("100")
    else:
        desconto = valor
    desconto = min(subtotal, desconto).quantize(Decimal("0.01"))
    return desconto, codigo_normalizado



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
    await _check_rate(request, max_hits=_RATE_LIMIT_GET, scope="get")

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
        tema_cardapio=getattr(pizz, "tema_cardapio", None) or {},
        formas_pagamento_aceitas=pizz.formas_pagamento_aceitas or [],
        taxa_entrega_info=pizz.taxa_entrega_info,
        taxa_entrega_fixa=float(pizz.taxa_entrega_fixa) if pizz.taxa_entrega_fixa else None,
        taxas_bairro=pizz.taxas_bairro or [],
        adicionais=pizz.adicionais or [],
        tempo_entrega_min=pizz.tempo_entrega_min,
        tempo_entrega_max=pizz.tempo_entrega_max,
        tempo_retirada_min=pizz.tempo_retirada_min,
        tempo_retirada_max=pizz.tempo_retirada_max,
        aberto=_esta_aberto(pizz),
        aberto_manual=getattr(pizz, "aberto_manual", None),
    )

    return MenuResponse(pizzaria=pizzaria_pub, produtos=produtos)


@router.get("/{slug}/status")
async def consultar_status_loja(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Consulta rápida e leve do status da loja (aberto/fechado)."""
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))).scalar_one_or_none()
    if not pizz:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pizzaria não encontrada")
    aberto = _esta_aberto(pizz) and not getattr(pizz, "suspensa", False)
    return {
        "aberto": aberto,
        "aberto_manual": getattr(pizz, "aberto_manual", None),
        "telefone_contato": pizz.telefone_contato or pizz.telefone_admin,
        "horario_funcionamento": pizz.horario_funcionamento or {},
    }


# ============================================
# POST /menu/{slug}/pedido — Finalizar pedido
# ============================================
@router.get("/{slug}/pedido/{numero}/acompanhar")
async def acompanhar_pedido(
    slug: str,
    numero: int,
    telefone: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Consulta pública mínima do andamento, protegida por número + telefone."""
    await _check_rate(request, max_hits=20, scope="track")
    telefone_limpo = _limpar_telefone(telefone)
    if numero < 1 or len(telefone_limpo) < 12:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe um pedido e telefone válidos.")

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))
    ).scalar_one_or_none()
    if not pizz or getattr(pizz, "suspensa", False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")

    pedido = (
        await db.execute(
            select(Pedido)
            .join(Cliente, Pedido.cliente_id == Cliente.id)
            .where(
                Pedido.pizzaria_id == pizz.id,
                Pedido.numero_pedido == numero,
                Cliente.telefone == telefone_limpo,
            )
        )
    ).scalar_one_or_none()
    if not pedido:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado. Confira os dados.")

    tempo = (
        f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
        if pedido.tipo == "delivery"
        else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min"
    )
    return {
        "numero_pedido": pedido.numero_pedido,
        "status": pedido.status,
        "tipo": pedido.tipo,
        "criado_em": pedido.created_at.isoformat(),
        "atualizado_em": pedido.updated_at.isoformat(),
        "tempo_estimado": tempo,
        "entregador_nome": pedido.entregador.nome if pedido.entregador else None,
    }


def _resposta_pedido_digital(pedido: Pedido, pizz: Pizzaria, *, repetido: bool = False) -> dict[str, Any]:
    return {
        "ok": True, "numero_pedido": pedido.numero_pedido,
        "valor_total": float(pedido.valor_total),
        "taxa_entrega": float(pedido.taxa_entrega or 0),
        "desconto": float(pedido.valor_desconto or 0),
        "cupom_codigo": pedido.cupom_codigo,
        "tempo_estimado": (
            f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
            if pedido.tipo == "delivery"
            else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min"
        ),
        "repetido": repetido,
    }


@router.post("/{slug}/pedido", status_code=status.HTTP_201_CREATED)
async def criar_pedido_digital(
    slug: str,
    body: PedidoDigitalIn,
    request: Request,
    x_idempotency_key: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Cria um pedido vindo do cardápio digital."""
    await _check_rate(request, max_hits=_RATE_LIMIT_POST, scope="post")

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
    chave_idempotencia = (x_idempotency_key or "").strip()[:120] or None
    if chave_idempotencia:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": f"pedido:idempotencia:{pizz.id}:{chave_idempotencia}"},
        )
        existente = (await db.execute(
            select(Pedido).where(
                Pedido.pizzaria_id == pizz.id,
                Pedido.chave_idempotencia == chave_idempotencia,
            )
        )).scalar_one_or_none()
        if existente:
            return _resposta_pedido_digital(existente, pizz, repetido=True)
    if getattr(pizz, "suspensa", False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esta pizzaria não está recebendo pedidos no momento.")
    if not _esta_aberto(pizz):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A pizzaria está fechada no momento e não está recebendo novos pedidos.",
        )

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

    # Calcula valor total — SEMPRE recalculado no servidor a partir do cadastro.
    # NUNCA confia no preço enviado pelo cliente (anti-tampering de preço).
    prod_ids: list[uuid.UUID] = []
    for it in body.itens:
        if it.produto_id:
            try:
                prod_ids.append(uuid.UUID(it.produto_id))
            except ValueError:
                pass
    produtos_map: dict[str, Produto] = {}
    if prod_ids:
        rows = (await db.execute(
            select(Produto).where(Produto.pizzaria_id == pizz.id, Produto.id.in_(prod_ids))
        )).scalars().all()
        produtos_map = {str(p.id): p for p in rows}

    adicionais_precos = {
        (a.get("nome") or "").strip().lower(): Decimal(str(a.get("preco") or 0))
        for a in (pizz.adicionais or [])
    }

    itens_json, subtotal = _recalcular_itens(body.itens, produtos_map, adicionais_precos)
    desconto, cupom_codigo = _calcular_desconto(getattr(pizz, "tema_cardapio", None), body.cupom, subtotal)

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

    valor_total = subtotal - desconto + taxa_entrega

    # Cria ou busca cliente
    cli = None
    authorization = request.headers.get("authorization")
    if authorization:
        cli, token_pizzaria = await _cliente_autenticado(slug, authorization, db)
        if token_pizzaria.id != pizz.id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida. Entre novamente.")
        telefone = cli.telefone
    if cli is None:
        cli = (
        await db.execute(
            select(Cliente).where(
                Cliente.pizzaria_id == pizz.id,
                Cliente.telefone == telefone,
            )
        )
    ).scalar_one_or_none()
    if cli is None:
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

    # Número do pedido: deixamos o trigger `assign_numero_pedido` (BEFERE INSERT)
    # atribuir — ele já serializa por pizzaria com advisory lock. Antes o fluxo
    # digital setava o número em Python (MAX+1) com chave de lock diferente, então
    # podia colidir com um pedido do WhatsApp criado ao mesmo tempo. Não setando o
    # número aqui, TODOS os fluxos passam pelo mesmo lock do trigger.
    observacoes_pedido = body.observacoes
    if desconto > 0 and cupom_codigo:
        desconto_fmt = f"{float(desconto):.2f}".replace(".", ",")
        nota_cupom = f"Cupom {cupom_codigo}: desconto de R$ {desconto_fmt}"
        observacoes_pedido = f"{observacoes_pedido}\n{nota_cupom}".strip() if observacoes_pedido else nota_cupom

    pedido = Pedido(
        pizzaria_id=pizz.id,
        cliente_id=cli.id,
        itens=itens_json,
        valor_total=valor_total,
        status="confirmado",
        tipo=body.tipo,
        endereco_entrega=endereco,
        endereco_lat=body.endereco_lat if body.tipo == "delivery" else None,
        endereco_lon=body.endereco_lon if body.tipo == "delivery" else None,
        forma_pagamento=body.forma_pagamento,
        observacoes=observacoes_pedido,
        origem="cardapio_digital",
        chave_idempotencia=chave_idempotencia,
        valor_subtotal=subtotal,
        valor_desconto=desconto,
        taxa_entrega=taxa_entrega,
        cupom_codigo=cupom_codigo,
        bot_ativo=False,  # Pedidos digitais não passam pelo bot
    )
    db.add(pedido)
    await db.flush()
    # Recarrega o numero_pedido atribuído pelo trigger (não vem por padrão no flush).
    await db.refresh(pedido, ["numero_pedido"])
    numero = pedido.numero_pedido

    registrar_evento_pedido(
        db, pedido, tipo="criado", status_novo=pedido.status,
        ator_nome="Cardapio digital", ator_tipo="cliente",
    )

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
        conteudo=f"[Pedido #{numero} via Cardápio Digital]",
        metadata_json={"trigger": "pedido_digital_quota", "pedido_num": numero},
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

    return _resposta_pedido_digital(pedido, pizz)


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

# ============================================
# Conta do consumidor: cadastro, login, histórico e recompra
# ============================================
def _cliente_publico(cliente: Cliente) -> dict[str, Any]:
    return {
        "id": str(cliente.id),
        "nome": cliente.nome or "",
        "telefone": cliente.telefone,
        "email": cliente.email or "",
        "endereco_padrao": cliente.endereco_padrao,
        "endereco": cliente.endereco_dados or {},
        "total_pedidos": cliente.total_pedidos,
        "total_gasto": float(cliente.total_gasto or 0),
    }


async def _cliente_autenticado(
    slug: str,
    authorization: str | None,
    db: AsyncSession,
) -> tuple[Cliente, Pizzaria]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Entre na sua conta para continuar.")
    try:
        payload = decode_token(authorization.split(" ", 1)[1].strip())
        if payload.get("typ") != "cliente" or payload.get("slug") != slug:
            raise ValueError("tipo ou loja incorretos")
        cliente_id = uuid.UUID(str(payload.get("sub")))
        pizzaria_id = uuid.UUID(str(payload.get("pizzaria_id")))
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sua sessão expirou. Entre novamente.") from exc

    pizzaria = (await db.execute(
        select(Pizzaria).where(Pizzaria.id == pizzaria_id, Pizzaria.slug == slug)
    )).scalar_one_or_none()
    cliente = (await db.execute(
        select(Cliente).where(
            Cliente.id == cliente_id,
            Cliente.pizzaria_id == pizzaria_id,
            Cliente.conta_ativa == True,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not pizzaria or not cliente or getattr(pizzaria, "suspensa", False):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sua sessão não é mais válida.")
    if int(payload.get("ver", 1)) != int(cliente.conta_versao or 1):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sua sessão foi encerrada. Entre novamente.")
    return cliente, pizzaria


@router.post("/{slug}/conta/cadastro", status_code=status.HTTP_201_CREATED)
async def cadastrar_conta_cliente(
    slug: str,
    body: ClienteContaCadastroIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_rate(request, max_hits=5, scope="account-register")
    pizzaria = (await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))).scalar_one_or_none()
    if not pizzaria or getattr(pizzaria, "suspensa", False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cardápio não encontrado.")
    email = _normalizar_email(body.email)
    telefone = _limpar_telefone(body.telefone)
    if len(telefone) < 12:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe um WhatsApp válido com DDD.")

    por_email = (await db.execute(
        select(Cliente).where(Cliente.pizzaria_id == pizzaria.id, func.lower(Cliente.email) == email)
    )).scalar_one_or_none()
    if por_email and por_email.conta_ativa:
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com este e-mail.")
    por_telefone = (await db.execute(
        select(Cliente).where(Cliente.pizzaria_id == pizzaria.id, Cliente.telefone == telefone)
    )).scalar_one_or_none()
    if por_telefone and por_telefone.conta_ativa and por_telefone.email != email:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este WhatsApp já está vinculado a outra conta.")
    if por_email and por_telefone and por_email.id != por_telefone.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "E-mail e WhatsApp já pertencem a cadastros diferentes.")

    cliente = por_telefone or por_email
    if not cliente:
        cliente = Cliente(pizzaria_id=pizzaria.id, telefone=telefone)
        db.add(cliente)
        await db.flush()
    ja_possuia_credencial = bool(cliente.senha_hash or cliente.conta_ativa)
    cliente.nome = body.nome.strip()
    cliente.telefone = telefone
    cliente.email = email
    cliente.senha_hash = hash_password(body.senha)
    cliente.conta_ativa = True
    cliente.conta_versao = int(cliente.conta_versao or 1) + (1 if ja_possuia_credencial else 0)
    cliente.conta_atualizada_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cliente)
    return {"access_token": _token_conta(cliente, pizzaria), "token_type": "bearer", "cliente": _cliente_publico(cliente)}


@router.post("/{slug}/conta/entrar")
async def entrar_conta_cliente(
    slug: str,
    body: ClienteContaLoginIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _check_rate(request, max_hits=8, scope="account-login")
    email = _normalizar_email(body.email)
    pizzaria = (await db.execute(select(Pizzaria).where(Pizzaria.slug == slug))).scalar_one_or_none()
    cliente = None
    if pizzaria and not getattr(pizzaria, "suspensa", False):
        cliente = (await db.execute(
            select(Cliente).where(
                Cliente.pizzaria_id == pizzaria.id,
                func.lower(Cliente.email) == email,
                Cliente.conta_ativa == True,  # noqa: E712
            )
        )).scalar_one_or_none()
    if not cliente or not cliente.senha_hash or not verify_password(body.senha, cliente.senha_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    cliente.conta_atualizada_at = datetime.now(timezone.utc)
    await db.commit()
    return {"access_token": _token_conta(cliente, pizzaria), "token_type": "bearer", "cliente": _cliente_publico(cliente)}


@router.get("/{slug}/conta")
async def minha_conta_cliente(
    slug: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cliente, _ = await _cliente_autenticado(slug, authorization, db)
    return {"cliente": _cliente_publico(cliente)}



@router.put("/{slug}/conta")
async def atualizar_conta_cliente(
    slug: str,
    body: ClienteContaAtualizarIn,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cliente, pizzaria = await _cliente_autenticado(slug, authorization, db)
    email = _normalizar_email(body.email)
    telefone = _limpar_telefone(body.telefone)
    cep = re.sub(r"\D", "", body.endereco.cep)
    if len(telefone) < 12:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe um WhatsApp valido com DDD.")
    if len(cep) != 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe um CEP valido com 8 digitos.")

    email_em_uso = (await db.execute(
        select(Cliente.id).where(
            Cliente.pizzaria_id == pizzaria.id,
            func.lower(Cliente.email) == email,
            Cliente.id != cliente.id,
        )
    )).scalar_one_or_none()
    if email_em_uso:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este e-mail ja esta vinculado a outra conta.")
    telefone_em_uso = (await db.execute(
        select(Cliente.id).where(
            Cliente.pizzaria_id == pizzaria.id,
            Cliente.telefone == telefone,
            Cliente.id != cliente.id,
        )
    )).scalar_one_or_none()
    if telefone_em_uso:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este WhatsApp ja esta vinculado a outra conta.")

    endereco = {
        "cep": cep,
        "rua": body.endereco.rua.strip(),
        "numero": body.endereco.numero.strip(),
        "bairro": body.endereco.bairro.strip(),
        "complemento": (body.endereco.complemento or "").strip(),
        "referencia": (body.endereco.referencia or "").strip(),
    }
    endereco_padrao = f"{endereco['rua']}, n {endereco['numero']} - {endereco['bairro']}"
    if endereco["complemento"]:
        endereco_padrao += f", {endereco['complemento']}"

    cliente.nome = body.nome.strip()
    cliente.telefone = telefone
    cliente.email = email
    cliente.endereco_dados = endereco
    cliente.endereco_padrao = endereco_padrao
    cliente.conta_atualizada_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cliente)
def _pedido_conta(pedido: Pedido) -> dict[str, Any]:
    return {"cliente": _cliente_publico(cliente)}

    labels = {
        "novo": "Recebido", "confirmado": "Confirmado", "no_forno": "Em preparo",
        "pronto_entrega": "Pronto", "a_caminho": "Saiu para entrega",
        "entregue": "Entregue", "cancelado": "Cancelado",
    }
    return {
        "id": str(pedido.id),
        "numero_pedido": pedido.numero_pedido,
        "status": pedido.status,
        "status_label": labels.get(pedido.status, pedido.status.replace("_", " ").title()),
        "tipo": pedido.tipo,
        "itens": pedido.itens or [],
        "valor_total": float(pedido.valor_total),
        "criado_em": pedido.created_at.isoformat(),
        "atualizado_em": pedido.updated_at.isoformat(),
        "em_andamento": pedido.status not in {"entregue", "cancelado"},
    }


@router.get("/{slug}/conta/pedidos")
async def pedidos_conta_cliente(
    slug: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cliente, pizzaria = await _cliente_autenticado(slug, authorization, db)
    telefones = _telefones_equivalentes(cliente.telefone)
    pedidos = list((await db.execute(
        select(Pedido)
        .outerjoin(Cliente, Pedido.cliente_id == Cliente.id)
        .where(
            Pedido.pizzaria_id == pizzaria.id,
            or_(Pedido.cliente_id == cliente.id, Cliente.telefone.in_(telefones)),
        )
        .order_by(Pedido.created_at.desc())
        .limit(30)
    )).scalars().all())
    return {"pedidos": [_pedido_conta(pedido) for pedido in pedidos]}


@router.get("/{slug}/conta/pedidos/{pedido_id}/repetir")
async def repetir_pedido_conta(
    slug: str,
    pedido_id: uuid.UUID,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cliente, pizzaria = await _cliente_autenticado(slug, authorization, db)
    telefones = _telefones_equivalentes(cliente.telefone)
    pedido = (await db.execute(
        select(Pedido)
        .outerjoin(Cliente, Pedido.cliente_id == Cliente.id)
        .where(
            Pedido.id == pedido_id,
            Pedido.pizzaria_id == pizzaria.id,
            or_(Pedido.cliente_id == cliente.id, Cliente.telefone.in_(telefones)),
        )
    )).scalar_one_or_none()
    if not pedido:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")

    produtos = list((await db.execute(
        select(Produto).where(Produto.pizzaria_id == pizzaria.id, Produto.disponivel == True)  # noqa: E712
    )).scalars().all())
    por_id = {str(produto.id): produto for produto in produtos}
    por_nome = {produto.nome.strip().lower(): produto for produto in produtos}
    adicionais_precos = {
        str(item.get("nome") or "").strip().lower(): Decimal(str(item.get("preco") or 0))
        for item in (pizzaria.adicionais or [])
    }
    itens_disponiveis: list[dict[str, Any]] = []
    indisponiveis: list[str] = []
    for item in (pedido.itens or []):
        nome_salvo = str(item.get("nome") or "").strip()
        nome_base = re.sub(r"\s*\([^)]*\)\s*$", "", nome_salvo).strip().lower()
        produto = por_id.get(str(item.get("produto_id") or "")) or por_nome.get(nome_base)
        if not produto:
            indisponiveis.append(nome_salvo or "Item removido")
            continue
        tamanho = item.get("tamanho")
        preco = Decimal(str(produto.preco))
        if produto.tamanhos:
            tamanho_atual = next((t for t in produto.tamanhos if str(t.get("tamanho")) == str(tamanho)), None)
            if not tamanho_atual:
                indisponiveis.append(nome_salvo or produto.nome)
                continue
            preco = Decimal(str(tamanho_atual.get("preco") or 0))
        adicionais = [
            nome for nome in (item.get("adicionais") or [])
            if str(nome).strip().lower() in adicionais_precos
        ]
        for adicional in adicionais:
            preco += adicionais_precos[str(adicional).strip().lower()]
        itens_disponiveis.append({
            "produto_id": str(produto.id),
            "nome": produto.nome,
            "tamanho": tamanho,
            "preco": float(preco),
            "quantidade": max(1, int(item.get("quantidade") or 1)),
            "observacao": item.get("observacao") or "",
            "adicionais": adicionais,
            "imagem_url": produto.imagem_url,
        })
    return {"itens": itens_disponiveis, "indisponiveis": indisponiveis}
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
