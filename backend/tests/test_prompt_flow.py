"""
Testes do fluxo de atendimento do PizzaBot.

Validam que:
1. O system prompt contém o checklist obrigatório de coleta de dados
2. A tool registrar_pedido rejeita chamadas incompletas
3. A tool buscar_cardapio respeita o flag incluir_descricao
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from decimal import Decimal
from datetime import datetime, timezone

# ============================================================
# 1. TESTES DO PROMPT
# ============================================================

class TestPromptFluxoPedido:
    """Verifica que o system prompt contém as regras críticas do fluxo."""

    def _build_prompt(self) -> str:
        """Constrói um prompt com dados mínimos de pizzaria."""
        from app.agent.prompt import build_system_prompt
        from unittest.mock import MagicMock

        pizzaria = MagicMock()
        pizzaria.nome = "Pizzaria Teste"
        pizzaria.endereco = "Rua Teste, 123"
        pizzaria.telefone_contato = "11999999999"
        pizzaria.telefone_admin = "11999999999"
        pizzaria.instagram = "@teste"
        pizzaria.tempo_entrega_min = 30
        pizzaria.tempo_entrega_max = 60
        pizzaria.tempo_retirada_min = 15
        pizzaria.tempo_retirada_max = 30
        pizzaria.taxa_entrega_info = "R$ 5"
        pizzaria.formas_pagamento_aceitas = ["pix", "cartão", "dinheiro"]
        pizzaria.horario_funcionamento = {}
        pizzaria.instancia = "test"

        return build_system_prompt(pizzaria, None)

    def test_prompt_contem_checklist_obrigatorio(self):
        """O prompt deve ter o checklist de 6 itens antes de registrar."""
        prompt = self._build_prompt()
        # Verifica os itens do checklist
        assert "ITENS:" in prompt or "1. ITENS" in prompt
        assert "ENTREGA OU RETIRADA" in prompt
        assert "ENDEREÇO" in prompt or "ENDERECO" in prompt
        assert "FORMA DE PAGAMENTO" in prompt
        assert "PAGAR AGORA" in prompt

    def test_prompt_contem_aviso_pode_confirmar(self):
        """O prompt deve avisar que 'pode confirmar' pode ser só sobre o item."""
        prompt = self._build_prompt()
        assert "pode confirmar" in prompt.lower()
        assert "ITEM" in prompt  # Menciona que pode ser só sobre o item

    def test_prompt_contem_regra_nao_pule_etapas(self):
        """O prompt deve conter instrução para não pular etapas."""
        prompt = self._build_prompt()
        assert "pule etapa" in prompt.lower() or "NÃO pule" in prompt

    def test_prompt_contem_regra_nunca_invente(self):
        """O prompt deve conter instrução para nunca inventar."""
        prompt = self._build_prompt()
        assert "invente" in prompt.lower() or "inventar" in prompt.lower()

    def test_prompt_contem_fluxo_pedido(self):
        """O prompt deve ter a seção FLUXO DO PEDIDO."""
        prompt = self._build_prompt()
        assert "FLUXO DO PEDIDO" in prompt

    def test_prompt_cardapio_regra_ouro(self):
        """O prompt deve ter regra de que a IA não sabe o cardápio de cor."""
        prompt = self._build_prompt()
        assert "cardápio de cor" in prompt.lower() or "NÃO sabe o cardápio" in prompt


# ============================================================
# 2. TESTES DA TOOL registrar_pedido
# ============================================================

class TestRegistrarPedidoValidacao:
    """Verifica que registrar_pedido rejeita chamadas incompletas."""

    def _make_ctx(self):
        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.telefone = "5511999999999"
        ctx.cliente = MagicMock()
        ctx.cliente.id = "00000000-0000-0000-0000-000000000002"
        ctx.cliente.nome = "Teste"
        ctx.cliente.total_pedidos = 0
        ctx.cliente.total_gasto = Decimal("0")
        ctx.cliente.ultima_visita = None
        ctx.cliente_nome = "Teste"
        return ctx

    def _make_db(self):
        return AsyncMock()

    def test_rejeita_tipo_invalido(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[{"nome": "Pizza", "qtd": 1, "preco_unit": 42}],
            valor_total=42.0,
            tipo="invalido",
            forma_pagamento="pix",
        ))
        assert result["ok"] is False
        assert "delivery" in result["erro"]
        assert "retirada" in result["erro"]

    def test_rejeita_delivery_sem_endereco(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[{"nome": "Pizza", "qtd": 1, "preco_unit": 42}],
            valor_total=42.0,
            tipo="delivery",
            forma_pagamento="pix",
            endereco_entrega=None,
        ))
        assert result["ok"] is False
        assert "endere" in result["erro"].lower()

    def test_rejeita_forma_pagamento_vazia(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[{"nome": "Pizza", "qtd": 1, "preco_unit": 42}],
            valor_total=42.0,
            tipo="retirada",
            forma_pagamento="",
        ))
        assert result["ok"] is False
        assert "forma_pagamento" in result["erro"]

    def test_rejeita_forma_pagamento_nao_informado(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[{"nome": "Pizza", "qtd": 1, "preco_unit": 42}],
            valor_total=42.0,
            tipo="retirada",
            forma_pagamento="nao informado",
        ))
        assert result["ok"] is False
        assert "forma_pagamento" in result["erro"]

    def test_rejeita_valor_total_zero(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[{"nome": "Pizza", "qtd": 1, "preco_unit": 42}],
            valor_total=0,
            tipo="retirada",
            forma_pagamento="dinheiro",
        ))
        assert result["ok"] is False
        assert "valor_total" in result["erro"]

    def test_rejeita_itens_vazio(self):
        import asyncio
        from app.agent.tools import registrar_pedido
        result = asyncio.run(registrar_pedido(
            self._make_ctx(), self._make_db(),
            itens=[],
            valor_total=42.0,
            tipo="retirada",
            forma_pagamento="dinheiro",
        ))
        assert result["ok"] is False
        assert "itens" in result["erro"].lower()


# ============================================================
# 3. TESTES DA TOOL DECLARATION
# ============================================================

class TestToolDeclarations:
    """Verifica que as tool declarations contêm instruções adequadas."""

    def test_registrar_pedido_description_menciona_coleta(self):
        from app.agent.tools import DECL_REGISTRAR_PEDIDO
        desc = DECL_REGISTRAR_PEDIDO.description
        assert "ANTES" in desc or "antes" in desc
        assert "forma de pagamento" in desc.lower() or "forma_pagamento" in desc.lower()
        assert "endereço" in desc.lower() or "endereco" in desc.lower()

    def test_buscar_cardapio_tem_incluir_descricao(self):
        from app.agent.tools import DECL_BUSCAR_CARDAPIO
        props = DECL_BUSCAR_CARDAPIO.parameters.properties
        assert "incluir_descricao" in props

    def test_registrar_pedido_required_fields(self):
        from app.agent.tools import DECL_REGISTRAR_PEDIDO
        required = list(DECL_REGISTRAR_PEDIDO.parameters.required)
        assert "itens" in required
        assert "valor_total" in required
        assert "tipo" in required
        assert "forma_pagamento" in required
