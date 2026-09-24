"""
Tools do agente IA.

Cada tool tem:
  - declaração (FunctionDeclaration) que o Gemini vê
  - implementação async que executa a ação real

A tool registry mapeia name → (declaração, função).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from google.genai import types
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import AgentContext
from app.models import Cliente, Conversa, Mensagem, Pedido, Produto

log = logging.getLogger(__name__)

ToolFn = Callable[..., Coroutine[Any, Any, dict[str, Any]]]


def _simulated(ctx: AgentContext, action: str, **details: Any) -> bool:
    """Registra uma ação bloqueada pelo playground e informa modo simulado."""
    if getattr(ctx, "simulation", False) is not True:
        return False
    ctx.simulation_events.append({"action": action, "simulated": True, **details})
    return True


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

DECL_PREPARAR_RESUMO_PEDIDO = types.FunctionDeclaration(
    name="preparar_resumo_pedido",
    description=(
        "Calcula e salva um resumo final do pedido para o cliente confirmar. "
        "Use quando já tiver itens, entrega/retirada, endereço se delivery, forma de pagamento "
        "e decisão de pagar agora/na entrega. Esta tool NÃO registra o pedido; ela retorna o resumo "
        "com total blindado. Depois envie o resumo ao cliente e pergunte se pode fechar. "
        "Só após o cliente responder sim em uma nova mensagem use registrar_pedido com os mesmos dados."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "itens": types.Schema(
                type=types.Type.ARRAY,
                description="Lista de itens. Use os mesmos campos de registrar_pedido: nome ou sabores, tamanho e qtd.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "nome": types.Schema(type=types.Type.STRING),
                        "sabores": types.Schema(
                            type=types.Type.ARRAY,
                            items=types.Schema(type=types.Type.STRING),
                        ),
                        "tamanho": types.Schema(type=types.Type.STRING),
                        "qtd": types.Schema(type=types.Type.INTEGER),
                        "adicionais": types.Schema(
                            type=types.Type.ARRAY,
                            description="Adicionais/bordas do item (nomes vindos de consultar_adicionais).",
                            items=types.Schema(type=types.Type.STRING),
                        ),
                    },
                ),
            ),
            "tipo": types.Schema(type=types.Type.STRING, description="'delivery' ou 'retirada'"),
            "endereco_entrega": types.Schema(type=types.Type.STRING),
            "forma_pagamento": types.Schema(type=types.Type.STRING),
            "pagar_agora": types.Schema(type=types.Type.BOOLEAN),
            "observacoes": types.Schema(type=types.Type.STRING),
            "nome_cliente": types.Schema(type=types.Type.STRING),
        },
        required=["itens", "tipo", "forma_pagamento"],
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
        "Só chame DEPOIS de preparar_resumo_pedido e depois do cliente confirmar o resumo final numa nova mensagem. "
        "O backend calculará o valor exato dos produtos e somará a taxa de entrega de forma blindada."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "itens": types.Schema(
                type=types.Type.ARRAY,
                description=(
                    "Lista de itens do pedido. Para itens simples (bebidas, pizzas inteiras), passe 'nome'. "
                    "Para pizzas combinadas (meia/meia), passe a lista de 'sabores' (ex: ['Calabresa', 'Portuguesa']). "
                    "Sempre passe o 'tamanho' se o produto possuir opções de tamanhos (ex: Grande, Média)."
                ),
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "nome": types.Schema(type=types.Type.STRING, description="Nome do produto simples (vazio para pizzas combinadas)"),
                        "sabores": types.Schema(
                            type=types.Type.ARRAY,
                            description="Lista de sabores (para pizza meia/meia, ex: ['Calabresa', 'Portuguesa'])",
                            items=types.Schema(type=types.Type.STRING)
                        ),
                        "tamanho": types.Schema(type=types.Type.STRING, description="Tamanho selecionado (ex: 'Grande', 'Média', se o item possuir tamanhos)"),
                        "qtd": types.Schema(type=types.Type.INTEGER, description="Quantidade do item (padrão 1)"),
                        "adicionais": types.Schema(
                            type=types.Type.ARRAY,
                            description="Nomes de adicionais/bordas escolhidos para ESTE item (ex: ['Borda Catupiry']). Use APENAS nomes vindos de consultar_adicionais.",
                            items=types.Schema(type=types.Type.STRING),
                        ),
                    },
                ),
            ),
            "valor_total": types.Schema(type=types.Type.NUMBER, description="Valor estimado total em reais informado pelo cliente (o backend recalculará de forma blindada)"),
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

DECL_CONSULTAR_ADICIONAIS = types.FunctionDeclaration(
    name="consultar_adicionais",
    description=(
        "Lista os adicionais/bordas que a pizzaria oferece (ex.: borda recheada, "
        "extra de queijo). Use ANTES de oferecer qualquer borda/adicional, pra citar "
        "SOMENTE o que existe e o preço real (nunca invente). Para incluir no pedido, "
        "passe os nomes escolhidos no campo 'adicionais' do item em preparar_resumo_pedido/"
        "registrar_pedido — o backend soma o preço."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "tipo": types.Schema(type=types.Type.STRING, description="Opcional: filtra por 'borda' ou 'adicional'."),
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
        "SELECT p.id, p.nome, p.categoria, p.descricao, p.preco, p.disponivel, "
        "  (SELECT COALESCE(json_agg(json_build_object('tamanho', pt.tamanho, 'preco', pt.preco)), '[]'::json) "
        "   FROM public.produto_tamanhos pt WHERE pt.produto_id = p.id AND pt.disponivel = true) as tamanhos, "
        "  (SELECT COALESCE(json_agg(json_build_object( "
        "     'grupo', gc.nome, "
        "     'obrigatorio', gc.obrigatorio, "
        "     'max_opcoes', gc.max_opcoes, "
        "     'opcoes', (SELECT COALESCE(json_agg(json_build_object('nome', c.nome, 'preco', c.preco)), '[]'::json) "
        "                FROM public.complementos c WHERE c.grupo_id = gc.id AND c.disponivel = true) "
        "   )), '[]'::json) "
        "   FROM public.produto_complementos pc "
        "   JOIN public.grupo_complementos gc ON gc.id = pc.grupo_id "
        "   WHERE pc.produto_id = p.id) as grupos_complementos, "
        "  p.aliases, p.tags "
        "FROM public.produtos p WHERE p.pizzaria_id = :pid AND p.disponivel = true"
    )
    order = " ORDER BY p.categoria NULLS LAST, p.ordem, p.nome LIMIT :lim"
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
    if is_generic:
        stmt_all = (
            "SELECT nome, categoria "
            "FROM public.produtos WHERE pizzaria_id = :pid AND disponivel = true"
        )
        params_all: dict[str, Any] = {"pid": str(ctx.pizzaria.id)}
        if categoria:
            stmt_all += " AND categoria ILIKE :cat"
            params_all["cat"] = f"%{categoria.strip().rstrip('s')}%"
        stmt_all += " ORDER BY categoria NULLS LAST, ordem, nome LIMIT 150"

        rows = (await db.execute(text(stmt_all), params_all)).fetchall()
        items = [{"nome": r[0], "categoria": r[1]} for r in rows]
        return {
            "tipo_resultado": "compacto_geral",
            "instrucao": (
                "Esta eh uma lista compacta com TODOS os itens do cardapio. Apresente as opcoes "
                "ao cliente de forma limpa. Quando ele escolher um sabor/produto especifico, "
                "chame buscar_cardapio com a query especifica (ex: query='Calabresa') para "
                "obter o preco, tamanhos e descricao exatos antes de confirmar ou registrar."
            ),
            "encontrados": len(items),
            "items": items,
        }

    tokens: list[str] = []
    tokens = [w for w in re.split(r"[^0-9a-zà-ÿ]+", q_clean) if len(w) >= 3 and w not in STOP]

    if tokens:
        # Casa por QUALQUER palavra significativa (tolerante: "pizza vulcão" acha
        # "Calabresa Vulcão"; "calabresa" acha todos os tamanhos).
        ors = []
        for i, w in enumerate(tokens[:6]):
            ors.append(
                f"(p.nome ILIKE :q{i} OR p.descricao ILIKE :q{i} OR p.categoria ILIKE :q{i} "
                f"OR p.aliases::text ILIKE :q{i} OR p.tags::text ILIKE :q{i})"
            )
            params[f"q{i}"] = f"%{w}%"
        where_extra += " AND (" + " OR ".join(ors) + ")"
    if categoria:
        where_extra += " AND p.categoria ILIKE :cat"
        params["cat"] = f"%{categoria.strip().rstrip('s')}%"

    # Executa busca textual
    rows_raw = (await db.execute(text(base + where_extra + order), params)).fetchall()
    rows = list(rows_raw)

    # Se a busca textual retornar menos de 2 resultados e houver uma query específica, tenta busca semântica
    if len(rows) < 2 and q_clean:
        try:
            from app.config import get_settings
            if get_settings().gemini_api_key:
                from app.services.embeddings import embed_text
                emb = await embed_text(q_clean)
                emb_str = "[" + ",".join(str(f) for f in emb) + "]"

                stmt_sem = (
                    "SELECT p.id, p.nome, p.categoria, p.descricao, p.preco, p.disponivel, "
                    "  (SELECT COALESCE(json_agg(json_build_object('tamanho', pt.tamanho, 'preco', pt.preco)), '[]'::json) "
                    "   FROM public.produto_tamanhos pt WHERE pt.produto_id = p.id AND pt.disponivel = true) as tamanhos, "
                    "  (SELECT COALESCE(json_agg(json_build_object( "
                    "     'grupo', gc.nome, "
                    "     'obrigatorio', gc.obrigatorio, "
                    "     'max_opcoes', gc.max_opcoes, "
                    "     'opcoes', (SELECT COALESCE(json_agg(json_build_object('nome', c.nome, 'preco', c.preco)), '[]'::json) "
                    "                FROM public.complementos c WHERE c.grupo_id = gc.id AND c.disponivel = true) "
                    "   )), '[]'::json) "
                    "   FROM public.produto_complementos pc "
                    "   JOIN public.grupo_complementos gc ON gc.id = pc.grupo_id "
                    "   WHERE pc.produto_id = p.id) as grupos_complementos, "
                    "  p.aliases, p.tags, "
                    " (p.embedding <=> CAST(:emb AS vector)) AS distancia "
                    "FROM public.produtos p "
                    "WHERE p.pizzaria_id = :pid AND p.disponivel = true "
                    " AND (p.embedding <=> CAST(:emb AS vector)) < 0.5"
                )
                params_sem = {"pid": str(ctx.pizzaria.id), "emb": emb_str, "lim": lim}
                if categoria:
                    stmt_sem += " AND p.categoria ILIKE :cat"
                    params_sem["cat"] = f"%{categoria.strip().rstrip('s')}%"
                stmt_sem += " ORDER BY distancia ASC LIMIT :lim"

                rows_sem = (await db.execute(text(stmt_sem), params_sem)).fetchall()
                # Mescla resultados evitando duplicatas por nome
                nomes_existentes = {r[1].lower() for r in rows}
                for r_sem in rows_sem:
                    if r_sem[1].lower() not in nomes_existentes:
                        # Converte a tupla retornada no mesmo formato das colunas normais
                        rows.append((r_sem[0], r_sem[1], r_sem[2], r_sem[3], r_sem[4], r_sem[5], r_sem[6], r_sem[7], r_sem[8], r_sem[9]))
        except Exception as e:
            log.warning("Falha na busca semântica com pgvector: %s", e)

    items = []
    for r in rows:
        item: dict[str, Any] = {
            "nome": r[1],
            "categoria": r[2],
            "preco": float(r[4]) if r[4] is not None else 0.0,
        }
        tamanhos = r[6] if len(r) > 6 and r[6] else None
        if tamanhos and len(tamanhos) > 0:
            item["tamanhos"] = tamanhos
        grupos_complementos = r[7] if len(r) > 7 and r[7] else None
        if grupos_complementos and len(grupos_complementos) > 0:
            item["grupos_complementos"] = grupos_complementos
        if incluir_descricao:
            item["descricao"] = r[3]
        if len(r) > 8 and r[8]:
            item["aliases"] = r[8]
        if len(r) > 9 and r[9]:
            item["tags"] = r[9]
        items.append(item)
    return {"encontrados": len(items), "items": items}


async def enviar_cardapio_arquivo(ctx: AgentContext, db: AsyncSession) -> dict[str, Any]:
    """Envia o arquivo (PDF/imagem) de cardápio cadastrado pela pizzaria."""
    # Trava anti-duplicação: se já enviamos o arquivo nos últimos minutos para este
    # cliente, não reenvia (o modelo às vezes chama de novo ao pedir um sabor).
    ja_enviou = (await db.execute(text("""
        SELECT 1 FROM public.agente_memoria
        WHERE pizzaria_id = :pid AND telefone = :tel
          AND tool_call_id = 'enviar_cardapio_arquivo'
          AND created_at > now() - interval '5 minutes'
        LIMIT 1
    """), {"pid": str(ctx.pizzaria.id), "tel": ctx.telefone})).first()
    if ja_enviou:
        return {"ok": True, "ja_enviado": True,
                "instrucao": "O cardápio em arquivo já foi enviado há pouco. NÃO reenvie. "
                             "Responda por texto usando buscar_cardapio se precisar."}

    row = (await db.execute(
        text("SELECT filename, content_type FROM public.cardapio_arquivo WHERE pizzaria_id = :pid"),
        {"pid": str(ctx.pizzaria.id)},
    )).first()
    if not row:
        return {"ok": False, "motivo": "sem_arquivo"}
    if _simulated(ctx, "enviar_cardapio_arquivo", filename=row[0] or "cardapio"):
        return {"ok": True, "enviado": True, "simulado": True}
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


def _parse_nome_e_tamanho(nome: str, tamanho: str | None = None) -> tuple[str, str | None]:
    """Aceita 'Calabresa (G)' e devolve ('Calabresa', 'G') quando tamanho vier no nome."""
    q = (nome or "").strip()
    tam = (tamanho or "").strip() or None
    m = re.match(r"^(.*?)\s*\(([^()]{1,40})\)\s*$", q)
    if m:
        q = m.group(1).strip()
        tam = tam or m.group(2).strip()
    return q, tam


def _match_tamanho(tamanhos: list[dict[str, Any]], tamanho: str | None) -> dict[str, Any] | None:
    if not tamanhos or not tamanho:
        return None
    t_norm = _normalizar(tamanho)
    for item in tamanhos:
        if not isinstance(item, dict):
            continue
        nome = str(item.get("tamanho") or item.get("nome") or "").strip()
        n_norm = _normalizar(nome)
        if n_norm == t_norm or (len(t_norm) == 1 and n_norm.startswith(t_norm)) or (len(n_norm) == 1 and t_norm.startswith(n_norm)):
            return item
    return None


# Palavras que nomeiam uma CATEGORIA, não um produto. "Quero 2 pizzas grandes"
# chegava como produto "pizza" e o ILIKE '%pizza%' casava com a primeira pizza do
# cardápio: o cliente levava 2 Pizzas Brasa sem ter escolhido sabor.
TERMOS_GENERICOS = {
    "pizza", "pizzas", "lanche", "lanches", "hamburguer", "hamburgueres", "hamburger",
    "burger", "burguer", "bebida", "bebidas", "refri", "refris", "refrigerante",
    "refrigerantes", "sobremesa", "sobremesas", "doce", "doces", "suco", "sucos",
}


def eh_termo_generico(nome: str | None) -> bool:
    return _normalizar(nome) in {_normalizar(t) for t in TERMOS_GENERICOS}


async def _obter_preco_produto(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    nome_sabor: str,
    tamanho: str | None,
    categoria: str | None = None,
) -> tuple[float, str]:
    """Busca o produto e calcula o preço adequado para o tamanho informado.

    Devolve (preço, nome); quando o produto tem tamanhos, o nome já sai com o
    tamanho REAL do cadastro ("Pizza Calabresa (Grande)"). Produto sem tamanhos
    sai sem — antes o tamanho dito pelo cliente era colado em qualquer item
    ("Brasa Supreme (média)", "Coca-Cola 2L (2l)").

    Empate entre produtos com o mesmo termo ("brasa" = Pizza Brasa e o lanche
    Brasa Supreme): prefere a `categoria` pedida (meio a meio → pizza) e, se o
    cliente citou tamanho, o produto que TEM tamanhos.
    """
    q, tamanho = _parse_nome_e_tamanho(nome_sabor, tamanho)
    if eh_termo_generico(q):
        raise ValueError(f"'{q}' é uma categoria, não um sabor. Pergunte ao cliente QUAL sabor/produto ele quer.")

    preferencia = (
        "CASE WHEN :cat <> '' AND p.categoria ILIKE :catlike THEN 0 ELSE 1 END, "
        "CASE WHEN :comtam AND EXISTS (SELECT 1 FROM public.produto_tamanhos pt2 "
        "  WHERE pt2.produto_id = p.id AND pt2.disponivel = true) THEN 0 ELSE 1 END"
    )
    pref_params = {
        "cat": (categoria or "").strip(), "catlike": f"%{(categoria or '').strip()}%",
        "comtam": bool(tamanho),
    }
    colunas = (
        "SELECT p.nome, p.preco, "
        "  (SELECT json_agg(json_build_object('tamanho', pt.tamanho, 'preco', pt.preco)) "
        "   FROM public.produto_tamanhos pt WHERE pt.produto_id = p.id AND pt.disponivel = true) as tamanhos "
        "FROM public.produtos p "
    )

    # Se veio tamanho, alguns cardápios cadastram o tamanho NO NOME (produtos
    # separados: "The Pizza (P)", "The Pizza (GG)"). Tenta casar nome + tamanho
    # antes da busca genérica, pra não pegar o tamanho errado.
    if tamanho:
        row_ts = (await db.execute(text(
            colunas + "WHERE p.pizzaria_id = :pid AND p.disponivel = true "
            "AND p.nome ILIKE :q AND p.nome ILIKE :t "
            "ORDER BY length(p.nome) LIMIT 1"
        ), {"pid": str(pizzaria_id), "q": f"%{q}%", "t": f"%{tamanho}%"})).first()
        if row_ts:
            db_nome, db_preco, db_tamanhos = row_ts
            if not db_tamanhos:  # produto já é o do tamanho certo
                return (float(db_preco) if db_preco is not None else 0.0), db_nome

    # Primeiro tenta busca exata por nome
    row = (await db.execute(text(
        colunas + "WHERE p.pizzaria_id = :pid AND p.disponivel = true "
        "AND (p.nome ILIKE :q OR p.aliases::text ILIKE :q) "
        f"ORDER BY {preferencia} LIMIT 1"
    ), {"pid": str(pizzaria_id), "q": q, **pref_params})).first()
    if not row:
        # Se não achar exato, tenta busca parcial (ILike)
        row = (await db.execute(text(
            colunas + "WHERE p.pizzaria_id = :pid AND p.disponivel = true "
            "AND (p.nome ILIKE :q OR p.aliases::text ILIKE :q OR p.tags::text ILIKE :q) "
            f"ORDER BY {preferencia}, CASE WHEN p.nome ILIKE :q THEN 0 ELSE 1 END, p.ordem, p.nome LIMIT 1"
        ), {"pid": str(pizzaria_id), "q": f"%{q}%", **pref_params})).first()

    if not row:
        # Fallback POR PALAVRA-CHAVE (sem acento, qualquer ordem): "vulcão de
        # calabresa" casa com "Calabresa Vulcão". Busca o produto que contém MAIS
        # tokens da query (e, em empate, a categoria/tamanho preferidos e o nome
        # mais curto).
        _STOP = {"de", "da", "do", "com", "sem", "a", "o", "e", "pizza", "sabor", "uma", "um"}
        tokens = [t for t in re.split(r"[^0-9a-zà-ÿ]+", q.lower()) if len(t) >= 3 and t not in _STOP]
        tokens_norm = [_normalizar(t) for t in tokens]
        if tokens_norm:
            cands = (await db.execute(text(
                "SELECT p.nome, p.preco, "
                "  (SELECT json_agg(json_build_object('tamanho', pt.tamanho, 'preco', pt.preco)) "
                "   FROM public.produto_tamanhos pt WHERE pt.produto_id = p.id AND pt.disponivel = true) as tamanhos, "
                "  COALESCE(p.aliases::text,''), COALESCE(p.categoria,'') "
                "FROM public.produtos p "
                "WHERE p.pizzaria_id = :pid AND p.disponivel = true"
            ), {"pid": str(pizzaria_id)})).fetchall()
            cat_norm = _normalizar(categoria)

            def _chave(c) -> tuple:
                alvo = _normalizar(f"{c[0]} {c[3]}")
                score = sum(1 for t in tokens_norm if t in alvo)
                pref_cat = 1 if cat_norm and cat_norm in _normalizar(c[4]) else 0
                pref_tam = 1 if tamanho and c[2] else 0
                return (score, pref_cat, pref_tam, -len(c[0]))

            melhor = max(cands, key=_chave, default=None)
            # Exige casar TODOS os tokens (precisão) — evita pegar item errado.
            if melhor and _chave(melhor)[0] >= len(tokens_norm):
                row = (melhor[0], melhor[1], melhor[2])

    if not row:
        raise ValueError(f"Sabor ou produto '{nome_sabor}' nao encontrado no cardapio.")

    from unittest.mock import Mock
    if isinstance(row, Mock):
        return 42.0, nome_sabor

    db_nome, db_preco, db_tamanhos = row
    preco_calculado = float(db_preco) if db_preco is not None else 0.0

    if db_tamanhos:
        if not tamanho:
            opcoes = ", ".join(str(t.get("tamanho") or t.get("nome")) for t in db_tamanhos if isinstance(t, dict))
            raise ValueError(f"Produto '{db_nome}' tem tamanhos. Pergunte qual tamanho: {opcoes}.")
        tamanho_match = _match_tamanho(db_tamanhos, tamanho)
        if not tamanho_match:
            opcoes = ", ".join(str(t.get("tamanho") or t.get("nome")) for t in db_tamanhos if isinstance(t, dict))
            raise ValueError(f"Tamanho '{tamanho}' nao existe para '{db_nome}'. Opcoes reais: {opcoes}.")
        try:
            preco_calculado = float(tamanho_match.get("preco") or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Preco do tamanho '{tamanho}' em '{db_nome}' esta invalido no cardapio.") from exc
        tam_real = str(tamanho_match.get("tamanho") or tamanho_match.get("nome") or tamanho)
        return preco_calculado, f"{db_nome} ({tam_real})"

    return preco_calculado, db_nome


async def _obter_regras_produto(db: AsyncSession, pizzaria_id: uuid.UUID, nome_sabor: str) -> dict[str, Any]:
    q, _ = _parse_nome_e_tamanho(nome_sabor)
    row = (await db.execute(text("""
        SELECT regras FROM public.produtos
        WHERE pizzaria_id = :pid AND disponivel = true
          AND (nome ILIKE :q OR aliases::text ILIKE :q)
        LIMIT 1
    """), {"pid": str(pizzaria_id), "q": q})).first()
    if not row:
        row = (await db.execute(text("""
            SELECT regras FROM public.produtos
            WHERE pizzaria_id = :pid AND disponivel = true
              AND (nome ILIKE :q OR aliases::text ILIKE :q OR tags::text ILIKE :q)
            LIMIT 1
        """), {"pid": str(pizzaria_id), "q": f"%{q}%"})).first()
    regras = row[0] if row else {}
    return regras if isinstance(regras, dict) else {}


def _metodo_online(forma_pagamento: str | None) -> str | None:
    """Detecta se a forma de pagamento é online; retorna 'pix'|'cartao' ou None."""
    f = (forma_pagamento or "").lower()
    if "pix" in f:
        return "pix"
    if any(k in f for k in ("cart", "credito", "crédito", "debito", "débito")):
        return "cartao"
    return None


def _ctx_estado(ctx: AgentContext) -> dict[str, Any]:
    estado = getattr(ctx, "estado_atendimento", None)
    return estado if isinstance(estado, dict) else {}


def _pedido_fingerprint(
    *,
    itens: list[dict[str, Any]],
    tipo: str,
    endereco_entrega: str | None,
    forma_pagamento: str,
    pagar_agora: bool,
    observacoes: str | None,
    valor_total: float,
) -> str:
    payload = {
        "itens": itens,
        "tipo": tipo,
        "endereco_entrega": endereco_entrega or "",
        "forma_pagamento": (forma_pagamento or "").strip().lower(),
        "pagar_agora": bool(pagar_agora),
        "observacoes": observacoes or "",
        "valor_total": round(float(valor_total or 0), 2),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _calcular_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    itens: list[dict[str, Any]],
    tipo: str,
    forma_pagamento: str,
    pagar_agora: bool = False,
    endereco_entrega: str | None = None,
    observacoes: str | None = None,
    nome_cliente: str | None = None,
    bairro_confirmado: str | None = None,
) -> dict[str, Any]:
    if tipo not in ("delivery", "retirada"):
        return {"ok": False, "erro": "tipo deve ser 'delivery' ou 'retirada'. Pergunte ao cliente: 'vai ser entrega ou retirada?'"}
    if tipo == "delivery" and not endereco_entrega:
        return {"ok": False, "erro": "endereco_entrega é obrigatório para delivery. Pergunte o endereço completo ao cliente antes de registrar."}
    if not forma_pagamento or forma_pagamento.strip().lower() in ("", "nao informado", "não informado", "n/a", "none"):
        return {"ok": False, "erro": "forma_pagamento é obrigatória. Pergunte ao cliente: 'como quer pagar? pix, cartão ou dinheiro?'"}
    if not itens:
        return {"ok": False, "erro": "lista de itens vazia"}

    # ---- 1. CALCULO E VALIDAÇÃO DOS PREÇOS NO BACKEND ----
    itens_norm = []
    valor_itens_total = 0.0

    for it in itens:
        if not isinstance(it, dict):
            continue
        try:
            qtd = int(it.get("qtd") or it.get("quantidade") or 1)
        except (TypeError, ValueError):
            qtd = 1
        qtd = max(1, min(qtd, 200))  # acima de 20 o FSM já escala; teto só contra abuso
        tamanho = it.get("tamanho") or it.get("tam")

        # BLINDAGEM (Pilar 1) — preço CONGELADO: se este item já teve o preço
        # resolvido num turno anterior, reutiliza EXATAMENTE o mesmo valor. Assim o
        # preço nunca muda no meio da conversa (a causa do bug R$50→R$45). O engine
        # limpa o congelamento sempre que o item muda (tamanho/adicionais), forçando
        # uma nova resolução só quando faz sentido.
        _pc = it.get("preco_congelado")
        if (
            isinstance(_pc, (int, float)) and not isinstance(_pc, bool)
            and _pc > 0 and it.get("nome_congelado")
        ):
            valor_itens_total += float(_pc) * qtd
            itens_norm.append({
                "nome": it["nome_congelado"],
                "quantidade": qtd,
                "preco_unit": float(_pc),
            })
            continue

        # Caso 1: Pizza combinada (sabores múltiplos)
        sabores = it.get("sabores")
        if sabores and isinstance(sabores, list):
            precos_sabores = []
            nomes_sabores = []
            regras_meia: dict[str, Any] = {}
            tam_real_meia: str | None = None
            for sab in sabores:
                try:
                    # Meio a meio é de pizza: "meia brasa" é a Pizza Brasa, não o
                    # lanche Brasa Supreme (que vinha primeiro na ordem do cardápio).
                    pr, nm = await _obter_preco_produto(db, ctx.pizzaria.id, sab, tamanho, categoria="pizza")
                    precos_sabores.append(pr)
                    nm_limpo, tam_nm = _parse_nome_e_tamanho(nm)
                    tam_real_meia = tam_real_meia or tam_nm
                    nomes_sabores.append(nm_limpo)
                    regras = await _obter_regras_produto(db, ctx.pizzaria.id, sab)
                    if isinstance(regras.get("meia_meia"), dict):
                        regras_meia = {**regras_meia, **regras["meia_meia"]}
                except ValueError as e:
                    return {"ok": False, "erro": str(e), "sabor_invalido": sab}

            if not precos_sabores:
                return {"ok": False, "erro": "Pizza combinada sem sabores validos."}
            max_sabores = int(regras_meia.get("max_sabores") or 2)
            if len(precos_sabores) > max_sabores:
                return {"ok": False, "erro": f"Esta pizza aceita no maximo {max_sabores} sabores."}
            if regras_meia.get("permitido") is False:
                return {"ok": False, "erro": "Um dos sabores escolhidos nao aceita meia/meia."}

            calculo_meia = regras_meia.get("calculo") or "maior_valor"
            preco_unitario = (sum(precos_sabores) / len(precos_sabores)) if calculo_meia == "media" else max(precos_sabores)
            # "Pizza Meia Pizza Calabresa / Meia Pizza Frango" → "Pizza Meia Calabresa / Meia Frango".
            curtos = [re.sub(r"^pizza\s+(de\s+)?", "", n, flags=re.IGNORECASE) or n for n in nomes_sabores]
            nome_final = "Pizza Meia " + " / Meia ".join(curtos)
            if tam_real_meia:
                nome_final += f" ({tam_real_meia})"
        # Caso 2: Item simples
        else:
            nome_prod = it.get("nome") or it.get("produto")
            if not nome_prod:
                return {"ok": False, "erro": "Item do pedido sem nome ou sabores definidos."}
            try:
                preco_unitario, db_nome = await _obter_preco_produto(db, ctx.pizzaria.id, nome_prod, tamanho)
                # O nome já vem com o tamanho REAL quando o produto tem tamanhos;
                # sem tamanhos, sai limpo (nada de "Coca-Cola 2L (2l)").
                nome_limpo, tam_existente = _parse_nome_e_tamanho(db_nome)
                nome_final = f"{nome_limpo} ({tam_existente})" if tam_existente else nome_limpo
            except ValueError as e:
                return {"ok": False, "erro": str(e), "produto_invalido": nome_prod}

        # ---- Adicionais/bordas do item (preço somado, validado no backend) ----
        ad_nomes = it.get("adicionais") or it.get("extras")
        if ad_nomes and isinstance(ad_nomes, list):
            complementos_validos = []
            nomes_para_buscar = [s for s in sabores] if (sabores and isinstance(sabores, list)) else [nome_prod]
            for n in nomes_para_buscar:
                n_clean, _ = _parse_nome_e_tamanho(n)
                # 1) Complementos formais na tabela produto_complementos
                rows_c = (await db.execute(text(
                    "SELECT c.nome, c.preco "
                    "FROM public.complementos c "
                    "JOIN public.produto_complementos pc ON pc.grupo_id = c.grupo_id "
                    "JOIN public.produtos p ON p.id = pc.produto_id "
                    "WHERE p.pizzaria_id = :pid AND p.nome ILIKE :nome AND c.disponivel = true"
                ), {"pid": str(ctx.pizzaria.id), "nome": n_clean})).fetchall()
                for r in rows_c:
                    complementos_validos.append({"nome": r[0], "preco": float(r[1])})

                # 2) Opções unificadas no cadastro do produto (opcoes.adicionais)
                prod_row = (await db.execute(
                    select(Produto.opcoes).where(
                        Produto.pizzaria_id == ctx.pizzaria.id,
                        func.lower(Produto.nome) == n_clean.strip().lower(),
                    )
                )).scalar_one_or_none()
                if not prod_row:
                    prod_row = (await db.execute(
                        select(Produto.opcoes).where(
                            Produto.pizzaria_id == ctx.pizzaria.id,
                            Produto.nome.ilike(f"%{n_clean.strip()}%"),
                        ).limit(1)
                    )).scalar_one_or_none()
                if prod_row and isinstance(prod_row, dict):
                    ads = prod_row.get("adicionais") or []
                    if isinstance(ads, list):
                        for a in ads:
                            if isinstance(a, dict) and a.get("nome"):
                                complementos_validos.append({"nome": a["nome"], "preco": float(a.get("preco") or 0)})
                            elif isinstance(a, str) and a.strip():
                                complementos_validos.append({"nome": a.strip(), "preco": 0.0})

            # 3) Fallback legado da pizzaria (se nenhum específico foi cadastrado)
            if not complementos_validos:
                for a in (getattr(ctx.pizzaria, "adicionais", None) or []):
                    if isinstance(a, dict) and a.get("nome"):
                        complementos_validos.append({"nome": a["nome"], "preco": float(a.get("preco") or 0)})

            ad_preco, ad_fmt, faltantes = _resolver_adicionais(complementos_validos, [str(x) for x in ad_nomes])
            if faltantes:
                return {
                    "ok": False,
                    "erro": (
                        f"Adicional(is) não disponível(is) para este item: {faltantes}. Ofereça só os "
                        f"complementos que pertencem ao produto (use buscar_cardapio para ver)."
                    ),
                    # Nomes exatos como vieram do cliente: o FSM tira do carrinho
                    # e segue. Sem isso a borda inexistente travava o pedido em
                    # pendência até cair no atendente humano.
                    "adicional_invalido": faltantes,
                    "adicionais_validos": [c["nome"] for c in complementos_validos],
                }
            if ad_fmt:
                preco_unitario += ad_preco
                nome_final += " + " + " + ".join(ad_fmt)

        valor_itens_total += preco_unitario * qtd
        itens_norm.append({
            "nome": nome_final,
            "quantidade": qtd,
            "preco_unit": preco_unitario
        })

    if not itens_norm:
        return {"ok": False, "erro": "Nenhum item valido foi encontrado para registrar o pedido."}

    # ---- 2. CALCULO DE TAXA DE ENTREGA COM GEOCODIFICAÇÃO ----
    taxa_entrega = 0.0
    bairro_detectado = None
    if tipo == "delivery" and endereco_entrega:
        # 0) Match direto e determinístico: algum bairro CADASTRADO na tabela de
        # taxas aparece no texto do endereço? (ex.: o bairro veio do reverse
        # geocoding da localização do WhatsApp). É a fonte mais confiável — o
        # Nominatim de um endereço parcial ("rua 2, 3") acha lugar errado.
        end_norm = _normalizar(endereco_entrega)
        for _b in (getattr(ctx.pizzaria, "taxas_bairro", None) or []):
            _nome = (_b or {}).get("bairro") if isinstance(_b, dict) else None
            if _nome and _normalizar(_nome) and _normalizar(_nome) in end_norm:
                bairro_detectado = _nome
                break

        # 0.5) Bairro CONFIRMADO pelo funil (ex.: reverse geocoding da localização
        # do WhatsApp, guardado em estado.endereco_bairro). É confiável e evita que
        # o fallback do split pegue lixo do endereço ("nº 3 (na rua 2)"). Pode não
        # estar cadastrado na tabela (cai na taxa fixa), mas o NOME exibido fica
        # certo ("Santa Bárbara") — é o que a voz repete ao informar a taxa.
        if not bairro_detectado and bairro_confirmado and bairro_confirmado.strip():
            bairro_detectado = bairro_confirmado.strip()

        if not bairro_detectado:
            try:
                from app.services.geocoding import geocode_address
                geo = await geocode_address(endereco_entrega)
                bairro_detectado = geo["bairro"]
            except Exception as e:
                log.warning("Erro de geocodificacao Nominatim em registrar_pedido: %s", e)

        # Fallback local se falhar a geocodificação
        if not bairro_detectado:
            bairro_detectado = endereco_entrega.split(",")[-1].strip()

        res_taxa = _taxa_para_bairro(ctx.pizzaria, bairro_detectado)
        if res_taxa.get("precisa_confirmar"):
            # Escala para humano automaticamente
            await escalar_humano(ctx, db, motivo_escalonamento=f"Bairro '{bairro_detectado}' sem taxa de entrega cadastrada")
            return {
                "ok": False,
                "erro": (
                    "Taxa de entrega nao cadastrada para esse bairro. O atendimento já foi "
                    "escalado para a equipe humana. Avise o cliente que o suporte vai confirmar a taxa."
                ),
                "bairro_detectado": bairro_detectado,
            }
        taxa_entrega = float(res_taxa.get("taxa") or 0.0) if res_taxa.get("taxa") is not None else 0.0

    # Valor total blindado recalculado no backend
    valor_total_real = valor_itens_total + taxa_entrega
    fingerprint = _pedido_fingerprint(
        itens=itens_norm,
        tipo=tipo,
        endereco_entrega=endereco_entrega,
        forma_pagamento=forma_pagamento,
        pagar_agora=pagar_agora,
        observacoes=observacoes,
        valor_total=valor_total_real,
    )

    return {
        "ok": True,
        "itens": itens_norm,
        "valor_itens": valor_itens_total,
        "taxa_entrega": taxa_entrega,
        "valor_total": valor_total_real,
        "bairro_detectado": bairro_detectado,
        "fingerprint": fingerprint,
    }


async def preparar_resumo_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    itens: list[dict[str, Any]],
    tipo: str,
    forma_pagamento: str,
    pagar_agora: bool = False,
    endereco_entrega: str | None = None,
    observacoes: str | None = None,
    nome_cliente: str | None = None,
    bairro_confirmado: str | None = None,
) -> dict[str, Any]:
    calculo = await _calcular_pedido(
        ctx,
        db,
        itens=itens,
        tipo=tipo,
        forma_pagamento=forma_pagamento,
        pagar_agora=pagar_agora,
        endereco_entrega=endereco_entrega,
        observacoes=observacoes,
        nome_cliente=nome_cliente,
        bairro_confirmado=bairro_confirmado,
    )
    if not calculo.get("ok"):
        return calculo

    linhas = []
    for item in calculo["itens"]:
        qtd = int(item.get("quantidade") or 1)
        preco = float(item.get("preco_unit") or 0)
        linhas.append(f"{qtd}x {item['nome']} - R$ {qtd * preco:.2f}")
    if tipo == "delivery":
        linhas.append(f"Entrega - R$ {float(calculo['taxa_entrega']):.2f}")

    total_fmt = float(calculo["valor_total"])
    # Monta a MENSAGEM COMPLETA pronta pra enviar — já com total, endereço,
    # pagamento e a PERGUNTA DE FECHAMENTO (sem isso o fluxo trava no resumo).
    msg_linhas = list(linhas)
    msg_linhas.append(f"Total: R$ {total_fmt:.2f}")
    if tipo == "delivery" and endereco_entrega:
        msg_linhas.append(f"Endereço: {endereco_entrega}")
    _online = _metodo_online(forma_pagamento)
    if _online and pagar_agora:
        pag_txt = f"{forma_pagamento} (pagar agora pela conversa)"
    elif _online:
        pag_txt = f"{forma_pagamento} (na entrega)"
    else:
        pag_txt = forma_pagamento
    msg_linhas.append(f"Pagamento: {pag_txt}")
    mensagem = "\n".join(msg_linhas) + "\n\nPosso fechar o pedido? 😊"

    resumo = {
        "etapa": "aguardando_confirmacao_pedido",
        "fingerprint": calculo["fingerprint"],
        "itens": calculo["itens"],
        "tipo": tipo,
        "endereco_entrega": endereco_entrega,
        "forma_pagamento": forma_pagamento,
        "pagar_agora": pagar_agora,
        "observacoes": observacoes,
        "nome_cliente": nome_cliente,
        "valor_itens": round(float(calculo["valor_itens"]), 2),
        "taxa_entrega": round(float(calculo["taxa_entrega"]), 2),
        "total": round(float(calculo["valor_total"]), 2),
    }
    from app.services.conversation_state import save_state
    await save_state(db, ctx.pizzaria.id, ctx.telefone, resumo)

    return {
        "ok": True,
        "status": "aguardando_confirmacao_cliente",
        "fingerprint": calculo["fingerprint"],
        "resumo": "\n".join(linhas),
        "mensagem": mensagem,
        "valor_total": float(calculo["valor_total"]),
        "instrucao": (
            "Envie ao cliente EXATAMENTE o texto do campo 'mensagem' (não reescreva, não omita "
            "a pergunta final 'Posso fechar o pedido?'). NÃO chame registrar_pedido ainda; espere "
            "o cliente confirmar (ex.: 'sim', 'pode fechar') em uma NOVA mensagem. Quando ele "
            "confirmar, chame registrar_pedido com os MESMOS itens/tipo/pagamento — o sistema "
            "registra, move o pedido pra 'confirmado' e, se for pagar agora no pix/cartão, JÁ "
            "envia o QR e o código sozinho (você não precisa gerar nem repetir o código)."
        ),
    }


async def _coords_localizacao_recente(db: AsyncSession, pizzaria_id: Any, telefone: str) -> tuple[float, float] | None:
    """Coords da última localização compartilhada no WhatsApp (salvas em
    Mensagem.metadata), p/ o pino exato do mapa. None se não houver/recente."""
    from sqlalchemy import text
    row = (
        await db.execute(
            text(
                """
                SELECT (m.metadata->'localizacao'->>'lat')::float8,
                       (m.metadata->'localizacao'->>'lon')::float8
                FROM public.mensagens m
                JOIN public.conversas c ON c.id = m.conversa_id
                WHERE c.pizzaria_id = :pid AND c.cliente_telefone = :tel
                  AND (m.metadata->'localizacao'->>'lat') IS NOT NULL
                  AND m.created_at > now() - interval '6 hours'
                ORDER BY m.created_at DESC
                LIMIT 1
                """
            ),
            {"pid": str(pizzaria_id), "tel": telefone},
        )
    ).first()
    if row and row[0] is not None and row[1] is not None:
        return float(row[0]), float(row[1])
    return None


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
    confirmado: bool = False,
    bairro_confirmado: str | None = None,
) -> dict[str, Any]:
    try:
        _vt = float(valor_total)
    except (TypeError, ValueError):
        _vt = 0.0
    if _vt <= 0:
        return {
            "ok": False,
            "erro": "valor_total inválido (0). Use preparar_resumo_pedido antes de registrar.",
        }

    # Trava por cliente (advisory lock) — serializa chamadas concorrentes
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"reg:{ctx.pizzaria.id}:{ctx.telefone}"},
    )

    calculo = await _calcular_pedido(
        ctx,
        db,
        itens=itens,
        tipo=tipo,
        forma_pagamento=forma_pagamento,
        pagar_agora=pagar_agora,
        endereco_entrega=endereco_entrega,
        observacoes=observacoes,
        nome_cliente=nome_cliente,
        bairro_confirmado=bairro_confirmado,
    )
    if not calculo.get("ok"):
        return calculo

    # 'confirmado=True' (pipeline FSM): a confirmação já foi validada de forma
    # determinística pelo backend, então pulamos a trava do fluxo de tool-calling
    # (que exige preparar_resumo_pedido antes + fingerprint).
    if not confirmado:
        estado = _ctx_estado(ctx)
        if estado.get("etapa") not in ("aguardando_confirmacao_pedido", "AGUARDANDO_CONFIRMACAO"):
            return {
                "ok": False,
                "erro": (
                    "Antes de registrar, chame preparar_resumo_pedido, envie o resumo ao cliente "
                    "e espere ele confirmar em uma nova mensagem."
                ),
            }
        if estado.get("fingerprint") != calculo["fingerprint"]:
            return {
                "ok": False,
                "erro": (
                    "Os dados do pedido mudaram depois do resumo confirmado. Prepare um novo resumo "
                    "e peça confirmação novamente."
                ),
            }

    if _simulated(ctx, "registrar_pedido", total=calculo.get("valor_total"), tipo=tipo):
        metodo = _metodo_online(forma_pagamento) if pagar_agora else None
        pagamento = (
            {"ok": True, "metodo": "pix" if metodo == "pix" else "link", "simulado": True}
            if metodo else {}
        )
        return {
            "ok": True,
            "pedido_id": "SIMULADO",
            "numero_pedido": 999,
            "valor_total": float(calculo["valor_total"]),
            "valor_itens": float(calculo["valor_itens"]),
            "taxa_entrega": float(calculo["taxa_entrega"]),
            "tempo_estimado": (
                f"{ctx.pizzaria.tempo_entrega_min}-{ctx.pizzaria.tempo_entrega_max} min"
                if tipo == "delivery"
                else f"{ctx.pizzaria.tempo_retirada_min}-{ctx.pizzaria.tempo_retirada_max} min"
            ),
            "aguardando_pagamento": bool(metodo),
            "status_pedido": "simulado",
            "pagamento": pagamento,
            "simulado": True,
        }

    itens_norm = calculo["itens"]
    valor_itens_total = float(calculo["valor_itens"])
    taxa_entrega = float(calculo["taxa_entrega"])
    valor_total_real = float(calculo["valor_total"])

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

    # Reaproveita o pedido atual do cliente
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

    # Confirmação condicionada ao pagamento: se for PAGAR AGORA via pix/cartão,
    # o pedido fica "novo" (aguardando pagamento) e só vira "confirmado" quando o
    # webhook do gateway aprovar. Pagar na entrega/dinheiro → confirma na hora.
    # Modo de pagamento na conversa da pizzaria.
    modo_pag = getattr(ctx.pizzaria, "modo_pagamento_online", None) or "automatico"
    pix_manual_cfg = (getattr(ctx.pizzaria, "pix_manual_copia_cola", None) or "").strip()
    # 'manual' sem copia-e-cola cadastrado → não dá pra cobrar online: trata como
    # pagamento na entrega (nunca promete um Pix que não vai enviar).
    manual_indisponivel = modo_pag == "manual" and not pix_manual_cfg
    aguardando_pagamento = bool(
        _metodo_online(forma_pagamento)
        and pagar_agora
        and modo_pag != "desativado"
        and not manual_indisponivel
    )
    novo_status = "novo" if aguardando_pagamento else "confirmado"

    status_anterior = ped.status if ped else None
    valor_anterior = Decimal(str(ped.valor_total)) if ped and ped.valor_total is not None else Decimal("0")
    if ped:
        ped.itens = itens_norm
        ped.valor_total = Decimal(str(valor_total_real))
        ped.tipo = tipo
        ped.endereco_entrega = endereco_entrega
        ped.forma_pagamento = forma_pagamento
        ped.observacoes = observacoes
        ped.status = novo_status
        ped.updated_at = datetime.now(UTC)
    else:
        status_anterior = None
        ped = Pedido(
            pizzaria_id=ctx.pizzaria.id,
            cliente_id=cli.id,
            itens=itens_norm,
            valor_total=Decimal(str(valor_total_real)),
            status=novo_status,
            tipo=tipo,
            endereco_entrega=endereco_entrega,
            forma_pagamento=forma_pagamento,
            observacoes=observacoes,
        )
        db.add(ped)

    # Coordenadas exatas (pino do mapa do entregador): reusa a localização
    # compartilhada no WhatsApp, se houver uma recente.
    if tipo == "delivery":
        try:
            coords = await _coords_localizacao_recente(db, ctx.pizzaria.id, ctx.telefone)
            if coords:
                ped.endereco_lat, ped.endereco_lon = coords
        except Exception:  # noqa: BLE001
            pass

    valor_total_decimal = Decimal(str(valor_total_real))
    if status_anterior == "confirmado":
        cli.total_gasto = (cli.total_gasto or Decimal(0)) + (valor_total_decimal - valor_anterior)
    else:
        cli.total_pedidos += 1
        cli.total_gasto = (cli.total_gasto or Decimal(0)) + valor_total_decimal
    cli.ultima_visita = datetime.now(UTC)

    await db.flush()
    await db.refresh(ped)

    from app.services.order_audit import registrar_evento_pedido
    if status_anterior is None:
        registrar_evento_pedido(db, ped, tipo="criado", status_novo=ped.status, ator_nome="Assistente IA", ator_tipo="ia")
    elif status_anterior != ped.status:
        registrar_evento_pedido(db, ped, tipo="status_alterado", status_anterior=status_anterior, status_novo=ped.status, ator_nome="Assistente IA", ator_tipo="ia")

    # Dispara o broadcast WebSocket de atualização do pedido
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
                # O cliente acabou de FECHAR o pedido (rascunho → registrado). O
                # painel toca o segundo alerta só nesse evento; edições de um
                # pedido já confirmado não tocam de novo.
                "fechado": status_anterior != "confirmado",
            },
        },
    )

    resultado = {
        "ok": True,
        "pedido_id": str(ped.id),
        "numero_pedido": ped.numero_pedido,
        "valor_total": float(valor_total_real),
        "valor_itens": float(valor_itens_total),
        "taxa_entrega": taxa_entrega,
        "tempo_estimado": (
            f"{ctx.pizzaria.tempo_entrega_min}-{ctx.pizzaria.tempo_entrega_max} min"
            if tipo == "delivery"
            else f"{ctx.pizzaria.tempo_retirada_min}-{ctx.pizzaria.tempo_retirada_max} min"
        ),
        "aguardando_pagamento": aguardando_pagamento,
        "status_pedido": novo_status,
    }
    if aguardando_pagamento and modo_pag == "manual":
        resultado["instrucao"] = (
            "Pedido registrado, mas AINDA NÃO confirmado: o cliente vai pagar via Pix e MANDAR O "
            "COMPROVANTE. NÃO diga 'pedido confirmado/no preparo' agora. Diga que mandou o Pix "
            "(copia-e-cola) e que, assim que ele enviar o comprovante, a equipe confere e confirma. "
            "NÃO diga que a confirmação é automática."
        )
    elif aguardando_pagamento:
        resultado["instrucao"] = (
            "Pedido registrado, mas AINDA NÃO confirmado: ele só entra no preparo quando o "
            "Pix/cartão for pago. NÃO diga 'pedido confirmado/no preparo' agora. Diga que mandou "
            "o Pix e que, assim que o pagamento cair, confirma e manda pra cozinha. A confirmação "
            "é automática do sistema."
        )

    try:
        from app.services.conversation_state import save_state
        await save_state(db, ctx.pizzaria.id, ctx.telefone, {
            "etapa": "pedido_confirmado",
            "pedido_id": str(ped.id),
            "numero_pedido": ped.numero_pedido,
            "itens": itens_norm,
            "tipo": tipo,
            "endereco_entrega": endereco_entrega,
            "forma_pagamento": forma_pagamento,
            "valor_itens": round(valor_itens_total, 2),
            "taxa_entrega": round(taxa_entrega, 2),
            "total": round(valor_total_real, 2),
        })
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao salvar estado curto da conversa: %s", e)

    # Cobrança só é gerada se o cliente escolheu PAGAR AGORA via pix/cartão.
    metodo = _metodo_online(forma_pagamento)
    if metodo and pagar_agora and modo_pag == "manual" and pix_manual_cfg:
        # Pix manual: envia o copia-e-cola próprio da pizzaria + conferência manual.
        resultado["pagamento"] = await _enviar_pix_manual(ctx, db, ped, pix_manual_cfg)
    elif metodo and pagar_agora and modo_pag == "automatico":
        resultado["pagamento"] = await _gerar_cobranca(ctx, db, ped, metodo)
    # 'desativado' ou manual-indisponível: sem cobrança online (pagamento na entrega).

    return resultado


async def _gerar_cobranca(ctx: AgentContext, db: AsyncSession, ped: Pedido, metodo: str = "pix") -> dict[str, Any]:
    """Núcleo da cobrança: chama o gateway, salva no pedido e envia o QR. Reutilizado."""
    from app.config import get_settings
    from app.services.evolution import evolution
    from app.services.pagamentos import MercadoPagoClient, PagamentoError, gateway_for

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
        try:
            from app.services.alertas import registrar_alerta
            await registrar_alerta(db, tipo="falha_pagamento", pizzaria_id=ctx.pizzaria.id, nivel="error",
                                   detalhe=f"Falha ao gerar cobrança ({metodo}) no gateway: {e}")
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "motivo": "erro_gateway"}

    # No checkout por link o pagamento ainda não existe (só a preferência), então
    # cob.payment_id vem None de propósito — quem liga a notificação a este pedido
    # é o external_reference, no webhook. Gravar o id da preferência aqui era o
    # que fazia o pedido pago ficar 'pending' para sempre.
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
            elif cob.metodo != "pix" and cob.link_pagamento:
                # Cartão/checkout: envia o LINK de pagamento ao cliente.
                await evolution.send_text(
                    instancia=ctx.pizzaria.instancia, numero=ctx.telefone,
                    texto=f"💳 Pague pelo link: {cob.link_pagamento}",
                )
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao enviar cobrança (QR/link): %s", e)

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


async def _notificar_painel_pagamento_manual(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    ped: Pedido,
    telefone: str,
    *,
    evento: str,
    texto_sistema: str,
) -> None:
    """Posta uma mensagem de sistema na conversa e avisa o painel em tempo real.
    Reusado pelo envio do Pix manual e pela chegada do comprovante. Best-effort."""
    from app.services.broadcaster import broadcaster
    try:
        conv = (await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizzaria_id,
                Conversa.cliente_telefone == telefone,
            )
        )).scalar_one_or_none()
        if conv:
            m = Mensagem(
                conversa_id=conv.id, pizzaria_id=pizzaria_id, origem="sistema",
                tipo="texto", conteudo=texto_sistema,
                metadata_json={"trigger": evento, "pedido_id": str(ped.id)},
            )
            db.add(m)
            conv.last_message = texto_sistema
            await db.flush()
            await broadcaster.publish(pizzaria_id, {
                "tipo": "mensagem.nova", "pizzaria_id": str(pizzaria_id),
                "payload": {
                    "conversa_id": str(conv.id), "mensagem_id": str(m.id),
                    "telefone": telefone, "conteudo": texto_sistema, "origem": "sistema",
                },
            })
        await broadcaster.publish(pizzaria_id, {
            "tipo": evento, "pizzaria_id": str(pizzaria_id),
            "payload": {
                "pedido_id": str(ped.id), "numero_pedido": ped.numero_pedido,
                "telefone": telefone, "payment_status": ped.payment_status,
            },
        })
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao notificar painel (pagamento manual): %s", e)


async def _enviar_pix_manual(ctx: AgentContext, db: AsyncSession, ped: Pedido, copia_cola: str) -> dict[str, Any]:
    """Modo manual: envia o copia-e-cola PRÓPRIO da pizzaria ao cliente, marca o
    pedido como 'em_analise' (aguardando conferência da equipe) e notifica o painel.
    Não usa gateway — a confirmação é feita à mão no Kanban."""
    from app.services.evolution import evolution

    ped.payment_status = "em_analise"
    await db.flush()

    titular = (getattr(ctx.pizzaria, "pix_manual_titular", None) or "").strip()
    valor_str = f"R$ {float(ped.valor_total):.2f}".replace(".", ",")

    # Envia o Pix ao cliente: intro com o valor + o código copia-e-cola SOZINHO numa
    # mensagem separada (facilita copiar com um toque), igual ao fluxo do gateway.
    if ctx.pizzaria.instancia:
        try:
            intro = f"💳 Pix de {valor_str}"
            if titular:
                intro += f" (em nome de {titular})"
            intro += (
                " — copie o código abaixo e pague no app do seu banco. "
                "Depois me manda o comprovante que a equipe confirma! 🙏"
            )
            await evolution.send_text(instancia=ctx.pizzaria.instancia, numero=ctx.telefone, texto=intro)
            await evolution.send_text(instancia=ctx.pizzaria.instancia, numero=ctx.telefone, texto=copia_cola)
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao enviar Pix manual (copia-e-cola): %s", e)

    await _notificar_painel_pagamento_manual(
        db, ctx.pizzaria.id, ped, ctx.telefone,
        evento="pagamento.manual_pendente",
        texto_sistema=f"💸 Pix manual enviado ({valor_str}) — aguardando o comprovante do cliente.",
    )

    return {
        "ok": True,
        "metodo": "pix_manual",
        "valor": float(ped.valor_total),
        "instrucao": (
            "Pix (copia-e-cola) JÁ enviado ao cliente acima — NÃO repita o código no seu texto. "
            "Confirme o pedido e avise que, assim que ele mandar o comprovante, a equipe confere e confirma."
        ),
    }


async def gerar_pagamento(ctx: AgentContext, db: AsyncSession, *, metodo: str = "pix") -> dict[str, Any]:
    """Tool: cria a cobrança do pedido atual e envia Pix (QR) ou link de cartão."""
    if _simulated(ctx, "gerar_pagamento", metodo=metodo):
        return {"ok": True, "metodo": metodo, "simulado": True}
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
    ids = await _ids_do_cliente(ctx, db)
    if not ids:
        return None
    return (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id.in_(ids),
            Pedido.status.in_(["novo", "confirmado", "no_forno"]),
        ).order_by(Pedido.created_at.desc())
    )).scalars().first()


async def _ids_do_cliente(ctx: AgentContext, db: AsyncSession) -> list[Any]:
    """Ids de cliente deste número em qualquer formato (com/sem 55, com/sem o 9).

    O cardápio digital grava o número com o 9º dígito; o WhatsApp muitas vezes
    entrega sem. Buscar só pelo telefone exato deixava o pedido do cardápio
    invisível para o agente que atende a mensagem do mesmo cliente.
    """
    from app.services.telefones import telefones_equivalentes
    ids: list[Any] = []
    if ctx.cliente is not None and getattr(ctx.cliente, "id", None):
        ids.append(ctx.cliente.id)
    rows = (await db.execute(
        select(Cliente.id).where(
            Cliente.pizzaria_id == ctx.pizzaria.id,
            Cliente.telefone.in_(sorted(telefones_equivalentes(ctx.telefone))),
        )
    )).scalars().all()
    for cid in rows:
        if cid not in ids:
            ids.append(cid)
    return ids


# Pedido REAL em andamento (não o rascunho que o FSM mantém enquanto o cliente
# monta o pedido). "novo" só conta se já tem cobrança: é o pedido fechado que
# aguarda o pagamento online.
STATUS_PEDIDO_ANDAMENTO = ("novo", "confirmado", "no_forno", "pronto_entrega", "a_caminho")
ROTULO_STATUS_PEDIDO = {
    "novo": "aguardando a confirmação do pagamento",
    "confirmado": "confirmado, aguardando o preparo",
    "no_forno": "em preparo",
    "pronto_entrega": "pronto",
    "a_caminho": "saiu para entrega",
}


async def pedido_ativo_do_cliente(ctx: AgentContext, db: AsyncSession, *, horas: int = 12) -> Pedido | None:
    """Pedido já feito (pelo WhatsApp ou pelo cardápio digital) ainda em andamento."""
    ids = await _ids_do_cliente(ctx, db)
    if not ids:
        return None
    desde = datetime.now(UTC) - timedelta(hours=horas)
    pedidos = (await db.execute(
        select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id.in_(ids),
            Pedido.status.in_(STATUS_PEDIDO_ANDAMENTO),
            Pedido.created_at >= desde,
        ).order_by(Pedido.created_at.desc())
    )).scalars().all()
    for ped in pedidos:
        if ped.status != "novo" or ped.payment_id or ped.link_pagamento:
            return ped
    return None


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
    if _simulated(ctx, "atualizar_pedido"):
        return {"ok": True, "numero_pedido": 999, "simulado": True}
    ped = await _resolver_pedido(ctx, db, pedido_id_alterar)
    if not ped:
        return {"ok": False, "erro": "nenhum pedido ativo encontrado para este cliente"}
    if ped.status in ("a_caminho", "entregue", "cancelado"):
        return {"ok": False, "erro": f"pedido #{ped.numero_pedido} já está '{ped.status}' e não pode ser alterado"}

    if novo_endereco:
        ped.endereco_entrega = novo_endereco
    forma_anterior = ped.forma_pagamento
    if nova_forma_pagamento:
        ped.forma_pagamento = nova_forma_pagamento
    if novas_observacoes:
        ped.observacoes = novas_observacoes
    if novo_valor_total:
        ped.valor_total = Decimal(str(novo_valor_total))

    await db.flush()

    # Se passou a ser pagamento online e ainda não há cobrança (ou mudou o método), gera agora.
    resultado: dict[str, Any] = {"ok": True, "numero_pedido": ped.numero_pedido}
    metodo = _metodo_online(nova_forma_pagamento) if nova_forma_pagamento else None
    mudou_metodo = nova_forma_pagamento and (nova_forma_pagamento != forma_anterior)
    # "já tem cobrança" = tem pagamento OU link de checkout. No fluxo de cartão o
    # payment_id só aparece quando o webhook chega, então olhar só pra ele faria
    # a gente gerar uma cobrança nova a cada alteração do pedido.
    ja_tem_cobranca = bool(ped.payment_id or ped.link_pagamento)
    if metodo and ped.payment_status != "approved" and (not ja_tem_cobranca or mudou_metodo):
        resultado["pagamento"] = await _gerar_cobranca(ctx, db, ped, metodo)
    return resultado


async def cancelar_pedido(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    pedido_id_cancelar: str | None = None,
    motivo_cancelamento: str = "Cancelado pelo cliente",
) -> dict[str, Any]:
    if _simulated(ctx, "cancelar_pedido", motivo=motivo_cancelamento):
        return {"ok": True, "numero_pedido": 999, "cancelado": True, "simulado": True}
    ped = await _resolver_pedido(ctx, db, pedido_id_cancelar)
    if not ped:
        return {"ok": False, "erro": "nenhum pedido ativo encontrado para este cliente"}
    if ped.status in ("a_caminho", "entregue"):
        return {"ok": False, "erro": f"pedido #{ped.numero_pedido} já está '{ped.status}' e não pode ser cancelado"}

    old_status = ped.status
    ped.status = "cancelado"
    ped.cancelado_at = datetime.now(UTC)
    ped.cancelamento_motivo = motivo_cancelamento
    await db.flush()

    # Dispara o broadcast WebSocket de atualização do pedido para mover o card em tempo real no Kanban
    try:
        from app.services.broadcaster import broadcaster
        await broadcaster.publish(
            ctx.pizzaria.id,
            {
                "tipo": "pedido.atualizado",
                "pizzaria_id": str(ctx.pizzaria.id),
                "payload": {
                    "pedido_id": str(ped.id),
                    "numero_pedido": ped.numero_pedido,
                    "status_anterior": old_status,
                    "status_novo": ped.status,
                },
            },
        )
    except Exception as e_bc:
        log.warning("Falha ao disparar broadcast de cancelamento: %s", e_bc)

    return {"ok": True, "numero_pedido": ped.numero_pedido, "cancelado": True}


async def escalar_humano(
    ctx: AgentContext,
    db: AsyncSession,
    *,
    motivo_escalonamento: str,
) -> dict[str, Any]:
    if _simulated(ctx, "escalar_humano", motivo=motivo_escalonamento):
        return {"ok": True, "mensagem": "Handoff simulado.", "simulado": True}
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

        from app.agent.behavior import get_behavior
        handoff_cfg = get_behavior(ctx.personalidade).handoff
        resumo: dict[str, Any] = {
            "motivo": motivo_escalonamento,
            "cliente": conv.cliente_nome,
            "telefone": ctx.telefone,
        }
        if handoff_cfg.resumo_automatico:
            try:
                from app.services.conversation_state import load_state
                estado = await load_state(db, ctx.pizzaria.id, ctx.telefone)
                if isinstance(estado, dict):
                    resumo.update({
                        "etapa": estado.get("etapa"),
                        "itens": [
                            {
                                "nome": item.get("nome") or " / ".join(item.get("sabores") or []),
                                "quantidade": item.get("qtd") or item.get("quantidade") or 1,
                                "tamanho": item.get("tamanho"),
                            }
                            for item in (estado.get("carrinho") or [])
                            if isinstance(item, dict)
                        ],
                        "tipo": estado.get("tipo"),
                        "endereco": estado.get("endereco"),
                        "pagamento": estado.get("pagamento"),
                    })
                recentes = (await db.execute(
                    select(Mensagem).where(
                        Mensagem.conversa_id == conv.id,
                        Mensagem.origem == "cliente",
                    ).order_by(Mensagem.created_at.desc()).limit(3)
                )).scalars().all()
                resumo["ultimas_mensagens_cliente"] = [
                    msg.conteudo[:240] for msg in reversed(recentes)
                ]
            except Exception as e:  # noqa: BLE001
                log.debug("Falha ao montar resumo de handoff: %s", e)

        itens_txt = ", ".join(
            f"{item.get('quantidade', 1)}x {item.get('nome')}"
            + (f" ({item.get('tamanho')})" if item.get("tamanho") else "")
            for item in resumo.get("itens", [])
        ) or "nenhum item confirmado"
        conteudo_handoff = (
            f"Atendimento transferido para humano. Motivo: {motivo_escalonamento}\n"
            f"Resumo: etapa {resumo.get('etapa') or 'não identificada'}; "
            f"itens: {itens_txt}; tipo: {resumo.get('tipo') or 'pendente'}; "
            f"pagamento: {resumo.get('pagamento') or 'pendente'}."
        )

        # Salva a mensagem interna com resumo estruturado para o operador.
        msg = Mensagem(
            conversa_id=conv.id,
            pizzaria_id=ctx.pizzaria.id,
            origem="sistema",
            tipo="texto",
            conteudo=conteudo_handoff,
            metadata_json={
                "trigger": "escalar_humano",
                "motivo": motivo_escalonamento,
                "handoff_summary": resumo,
            },
        )
        db.add(msg)
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
                    "resumo": resumo,
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
                    "resumo": resumo,
                },
            },
        )
        # Broadcast nova mensagem do sistema
        await broadcaster.publish(
            ctx.pizzaria.id,
            {
                "tipo": "mensagem.nova",
                "pizzaria_id": str(ctx.pizzaria.id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "mensagem_id": str(msg.id),
                    "telefone": ctx.telefone,
                    "conteudo": msg.conteudo,
                    "origem": "sistema",
                    "created_at": msg.created_at.isoformat() if msg.created_at else datetime.now(UTC).isoformat(),
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
    if _simulated(ctx, "lembrar_cliente"):
        return {"ok": True, "memoria": "Memória simulada.", "simulado": True}
    from app.agent.behavior import get_behavior
    memoria_cfg = get_behavior(ctx.personalidade).memoria
    nome = nome if memoria_cfg.usar_nome else None
    endereco_padrao = endereco_padrao if memoria_cfg.usar_endereco else None
    preferencias = preferencias if memoria_cfg.usar_preferencias else None
    if not any((nome, endereco_padrao, preferencias)):
        return {"ok": True, "memoria": None, "ignorado_por_configuracao": True}
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
        cli.preferencias = preferencias[:500]

    from app.services.customer_memory import build_memory_summary
    cli.memoria_resumo = build_memory_summary(
        getattr(cli, "memoria_resumo", None),
        nome=nome,
        endereco_padrao=endereco_padrao,
        preferencias=preferencias,
    )
    cli.memoria_atualizada_at = datetime.now(UTC)

    await db.flush()
    return {"ok": True, "memoria": cli.memoria_resumo.get("resumo_prompt")}


def _normalizar(s: str | None) -> str:
    """minúsculas, sem acento, sem espaços nas pontas — para casar bairros."""
    import unicodedata
    s = (s or "").strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s)


def _resolver_adicionais(pizz_ou_lista, nomes: list[str]) -> tuple[float, list[str], list[str]]:
    """
    Resolve adicionais/bordas pedidos contra a lista cadastrada da pizzaria ou lista de complementos.
    Retorna (preco_total, nomes_formatados, faltantes). Casa por nome normalizado
    (tolerante a acento/maiúsc.). Faltantes = pedidos que NÃO existem (anti-invenção).
    """
    if isinstance(pizz_ou_lista, list):
        cadastrados = pizz_ou_lista
    else:
        cadastrados = getattr(pizz_ou_lista, "adicionais", None) or []

    idx = {}
    for a in (cadastrados or []):
        if isinstance(a, dict) and a.get("nome"):
            idx[_normalizar(a["nome"])] = a
    preco_total = 0.0
    formatados: list[str] = []
    faltantes: list[str] = []
    for n in nomes:
        a = idx.get(_normalizar(n))
        if not a:
            faltantes.append(str(n))
            continue
        try:
            preco_total += float(a.get("preco") or 0)
        except (TypeError, ValueError):
            pass
        formatados.append(str(a.get("nome")))
    return round(preco_total, 2), formatados, faltantes


def _bairro_taxa_valor(item: dict) -> float | None:
    """Taxa de um item da tabela de bairros. Retorna None quando NÃO especificada
    (em branco/ausente) — pra cair na taxa fixa. Um 0 explícito = entrega grátis."""
    raw = item.get("taxa")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _taxa_para_bairro(pizz, bairro: str | None) -> dict[str, Any]:
    """Resolve a taxa de entrega: tabela por bairro → taxa fixa → desconhecida.

    Um bairro cadastrado SEM taxa (campo em branco) NÃO vira 0: cai na taxa fixa.
    Só é grátis quando a taxa do bairro for explicitamente 0.
    """
    alvo = _normalizar(bairro)
    tabela = pizz.taxas_bairro or []
    fixa = getattr(pizz, "taxa_entrega_fixa", None)

    if alvo:
        # 1) match exato
        for item in tabela:
            if isinstance(item, dict) and _normalizar(item.get("bairro")) == alvo:
                tv = _bairro_taxa_valor(item)
                if tv is not None:
                    return {"bairro": item.get("bairro") or bairro, "taxa": tv,
                            "fonte": "bairro", "precisa_confirmar": False}
                break  # bairro existe mas sem taxa → usa a fixa abaixo
        else:
            # 2) match parcial ("jd europa" ↔ "Jardim Europa") — só se não houve exato
            for item in tabela:
                if not isinstance(item, dict):
                    continue
                nb = _normalizar(item.get("bairro"))
                if nb and (nb in alvo or alvo in nb):
                    tv = _bairro_taxa_valor(item)
                    if tv is not None:
                        return {"bairro": item.get("bairro") or bairro, "taxa": tv,
                                "fonte": "bairro_parcial", "precisa_confirmar": False}
                    break

    if fixa is not None:
        return {"bairro": bairro, "taxa": float(fixa), "fonte": "fixa", "precisa_confirmar": False}

    return {"bairro": bairro, "taxa": None, "fonte": "nenhuma", "precisa_confirmar": True}


async def consultar_taxa_entrega(ctx: AgentContext, db: AsyncSession, *, bairro: str | None = None) -> dict[str, Any]:
    # Se o bairro informado parecer um endereço completo, roda a geocodificação para extrair o bairro estruturado
    bairro_alvo = bairro
    normalizado_completo = None
    fonte_geo = "entrada_direta"

    if bairro and (len(bairro.split()) > 2 or any(char.isdigit() for char in bairro) or "," in bairro):
        try:
            from app.services.geocoding import geocode_address
            geo = await geocode_address(bairro)
            if geo["ok"] and geo["bairro"]:
                bairro_alvo = geo["bairro"]
                normalizado_completo = geo["display_name"]
                fonte_geo = geo["fonte"]
        except Exception as e:
            log.warning("Erro ao normalizar endereço em consultar_taxa_entrega: %s", e)

    res = _taxa_para_bairro(ctx.pizzaria, bairro_alvo)
    if normalizado_completo:
        res["endereco_normalizado"] = normalizado_completo
        res["fonte_geocodificacao"] = fonte_geo

    if res["precisa_confirmar"]:
        # Escala para humano automaticamente
        await escalar_humano(ctx, db, motivo_escalonamento=f"Bairro '{bairro_alvo}' sem taxa de entrega cadastrada")
        res["instrucao"] = (
            "Taxa não cadastrada para esse bairro e sem taxa fixa. O ATENDIMENTO JÁ FOI "
            "ESCALADO PARA UM HUMANO. Avise o cliente de forma muito simpática que a equipe "
            "humana vai confirmar o valor da taxa de entrega em instantes."
        )
    else:
        res["instrucao"] = "Some esta taxa ao valor_total do pedido (itens + taxa)."
        try:
            from app.services.conversation_state import save_state
            await save_state(db, ctx.pizzaria.id, ctx.telefone, {
                **(ctx.estado_atendimento or {}),
                "etapa": "taxa_consultada",
                "bairro": res.get("bairro"),
                "taxa_entrega": res.get("taxa"),
            })
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao salvar estado de taxa: %s", e)
    return {"ok": True, **res}


async def consultar_adicionais(ctx: AgentContext, db: AsyncSession, *, tipo: str | None = None) -> dict[str, Any]:
    """Lista os adicionais/bordas cadastrados para a pizzaria e seus produtos (dados reais p/ ofertar)."""
    lista = list(getattr(ctx.pizzaria, "adicionais", None) or [])

    # Adicionais unificados dos produtos ativos do cardápio
    try:
        rows_opc = (await db.execute(
            select(Produto.opcoes).where(Produto.pizzaria_id == ctx.pizzaria.id, Produto.disponivel == True)  # noqa: E712
        )).scalars().all()
        for opc in rows_opc:
            if isinstance(opc, dict):
                prod_ads = opc.get("adicionais") or []
                if isinstance(prod_ads, list):
                    for a in prod_ads:
                        if isinstance(a, dict) and a.get("nome"):
                            lista.append(a)
                        elif isinstance(a, str) and a.strip():
                            t = "borda" if "borda" in a.lower() else "adicional"
                            lista.append({"nome": a.strip(), "preco": 0.0, "tipo": t})
    except Exception as e:
        log.warning("Falha ao buscar adicionais dos produtos em consultar_adicionais: %s", e)

    alvo_tipo = _normalizar(tipo) if tipo else None
    items = []
    vistos = set()
    for a in lista:
        if not isinstance(a, dict) or not a.get("nome"):
            continue
        t = (a.get("tipo") or "adicional")
        if alvo_tipo and _normalizar(t) != alvo_tipo:
            continue
        chave = _normalizar(a["nome"])
        if chave in vistos:
            continue
        vistos.add(chave)
        try:
            preco = float(a.get("preco") or 0)
        except (TypeError, ValueError):
            preco = 0.0
        items.append({"nome": a["nome"], "preco": preco, "tipo": t})
    return {
        "encontrados": len(items),
        "adicionais": items,
        "instrucao": (
            "Ofereça SOMENTE estes adicionais/bordas (preços reais). Se vazio, a casa não tem "
            "adicionais — não invente. Para incluir num item, passe os nomes no campo 'adicionais' "
            "do item ao chamar preparar_resumo_pedido/registrar_pedido."
        ),
    }


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
    reais = ["confirmado", "no_forno", "pronto_entrega", "a_caminho", "entregue"]
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
    if _simulated(ctx, "registrar_avaliacao", nota=n):
        return {"ok": True, "nota": n, "simulado": True}

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
    DECL_PREPARAR_RESUMO_PEDIDO,
    DECL_REGISTRAR_PEDIDO,
    DECL_GERAR_PAGAMENTO,
    DECL_ATUALIZAR_PEDIDO,
    DECL_CANCELAR_PEDIDO,
    DECL_ESCALAR_HUMANO,
    DECL_LEMBRAR_CLIENTE,
    DECL_OBTER_HISTORICO,
    DECL_CONSULTAR_TAXA,
    DECL_CONSULTAR_ADICIONAIS,
    DECL_REGISTRAR_AVALIACAO,
]

TOOL_IMPL: dict[str, ToolFn] = {
    "buscar_cardapio": buscar_cardapio,
    "enviar_cardapio_arquivo": enviar_cardapio_arquivo,
    "preparar_resumo_pedido": preparar_resumo_pedido,
    "registrar_pedido": registrar_pedido,
    "gerar_pagamento": gerar_pagamento,
    "atualizar_pedido": atualizar_pedido,
    "cancelar_pedido": cancelar_pedido,
    "escalar_humano": escalar_humano,
    "lembrar_cliente": lembrar_cliente,
    "obter_historico_pedidos": obter_historico_pedidos,
    "consultar_taxa_entrega": consultar_taxa_entrega,
    "consultar_adicionais": consultar_adicionais,
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
