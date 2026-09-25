"""
Validador de invariantes do pedido — a porta que todo pedido atravessa antes do
resumo e antes de ser registrado (camada 3 da blindagem).

Por que existe: as regras de "o que é um pedido válido" estavam espalhadas
(cálculo por nome no agente, outras no cardápio digital) e o pedido era montado
e cobrado sem uma conferência final. Aqui, com o catálogo da pizzaria
(catalogo.py) como fonte única, cada item e o pedido inteiro são conferidos:

  - todo item está ligado a um produto do catálogo (produto_id/sabores_ids);
  - produto disponível, tamanho cadastrado, meio a meio permitido, adicional
    que pertence ao produto (catalogo.precificar — a mesma regra do checkout
    do cardápio digital);
  - quantidade entre 1 e o teto;
  - o preço cobrado de cada item é o do catálogo (ou o congelado no turno em
    que o cliente viu o valor, se o cardápio não mudou desde então);
  - total = soma dos itens + taxa; entrega exige endereço; pagamento definido.

Violação NUNCA vira pedido: o engine pergunta ao cliente o que falta e, se a
mesma conversa travar de novo, passa para a equipe.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.agent.fsm.catalogo import Catalogo, ErroItem, normalizar

QTD_MAXIMA = 50


@dataclass
class Violacao:
    codigo: str          # item_sem_catalogo | item_invalido | qtd_invalida | preco_divergente | total_divergente | sem_endereco | sem_pagamento
    mensagem: str        # para o fato da voz / log
    iid: str | None = None


def _ids(it: dict[str, Any]) -> list[str]:
    return [str(x) for x in (it.get("sabores_ids") or []) if x] or (
        [str(it["produto_id"])] if it.get("produto_id") else []
    )


def _nome_base(nome: str) -> str:
    """"Pizza Calabresa (G) + Queijo extra" → "Pizza Calabresa"."""
    base = (nome or "").split(" + ")[0]
    return re.sub(r"\s*\([^)]*\)\s*$", "", base).strip()


def _achar_por_nome(cat: Catalogo, nome: str | None) -> str | None:
    """ID do produto cujo nome (ou apelido) é EXATAMENTE `nome` — sem aproximação."""
    alvo = normalizar(_nome_base(nome or ""))
    if not alvo:
        return None
    for p in cat.produtos:
        if normalizar(p.nome) == alvo or alvo in {normalizar(a) for a in p.aliases}:
            return p.id
    return None


def vincular_catalogo(cat: Catalogo, estado: dict[str, Any]) -> None:
    """Liga ao catálogo os itens que entraram por NOME (o "de sempre", a sugestão
    aceita, a NLU livre de reserva), só por nome EXATO do cadastro — inclusive o
    nome já resolvido pelo cálculo (nome_congelado)."""
    for it in estado.get("carrinho") or []:
        if not isinstance(it, dict) or _ids(it):
            continue
        sabores = [s for s in (it.get("sabores") or []) if s]
        if sabores:
            ids = [_achar_por_nome(cat, s) for s in sabores]
            if all(ids):
                it["sabores_ids"] = ids
            continue
        pid = _achar_por_nome(cat, it.get("nome")) or _achar_por_nome(cat, it.get("nome_congelado"))
        if pid:
            it["produto_id"] = pid


def validar_pedido(
    cat: Catalogo,
    estado: dict[str, Any],
    calc: dict[str, Any] | None,
    *,
    exigir_entrega_pagamento: bool = True,
) -> list[Violacao]:
    """Confere o pedido inteiro. Lista vazia = pode mostrar resumo/registrar."""
    violacoes: list[Violacao] = []
    carrinho = [it for it in (estado.get("carrinho") or []) if isinstance(it, dict)]
    itens_calc = (calc or {}).get("itens") or []
    if not carrinho:
        return [Violacao("item_invalido", "O pedido está sem itens.")]

    soma = Decimal("0")
    for i, it in enumerate(carrinho):
        iid = it.get("iid")
        nome = it.get("nome_congelado") or it.get("nome") or " / ".join(it.get("sabores") or [])
        ids = _ids(it)
        if not ids:
            violacoes.append(Violacao("item_sem_catalogo", f"'{nome}' não corresponde a um produto do cardápio.", iid))
            continue
        try:
            qtd = int(it.get("qtd") or 1)
        except (TypeError, ValueError):
            qtd = 0
        if not 1 <= qtd <= QTD_MAXIMA:
            violacoes.append(Violacao("qtd_invalida", f"Quantidade inválida para '{nome}': {it.get('qtd')}.", iid))
            continue
        try:
            pi = cat.precificar(ids, it.get("tamanho"), [str(a) for a in (it.get("adicionais") or [])])
        except ErroItem as e:
            violacoes.append(Violacao("item_invalido", f"'{nome}': {e}", iid))
            continue
        cobrado = None
        if i < len(itens_calc) and isinstance(itens_calc[i], dict):
            try:
                cobrado = Decimal(str(itens_calc[i].get("preco_unit"))).quantize(Decimal("0.01"))
            except Exception:  # noqa: BLE001
                cobrado = None
        if cobrado is None or cobrado != pi.preco_unit:
            violacoes.append(Violacao(
                "preco_divergente",
                f"Preço de '{pi.nome}' no pedido ({cobrado}) difere do cardápio ({pi.preco_unit}).", iid,
            ))
            continue
        soma += cobrado * qtd

    if calc and not any(v.codigo in ("item_sem_catalogo", "item_invalido", "qtd_invalida", "preco_divergente") for v in violacoes):
        taxa = Decimal(str(calc.get("taxa_entrega") or 0))
        total = Decimal(str(calc.get("valor_total") or 0))
        desconto = Decimal(str(calc.get("desconto") or 0))
        if abs((soma + taxa - desconto) - total) > Decimal("0.01"):
            violacoes.append(Violacao("total_divergente", f"Total {total} ≠ itens {soma} + taxa {taxa}."))

    if exigir_entrega_pagamento:
        if estado.get("tipo") == "delivery" and not estado.get("endereco"):
            violacoes.append(Violacao("sem_endereco", "Entrega sem endereço."))
        if not estado.get("pagamento"):
            violacoes.append(Violacao("sem_pagamento", "Forma de pagamento não definida."))
    return violacoes


def iids_com_preco_divergente(violacoes: list[Violacao]) -> set[str]:
    return {v.iid for v in violacoes if v.codigo == "preco_divergente" and v.iid}
