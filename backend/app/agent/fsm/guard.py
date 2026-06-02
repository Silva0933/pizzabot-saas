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
        val = _parse_valor(re.sub(r"[^\d.,]", "", raw.replace("R$", "")))
        if val is not None and any(abs(val - s) < 0.01 for s in suspeitos):
            removidos.append(val)
            return _MARCADOR
        return raw

    novo = _PRICE_TOKEN_RE.sub(_rep, texto)
    novo = re.sub(r"[ \t]{2,}", " ", novo).strip()
    return novo, removidos


def blindar(texto: str, *, ja_apresentou: bool, precos_validos: Any) -> tuple[str, dict[str, Any]]:
    """Aplica todas as correções determinísticas. Retorna (texto, correcoes).

    `correcoes` traz o que foi mexido (pra alerta/observabilidade):
      {"saudacao_removida": bool, "precos_neutralizados": [floats]}
    """
    correcoes: dict[str, Any] = {}
    texto, removeu_saud = strip_saudacao(texto, ja_apresentou)
    if removeu_saud:
        correcoes["saudacao_removida"] = True
    texto, precos = neutralizar_precos(texto, precos_validos)
    if precos:
        correcoes["precos_neutralizados"] = precos
    return texto, correcoes
