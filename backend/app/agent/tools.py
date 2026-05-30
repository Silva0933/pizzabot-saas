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
import re
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
        "(ou com 'cardapio'). Para buscar algo específico, passe 'query' (ex: 'calabresa'). "
        "IMPORTANTE: por padrão retorna só nome, categoria e preço (sem descrição/ingredientes). "
        "Passe incluir_descricao=true SOMENTE quando o cliente perguntar ingredientes de um sabor específico. "
        "Se o produto tiver múltiplos tamanhos, o retorno incluirá um campo 'tamanhos' com opções e preços. "
        "Nesse caso, pergunte qual tamanho o cliente quer. Ao registrar o pedido, passe o nome formatado "
        "como 'Nome (Tamanho)' (ex.: 'Calabresa (G)') e o preço correspondente."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(type=types.Type.STRING, description="Termo de busca específico (ex: 'calabresa', 'doce', 'sem lactose'). Deixe vazio para listar tudo."),
            "categoria": types.Schema(type=types.Type.STRING, description="Filtra por categoria específica (opcional)"),
            "limit": types.Schema(type=types.Type.INTEGER, description="Máximo de resultados (padrão 12)"),
            "incluir_descricao": types.Schema(type=types.Type.BOOLEAN, description="Se true, inclui descrição/ingredientes dos itens. Use SOMENTE quando o cliente perguntar ingredientes. Padrão: false."),
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

DECL_GERAR_PAGAMENTO = types.FunctionDeclaration(
    name="gerar_pagamento",
    description=(
        "Gera a cobrança do pedido e envia ao cliente: Pix (QR + copia-e-cola) ou link de "
        "cartão. Use SOMENTE depois de registrar_pedido, quando o cliente escolher pagar "
        "online (pix ou cartão). Para dinheiro/pagar na entrega, NÃO use. Se não houver "
        "gateway configurado, retorna sem gerar."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "metodo": types.Schema(type=types.Type.STRING, description="'pix' (padrão) ou 'cartao' (link de checkout)"),
        },
        required=[],
    ),
)

DECL_REGISTRAR_PEDIDO = types.FunctionDeclaration(
    name="registrar_pedido",
    description=(
        "Registra um novo pedido no sistema. ANTES de chamar, você PRECISA ter coletado: "
        "(1) itens com nome/preço exatos do cardápio, (2) entrega ou retirada, "
        "(3) se entrega: endereço completo, (4) forma de pagamento, "
        "(5) se pix/cartão: pagar agora ou na entrega. "
        "NÃO chame sem ter TODOS esses dados — se faltar algo, pergunte ao cliente primeiro. "
        "Só chame DEPOIS do cliente confirmar o resumo final do pedido."
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
            "forma_pagamento": types.Schema(type=types.Type.STRING, description="pix, cartao, dinheiro etc. OBRIGATÓRIO — pergunte ao cliente antes de chamar."),
            "pagar_agora": types.Schema(type=types.Type.BOOLEAN, description="True só se o cliente escolheu PAGAR AGORA (na conversa) via pix/cartão. False se for pagar na entrega ou dinheiro. Só gera cobrança quando True."),
            "observacoes": types.Schema(type=types.Type.STRING, description="Obs do cliente (sem cebola, troco, etc)"),
            "nome_cliente": types.Schema(type=types.Type.STRING, description="Nome do cliente para o pedido"),
        },
        required=["itens", "valor_total", "tipo", "forma_pagamento"],
    ),
)

DECL_ATUALIZAR_PEDIDO = types.FunctionDeclaration(
    name="atualizar_pedido",
    description=(
        "Atualiza o pedido ATUAL do cliente (endereço, forma de pagamento, "
        "observações ou valor). Use para 'mudar a forma de pagamento', 'trocar "
        "endereço', etc. NÃO precisa de código — age no pedido ativo mais recente "
        "do cliente. Para trocar ITENS, use cancelar_pedido + registrar_pedido. "
        "Se mudar para pix/cartão e ainda não houver cobrança, ela é gerada."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "pedido_id_alterar": types.Schema(type=types.Type.STRING, description="Opcional. Deixe vazio para o pedido atual do cliente."),
            "novo_endereco": types.Schema(type=types.Type.STRING),
            "nova_forma_pagamento": types.Schema(type=types.Type.STRING),
            "novas_observacoes": types.Schema(type=types.Type.STRING),
            "novo_valor_total": types.Schema(type=types.Type.NUMBER),
        },
        required=[],
    ),
)

DECL_CANCELAR_PEDIDO = types.FunctionDeclaration(
    name="cancelar_pedido",
    description=(
        "Cancela o pedido ATUAL do cliente (só se ainda não saiu para entrega). "
        "NÃO precisa de código — cancela o pedido ativo mais recente do cliente."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "pedido_id_cancelar": types.Schema(type=types.Type.STRING, description="Opcional. Deixe vazio para o pedido atual do cliente."),
            "motivo_cancelamento": types.Schema(type=types.Type.STRING, description="Motivo informado pelo cliente (opcional)"),
        },
        required=[],
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

DECL_OBTER_HISTORICO = types.FunctionDeclaration(
    name="obter_historico_pedidos",
    description=(
        "Consulta os últimos pedidos JÁ FEITOS por este cliente (histórico real) e o item "
        "que ele mais pede. Use quando um cliente CONHECIDO voltar e você quiser sugerir 'o de "
        "sempre', ou quando ele perguntar o que pediu antes. Retorna pedidos recentes (itens e "
        "valor) + item_favorito. Se vier vazio, é a primeira vez dele — trate como cliente novo "
        "e NÃO invente histórico."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "limit": types.Schema(type=types.Type.INTEGER, description="Quantos pedidos recentes trazer (padrão 3, máx 5)"),
        },
        required=[],
    ),
)

DECL_CONSULTAR_TAXA = types.FunctionDeclaration(
    name="consultar_taxa_entrega",
    description=(
        "Retorna a taxa de entrega para o BAIRRO do cliente. Use SEMPRE que o pedido for "
        "ENTREGA, assim que souber o bairro, para somar a taxa ao total. Nunca invente a taxa: "
        "pegue o valor daqui. Se o bairro não estiver cadastrado, o retorno indica isso "
        "(precisa_confirmar=true) — aí avise que vai confirmar a taxa com a equipe."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "bairro": types.Schema(type=types.Type.STRING, description="Bairro informado pelo cliente"),
        },
        required=[],
    ),
)

DECL_REGISTRAR_AVALIACAO = types.FunctionDeclaration(
    name="registrar_avaliacao",
    description=(
        "Registra a avaliação que o cliente deu DEPOIS de receber o pedido: uma nota de 0 a 10 "
        "e um comentário opcional. Use SOMENTE quando, após a entrega, o cliente responder com "
        "uma nota ou avaliação. Aplica no último pedido entregue do cliente."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "nota": types.Schema(type=types.Type.INTEGER, description="Nota de 0 a 10"),
            "comentario": types.Schema(type=types.Type.STRING, description="Comentário do cliente (opcional)"),
        },
        required=["nota"],
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
    incluir_descricao: bool = False,
) -> dict[str, Any]:
    """
    Busca produtos no cardápio (só os disponíveis). Robusta:
    - pedidos genéricos (cardápio/sabores/menu/etc.) retornam o cardápio inteiro;
    - se uma busca específica não achar nada, cai no cardápio inteiro (nunca
      devolve vazio com produtos existindo).
    - Por padrão NÃO retorna descrição/ingredientes (economiza tokens).
      Só retorna descrição quando incluir_descricao=True.
    """
    base = (
        "SELECT id, nome, categoria, descricao, preco, disponivel, tamanhos "
        "FROM public.produtos WHERE pizzaria_id = :pid AND disponivel = true"
    )
    order = " ORDER BY categoria NULLS LAST, ordem, nome LIMIT :lim"
    lim = max(1, min(int(limit or 12), 40))

    q_clean = (query or "").strip().lower()
    # Palavras genéricas/irrelevantes que não devem virar filtro de busca.
    STOP = {
        "", "a", "o", "os", "as", "de", "do", "da", "dos", "das", "e", "com", "sem", "ou",
        "pra", "para", "um", "uma", "uns", "umas", "quero", "queria", "gostaria", "vou",
        "quer", "ver", "me", "manda", "mandar", "por", "favor", "tem", "ter", "qual",
        "quais", "essa", "esse", "aquela", "aquele", "isso", "ai", "aí",
        "pizza", "pizzas", "sabor", "sabores", "lanche", "lanches", "bebida", "bebidas",
        "grande", "media", "média", "pequena", "broto", "tamanho", "p", "m", "g",
    }
    GENERIC_HINT = ("cardap", "menu", "opç", "opc", "sabor", "tudo", "todas", "todos",
                    "disponiv", "que tem", "o que voce", "o que vc")

    where_extra = ""
    params: dict[str, Any] = {"pid": str(ctx.pizzaria.id), "lim": lim}

    is_generic = (not q_clean) or any(h in q_clean for h in GENERIC_HINT)
    tokens: list[str] = []
    if not is_generic:
        tokens = [w for w in re.split(r"[^0-9a-zà-ÿ]+", q_clean) if len(w) >= 3 and w not in STOP]

    if tokens:
        # Casa por QUALQUER palavra significativa (tolerante: "pizza vulcão" acha
        # "Calabresa Vulcão"; "calabresa" acha todos os tamanhos).
        ors = []
        for i, w in enumerate(tokens[:6]):
            ors.append(f"(nome ILIKE :q{i} OR descricao ILIKE :q{i} OR categoria ILIKE :q{i})")
            params[f"q{i}"] = f"%{w}%"
        where_extra += " AND (" + " OR ".join(ors) + ")"
    if categoria:
        where_extra += " AND categoria ILIKE :cat"
        params["cat"] = f"%{categoria}%"

    rows = (await db.execute(text(base + where_extra + order), params)).fetchall()

    # Importante: para busca ESPECÍFICA sem resultado, NÃO devolvemos o cardápio
    # inteiro (isso fazia a atendente "achar" pizzas ao buscar refrigerante).
    # Retorna vazio → a atendente avisa que o item não existe.

    items = []
    for r in rows:
        item: dict[str, Any] = {
            "id": str(r[0]),
            "nome": r[1],
            "categoria": r[2],
            "preco": float(r[4]) if r[4] is not None else 0.0,
            "disponivel": bool(r[5]),
            "tamanhos": r[6] if len(r) > 6 else None,
        }
        # Só inclui descrição/ingredientes se explicitamente pedido
        if incluir_descricao:
            item["descricao"] = r[3]
        items.append(item)
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
            caption="",
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
    pagar_agora: bool = False,
    endereco_entrega: str | None = None,
    observacoes: str | None = None,
    nome_cliente: str | None = None,
) -> dict[str, Any]:
    if tipo not in ("delivery", "retirada"):
        return {"ok": False, "erro": "tipo deve ser 'delivery' ou 'retirada'. Pergunte ao cliente: 'vai ser entrega ou retirada?'"}
    if tipo == "delivery" and not endereco_entrega:
        return {"ok": False, "erro": "endereco_entrega é obrigatório para delivery. Pergunte o endereço completo ao cliente antes de registrar."}
    if not forma_pagamento or forma_pagamento.strip().lower() in ("", "nao informado", "não informado", "n/a", "none"):
        return {"ok": False, "erro": "forma_pagamento é obrigatória. Pergunte ao cliente: 'como quer pagar? pix, cartão ou dinheiro?'"}
    if not itens:
        return {"ok": False, "erro": "lista de itens vazia"}
    try:
        _vt = float(valor_total)
    except (TypeError, ValueError):
        _vt = 0.0
    if _vt <= 0:
        return {
            "ok": False,
            "erro": "valor_total inválido (0). Use buscar_cardapio para pegar os preços reais, "
                    "some os itens e registre com o valor_total correto.",
        }

    # Trava por cliente (advisory lock) — serializa chamadas concorrentes de
    # registrar_pedido do mesmo cliente. A 2ª espera, e ao buscar o pedido ativo
    # encontra o que a 1ª criou → atualiza em vez de duplicar. Liberado no commit.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"reg:{ctx.pizzaria.id}:{ctx.telefone}"},
    )

    # Normaliza os itens (o modelo pode mandar 'qtd'/'preco' em vez de
    # 'quantidade'/'preco_unit') para o painel exibir certo (evita R$ NaN).
    def _num(v: Any, default: float = 0.0) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return default
    itens_norm = []
    for it in itens:
        if not isinstance(it, dict):
            continue
        itens_norm.append({
            "nome": it.get("nome") or it.get("produto") or "Item",
            "quantidade": int(_num(it.get("quantidade") or it.get("qtd") or 1, 1)),
            "preco_unit": _num(it.get("preco_unit") or it.get("preco") or it.get("valor")),
        })
    itens = itens_norm or itens

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

    # Reaproveita o pedido atual do cliente (rascunho 'novo' OU confirmado ainda
    # não pago) em vez de criar duplicado a cada chamada.
    stmt = (
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status.in_(["novo", "confirmado"]),
            Pedido.payment_status != "approved",
        )
        .order_by(Pedido.created_at.desc())
    )
    ped = (await db.execute(stmt)).scalars().first()

    status_anterior = ped.status if ped else None
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

    resultado = {
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

    # Cobrança só é gerada se o cliente escolheu PAGAR AGORA via pix/cartão.
    # "Na entrega" ou dinheiro → não gera nada.
    metodo = _metodo_online(forma_pagamento)
    if metodo and pagar_agora:
        cobranca = await _gerar_cobranca(ctx, db, ped, metodo)
        resultado["pagamento"] = cobranca

    return resultado


async def _gerar_cobranca(ctx: AgentContext, db: AsyncSession, ped: Pedido, metodo: str = "pix") -> dict[str, Any]:
    """Núcleo da cobrança: chama o gateway, salva no pedido e envia o QR. Reutilizado."""
    from app.config import get_settings
    from app.services.evolution import evolution
    from app.services.pagamentos import PagamentoError, gateway_for, MercadoPagoClient

    gw = gateway_for(ctx.pizzaria)
    if gw is None:
        return {"ok": False, "motivo": "sem_gateway"}

    base = (get_settings().public_base_url or "").rstrip("/")
    notif = f"{base}/webhook/mercadopago" if isinstance(gw, MercadoPagoClient) else f"{base}/webhook/asaas"
    descricao = f"Pedido #{ped.numero_pedido or ''} - {ctx.pizzaria.nome}".strip()
    nome = (ctx.cliente_nome or "Cliente")

    try:
        if isinstance(gw, MercadoPagoClient) and (metodo or "pix").lower() != "pix":
            cob = await gw.criar_cobranca(
                valor=ped.valor_total, descricao=descricao, nome_cliente=nome,
                telefone=ctx.telefone, external_reference=str(ped.id), notification_url=notif,
            )
        elif isinstance(gw, MercadoPagoClient):
            cob = await gw.criar_pix(
                valor=ped.valor_total, descricao=descricao, nome_cliente=nome,
                telefone=ctx.telefone, external_reference=str(ped.id), notification_url=notif,
            )
        else:  # Asaas (só Pix)
            cob = await gw.criar_cobranca_pix(
                valor=ped.valor_total, descricao=descricao, nome_cliente=nome,
                telefone=ctx.telefone, external_reference=str(ped.id),
            )
    except PagamentoError as e:
        log.warning("Falha ao gerar cobrança: %s", e)
        return {"ok": False, "motivo": "erro_gateway"}

    ped.payment_id = cob.payment_id
    ped.link_pagamento = cob.link_pagamento
    ped.payment_status = "pending"
    await db.flush()

    # Pix: manda QR (imagem) e o copia-e-cola em MENSAGEM SEPARADA (só o código,
    # pra o cliente conseguir copiar com um toque).
    if ctx.pizzaria.instancia:
        try:
            if cob.qr_code_base64:
                await evolution.send_media(
                    instancia=ctx.pizzaria.instancia, numero=ctx.telefone,
                    media_url=cob.qr_code_base64, mediatype="image",
                    mimetype="image/png", filename="pix.png",
                    caption="QR Code do Pix 👆",
                )
            if cob.metodo == "pix" and cob.qr_code:
                # Mensagem só com o código → fácil de copiar.
                await evolution.send_text(
                    instancia=ctx.pizzaria.instancia, numero=ctx.telefone,
                    texto=cob.qr_code,
                )
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao enviar QR/código Pix: %s", e)

    return {
        "ok": True,
        "metodo": cob.metodo,
        "valor": float(ped.valor_total),
        "pix_copia_e_cola": cob.qr_code,
        "link_pagamento": cob.link_pagamento,
        "instrucao": (
            "Pix JÁ enviado ao cliente: o QR (imagem) e o código copia-e-cola foram "
            "mandados em mensagens separadas. NÃO repita o código no seu texto — apenas "
            "confirme o pedido e avise que o QR e o código Pix foram enviados acima."
            if cob.metodo == "pix"
            else "Link de pagamento gerado. Envie o link_pagamento ao cliente."
        ),
    }


async def gerar_pagamento(ctx: AgentContext, db: AsyncSession, *, metodo: str = "pix") -> dict[str, Any]:
    """Tool: cria a cobrança do pedido atual e envia Pix (QR) ou link de cartão."""
    cli = ctx.cliente or (await db.execute(
        select(Cliente).where(
            Cliente.pizzaria_id == ctx.pizzaria.id,
            Cliente.telefone == ctx.telefone,
        )
    )).scalar_one_or_none()
    if not cli:
        return {"ok": False, "motivo": "sem_cliente"}

    ped = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status.in_(["novo", "confirmado"]),
            Pedido.payment_status != "approved",
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()
    if not ped:
        return {"ok": False, "motivo": "sem_pedido"}

    return await _gerar_cobranca(ctx, db, ped, metodo)


def _metodo_online(forma_pagamento: str | None) -> str | None:
    """Detecta se a forma de pagamento é online; retorna 'pix'|'cartao' ou None."""
    f = (forma_pagamento or "").lower()
    if "pix" in f:
        return "pix"
    if any(k in f for k in ("cart", "credito", "crédito", "debito", "débito")):
        return "cartao"
    return None


async def _resolver_pedido(ctx: AgentContext, db: AsyncSession, ref: str | None = None) -> Pedido | None:
    """
    Encontra o pedido alvo. Se 'ref' for um UUID válido, usa ele; senão (ou se o
    modelo passar o número curto/nada), pega o pedido ATIVO mais recente do cliente.
    """
    if ref:
        try:
            pid = uuid.UUID(str(ref))
        except (ValueError, TypeError, AttributeError):
            pid = None
        if pid:
            ped = (await db.execute(
                select(Pedido).where(Pedido.id == pid, Pedido.pizzaria_id == ctx.pizzaria.id)
            )).scalar_one_or_none()
            if ped:
                return ped
    cli = ctx.cliente or (await db.execute(
        select(Cliente).where(Cliente.pizzaria_id == ctx.pizzaria.id, Cliente.telefone == ctx.telefone)
    )).scalar_one_or_none()
    if not cli:
        return None
    return (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status.in_(["novo", "confirmado", "no_forno"]),
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()


async def atualizar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    pedido_id_alterar: str | None = None,
    novo_endereco: str | None = None,
    nova_forma_pagamento: str | None = None,
    novas_observacoes: str | None = None,
    novo_valor_total: float | None = None,
) -> dict[str, Any]:
    ped = await _resolver_pedido(ctx, db, pedido_id_alterar)
    if not ped:
        return {"ok": False, "erro": "nenhum pedido ativo encontrado para este cliente"}
    if ped.status in ("a_caminho", "entregue", "cancelado"):
        return {"ok": False, "erro": f"pedido #{ped.numero_pedido} já está '{ped.status}' e não pode ser alterado"}

    if novo_endereco:
        ped.endereco_entrega = novo_endereco
    if nova_forma_pagamento:
        ped.forma_pagamento = nova_forma_pagamento
    if novas_observacoes:
        ped.observacoes = novas_observacoes
    if novo_valor_total:
        ped.valor_total = Decimal(str(novo_valor_total))

    await db.flush()

    # Se passou a ser pagamento online e ainda não há cobrança, gera agora.
    resultado: dict[str, Any] = {"ok": True, "numero_pedido": ped.numero_pedido}
    metodo = _metodo_online(nova_forma_pagamento) if nova_forma_pagamento else None
    if metodo and ped.payment_status != "approved" and not ped.payment_id:
        resultado["pagamento"] = await _gerar_cobranca(ctx, db, ped, metodo)
    return resultado


async def cancelar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    pedido_id_cancelar: str | None = None,
    motivo_cancelamento: str = "Cancelado pelo cliente",
) -> dict[str, Any]:
    ped = await _resolver_pedido(ctx, db, pedido_id_cancelar)
    if not ped:
        return {"ok": False, "erro": "nenhum pedido ativo encontrado para este cliente"}
    if ped.status in ("a_caminho", "entregue"):
        return {"ok": False, "erro": f"pedido #{ped.numero_pedido} já está '{ped.status}' e não pode ser cancelado"}

    ped.status = "cancelado"
    ped.cancelado_at = datetime.now(timezone.utc)
    ped.cancelamento_motivo = motivo_cancelamento
    await db.flush()
    return {"ok": True, "numero_pedido": ped.numero_pedido, "cancelado": True}


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


def _normalizar(s: str | None) -> str:
    """minúsculas, sem acento, sem espaços nas pontas — para casar bairros."""
    import unicodedata
    s = (s or "").strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s)


def _taxa_para_bairro(pizz, bairro: str | None) -> dict[str, Any]:
    """Resolve a taxa de entrega: tabela por bairro → taxa fixa → desconhecida."""
    alvo = _normalizar(bairro)
    tabela = pizz.taxas_bairro or []
    if alvo:
        for item in tabela:
            if not isinstance(item, dict):
                continue
            if _normalizar(item.get("bairro")) == alvo:
                try:
                    taxa = float(item.get("taxa") or 0)
                except (TypeError, ValueError):
                    taxa = 0.0
                return {"bairro": item.get("bairro") or bairro, "taxa": taxa,
                        "fonte": "bairro", "precisa_confirmar": False}
        # match parcial (cliente escreve "jd europa", cadastro "Jardim Europa")
        for item in tabela:
            if not isinstance(item, dict):
                continue
            nb = _normalizar(item.get("bairro"))
            if nb and (nb in alvo or alvo in nb):
                try:
                    taxa = float(item.get("taxa") or 0)
                except (TypeError, ValueError):
                    taxa = 0.0
                return {"bairro": item.get("bairro") or bairro, "taxa": taxa,
                        "fonte": "bairro_parcial", "precisa_confirmar": False}

    fixa = getattr(pizz, "taxa_entrega_fixa", None)
    if fixa is not None:
        return {"bairro": bairro, "taxa": float(fixa), "fonte": "fixa", "precisa_confirmar": False}

    return {"bairro": bairro, "taxa": None, "fonte": "nenhuma", "precisa_confirmar": True}


async def consultar_taxa_entrega(ctx: AgentContext, db: AsyncSession, *, bairro: str | None = None) -> dict[str, Any]:
    res = _taxa_para_bairro(ctx.pizzaria, bairro)
    if res["precisa_confirmar"]:
        res["instrucao"] = (
            "Taxa não cadastrada para esse bairro e sem taxa fixa. Avise o cliente que vai "
            "confirmar a taxa de entrega com a equipe — não invente um valor."
        )
    else:
        res["instrucao"] = "Some esta taxa ao valor_total do pedido (itens + taxa)."
    return {"ok": True, **res}


async def _cliente_do_ctx(ctx: AgentContext, db: AsyncSession) -> Cliente | None:
    return ctx.cliente or (await db.execute(
        select(Cliente).where(Cliente.pizzaria_id == ctx.pizzaria.id, Cliente.telefone == ctx.telefone)
    )).scalar_one_or_none()


async def obter_historico_pedidos(ctx: AgentContext, db: AsyncSession, *, limit: int = 3) -> dict[str, Any]:
    """Últimos pedidos reais do cliente + item mais pedido."""
    cli = await _cliente_do_ctx(ctx, db)
    if not cli:
        return {"total_pedidos": 0, "pedidos": [], "item_favorito": None}

    lim = max(1, min(int(limit or 3), 5))
    reais = ["confirmado", "no_forno", "a_caminho", "entregue"]
    # Pega um histórico maior pra calcular o favorito, mas só devolve `lim` recentes.
    rows = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status.in_(reais),
        ).order_by(Pedido.created_at.desc()).limit(20)
    )).scalars().all()

    if not rows:
        return {"total_pedidos": cli.total_pedidos or 0, "pedidos": [], "item_favorito": None}

    from collections import Counter
    contagem: Counter = Counter()
    pedidos_out = []
    for i, p in enumerate(rows):
        itens = p.itens or []
        nomes = []
        for it in itens:
            if isinstance(it, dict) and it.get("nome"):
                nome = str(it["nome"])
                qtd = int(it.get("quantidade") or it.get("qtd") or 1)
                contagem[nome] += qtd
                nomes.append({"nome": nome, "qtd": qtd})
        if i < lim:
            pedidos_out.append({
                "numero": p.numero_pedido,
                "data": p.created_at.strftime("%d/%m") if p.created_at else None,
                "tipo": p.tipo,
                "valor_total": float(p.valor_total) if p.valor_total is not None else None,
                "itens": nomes,
            })

    favorito = contagem.most_common(1)[0][0] if contagem else None
    return {
        "total_pedidos": cli.total_pedidos or len(rows),
        "pedidos": pedidos_out,
        "item_favorito": favorito,
    }


async def registrar_avaliacao(
    ctx: AgentContext, db: AsyncSession, *, nota: int, comentario: str | None = None
) -> dict[str, Any]:
    try:
        n = int(nota)
    except (TypeError, ValueError):
        return {"ok": False, "erro": "nota inválida — peça uma nota de 0 a 10."}
    n = max(0, min(n, 10))

    cli = await _cliente_do_ctx(ctx, db)
    if not cli:
        return {"ok": False, "erro": "cliente não encontrado"}

    # Aplica no pedido mais recente que já recebeu a pesquisa (ou no último entregue).
    ped = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status.in_(["a_caminho", "entregue"]),
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()
    if not ped:
        return {"ok": False, "erro": "nenhum pedido recente para avaliar"}

    ped.nps_nota = n
    if comentario:
        ped.nps_comentario = comentario[:1000]
    await db.flush()

    from app.services.broadcaster import broadcaster
    await broadcaster.publish(
        ctx.pizzaria.id,
        {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(ctx.pizzaria.id),
            "payload": {"pedido_id": str(ped.id), "numero_pedido": ped.numero_pedido, "nps_nota": n},
        },
    )
    # Nota baixa: sinaliza pra equipe acompanhar (não trava o fluxo).
    if n <= 6:
        return {"ok": True, "nota": n, "alerta": "nota baixa — agradeça, peça desculpas pelo ocorrido e considere escalar_humano se ele relatar um problema."}
    return {"ok": True, "nota": n}


# ===============================================================
# REGISTRY
# ===============================================================
TOOL_DECLARATIONS = [
    DECL_BUSCAR_CARDAPIO,
    DECL_ENVIAR_CARDAPIO_ARQUIVO,
    DECL_REGISTRAR_PEDIDO,
    DECL_GERAR_PAGAMENTO,
    DECL_ATUALIZAR_PEDIDO,
    DECL_CANCELAR_PEDIDO,
    DECL_ESCALAR_HUMANO,
    DECL_LEMBRAR_CLIENTE,
    DECL_OBTER_HISTORICO,
    DECL_CONSULTAR_TAXA,
    DECL_REGISTRAR_AVALIACAO,
]

TOOL_IMPL: dict[str, ToolFn] = {
    "buscar_cardapio": buscar_cardapio,
    "enviar_cardapio_arquivo": enviar_cardapio_arquivo,
    "registrar_pedido": registrar_pedido,
    "gerar_pagamento": gerar_pagamento,
    "atualizar_pedido": atualizar_pedido,
    "cancelar_pedido": cancelar_pedido,
    "escalar_humano": escalar_humano,
    "lembrar_cliente": lembrar_cliente,
    "obter_historico_pedidos": obter_historico_pedidos,
    "consultar_taxa_entrega": consultar_taxa_entrega,
    "registrar_avaliacao": registrar_avaliacao,
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
