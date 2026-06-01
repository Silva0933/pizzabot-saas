"""
Camada 1 — NLU: extrai INTENÇÃO + ENTIDADES da mensagem do cliente em JSON.

A LLM aqui NÃO conversa e NÃO usa ferramentas — só interpreta. Isso é barato,
rápido e funciona bem até em modelos sem tool-calling (ex.: Gemma). O histórico
passado é enxuto (texto puro). Saída sempre JSON; em falha, vira 'duvida_geral'.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

log = logging.getLogger(__name__)

INTENCOES = (
    "saudacao", "pedir_cardapio", "adicionar_item", "remover_item", "informar_tamanho",
    "informar_entrega_retirada", "informar_endereco", "informar_pagamento",
    "confirmar_resumo", "cancelar", "alterar_pedido", "avaliar", "reclamar",
    "falar_humano", "duvida_geral", "conversa_fiada",
)

_SYSTEM = (
    "Você é um EXTRATOR de intenção e dados de um atendimento de pizzaria no WhatsApp. "
    "NÃO responda ao cliente, NÃO converse: apenas analise a ÚLTIMA mensagem dele (no contexto "
    "do estado atual) e devolva SOMENTE um JSON válido, sem texto antes ou depois, com este formato:\n"
    "{\n"
    '  "intencao": uma de ' + str(list(INTENCOES)) + ",\n"
    '  "confianca_intencao": number 0..1,\n'
    '  "dados_extraidos": {\n'
    '    "produtos": [{"nome": str, "qtd": int, "tamanho": str|null, "sabores_meia": [str], "adicionais": [str]}],\n'
    '    "remover": [str],\n'
    '    "tipo_entrega": "delivery"|"retirada"|null,\n'
    '    "endereco": {"rua": str|null, "numero": str|null, "bairro": str|null, "referencia": str|null}|null,\n'
    '    "forma_pagamento": "pix"|"cartao"|"dinheiro"|null,\n'
    '    "pagar_agora": true|false|null,\n'
    '    "quer_cardapio": true|false,\n'
    '    "nota": int 0..10|null,\n'
    '    "observacoes": str|null\n'
    "  }\n"
    "}\n"
    "Regras: só preencha o que o cliente DISSE; o que ele não falou fica null/vazio. "
    "Nunca invente preço, sabor ou taxa (isso é com o sistema). Se o cliente pedir alteração de ingredientes, "
    "remoção de itens de preparo (ex.: 'sem cebola', 'borda fina', 'com gelo'), preencha o campo 'observacoes'. "
    "Se ele só confirma (ex.: 'sim', 'pode', 'isso', 'fechado'), use intencao 'confirmar_resumo'. Se for só bate-papo, 'conversa_fiada'. "
    "Se ele reclamar (pizza fria/atrasada/errada) use 'reclamar'; se pedir pra falar com atendente/humano "
    "use 'falar_humano'; se der uma nota/avaliação (0-10) use 'avaliar' e preencha 'nota'; se quiser MUDAR "
    "endereço/forma de pagamento de um pedido já feito use 'alterar_pedido'."
)


def _extrair_json(texto: str) -> dict[str, Any] | None:
    if not texto:
        return None
    # remove cercas de código se vierem
    texto = re.sub(r"^```[a-z]*\n?|```$", "", texto.strip(), flags=re.IGNORECASE | re.MULTILINE)
    # tenta o primeiro objeto {...} balanceado
    inicio = texto.find("{")
    if inicio < 0:
        return None
    profundidade = 0
    for i in range(inicio, len(texto)):
        if texto[i] == "{":
            profundidade += 1
        elif texto[i] == "}":
            profundidade -= 1
            if profundidade == 0:
                try:
                    return json.loads(texto[inicio:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _normalizar_saida(d: dict[str, Any]) -> dict[str, Any]:
    intencao = str(d.get("intencao") or "duvida_geral")
    if intencao not in INTENCOES:
        intencao = "duvida_geral"
    try:
        conf = float(d.get("confianca_intencao"))
    except (TypeError, ValueError):
        conf = 0.5
    dados = d.get("dados_extraidos") or {}
    if not isinstance(dados, dict):
        dados = {}
    return {"intencao": intencao, "confianca": max(0.0, min(conf, 1.0)), "dados": dados}


async def nlu_extract(
    *,
    provider: str,
    api_key: str,
    model: str,
    estado_resumo: str,
    historico_texto: str,
    user_input: str,
) -> dict[str, Any]:
    """Roda a extração NLU. Retorna {intencao, confianca, dados}. Nunca lança."""
    from app.agent.providers import openai_chat

    contexto = (
        f"ESTADO ATUAL DO ATENDIMENTO:\n{estado_resumo}\n\n"
        f"HISTÓRICO RECENTE:\n{historico_texto or '(início da conversa)'}\n\n"
        f"ÚLTIMA MENSAGEM DO CLIENTE: {user_input}"
    )
    try:
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": contexto},
            ],
            temperature=0.0,
            max_tokens=600,
            response_format={"type": "json_object"},
        )
        usage = res.get("usage") or {}
        parsed = _extrair_json(res.get("content") or "")
        if parsed:
            out = _normalizar_saida(parsed)
            out["_usage"] = usage
            return out
        return {"intencao": "duvida_geral", "confianca": 0.0, "dados": {}, "_usage": usage}
    except Exception as e:  # noqa: BLE001
        log.warning("NLU falhou (caindo p/ duvida_geral): %s", e)
    return {"intencao": "duvida_geral", "confianca": 0.0, "dados": {}, "_usage": {}}
