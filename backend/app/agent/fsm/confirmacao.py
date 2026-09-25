"""
Confirmação do que mudou no carrinho — texto do SISTEMA, não da IA (camada 4).

Por que existe: a voz redigia "Anotei 1 Cheese Clássico" com o carrinho em 3,
"três smash duplos" com o carrinho em 2, "Você quer retirar a Coca?" depois de
já ter tirado. Aqui a confirmação sai do carrinho REAL, comparando o antes e o
depois do turno pelo ID do item: a IA fica só com a próxima pergunta.
"""
from __future__ import annotations

from typing import Any


def rotulo(it: dict[str, Any]) -> str:
    """Nome de exibição do item: o resolvido pelo cálculo quando existe."""
    if it.get("nome_congelado"):
        return str(it["nome_congelado"])
    if it.get("sabores"):
        nome = "Meia " + " / Meia ".join(map(str, it["sabores"]))
    else:
        nome = str(it.get("nome") or "item")
    if it.get("tamanho"):
        nome += f" ({it['tamanho']})"
    if it.get("adicionais"):
        nome += " + " + " + ".join(map(str, it["adicionais"]))
    return nome


def _por_iid(itens: list[Any]) -> dict[str, dict[str, Any]]:
    return {str(it["iid"]): it for it in itens or [] if isinstance(it, dict) and it.get("iid")}


def confirmacao_do_turno(antes: list[Any], depois: list[Any]) -> str | None:
    """"Anotei: 2x Pizza Brasa (G) · Tirei: Coca-Cola 2L" — ou None se o
    carrinho não mudou. Itens sem ID (estado antigo) não entram na comparação."""
    a, d = _por_iid(antes), _por_iid(depois)
    anotados: list[str] = []
    ajustados: list[str] = []
    tirados: list[str] = []
    for iid, it in d.items():
        qtd = int(it.get("qtd") or 1)
        if iid not in a:
            anotados.append(f"{qtd}x {rotulo(it)}")
            continue
        velho = a[iid]
        mudou = (
            int(velho.get("qtd") or 1) != qtd
            or (velho.get("tamanho") or "") != (it.get("tamanho") or "")
            or sorted(map(str, velho.get("adicionais") or [])) != sorted(map(str, it.get("adicionais") or []))
        )
        if mudou:
            ajustados.append(f"{qtd}x {rotulo(it)}")
    for iid, it in a.items():
        if iid not in d:
            tirados.append(rotulo(it))
    partes = []
    if anotados:
        partes.append("Anotei: " + ", ".join(anotados))
    if ajustados:
        partes.append("Ajustei: " + ", ".join(ajustados))
    if tirados:
        partes.append("Tirei: " + ", ".join(tirados))
    return ("✅ " + " · ".join(partes)) if partes else None
