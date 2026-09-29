"""
Preço inventado pela voz: refaz uma vez antes de "(valor a confirmar)".

Alertas de 24/09: "quanto é a pizza de frango grande?" (válido R$ 66,90) → a voz
disse R$ 40,90 e o cliente recebeu "(valor a confirmar)" com o preço conhecido.
"""
from __future__ import annotations

import asyncio

from app.agent.fsm.guard import blindar
from app.agent.fsm.pipeline import refazer_voz_pelo_preco

VALIDOS = [66.9]


def _blindar(t):
    return blindar(t, ja_apresentou=True, precos_validos=VALIDOS, persona_nome="Camila")


def _rodar(respostas):
    fila = list(respostas)
    comandos: list[str] = []

    async def gerar(cmd):
        comandos.append(cmd)
        r = fila.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    texto, cor = _blindar("A Frango G sai por R$ 40,90.")
    out = asyncio.run(refazer_voz_pelo_preco(
        texto, cor, comando="CMD", validos=VALIDOS, gerar=gerar, blindar_fn=_blindar,
    ))
    return out, comandos


def test_segunda_tentativa_certa_substitui_o_marcador():
    (texto, cor), comandos = _rodar(["A Frango G sai por R$ 66,90."])
    assert texto == "A Frango G sai por R$ 66,90."
    assert cor["preco_refeito"] == [40.9]
    assert "R$ 66,90" in comandos[0] and "40.9" in comandos[0]


def test_segunda_tentativa_errada_mantem_o_neutralizado():
    (texto, cor), _ = _rodar(["Sai por R$ 50,00."])
    assert "(valor a confirmar)" in texto
    assert cor["precos_neutralizados"] == [40.9]


def test_taxa_fixa_nao_promete_bairro():
    """Só taxa fixa (sem tabela de bairros): a voz dizia 'Entregamos no Cohatrac'."""
    from types import SimpleNamespace

    from app.agent.fsm.engine import _fatos_taxa_entrega
    fato, valores = _fatos_taxa_entrega(SimpleNamespace(taxas_bairro=[], taxa_entrega_fixa=6.9),
                                        "vocês entregam no Cohatrac?")
    assert "R$ 6,90" in fato and "NÃO afirme nem negue" in fato
    assert valores == [6.9]


def test_falha_do_provedor_mantem_o_neutralizado():
    (texto, cor), _ = _rodar([RuntimeError("fora")])
    assert "(valor a confirmar)" in texto
