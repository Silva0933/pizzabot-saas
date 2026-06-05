"""
Camada 3 — Voz: transforma a DECISÃO do backend numa resposta humanizada.

A LLM aqui NÃO decide nada de negócio: ela só "fala" com a persona da pizzaria o
que o sistema já calculou, e faz a próxima pergunta do funil. Recebe um comando
direto e responde curto. Pode usar [QUEBRA] para separar balões.
"""
from __future__ import annotations

import logging
import re
from typing import Any

log = logging.getLogger(__name__)

QUEBRA = "[QUEBRA]"

# Uma resposta "completa" termina em pontuação final, fecha-parênteses/aspas, OU
# num emoji/símbolo (≥ 0x2190 cobre setas e emojis). Caso contrário, provavelmente
# o modelo cortou no meio (ex.: "Beleza! Mais", "Ok, só a") — aí refazemos.
_FIM_OK = re.compile(r"""[.!?…)\]"']\s*$""")


def _parece_truncado(texto: str) -> bool:
    t = (texto or "").strip()
    if not t:
        return True
    # remove o marcador de quebra do fim antes de avaliar
    t = t.replace(QUEBRA, " ").strip()
    if not t:
        return True
    if _FIM_OK.search(t):
        return False
    if ord(t[-1]) >= 0x2190:  # emoji / símbolo no fim → ok
        return False
    return True


# Pontuação final de frase (pra "salvar" um texto truncado cortando no último ponto).
_FIM_FRASE = re.compile(r"[.!?…][\"')\]]?(?=\s|$)")


def _salvar_truncado(texto: str) -> str:
    """Última linha de defesa: se o texto está truncado, corta de volta até a
    ÚLTIMA frase completa. Se não houver nenhuma, devolve "" — melhor mandar nada
    (o pipeline manda um 'pode repetir?' seguro) do que um fragmento sem sentido."""
    t = (texto or "").replace(QUEBRA, " ").strip()
    if not t:
        return ""
    matches = list(_FIM_FRASE.finditer(t))
    if matches:
        return t[: matches[-1].end()].strip()
    return ""


def _persona_linha(personalidade) -> str:
    nome = getattr(personalidade, "nome", None) or "Camila"
    estilo = getattr(personalidade, "estilo", None) or "casual"
    return f"Você é {nome}, atendente da pizzaria (estilo {estilo}). Fale como gente de verdade no WhatsApp, curto e natural."


def montar_comando(*, personalidade, pizzaria_nome: str, decisao: dict[str, Any], ja_apresentou: bool, user_input: str = "") -> str:
    nome_atendente = getattr(personalidade, "nome", None) or "Camila"
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
        if dados.get("observacoes"):
            linhas.append(f"Observações: {dados['observacoes']}")
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
        "duas vezes. NUNCA dê a entender que o pedido está fechado, confirmado ou pronto antes de o "
        "cliente confirmar — NÃO diga 'é só vir buscar', 'pode retirar', 'pedido fechado' nem 'qualquer "
        "coisa é só chamar' enquanto o pedido não foi confirmado. NUNCA cite preço, total ou taxa em "
        "NENHUM valor (R$) — quem mostra os valores ao cliente é o SISTEMA, não você. Nunca invente "
        "preço/sabor/taxa. Não repita bordões fixos "
        "('Perfeito!', 'Show!'). VOCÊ é a atendente: nunca diga que VOCÊ 'deu uma olhada', "
        "'escolheu' ou 'decidiu' algo pelo cliente — quem decide é ele. "
        f"SEU nome é {nome_atendente}: NUNCA chame o cliente pelo seu nome nem coloque "
        f"'{nome_atendente}' no meio da resposta (ex.: 'não temos, {nome_atendente}') — "
        "seu nome só aparece na saudação inicial. "
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
    """Retorna (texto, usage). Refaz UMA vez se a 1ª resposta vier truncada."""
    from app.agent.providers import openai_chat
    try:
        # max_tokens FOLGADO de propósito: modelos "thinking" (ex.: gemini-2.5-flash-lite)
        # gastam tokens pensando ANTES do texto visível. Com teto baixo (300) a resposta
        # saía cortada no meio quase sempre. max_tokens é só um TETO — resposta curta não
        # gasta mais; só evita o corte.
        res = await openai_chat(
            provider=provider, api_key=api_key, model=model,
            messages=[{"role": "user", "content": comando}],
            temperature=0.6, max_tokens=1200,
        )
        texto = (res.get("content") or "").strip()
        usage = res.get("usage") or {}

        # Se mesmo assim vier truncada, refaz UMA vez com mais espaço e um empurrão
        # pra completar a frase.
        if _parece_truncado(texto):
            log.warning("Voz FSM veio truncada (%r) — refazendo", texto[:60])
            res2 = await openai_chat(
                provider=provider, api_key=api_key, model=model,
                messages=[{
                    "role": "user",
                    "content": comando + "\n\nIMPORTANTE: responda a frase COMPLETA, terminando o pensamento (não corte no meio). Seja breve.",
                }],
                temperature=0.4, max_tokens=2048,
            )
            texto2 = (res2.get("content") or "").strip()
            u2 = res2.get("usage") or {}
            for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                usage[k] = int(usage.get(k, 0) or 0) + int(u2.get(k, 0) or 0)

            # Escolhe a melhor: prioriza uma resposta COMPLETA (retry primeiro).
            completas = [c for c in (texto2, texto) if c and not _parece_truncado(c)]
            if completas:
                texto = completas[0]
            else:
                # Nenhuma completa → NUNCA envia o fragmento. Salva a mais longa
                # cortando na última frase fechada; se não der, devolve "" (o
                # pipeline manda um 'pode repetir?' seguro).
                candidatas = [c for c in (texto2, texto) if c]
                base = max(candidatas, key=len) if candidatas else ""
                salvo = _salvar_truncado(base)
                log.warning("Voz FSM truncada nas 2 tentativas — salvando: %r", salvo[:60])
                texto = salvo

        return texto, usage
    except Exception as e:  # noqa: BLE001
        log.warning("Voz FSM falhou: %s", e)
        return "", {}
