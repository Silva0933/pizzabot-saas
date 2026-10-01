"""
Pergunta sobre meio a meio e bordas/adicionais é respondida pela regra do
cadastro, com o "não" dito por inteiro (auditoria de 01/10 com o cardápio real).

Casos reais encontrados com o agente em simulação:
  - Palazio (todas as pizzas com meia desligada): "a The Pizza pode ser meio a
    meio?" → "Sim, a The Pizza pode ser meio a meio". Os fatos só diziam "aceita
    meio a meio" quando aceitava; o "não" ficava implícito e a voz completava.
  - Palazio (sem borda/adicional cadastrado): "vocês têm borda recheada?" →
    "Vou confirmar se temos borda recheada" — promessa sem chamado nenhum.
"""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from app.agent.fsm.catalogo import montar_catalogo


def _prod(pid, nome, categoria, tamanhos=None, meia=None, adicionais=None):
    return SimpleNamespace(
        id=pid, nome=nome, categoria=categoria, preco=Decimal("30"), disponivel=True, ordem=0,
        tamanhos=[{"tamanho": t, "preco": p} for t, p in (tamanhos or [])] or None,
        opcoes={"adicionais": adicionais or []},
        regras={"meia_meia": meia} if meia is not None else {},
        aliases=[], descricao="",
    )


TAMS = [("P", 27.9), ("M", 31.9), ("G", 42.0), ("GG", 50.0)]

# Como a Palazio: todas as pizzas com meia desligada, sem adicionais.
PALAZIO = montar_catalogo("palazio", [
    _prod("thepizza", "The Pizza", "pizza", TAMS, meia={"permitido": False}),
    _prod("calab", "Calabresa", "pizza", TAMS, meia={"permitido": False}),
    _prod("coca", "Coca Cola 2L", "bebida"),
], [])

# Como a Fornalha: meia ligada em parte (e o padrão de pizza sem regra é aceitar).
FORNALHA = montar_catalogo("fornalha", [
    _prod("brasa", "Pizza Brasa", "pizza", [("M", 49.9), ("G", 64.9)], meia={"permitido": True, "max_sabores": 2}),
    _prod("calab", "Pizza Calabresa", "pizza", [("M", 46.9), ("G", 59.9)]),   # sem regra = aceita
    _prod("doce", "Pizza Doce", "pizza", [("M", 39.9)], meia={"permitido": False},
          adicionais=[{"nome": "Borda de Chocolate", "preco": 8}]),
], [{"nome": "Queijo extra", "preco": 4}])


class TestMeioAMeio:
    def test_loja_sem_meia_diz_nao_mesmo_citando_o_sabor(self):
        txt, _ = PALAZIO.fatos_regras("a pizza de The Pizza pode ser meio a meio?", [PALAZIO.por_id("thepizza")])
        assert "NÃO faz pizza meio a meio" in txt

    def test_loja_sem_meia_pergunta_generica(self):
        txt, _ = PALAZIO.fatos_regras("vocês fazem pizza de dois sabores?", [])
        assert "NÃO faz pizza meio a meio" in txt

    def test_sabor_que_aceita_e_que_nao_aceita(self):
        sim, _ = FORNALHA.fatos_regras("a brasa pode ser meia?", [FORNALHA.por_id("brasa")])
        assert "Pizza Brasa: ACEITA meio a meio" in sim
        nao, _ = FORNALHA.fatos_regras("a doce pode ser meia?", [FORNALHA.por_id("doce")])
        assert "Pizza Doce: NÃO aceita meio a meio" in nao

    def test_pergunta_generica_lista_quem_aceita_e_quem_nao(self):
        txt, _ = FORNALHA.fatos_regras("faz meio a meio?", [])
        assert "Pizza Brasa" in txt and "Pizza Calabresa" in txt     # sem regra = aceita
        assert "NÃO aceitam meio a meio: Pizza Doce" in txt
        assert "sabor mais caro" in txt

    def test_fatos_do_produto_dizem_o_nao(self):
        txt, _ = PALAZIO.fatos_de([PALAZIO.por_id("thepizza")])
        assert "NÃO aceita meio a meio" in txt

    def test_pergunta_sem_meia_nem_adicional_nao_gera_fato(self):
        assert PALAZIO.fatos_regras("que horas vocês abrem?", [])[0] is None


class TestAdicionais:
    def test_loja_sem_adicional_diz_que_nao_tem(self):
        txt, precos = PALAZIO.fatos_regras("vocês têm borda recheada?", [])
        assert "NÃO tem adicionais nem bordas" in txt and "não prometa confirmar" in txt
        assert precos == []

    def test_lista_os_do_cadastro_com_preco(self):
        txt, precos = FORNALHA.fatos_regras("quais adicionais vocês têm?", [])
        assert "Queijo extra (+R$ 4,00)" in txt and "Borda de Chocolate (+R$ 8,00)" in txt
        assert 4.0 in precos and 8.0 in precos

    def test_adicionais_do_produto_citado(self):
        txt, _ = FORNALHA.fatos_regras("a brasa tem borda?", [FORNALHA.por_id("brasa")])
        assert "Adicionais/bordas de Pizza Brasa: Queijo extra" in txt    # sem próprios → os da loja
        sem, _ = PALAZIO.fatos_regras("a the pizza tem borda?", [PALAZIO.por_id("thepizza")])
        assert "The Pizza NÃO tem adicionais nem bordas" in sem
