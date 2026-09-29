"""
Qualidade do cardápio: erros de cadastro que a atendente repete para o cliente.

Caso real (Palazio, 25/09): a descrição da "Fanta 1L" era "Uma Coca-Cola de 2 l"
(copiada da Coca). A IA lia a descrição e oferecia uma Coca 2L que estava
desligada — o cliente ouviu "não temos" e depois "também há Coca 2L". Nada no
sistema avisava a loja. Aqui o diagnóstico da atendente aponta:

  - produto disponível sem preço (ou com tamanho de preço zero);
  - descrição que cita OUTRO produto do cardápio pelo nome.
"""
from __future__ import annotations

import re
from typing import Any

from app.agent.fsm.catalogo import normalizar

_PREFIXO_CATEGORIA_RE = re.compile(r"^(pizza|lanche|hamburguer|burger|bebida|sobremesa)\s+(de\s+)?", re.IGNORECASE)


def _precos(p: Any) -> list[float]:
    rel = getattr(p, "tamanhos_rel", None)
    if rel:
        return [float(t.preco or 0) for t in rel if getattr(t, "disponivel", True)]
    brutos = getattr(p, "tamanhos", None) or []
    tams = [float(t.get("preco") or 0) for t in brutos if isinstance(t, dict)]
    return tams or [float(getattr(p, "preco", 0) or 0)]


_VOLUME_RE = re.compile(r"\b\d+([.,]\d+)?\s*(l|ml|lt|litros?|g|kg|cm)?\b")


def _nome_distintivo(nome: str) -> str:
    """"Pizza Calabresa" → "calabresa"; "Coca-Cola 2L" → "coca cola" (sem volume:
    a descrição copiada dizia "Coca-Cola de 2 l", não "2L")."""
    base = normalizar(_PREFIXO_CATEGORIA_RE.sub("", nome or "")).replace("-", " ")
    return re.sub(r"\s+", " ", _VOLUME_RE.sub(" ", base)).strip()


def problemas_cardapio(produtos: list[Any]) -> list[str]:
    """Frases prontas para o painel, uma por problema (produtos disponíveis)."""
    disp = [p for p in produtos if getattr(p, "disponivel", True)]
    problemas: list[str] = []
    for p in disp:
        precos = _precos(p)
        if not precos or any(v <= 0 for v in precos):
            problemas.append(f"'{p.nome}' está disponível sem preço (ou com um tamanho de preço zero).")

    todos = [(p, _nome_distintivo(p.nome)) for p in produtos if getattr(p, "nome", None)]
    for p in disp:
        desc = normalizar(getattr(p, "descricao", None) or "").replace("-", " ")
        if not desc:
            continue
        proprio = _nome_distintivo(p.nome)
        for outro, chave in todos:
            if outro is p or len(chave) < 5 or chave in proprio or proprio in chave:
                continue
            if re.search(rf"(?<![a-z0-9]){re.escape(chave)}(?![a-z0-9])", desc):
                problemas.append(
                    f"A descrição de '{p.nome}' cita '{outro.nome}' — a atendente repete isso "
                    "para o cliente. Confira se não foi copiada de outro produto."
                )
                break
    return problemas
