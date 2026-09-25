"""
Guard-rail pós-geração (BLINDAGEM — Pilar 3).

Rede de segurança DETERMINÍSTICA que revisa o texto gerado pela voz ANTES de
enviar ao cliente. A LLM pode desobedecer instruções (ex.: cumprimentar de novo)
ou alucinar um preço — aqui o backend corrige isso sem depender do modelo:

  1. strip_saudacao    — remove "Olá/Oi/Bom dia..." se a atendente já cumprimentou.
  2. neutralizar_precos — troca qualquer valor R$ SEM LASTRO (que não bate com o
                          que o backend calculou) por um marcador neutro, pra que
                          NUNCA chegue um preço errado ao cliente.

Tudo puro/síncrono e sem efeitos colaterais — fácil de testar.
"""
from __future__ import annotations

import re
from typing import Any

from app.services.price_check import _parse_valor, precos_sem_lastro

# Saudações comuns no começo da mensagem (com pontuação/emojis logo após).
_SAUDACAO_RE = re.compile(
    r"^[\s\W]*(ol[áa]|oi+|e a[íi]|opa|opaa+|fala|fala a[íi]|hey|hello|al[ôo]|"
    r"bom dia|boa tarde|boa noite|bom diaa+)\b[\s,!.…–-]*",
    re.IGNORECASE,
)

# Token monetário (mesmo formato do price_check).
_PRICE_TOKEN_RE = re.compile(
    r"R\$\s*\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?", re.IGNORECASE
)

_MARCADOR = "(valor a confirmar)"


def strip_saudacao(texto: str, ja_apresentou: bool) -> tuple[str, bool]:
    """Remove a saudação inicial se a atendente JÁ cumprimentou antes.

    Retorna (texto_corrigido, removeu?). Recapitaliza a 1ª letra restante.
    """
    if not texto or not ja_apresentou:
        return texto, False
    novo = _SAUDACAO_RE.sub("", texto, count=1)
    if novo == texto:
        return texto, False
    novo = novo.lstrip()
    if not novo:
        # A mensagem era só a saudação — não apaga tudo, mantém o original.
        return texto, False
    novo = novo[0].upper() + novo[1:]
    return novo, True


def strip_nome_proprio(texto: str, persona_nome: str | None, ja_apresentou: bool) -> tuple[str, bool]:
    """Remove o nome da PRÓPRIA atendente quando ela o usa como vocativo dirigido ao
    cliente (ex.: 'guaraná não temos, Camila.'). Ela é a Camila — não pode chamar o
    cliente assim. Só age DEPOIS da apresentação; na saudação ('Sou a Camila') o nome
    é legítimo. Retorna (texto, removeu?)."""
    if not texto or not persona_nome or not ja_apresentou:
        return texto, False
    nome = re.escape(persona_nome.strip())
    if not nome:
        return texto, False
    original = texto
    # Vocativo no meio/fim: "..., Camila"
    texto = re.sub(rf",\s*{nome}\b", "", texto, flags=re.IGNORECASE)
    # Vocativo no início de oração: "Camila, ..."
    texto = re.sub(rf"(^|[.!?…]\s+){nome}\s*,\s*", r"\1", texto, flags=re.IGNORECASE)
    # Limpa espaço duplo e espaço antes de pontuação
    texto = re.sub(r"\s{2,}", " ", texto)
    texto = re.sub(r"\s+([.!?,])", r"\1", texto).strip()
    if texto and texto[0].islower():
        texto = texto[0].upper() + texto[1:]
    return (texto, True) if (texto and texto != original) else (original, False)


def neutralizar_precos(texto: str, validos: Any) -> tuple[str, list[float]]:
    """Troca por marcador neutro todo valor R$ citado que NÃO tem lastro no que o
    backend calculou (lista/conjunto `validos`). Retorna (texto, [removidos]).

    Se nenhum valor for inválido, devolve o texto intacto.
    """
    if not texto:
        return texto, []
    validos_set = {round(float(v), 2) for v in (validos or []) if isinstance(v, (int, float)) and not isinstance(v, bool)}
    suspeitos = set(precos_sem_lastro(texto, validos_set))
    if not suspeitos:
        return texto, []

    removidos: list[float] = []

    def _rep(m: re.Match) -> str:
        raw = m.group(0)
        # "Troco para R$ 100" é o dinheiro do cliente, não preço de item: sem
        # lastro no cálculo por natureza, e apagá-lo deixava "troco para (valor
        # a confirmar)" — o entregador sairia sem saber quanto levar.
        if "troco" in texto[max(0, m.start() - 30):m.start()].lower():
            return raw
        val = _parse_valor(re.sub(r"[^\d.,]", "", raw.replace("R$", "")))
        if val is not None and any(abs(val - s) < 0.01 for s in suspeitos):
            removidos.append(val)
            return _MARCADOR
        return raw

    novo = _PRICE_TOKEN_RE.sub(_rep, texto)
    novo = re.sub(r"[ \t]{2,}", " ", novo).strip()
    return novo, removidos


def blindar(texto: str, *, ja_apresentou: bool, precos_validos: Any,
            persona_nome: str | None = None) -> tuple[str, dict[str, Any]]:
    """Aplica todas as correções determinísticas. Retorna (texto, correcoes).

    `correcoes` traz o que foi mexido (pra alerta/observabilidade):
      {"saudacao_removida": bool, "nome_proprio_removido": bool,
       "precos_neutralizados": [floats]}
    """
    correcoes: dict[str, Any] = {}
    texto, removeu_saud = strip_saudacao(texto, ja_apresentou)
    if removeu_saud:
        correcoes["saudacao_removida"] = True
    texto, removeu_nome = strip_nome_proprio(texto, persona_nome, ja_apresentou)
    if removeu_nome:
        correcoes["nome_proprio_removido"] = True
    texto, precos = neutralizar_precos(texto, precos_validos)
    if precos:
        correcoes["precos_neutralizados"] = precos
    return texto, correcoes


# ============================================
# Pilar 3b — produto citado sem lastro (camada 4 da blindagem)
# ============================================
_PREFIXO_CATEGORIA_RE = re.compile(r"^(pizza|lanche|hamburguer|burger|bebida|sobremesa)\s+(de\s+)?", re.IGNORECASE)


def _norm(s: Any) -> str:
    import unicodedata
    base = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in base if unicodedata.category(c) != "Mn")).strip()


def _chaves_produto(nome: str) -> list[str]:
    """Formas de citar o produto no texto: o nome inteiro e, sem o prefixo de
    categoria ("Pizza Brasa" → "brasa"), o nome distintivo (só se não for curto
    demais para evitar falso alarme)."""
    cheio = _norm(nome)
    curto = _norm(_PREFIXO_CATEGORIA_RE.sub("", nome))
    chaves = [cheio]
    if curto and curto != cheio and len(curto) >= 5:
        chaves.append(curto)
    return chaves


def _cita(texto_norm: str, chave: str) -> bool:
    return bool(re.search(r"(?<![a-z0-9])" + re.escape(chave) + r"(?![a-z0-9])", texto_norm))


def produtos_sem_lastro(texto: str, nomes_catalogo: list[str], contexto: str) -> list[str]:
    """Produtos do cardápio que a voz citou mas que NÃO estão no contexto do
    turno (carrinho, confirmação, fatos, opções oferecidas). A voz não pode
    oferecer ou afirmar sobre produto que o sistema não trouxe — era assim que
    ela respondia a pechincha com o preço da calabresa."""
    t = _norm(texto)
    ctx = _norm(contexto)
    fora: list[str] = []
    for nome in nomes_catalogo:
        chaves = _chaves_produto(nome)
        if any(_cita(t, c) for c in chaves) and not any(_cita(ctx, c) for c in chaves):
            fora.append(nome)
    return fora
