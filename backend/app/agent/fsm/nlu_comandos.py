"""
NLU de COMANDOS — a IA escolhe do cardápio e dá ordens; não descreve nem inventa.

Duas blindagens sobre a NLU livre (nlu.py):

  1) Escolha no catálogo: o produto vem como CÓDIGO do catálogo da pizzaria
     (P1, P2... — ver catalogo.py), o tamanho como um dos tamanhos cadastrados,
     o adicional como código A1, A2... O esquema JSON é montado por pizzaria com
     esses valores em `enum` e enviado em modo estrito (Structured Outputs): o
     modelo não consegue gerar um valor fora da lista. Mesmo quando o provedor
     não suporta o modo estrito, o código valida cada código de volta — valor
     desconhecido vira "não encontrado", nunca um produto parecido.

  2) Comandos: em vez de "produtos: [...]" (que o engine precisava adivinhar se
     era item novo, correção ou esclarecimento), a IA devolve operações
     explícitas — adicionar, definir_qtd, somar_qtd, remover, trocar_tamanho,
     adicionar_adicional, remover_adicional, pedido_generico — e se refere aos
     itens do carrinho pelo ID do item (I1, I2...), nunca pelo nome.

A saída é convertida para o MESMO formato da NLU livre ({intencao, confianca,
dados}), com os itens já resolvidos por ID (`produto_id`/`sabores_ids`) e as
operações sobre itens em `dados["_ops_itens"]` — o engine aplica tudo de forma
determinística. Falha (provedor, JSON, catálogo vazio) → None, e o pipeline usa
a NLU livre como rede de segurança.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.agent.fsm.catalogo import Catalogo, normalizar
from app.agent.fsm.nlu import INTENCOES, _extrair_json

log = logging.getLogger(__name__)

NAO_ENCONTRADO = "NAO_ENCONTRADO"
ACOES = (
    "adicionar", "pedido_generico", "definir_qtd", "somar_qtd", "remover",
    "trocar_tamanho", "adicionar_adicional", "remover_adicional",
)

# Modelos/provedores que já recusaram json_schema: não tentamos de novo (cada
# recusa custaria uma chamada extra por mensagem).
_SEM_SCHEMA: set[str] = set()


# ============================================
# Carrinho visto pela NLU (itens com ID estável)
# ============================================
def garantir_ids_itens(estado: dict[str, Any]) -> None:
    """Todo item do carrinho ganha um ID estável (I1, I2...). Estados antigos,
    de antes dos comandos, recebem o ID aqui."""
    seq = int(estado.get("seq_item") or 0)
    for it in estado.get("carrinho") or []:
        if isinstance(it, dict) and not it.get("iid"):
            seq += 1
            it["iid"] = f"I{seq}"
    estado["seq_item"] = seq


def carrinho_para_nlu(estado: dict[str, Any]) -> str:
    linhas = []
    for it in estado.get("carrinho") or []:
        if not isinstance(it, dict):
            continue
        nome = it.get("nome") or ""
        if it.get("sabores"):
            nome = "meio a meio " + " / ".join(it["sabores"])
        extra = []
        if it.get("tamanho"):
            extra.append(f"tamanho {it['tamanho']}")
        else:
            extra.append("SEM tamanho")
        if it.get("adicionais"):
            extra.append("adicionais: " + ", ".join(map(str, it["adicionais"])))
        linhas.append(f"{it.get('iid')}: {it.get('qtd', 1)}x {nome} ({'; '.join(extra)})")
    return "\n".join(linhas) or "(vazio)"


# ============================================
# Esquema estrito por pizzaria
# ============================================
def _nullable_enum(valores: list[str]) -> dict[str, Any]:
    return {"type": ["string", "null"], "enum": [*valores, None]}


def montar_schema(cat: Catalogo, iids: list[str]) -> dict[str, Any]:
    codigos = [p.codigo for p in cat.produtos] + [NAO_ENCONTRADO]
    tamanhos = cat.todos_tamanhos() or ["-"]
    ads = list(cat.codigos_adicionais().keys()) or ["-"]
    categorias = cat.categorias() or ["-"]
    comando = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "acao", "item", "produtos", "texto_cliente", "tamanho", "tamanho_texto", "qtd",
            "adicionais", "adicionais_nao_encontrados", "categoria",
        ],
        "properties": {
            "acao": {"type": "string", "enum": list(ACOES)},
            "item": _nullable_enum(iids or ["-"]),
            "produtos": {"type": "array", "items": {"type": "string", "enum": codigos}},
            "texto_cliente": {"type": ["string", "null"]},
            "tamanho": _nullable_enum(tamanhos),
            "tamanho_texto": {"type": ["string", "null"]},
            "qtd": {"type": ["integer", "null"]},
            "adicionais": {"type": "array", "items": {"type": "string", "enum": ads}},
            "adicionais_nao_encontrados": {"type": "array", "items": {"type": "string"}},
            "categoria": _nullable_enum(categorias),
        },
    }
    endereco = {
        "type": "object",
        "additionalProperties": False,
        "required": ["rua", "numero", "bairro", "referencia"],
        "properties": {k: {"type": ["string", "null"]} for k in ("rua", "numero", "bairro", "referencia")},
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "intencao", "confianca", "comandos", "tipo_entrega", "endereco", "forma_pagamento",
            "pagar_agora", "quer_cardapio", "nota", "observacoes",
        ],
        "properties": {
            "intencao": {"type": "string", "enum": list(INTENCOES)},
            "confianca": {"type": "number"},
            "comandos": {"type": "array", "items": comando},
            "tipo_entrega": _nullable_enum(["delivery", "retirada"]),
            "endereco": endereco,
            "forma_pagamento": _nullable_enum(["pix", "cartao", "dinheiro"]),
            "pagar_agora": {"type": ["boolean", "null"]},
            "quer_cardapio": {"type": "boolean"},
            "nota": {"type": ["integer", "null"]},
            "observacoes": {"type": ["string", "null"]},
        },
    }


# ============================================
# Prompt
# ============================================
_REGRAS = """Você é o EXTRATOR de um atendimento de pizzaria no WhatsApp. NÃO responda ao cliente:
leia a ÚLTIMA mensagem dele (com o estado e o histórico) e devolva SÓ o JSON do esquema.

PRODUTOS: use SOMENTE os códigos do CATÁLOGO abaixo (P1, P2...). Nunca escreva nome de produto.
- Escolha o produto pelo que o cliente disse, considerando nome, "também chamado" e categoria.
  Se ele disse "pizza X", escolha a PIZZA X, não um lanche com nome parecido.
- Se o produto não existe no catálogo: produtos = ["NAO_ENCONTRADO"] e texto_cliente = o que ele pediu.
- Se ficar em dúvida entre dois produtos do catálogo, NÃO chute: use NAO_ENCONTRADO com texto_cliente.

COMANDOS (lista, na ordem em que o cliente falou; vazia se ele não mexeu no pedido):
- adicionar: item NOVO. produtos = [código] para inteira; 2+ códigos SÓ se ele disse meia/metade/meio a meio.
  qtd = quantas unidades (número inteiro; "uma" = 1). NUNCA coloque a quantidade em outro campo.
- pedido_generico: ele pediu a categoria sem dizer o sabor ("2 pizzas grandes", "um lanche").
  categoria = a categoria do catálogo, qtd e tamanho se ditos.
- definir_qtd: CORRIGE a quantidade de um item que JÁ está no carrinho ("na verdade são 3", "é só 1"):
  item = ID do carrinho (I1...), qtd = a quantidade TOTAL nova. qtd 0 = tirar o item.
- somar_qtd: quer MAIS unidades de um item do carrinho ("mais uma igual", "põe outra"): qtd = quanto acrescenta.
- remover: tirar um item do carrinho ("tira a coca") — item = ID.
- trocar_tamanho: mudar o tamanho de um item do carrinho, OU responder o tamanho de um item que está SEM tamanho.
- adicionar_adicional / remover_adicional: pôr ou tirar adicional/borda de um item do carrinho.
Itens do carrinho SEMPRE pelo ID (I1, I2...). Se o cliente repetir um pedido que já está no carrinho sem
pedir mais unidades, NÃO gere comando.

TAMANHO: só um dos tamanhos cadastrados DAQUELE produto. Converta o jeito de falar: "broto/brotinho/pequena"
= o menor tamanho do produto; "média" = M/Média; "grande" = G/Grande; "família/gigante/extra grande" = o maior.
Se o tamanho dito não existe no produto, tamanho = null e tamanho_texto = o que ele disse.

ADICIONAIS: códigos A1, A2... listados NAQUELE produto. Borda recheada ("borda de catupiry") é adicional.
Adicional/borda que o produto não tem: adicionais_nao_encontrados = o texto dito. "Sem cebola", "borda fina",
"bem passada" são PREPARO: vão em observacoes, não em adicionais.

NÃO É PEDIDO: pergunta de preço/disponibilidade ("tem X?", "quanto é X?", "o que vem na X?") → intencao
duvida_geral e comandos vazio. Pechincha/desconto → duvida_geral.

DEMAIS CAMPOS (null quando ele não falou disso):
- tipo_entrega: delivery (entrega, "manda aqui") | retirada ("vou buscar", "retiro").
- endereco: rua, numero, bairro, referencia do que ele escreveu (campos vazios = null).
- forma_pagamento: pix | cartao | dinheiro. pagar_agora: true = agora pela conversa; false = na entrega/retirada.
- observacoes: só preparo/recado para a cozinha. "Só isso", "é isso", "nada mais" NÃO são observação.
  Troco ("troco pra 100") vai em observacoes.
- nota: avaliação 0 a 10. quer_cardapio: true se pediu o cardápio.
INTENÇÃO: saudacao | pedir_cardapio | adicionar_item | remover_item | informar_tamanho | informar_entrega_retirada |
informar_endereco | informar_pagamento | confirmar_resumo ("sim", "pode", "fechado", "só isso") | cancelar |
alterar_pedido (mudar endereço/pagamento de pedido JÁ feito) | avaliar | reclamar | falar_humano | duvida_geral |
conversa_fiada. confianca: 0 a 1."""


def montar_mensagens(
    cat: Catalogo, *, estado: dict[str, Any], estado_resumo: str, historico_texto: str, user_input: str,
) -> list[dict[str, str]]:
    # O catálogo vai no SYSTEM (prefixo estável por pizzaria → cache de prompt do provedor).
    sistema = f"{_REGRAS}\n\nCATÁLOGO DESTA PIZZARIA (código | nome | detalhes):\n{cat.texto_para_nlu()}"
    usuario = (
        f"ESTADO: {estado_resumo}\n\n"
        f"CARRINHO (use estes IDs):\n{carrinho_para_nlu(estado)}\n\n"
        f"HISTÓRICO RECENTE:\n{historico_texto or '(início da conversa)'}\n\n"
        f"ÚLTIMA MENSAGEM DO CLIENTE: {user_input}"
    )
    return [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]


# ============================================
# Conversão: comandos → formato do engine
# ============================================
def _int(v: Any) -> int | None:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n


def converter(bruto: dict[str, Any], cat: Catalogo, estado: dict[str, Any]) -> dict[str, Any]:
    """JSON da IA → {intencao, confianca, dados}. Tudo é revalidado aqui: código
    que não existe vira não encontrado; item do carrinho inexistente é ignorado."""
    intencao = str(bruto.get("intencao") or "duvida_geral")
    if intencao not in INTENCOES:
        intencao = "duvida_geral"
    try:
        confianca = max(0.0, min(float(bruto.get("confianca")), 1.0))
    except (TypeError, ValueError):
        confianca = 0.5

    codigos_ad = cat.codigos_adicionais()
    iids = {str(it.get("iid")) for it in (estado.get("carrinho") or []) if isinstance(it, dict)}

    def _ads(c: dict[str, Any]) -> list[str]:
        nomes = [codigos_ad[a] for a in (c.get("adicionais") or []) if a in codigos_ad]
        nomes += [str(x).strip() for x in (c.get("adicionais_nao_encontrados") or []) if str(x or "").strip()]
        return nomes

    def _tam(c: dict[str, Any]) -> str | None:
        t = c.get("tamanho")
        if t and t != "-":
            return str(t)
        tt = c.get("tamanho_texto")
        return str(tt).strip() if tt and str(tt).strip() else None

    produtos: list[dict[str, Any]] = []
    ops: list[dict[str, Any]] = []
    for c in bruto.get("comandos") or []:
        if not isinstance(c, dict):
            continue
        acao = c.get("acao")
        qtd = _int(c.get("qtd"))
        if acao == "adicionar":
            escolhidos = [cat.por_codigo(x) for x in (c.get("produtos") or []) if x != NAO_ENCONTRADO]
            escolhidos = [p for p in escolhidos if p is not None]
            base = {"qtd": max(1, qtd or 1), "tamanho": _tam(c), "adicionais": _ads(c)}
            if not escolhidos:
                texto = str(c.get("texto_cliente") or "").strip()
                if texto:
                    produtos.append({**base, "nome": texto, "sabores_meia": []})
                continue
            unicos = list({p.id: p for p in escolhidos}.values())
            if len(unicos) == 1:
                p = unicos[0]
                produtos.append({**base, "nome": p.nome, "produto_id": p.id, "sabores_meia": []})
            else:
                produtos.append({
                    **base, "nome": unicos[0].categoria or "pizza",
                    "sabores_meia": [p.nome for p in unicos], "sabores_ids": [p.id for p in unicos],
                })
        elif acao == "pedido_generico":
            categoria = c.get("categoria") if c.get("categoria") not in (None, "-") else None
            produtos.append({
                "nome": categoria or "pizza", "_generico": True, "qtd": max(1, qtd or 1),
                "tamanho": _tam(c), "sabores_meia": [],
            })
        elif acao in ACOES and c.get("item") in iids:
            ops.append({
                "op": acao, "iid": c["item"], "qtd": qtd, "tamanho": _tam(c), "adicionais": _ads(c),
            })

    dados: dict[str, Any] = {"produtos": produtos, "_ops_itens": ops, "_nlu": "comandos"}
    if bruto.get("tipo_entrega") in ("delivery", "retirada"):
        dados["tipo_entrega"] = bruto["tipo_entrega"]
    end = bruto.get("endereco")
    if isinstance(end, dict) and any(end.get(k) for k in ("rua", "numero", "bairro")):
        dados["endereco"] = {k: end.get(k) for k in ("rua", "numero", "bairro", "referencia")}
    if bruto.get("forma_pagamento") in ("pix", "cartao", "dinheiro"):
        dados["forma_pagamento"] = bruto["forma_pagamento"]
    if isinstance(bruto.get("pagar_agora"), bool):
        dados["pagar_agora"] = bruto["pagar_agora"]
    if bruto.get("quer_cardapio") is True:
        dados["quer_cardapio"] = True
    nota = _int(bruto.get("nota"))
    if nota is not None and 0 <= nota <= 10:
        dados["nota"] = nota
    if isinstance(bruto.get("observacoes"), str) and bruto["observacoes"].strip():
        dados["observacoes"] = bruto["observacoes"].strip()
    return {"intencao": intencao, "confianca": confianca, "dados": dados}


# ============================================
# Chamada
# ============================================
async def nlu_comandos(
    *,
    provider: str,
    api_key: str,
    model: str,
    cat: Catalogo,
    estado: dict[str, Any],
    estado_resumo: str,
    historico_texto: str,
    user_input: str,
    reasoning: str | None = None,
) -> dict[str, Any] | None:
    """Roda a NLU de comandos. Retorna o formato do engine, ou None em falha
    (o pipeline cai na NLU livre)."""
    if not cat.produtos:
        return None
    from app.agent.providers import openai_chat

    garantir_ids_itens(estado)
    iids = [str(it["iid"]) for it in estado.get("carrinho") or [] if isinstance(it, dict) and it.get("iid")]
    messages = montar_mensagens(
        cat, estado=estado, estado_resumo=estado_resumo, historico_texto=historico_texto, user_input=user_input,
    )
    chave = f"{provider}:{model}"
    formatos: list[dict[str, Any]] = []
    if chave not in _SEM_SCHEMA:
        formatos.append({
            "type": "json_schema",
            "json_schema": {"name": "comandos_pedido", "strict": True, "schema": montar_schema(cat, iids)},
        })
    formatos.append({"type": "json_object"})

    for fmt in formatos:
        try:
            res = await openai_chat(
                provider=provider, api_key=api_key, model=model, messages=messages,
                temperature=0.0, max_tokens=1500, reasoning=reasoning, response_format=fmt,
            )
        except Exception as e:  # noqa: BLE001
            if fmt["type"] == "json_schema":
                log.info("NLU comandos: %s recusou json_schema, seguindo com json_object: %s", chave, str(e)[:200])
                _SEM_SCHEMA.add(chave)
                continue
            log.warning("NLU comandos falhou (%s): %s", chave, str(e)[:200])
            return None
        bruto = _extrair_json(res.get("content") or "")
        if not isinstance(bruto, dict):
            log.warning("NLU comandos: resposta sem JSON válido (%s)", chave)
            continue
        out = converter(bruto, cat, estado)
        out["_usage"] = res.get("usage") or {}
        out["_modo"] = fmt["type"]
        return out
    return None


def resumo_para_trace(res: dict[str, Any] | None) -> str:
    """Texto curto dos comandos aplicados (para o trace do playground)."""
    if not res:
        return ""
    d = res.get("dados") or {}
    return json.dumps(
        {"produtos": d.get("produtos"), "ops": d.get("_ops_itens")}, ensure_ascii=False, default=str,
    )[:600]


__all__ = [
    "ACOES", "NAO_ENCONTRADO", "carrinho_para_nlu", "converter", "garantir_ids_itens",
    "montar_schema", "nlu_comandos", "normalizar",
]
