"""
Camada 3 — Voz: transforma a DECISÃO do backend numa resposta humanizada.

A LLM aqui NÃO decide nada de negócio: ela só "fala" com a persona da pizzaria o
que o sistema já calculou, e faz a próxima pergunta do funil. Recebe um comando
direto e responde curto. Pode usar [QUEBRA] para separar balões.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

QUEBRA = "[QUEBRA]"


def _persona_linha(personalidade) -> str:
    nome = getattr(personalidade, "nome", None) or "Camila"
    estilo = getattr(personalidade, "estilo", None) or "casual"
    return f"Você é {nome}, atendente da pizzaria (estilo {estilo}). Fale como gente de verdade no WhatsApp, curto e natural."


def montar_comando(*, personalidade, pizzaria_nome: str, decisao: dict[str, Any], ja_apresentou: bool) -> str:
    fatos = "\n".join(f"- {f}" for f in (decisao.get("fatos") or [])) or "- (nada novo)"
    dados = decisao.get("dados") or {}
    resumo = ""
    if dados:
        linhas = []
        if dados.get("itens"):
            linhas += dados["itens"]
        if dados.get("taxa_entrega"):
            linhas.append(f"Entrega: R$ {dados['taxa_entrega']:.2f}")
        if dados.get("total") is not None:
            linhas.append(f"Total: R$ {dados['total']:.2f}")
        if dados.get("numero_pedido"):
            linhas.append(f"Pedido #{dados['numero_pedido']} · {dados.get('tempo_estimado','')}")
        resumo = "DADOS CALCULADOS PELO SISTEMA (use exatamente, não invente):\n" + "\n".join(linhas)

    apres = (
        "É a PRIMEIRA mensagem: apresente-se uma vez (nome + pizzaria) e cumprimente."
        if not ja_apresentou else
        "JÁ cumprimentou antes: NÃO repita saudação nem o nome; vá direto ao ponto."
    )

    return (
        f"{_persona_linha(personalidade)} Pizzaria: {pizzaria_nome}.\n"
        f"{apres}\n\n"
        f"O QUE O SISTEMA FEZ/SABE AGORA:\n{fatos}\n\n"
        f"{resumo}\n\n"
        f"SUA TAREFA: {decisao.get('proxima_pergunta') or 'Responda de forma útil e siga o atendimento.'}\n\n"
        "REGRAS: nunca invente preço/sabor/taxa (use só os dados acima); não repita bordões fixos "
        "('Perfeito!', 'Show!') a cada msg; máximo 2 frases curtas. Se quiser quebrar em 2 balões, "
        f"separe com {QUEBRA}. Responda só a mensagem final ao cliente, nada de explicações."
    )


async def gerar_voz(
    *,
    provider: str,
    api_key: str,
    model: str,
    comando: str,
) -> str:
    from app.agent.providers import openai_chat
    try:
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=[{"role": "user", "content": comando}],
            temperature=0.6, max_tokens=300,
        )
        txt = (res.get("content") or "").strip()
        return txt
    except Exception as e:  # noqa: BLE001
        log.warning("Voz FSM falhou: %s", e)
        return ""
