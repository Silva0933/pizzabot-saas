"""
Tools do agente IA.

Cada tool tem:
  - declaração (FunctionDeclaration) que o Gemini vê
  - implementação async que executa a ação real

A tool registry mapeia name → (declaração, função).
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Coroutine

from google.genai import types
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import AgentContext
from app.models import Cliente, Conversa, Pedido

log = logging.getLogger(__name__)

ToolFn = Callable[..., Coroutine[Any, Any, dict[str, Any]]]


# ===============================================================
# DECLARAÇÕES (o que o Gemini "vê")
# ===============================================================
DECL_BUSCAR_CARDAPIO = types.FunctionDeclaration(
    name="buscar_cardapio",
    description=(
        "Consulta o cardápio real da pizzaria. Use SEMPRE antes de citar qualquer "
        "produto/preço/sabor e SEMPRE que o cliente pedir o cardápio, os sabores, "
        "as opções ou o que tem disponível. Para listar tudo, chame sem 'query' "
        "(ou com 'cardapio'). Para buscar algo específico, passe 'query' (ex: 'calabresa')."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(type=types.Type.STRING, description="Termo de busca específico (ex: 'calabresa', 'doce', 'sem lactose'). Deixe vazio para listar tudo."),
            "categoria": types.Schema(type=types.Type.STRING, description="Filtra por categoria específica (opcional)"),
            "limit": types.Schema(type=types.Type.INTEGER, description="Máximo de resultados (padrão 12)"),
        },
        required=[],
    ),
)

DECL_ENVIAR_CARDAPIO_ARQUIVO = types.FunctionDeclaration(
    name="enviar_cardapio_arquivo",
    description=(
        "Envia o cardápio completo em arquivo (PDF/imagem) para o cliente no WhatsApp. "
        "Use quando o cliente pedir 'o cardápio completo', 'me manda o cardápio', "
        "'tem em PDF/foto'. Se não houver arquivo cadastrado, retorna sem enviar — "
        "nesse caso liste os itens com buscar_cardapio."
    ),
    parameters=types.Schema(type=types.Type.OBJECT, properties={}, required=[]),
)

DECL_REGISTRAR_PEDIDO = types.FunctionDeclaration(
    name="registrar_pedido",
    description=(
        "Registra um novo pedido no sistema. Use SOMENTE após confirmação do cliente. "
        "Itens devem ser array com {nome, qtd, preco_unit}."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "itens": types.Schema(
                type=types.Type.ARRAY,
                description="Lista de itens do pedido. Cada item: {nome, qtd, preco_unit}",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "nome": types.Schema(type=types.Type.STRING),
                        "qtd": types.Schema(type=types.Type.INTEGER),
                        "preco_unit": types.Schema(type=types.Type.NUMBER),
                    },
                ),
            ),
            "valor_total": types.Schema(type=types.Type.NUMBER, description="Valor total em reais"),
            "tipo": types.Schema(type=types.Type.STRING, description="'delivery' ou 'retirada'"),
            "endereco_entrega": types.Schema(type=types.Type.STRING, description="Endereço completo (obrigatório se delivery)"),
            "forma_pagamento": types.Schema(type=types.Type.STRING, description="pix, cartao, dinheiro etc"),
            "observacoes": types.Schema(type=types.Type.STRING, description="Obs do cliente (sem cebola, troco, etc)"),
            "nome_cliente": types.Schema(type=types.Type.STRING, description="Nome do cliente para o pedido"),
        },
        required=["itens", "valor_total", "tipo", "forma_pagamento"],
    ),
)

DECL_ATUALIZAR_PEDIDO = types.FunctionDeclaration(
    name="atualizar_pedido",
    description=(
        "Atualiza um pedido já registrado (só se ainda não saiu para entrega). "
        "Use para mudar endereço, forma de pagamento, observações ou valor. "
        "Para trocar ITENS, prefira cancelar_pedido + registrar_pedido."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "pedido_id_alterar": types.Schema(type=types.Type.STRING, description="UUID do pedido"),
            "novo_endereco": types.Schema(type=types.Type.STRING),
            "nova_forma_pagamento": types.Schema(type=types.Type.STRING),
            "novas_observacoes": types.Schema(type=types.Type.STRING),
            "novo_valor_total": types.Schema(type=types.Type.NUMBER),
        },
        required=["pedido_id_alterar"],
    ),
)

DECL_CANCELAR_PEDIDO = types.FunctionDeclaration(
    name="cancelar_pedido",
    description="Cancela um pedido. Só funciona se ainda não saiu para entrega.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "pedido_id_cancelar": types.Schema(type=types.Type.STRING, description="UUID do pedido"),
            "motivo_cancelamento": types.Schema(type=types.Type.STRING, description="Motivo informado pelo cliente"),
        },
        required=["pedido_id_cancelar", "motivo_cancelamento"],
    ),
)

DECL_ESCALAR_HUMANO = types.FunctionDeclaration(
    name="escalar_humano",
    description=(
        "Transfere o atendimento para um humano da equipe. Use quando: insatisfação, "
        "urgência, alergia grave, restrição alimentar séria, ou assunto fora do escopo."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "motivo_escalonamento": types.Schema(type=types.Type.STRING, description="Por que está escalando"),
        },
        required=["motivo_escalonamento"],
    ),
)

DECL_LEMBRAR_CLIENTE = types.FunctionDeclaration(
    name="lembrar_cliente",
    description="Atualiza dados pessoais do cliente (nome, endereço padrão, preferências). Use quando o cliente informar.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "nome": types.Schema(type=types.Type.STRING),
            "endereco_padrao": types.Schema(type=types.Type.STRING),
            "preferencias": types.Schema(type=types.Type.STRING, description="Ex: 'sem cebola', 'massa fina', 'alérgico a frutos do mar'"),
        },
    ),
)


# ===============================================================
# IMPLEMENTAÇÕES
# ===============================================================
async def buscar_cardapio(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    query: str | None = None,
    categoria: str | None = None,
    limit: int = 12,
) -> dict[str, Any]:
    """
    Busca produtos no cardápio (só os disponíveis). Robusta:
    - pedidos genéricos (cardápio/sabores/menu/etc.) retornam o cardápio inteiro;
    - se uma busca específica não achar nada, cai no cardápio inteiro (nunca
      devolve vazio com produtos existindo).
    """
    base = (
        "SELECT id, nome, categoria, descricao, preco, disponivel "
        "FROM public.produtos WHERE pizzaria_id = :pid AND disponivel = true"
    )
    order = " ORDER BY categoria NULLS LAST, ordem, nome LIMIT :lim"
    lim = max(1, min(int(limit or 12), 40))

    q_clean = (query or "").strip().lower()
    GENERIC = {
        "", "todas", "todos", "tudo", "cardapio", "cardápio", "menu", "sabores",
        "sabor", "pizza", "pizzas", "opcoes", "opções", "quais", "lista", "ver", "tem",
    }

    def _is_generic(q: str) -> bool:
        if q in GENERIC:
            return True
        return any(tok in q for tok in ("sabor", "cardap", "menu", "opç", "opc", "todas", "tudo", "quais", "disponiv"))

    where_extra = ""
    params: dict[str, Any] = {"pid": str(ctx.pizzaria.id), "lim": lim}
    if q_clean and not _is_generic(q_clean):
        where_extra += " AND (nome ILIKE :q OR descricao ILIKE :q OR categoria ILIKE :q)"
        params["q"] = f"%{query.strip()}%"
    if categoria:
        where_extra += " AND categoria ILIKE :cat"
        params["cat"] = f"%{categoria}%"

    rows = (await db.execute(text(base + where_extra + order), params)).fetchall()

    # Fallback: filtro não achou nada → devolve o cardápio disponível inteiro.
    if not rows and where_extra:
        rows = (await db.execute(
            text(base + order), {"pid": str(ctx.pizzaria.id), "lim": lim}
        )).fetchall()

    items = [
        {
            "id": str(r[0]),
            "nome": r[1],
            "categoria": r[2],
            "descricao": r[3],
            "preco": float(r[4]),
            "disponivel": bool(r[5]),
        }
        for r in rows
    ]
    return {"encontrados": len(items), "items": items}


async def enviar_cardapio_arquivo(ctx: AgentContext, db: AsyncSession) -> dict[str, Any]:
    """Envia o arquivo (PDF/imagem) de cardápio cadastrado pela pizzaria."""
    row = (await db.execute(
        text("SELECT filename, content_type FROM public.cardapio_arquivo WHERE pizzaria_id = :pid"),
        {"pid": str(ctx.pizzaria.id)},
    )).first()
    if not row:
        return {"ok": False, "motivo": "sem_arquivo"}
    if not ctx.pizzaria.instancia:
        return {"ok": False, "motivo": "sem_instancia"}

    from app.config import get_settings
    from app.services.evolution import evolution

    filename = row[0] or "cardapio"
    ct = (row[1] or "application/pdf").lower()
    base = (get_settings().public_base_url or "").rstrip("/")
    url = f"{base}/pizzarias/{ctx.pizzaria.id}/cardapio/arquivo"
    mediatype = "image" if ct.startswith("image/") else "document"
    try:
        await evolution.send_media(
            instancia=ctx.pizzaria.instancia, numero=ctx.telefone,
            media_url=url, mediatype=mediatype, mimetype=ct, filename=filename,
            caption="Aqui está nosso cardápio completo 📋",
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao enviar arquivo de cardápio: %s", e)
        return {"ok": False, "motivo": "erro_envio"}
    return {"ok": True, "enviado": True}


async def registrar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    itens: list[dict[str, Any]],
    valor_total: float,
    tipo: str,
    forma_pagamento: str,
    endereco_entrega: str | None = None,
    observacoes: str | None = None,
    nome_cliente: str | None = None,
) -> dict[str, Any]:
    if tipo not in ("delivery", "retirada"):
        return {"ok": False, "erro": "tipo deve ser 'delivery' ou 'retirada'"}
    if tipo == "delivery" and not endereco_entrega:
        return {"ok": False, "erro": "endereco_entrega é obrigatório para delivery"}
    if not itens:
        return {"ok": False, "erro": "lista de itens vazia"}

    # garante cliente
    cli = ctx.cliente
    if not cli:
        cli = Cliente(
            pizzaria_id=ctx.pizzaria.id,
            telefone=ctx.telefone,
            nome=nome_cliente,
            endereco_padrao=endereco_entrega,
        )
        db.add(cli)
        await db.flush()
    else:
        if nome_cliente and not cli.nome:
            cli.nome = nome_cliente

    # Busca pedido rascunho existente no status 'novo'
    stmt = select(Pedido).where(
        Pedido.pizzaria_id == ctx.pizzaria.id,
        Pedido.cliente_id == cli.id,
        Pedido.status == "novo",
    )
    ped = (await db.execute(stmt)).scalars().first()

    status_anterior = "novo"
    if ped:
        # Atualiza o rascunho e move para confirmado
        ped.itens = itens
        ped.valor_total = Decimal(str(valor_total))
        ped.tipo = tipo
        ped.endereco_entrega = endereco_entrega
        ped.forma_pagamento = forma_pagamento
        ped.observacoes = observacoes
        ped.status = "confirmado"
        ped.updated_at = datetime.now(timezone.utc)
    else:
        status_anterior = None
        # Cria um novo em confirmado
        ped = Pedido(
            pizzaria_id=ctx.pizzaria.id,
            cliente_id=cli.id,
            itens=itens,
            valor_total=Decimal(str(valor_total)),
            status="confirmado",
            tipo=tipo,
            endereco_entrega=endereco_entrega,
            forma_pagamento=forma_pagamento,
            observacoes=observacoes,
        )
        db.add(ped)

    cli.total_pedidos += 1
    cli.total_gasto = (cli.total_gasto or Decimal(0)) + Decimal(str(valor_total))
    cli.ultima_visita = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(ped)

    # Dispara o broadcast WebSocket de atualização do pedido para mover de coluna no Kanban
    from app.services.broadcaster import broadcaster
    await broadcaster.publish(
        ctx.pizzaria.id,
        {
            "tipo": "pedido.atualizado" if status_anterior else "pedido.novo",
            "pizzaria_id": str(ctx.pizzaria.id),
            "payload": {
                "pedido_id": str(ped.id),
                "numero_pedido": ped.numero_pedido,
                "status_anterior": status_anterior,
                "status_novo": ped.status,
            },
        },
    )

    return {
        "ok": True,
        "pedido_id": str(ped.id),
        "numero_pedido": ped.numero_pedido,
        "valor_total": valor_total,
        "tempo_estimado": (
            f"{ctx.pizzaria.tempo_entrega_min}-{ctx.pizzaria.tempo_entrega_max} min"
            if tipo == "delivery"
            else f"{ctx.pizzaria.tempo_retirada_min}-{ctx.pizzaria.tempo_retirada_max} min"
        ),
    }


async def atualizar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    pedido_id_alterar: str,
    novo_endereco: str | None = None,
    nova_forma_pagamento: str | None = None,
    novas_observacoes: str | None = None,
    novo_valor_total: float | None = None,
) -> dict[str, Any]:
    try:
        pid = uuid.UUID(pedido_id_alterar)
    except ValueError:
        return {"ok": False, "erro": "pedido_id inválido"}

    ped = (
        await db.execute(
            select(Pedido).where(
                Pedido.id == pid,
                Pedido.pizzaria_id == ctx.pizzaria.id,
            )
        )
    ).scalar_one_or_none()

    if not ped:
        return {"ok": False, "erro": "pedido não encontrado"}
    if ped.status in ("a_caminho", "entregue", "cancelado"):
        return {"ok": False, "erro": f"pedido com status '{ped.status}' não pode ser alterado"}

    if novo_endereco:
        ped.endereco_entrega = novo_endereco
    if nova_forma_pagamento:
        ped.forma_pagamento = nova_forma_pagamento
    if novas_observacoes:
        ped.observacoes = novas_observacoes
    if novo_valor_total:
        ped.valor_total = Decimal(str(novo_valor_total))

    await db.flush()
    return {"ok": True, "numero_pedido": ped.numero_pedido}


async def cancelar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    pedido_id_cancelar: str,
    motivo_cancelamento: str,
) -> dict[str, Any]:
    try:
        pid = uuid.UUID(pedido_id_cancelar)
    except ValueError:
        return {"ok": False, "erro": "pedido_id inválido"}

    ped = (
        await db.execute(
            select(Pedido).where(
                Pedido.id == pid,
                Pedido.pizzaria_id == ctx.pizzaria.id,
            )
        )
    ).scalar_one_or_none()

    if not ped:
        return {"ok": False, "erro": "pedido não encontrado"}
    if ped.status in ("a_caminho", "entregue"):
        return {"ok": False, "erro": f"pedido com status '{ped.status}' não pode ser cancelado"}

    ped.status = "cancelado"
    ped.cancelado_at = datetime.now(timezone.utc)
    ped.cancelamento_motivo = motivo_cancelamento
    await db.flush()
    return {"ok": True, "numero_pedido": ped.numero_pedido}


async def escalar_humano(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    motivo_escalonamento: str,
) -> dict[str, Any]:
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == ctx.pizzaria.id,
                Conversa.cliente_telefone == ctx.telefone,
            )
        )
    ).scalar_one_or_none()

    if conv:
        conv.bot_ativo = False
        conv.status = "humano_necessario"
        await db.flush()

        # Broadcast para alertar o painel em tempo real
        from app.services.broadcaster import broadcaster

        await broadcaster.publish(
            ctx.pizzaria.id,
            {
                "tipo": "atendimento.humano",
                "pizzaria_id": str(ctx.pizzaria.id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "telefone": ctx.telefone,
                    "cliente_nome": conv.cliente_nome,
                    "motivo": motivo_escalonamento,
                },
            },
        )
        await broadcaster.publish(
            ctx.pizzaria.id,
            {
                "tipo": "conversa.atualizada",
                "pizzaria_id": str(ctx.pizzaria.id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "telefone": ctx.telefone,
                    "bot_ativo": False,
                    "status": "humano_necessario",
                    "motivo": motivo_escalonamento,
                },
            },
        )

    log.info(
        "Escalou: pizzaria=%s tel=%s motivo=%s",
        ctx.pizzaria.id, ctx.telefone, motivo_escalonamento,
    )
    return {"ok": True, "mensagem": "Equipe acionada, atendente humano vai assumir."}


async def lembrar_cliente(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    nome: str | None = None,
    endereco_padrao: str | None = None,
    preferencias: str | None = None,
) -> dict[str, Any]:
    cli = ctx.cliente
    if not cli:
        cli = Cliente(pizzaria_id=ctx.pizzaria.id, telefone=ctx.telefone)
        db.add(cli)
        await db.flush()

    if nome:
        cli.nome = nome
    if endereco_padrao:
        cli.endereco_padrao = endereco_padrao
    if preferencias:
        cli.preferencias = preferencias

    await db.flush()
    return {"ok": True}


# ===============================================================
# REGISTRY
# ===============================================================
TOOL_DECLARATIONS = [
    DECL_BUSCAR_CARDAPIO,
    DECL_ENVIAR_CARDAPIO_ARQUIVO,
    DECL_REGISTRAR_PEDIDO,
    DECL_ATUALIZAR_PEDIDO,
    DECL_CANCELAR_PEDIDO,
    DECL_ESCALAR_HUMANO,
    DECL_LEMBRAR_CLIENTE,
]

TOOL_IMPL: dict[str, ToolFn] = {
    "buscar_cardapio": buscar_cardapio,
    "enviar_cardapio_arquivo": enviar_cardapio_arquivo,
    "registrar_pedido": registrar_pedido,
    "atualizar_pedido": atualizar_pedido,
    "cancelar_pedido": cancelar_pedido,
    "escalar_humano": escalar_humano,
    "lembrar_cliente": lembrar_cliente,
}


def get_tools() -> list[types.Tool]:
    """Retorna no formato esperado pelo Gemini."""
    return [types.Tool(function_declarations=TOOL_DECLARATIONS)]


async def execute_tool(
    name: str,
    args: dict[str, Any],
    *,
    ctx: AgentContext,
    db: AsyncSession,
) -> dict[str, Any]:
    """Dispatcher."""
    fn = TOOL_IMPL.get(name)
    if not fn:
        return {"erro": f"tool desconhecida: {name}"}
    try:
        result = await fn(ctx, db, **args)
        log.info("Tool %s → %s", name, json.dumps(result, default=str)[:200])
        return result
    except TypeError as e:
        return {"erro": f"argumentos inválidos: {e}"}
    except Exception as e:
        log.exception("Erro na tool %s", name)
        return {"erro": str(e)}
