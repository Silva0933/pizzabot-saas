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


def montar_comando(*, personalidade, pizzaria_nome: str, decisao: dict[str, Any], ja_apresentou: bool, user_input: str = "") -> str:
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
        f"MENSAGEM DO CLIENTE AGORA: \"{(user_input or '').strip()[:300]}\"\n\n"
        f"O QUE O SISTEMA FEZ/SABE AGORA:\n{fatos}\n\n"
        f"{resumo}\n\n"
        f"SUA TAREFA: {decisao.get('proxima_pergunta') or 'Responda de forma útil e siga o atendimento.'} "
        "Responda DE VERDADE ao que o cliente falou acima (não ignore a pergunta dele).\n\n"
        "REGRAS: responda em UMA mensagem curta (1 frase, no máximo 2). NÃO faça a mesma pergunta "
        "duas vezes nem repita o total a cada passo (só cite valores quando for o resumo/fechamento). "
        "Nunca invente preço/sabor/taxa (use só os dados acima). Não repita bordões fixos "
        "('Perfeito!', 'Show!'). VOCÊ é a atendente: nunca diga que VOCÊ 'deu uma olhada', "
        "'escolheu' ou 'decidiu' algo pelo cliente — quem decide é ele. "
        f"Use {QUEBRA} SÓ se forem conteúdos diferentes (ex.: resumo + pergunta) "
        "— nunca pra repetir a mesma ideia. Responda só a mensagem final ao cliente."
    )


async def gerar_voz(
    *,
    provider: str,
    api_key: str,
    model: str,
    comando: str,
) -> tuple[str, dict]:
    """Retorna (texto, usage)."""
    from app.agent.providers import openai_chat
    try:
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=[{"role": "user", "content": comando}],
            temperature=0.6, max_tokens=300,
        )
        return (res.get("content") or "").strip(), (res.get("usage") or {})
    except Exception as e:  # noqa: BLE001
        log.warning("Voz FSM falhou: %s", e)
        return "", {}
