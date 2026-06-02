"""
Testes de regressão da BLINDAGEM do FSM (Pilares 1–6).

Travam, antes de cada deploy, os comportamentos que causam PREJUÍZO se quebrarem:
  - Pilar 1: preço CONGELADO — não muda no meio da conversa (bug R$50→R$45).
  - Pilar 2: resumo/fechamento escritos pelo backend (verbatim, sem LLM).
  - Pilar 3: guard remove saudação repetida e neutraliza preço sem lastro.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest


# ============================================================
# Pilar 3 — Guard determinístico
# ============================================================
class TestGuardSaudacao:
    def test_remove_saudacao_se_ja_apresentou(self):
        from app.agent.fsm.guard import strip_saudacao
        out, mudou = strip_saudacao("Olá! A gente pode finalizar o pagamento agora?", True)
        assert mudou is True
        assert not out.lower().startswith("olá")
        assert "finalizar o pagamento" in out.lower()
        # recapitaliza
        assert out[0].isupper()

    def test_mantem_saudacao_na_primeira_vez(self):
        from app.agent.fsm.guard import strip_saudacao
        txt = "Oi! Sou a Camila da Pizzaria Palazio 😊"
        out, mudou = strip_saudacao(txt, False)
        assert mudou is False
        assert out == txt

    def test_nao_apaga_mensagem_que_e_so_saudacao(self):
        from app.agent.fsm.guard import strip_saudacao
        out, mudou = strip_saudacao("Boa tarde!", True)
        assert mudou is False  # não deixa a mensagem vazia
        assert out == "Boa tarde!"

    def test_variacoes_de_saudacao(self):
        from app.agent.fsm.guard import strip_saudacao
        for s in ["Bom dia, vai ser entrega ou retirada?",
                  "Opa, qual o endereço?",
                  "E aí! Me passa o endereço?"]:
            out, mudou = strip_saudacao(s, True)
            assert mudou is True, s


class TestGuardPrecos:
    def test_neutraliza_preco_sem_lastro(self):
        from app.agent.fsm.guard import neutralizar_precos
        out, removidos = neutralizar_precos(
            "Sua 4 Queijos fica R$ 99,00, posso fechar?", validos=[50.0, 5.0, 55.0]
        )
        assert 99.0 in removidos
        assert "99" not in out
        assert "valor a confirmar" in out

    def test_mantem_preco_com_lastro(self):
        from app.agent.fsm.guard import neutralizar_precos
        out, removidos = neutralizar_precos(
            "O total fica R$ 55,00 com a entrega.", validos=[50.0, 5.0, 55.0]
        )
        assert removidos == []
        assert "R$ 55,00" in out

    def test_aceita_soma_de_pares(self):
        from app.agent.fsm.guard import neutralizar_precos
        # 50 + 5 = 55 deve ser aceito mesmo sem 55 explícito na lista
        out, removidos = neutralizar_precos("Total R$ 55,00", validos=[50.0, 5.0])
        assert removidos == []

    def test_blindar_combina_saudacao_e_preco(self):
        from app.agent.fsm.guard import blindar
        out, corr = blindar(
            "Olá! Sua pizza fica R$ 12,00.", ja_apresentou=True, precos_validos=[50.0]
        )
        assert corr.get("saudacao_removida") is True
        assert 12.0 in corr.get("precos_neutralizados", [])
        assert not out.lower().startswith("olá")


# ============================================================
# Pilar 1 — Congelamento de preço
# ============================================================
class TestCongelamento:
    def test_congelar_e_descongelar(self):
        from app.agent.fsm.engine import _congelar_precos, _descongelar
        estado = {"carrinho": [{"nome": "4 Queijos", "tamanho": "GG"}]}
        calc = {"itens": [{"nome": "4 Queijos (GG)", "preco_unit": 50.0, "quantidade": 1}]}
        _congelar_precos(estado, calc)
        item = estado["carrinho"][0]
        assert item["preco_congelado"] == 50.0
        assert item["nome_congelado"] == "4 Queijos (GG)"
        _descongelar(item)
        assert "preco_congelado" not in item
        assert "nome_congelado" not in item

    def test_calcular_pedido_usa_preco_congelado(self):
        """Item congelado NÃO re-resolve o preço (mesmo que a busca mudasse)."""
        import app.agent.tools as tools

        async def _boom(*a, **k):
            raise AssertionError("não deveria re-resolver preço de item congelado")

        original = tools._obter_preco_produto
        tools._obter_preco_produto = _boom
        try:
            ctx = MagicMock()
            ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
            ctx.pizzaria.taxa_entrega_fixa = None
            ctx.pizzaria.taxas_bairro = None
            db = MagicMock()
            result = asyncio.run(tools._calcular_pedido(
                ctx, db,
                itens=[{
                    "nome": "4 Queijos", "tamanho": "GG", "qtd": 1,
                    "preco_congelado": 50.0, "nome_congelado": "4 Queijos (GG)",
                }],
                tipo="retirada", forma_pagamento="dinheiro",
            ))
            assert result["ok"] is True
            assert result["valor_total"] == 50.0
            assert result["itens"][0]["preco_unit"] == 50.0
            assert result["itens"][0]["nome"] == "4 Queijos (GG)"
        finally:
            tools._obter_preco_produto = original

    def test_preco_estavel_entre_dois_calculos(self):
        """Simula o bug real: 1º cálculo congela, 2º cálculo reusa o MESMO preço."""
        import app.agent.tools as tools
        from app.agent.fsm.engine import _congelar_precos

        chamadas = {"n": 0}

        async def _resolver(db, pid, nome, tamanho=None):
            chamadas["n"] += 1
            return (50.0, "4 Queijos (GG)")

        original = tools._obter_preco_produto
        tools._obter_preco_produto = _resolver
        try:
            ctx = MagicMock()
            ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
            db = MagicMock()
            estado = {"carrinho": [{"nome": "4 queijos", "tamanho": "GG", "qtd": 1}]}

            calc1 = asyncio.run(tools._calcular_pedido(
                ctx, db, itens=estado["carrinho"],
                tipo="retirada", forma_pagamento="dinheiro",
            ))
            _congelar_precos(estado, calc1)
            calc2 = asyncio.run(tools._calcular_pedido(
                ctx, db, itens=estado["carrinho"],
                tipo="retirada", forma_pagamento="dinheiro",
            ))
            assert calc1["valor_total"] == calc2["valor_total"] == 50.0
            assert chamadas["n"] == 1  # resolveu UMA vez só
        finally:
            tools._obter_preco_produto = original


# ============================================================
# Pilar 2 — Mensagens críticas verbatim (backend)
# ============================================================
class TestMensagensVerbatim:
    def test_resumo_tem_total_correto(self):
        from app.agent.fsm.engine import _montar_resumo_msg
        msg = _montar_resumo_msg(
            [{"quantidade": 1, "nome": "4 Queijos (GG)", "preco_unit": 50.0}],
            taxa=5.0, total=55.0, tipo="delivery", endereco="Rua X, 5",
            pagamento="cartao", pagar_agora=False, observacoes=None,
        )
        assert "R$ 50,00" in msg
        assert "R$ 5,00" in msg
        assert "Total: R$ 55,00" in msg
        assert "Rua X, 5" in msg
        assert "Cartão" in msg
        assert "Posso fechar o pedido?" in msg

    def test_resumo_retirada_sem_taxa(self):
        from app.agent.fsm.engine import _montar_resumo_msg
        msg = _montar_resumo_msg(
            [{"quantidade": 2, "nome": "Calabresa (M)", "preco_unit": 40.0}],
            taxa=0.0, total=80.0, tipo="retirada", endereco=None,
            pagamento="pix", pagar_agora=True, observacoes="sem cebola",
        )
        assert "Entrega" not in msg
        assert "Retirada" in msg
        assert "Total: R$ 80,00" in msg
        assert "sem cebola" in msg

    def test_registro_pix_e_link(self):
        from app.agent.fsm.engine import _montar_registro_msg
        m_pix = _montar_registro_msg(123, "40 min", "pix", True)
        assert "#123" in m_pix and "Pix" in m_pix
        m_link = _montar_registro_msg(124, "40 min", "link", True)
        assert "link" in m_link.lower()
        m_dinheiro = _montar_registro_msg(125, "40 min", None, False)
        assert "#125" in m_dinheiro

    def test_fmt_brl(self):
        from app.agent.fsm.engine import _fmt_brl
        assert _fmt_brl(55) == "R$ 55,00"
        assert _fmt_brl(55.5) == "R$ 55,50"
