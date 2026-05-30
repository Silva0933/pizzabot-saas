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
# 2b. FEATURES v2: histórico, taxa por bairro, NPS, upselling
# ============================================================

class TestTaxaPorBairro:
    def _pizz(self, taxas=None, fixa=None):
        from unittest.mock import MagicMock
        p = MagicMock()
        p.taxas_bairro = taxas if taxas is not None else []
        p.taxa_entrega_fixa = fixa
        return p

    def test_normalizar_remove_acento(self):
        from app.agent.tools import _normalizar
        assert _normalizar("Jardim Europá") == "jardim europa"
        assert _normalizar("  CENTRO  ") == "centro"

    def test_match_exato_de_bairro(self):
        from app.agent.tools import _taxa_para_bairro
        pizz = self._pizz([{"bairro": "Centro", "taxa": 5.0}, {"bairro": "Jardim Europa", "taxa": 8.5}])
        r = _taxa_para_bairro(pizz, "centro")
        assert r["taxa"] == 5.0 and r["fonte"] == "bairro" and r["precisa_confirmar"] is False

    def test_match_parcial_de_bairro(self):
        from app.agent.tools import _taxa_para_bairro
        pizz = self._pizz([{"bairro": "Jardim Europa", "taxa": 8.5}])
        r = _taxa_para_bairro(pizz, "Europa")  # cliente escreve só parte do bairro
        assert r["taxa"] == 8.5 and r["fonte"] == "bairro_parcial"

    def test_fallback_taxa_fixa(self):
        from app.agent.tools import _taxa_para_bairro
        pizz = self._pizz([], fixa=7.0)
        r = _taxa_para_bairro(pizz, "Bairro Desconhecido")
        assert r["taxa"] == 7.0 and r["fonte"] == "fixa" and r["precisa_confirmar"] is False

    def test_bairro_desconhecido_sem_fixa_precisa_confirmar(self):
        from app.agent.tools import _taxa_para_bairro
        pizz = self._pizz([{"bairro": "Centro", "taxa": 5.0}], fixa=None)
        r = _taxa_para_bairro(pizz, "Outro Bairro")
        assert r["taxa"] is None and r["precisa_confirmar"] is True


class TestPromptFeaturesV2:
    def _build(self):
        from app.agent.prompt import build_system_prompt
        from unittest.mock import MagicMock
        p = MagicMock()
        p.nome = "Pizza X"; p.endereco = "Rua 1"
        p.tempo_entrega_min = 30; p.tempo_entrega_max = 60
        p.tempo_retirada_min = 15; p.tempo_retirada_max = 25
        p.taxa_entrega_info = "R$5"; p.formas_pagamento_aceitas = ["pix"]
        p.horario_funcionamento = {}
        return build_system_prompt(p, None, cliente_nome="Jailson", cliente_total_pedidos=3, cliente_ultimo_pedido="1x Calabresa G")

    def test_tem_secao_recorrente(self):
        assert "CLIENTE QUE JÁ CONHECEMOS" in self._build()

    def test_tem_upselling(self):
        assert "UPSELLING" in self._build()

    def test_tem_taxa_entrega(self):
        s = self._build()
        assert "TAXA DE ENTREGA" in s and "consultar_taxa_entrega" in s

    def test_tem_pos_venda(self):
        s = self._build()
        assert "registrar_avaliacao" in s and "PÓS-VENDA" in s

    def test_injeta_ultimo_pedido(self):
        assert "ÚLTIMO PEDIDO DELE: 1x Calabresa G" in self._build()


class TestNovasToolsRegistry:
    def test_tools_registradas(self):
        from app.agent.tools import TOOL_IMPL, TOOL_DECLARATIONS
        nomes = {d.name for d in TOOL_DECLARATIONS}
        for t in ("obter_historico_pedidos", "consultar_taxa_entrega", "registrar_avaliacao"):
            assert t in TOOL_IMPL
            assert t in nomes

    def test_registrar_avaliacao_required_nota(self):
        from app.agent.tools import DECL_REGISTRAR_AVALIACAO
        assert "nota" in list(DECL_REGISTRAR_AVALIACAO.parameters.required)


class TestBuscarCardapioPayload:
    """Garante o payload enxuto e o tamanho data-driven (anti-alucinação)."""

    def _ctx(self):
        from unittest.mock import MagicMock
        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        return ctx

    def _db_com_linhas(self, linhas):
        from unittest.mock import AsyncMock, MagicMock
        db = AsyncMock()
        res = MagicMock()
        res.fetchall = MagicMock(return_value=linhas)
        db.execute = AsyncMock(return_value=res)
        return db

    def test_item_sem_tamanhos_nao_tem_campo_tamanhos(self):
        import asyncio
        from app.agent.tools import buscar_cardapio
        # (id, nome, categoria, descricao, preco, disponivel, tamanhos)
        linhas = [("id1", "Calabresa Vulcao", "Pizzas", "desc", 50.0, True, None)]
        r = asyncio.run(buscar_cardapio(self._ctx(), self._db_com_linhas(linhas), query="vulcao"))
        item = r["items"][0]
        assert "tamanhos" not in item            # sem tamanhos = preço único
        assert "id" not in item and "disponivel" not in item  # payload enxuto
        assert item["preco"] == 50.0

    def test_item_com_tamanhos_mantem_campo(self):
        import asyncio
        from app.agent.tools import buscar_cardapio
        tam = [{"tamanho": "G", "preco": 42.0}, {"tamanho": "M", "preco": 36.0}]
        linhas = [("id2", "The Pizza", "Pizzas", "desc", 42.0, True, tam)]
        r = asyncio.run(buscar_cardapio(self._ctx(), self._db_com_linhas(linhas), query="the pizza"))
        item = r["items"][0]
        assert item["tamanhos"] == tam

    def test_descricao_so_quando_pedida(self):
        import asyncio
        from app.agent.tools import buscar_cardapio
        linhas = [("id1", "Calabresa", "Pizzas", "molho e calabresa", 40.0, True, None)]
        sem = asyncio.run(buscar_cardapio(self._ctx(), self._db_com_linhas(linhas), query="calabresa"))
        com = asyncio.run(buscar_cardapio(self._ctx(), self._db_com_linhas(linhas), query="calabresa", incluir_descricao=True))
        assert "descricao" not in sem["items"][0]
        assert com["items"][0]["descricao"] == "molho e calabresa"


class TestPromptAntiAlucinacao:
    def _build(self):
        from app.agent.prompt import build_system_prompt
        from unittest.mock import MagicMock
        p = MagicMock()
        p.nome = "X"; p.endereco = "R1"
        p.tempo_entrega_min = 30; p.tempo_entrega_max = 60
        p.tempo_retirada_min = 15; p.tempo_retirada_max = 25
        p.taxa_entrega_info = "5"; p.formas_pagamento_aceitas = ["pix"]
        p.horario_funcionamento = {}
        return build_system_prompt(p, None)

    def test_principio_nunca_invente(self):
        assert "PRINCÍPIO Nº 1" in self._build()

    def test_regra_preco_unico(self):
        s = self._build()
        assert "PREÇO ÚNICO" in s and "P/M/G/GG" in s

    def test_arquivo_uma_vez(self):
        assert "ja_enviado" in self._build() or "uma vez por conversa" in self._build()

    def test_proibe_mensagem_de_espera(self):
        s = self._build()
        assert "mensagem de espera" in s
        # a frase-bug que causava o loop tem que estar listada como proibida
        assert "deixa eu ver/confirmar" in s or "deixa eu" in s.lower()

    def test_fonte_da_verdade_e_a_tool(self):
        assert "FONTE DA VERDADE" in self._build()

    def test_fechamento_envia_campo_mensagem(self):
        s = self._build()
        assert "campo \"mensagem\"" in s or "campo 'mensagem'" in s
        assert "Posso fechar o pedido" in s

    def test_pix_automatico_no_fechamento(self):
        s = self._build()
        assert "QR Code" in s and "pagar_agora=true" in s


class TestPagamentoFalhou:
    def test_default_message_existe(self):
        from app.services.status_messages import DEFAULT_STATUS_MESSAGES
        assert "pagamento_falhou" in DEFAULT_STATUS_MESSAGES

    def test_falhou_interpola(self):
        from app.services.status_messages import DEFAULT_STATUS_MESSAGES, _interpolar
        t = _interpolar(DEFAULT_STATUS_MESSAGES["pagamento_falhou"], {"numero_pedido": 9, "nome_cliente": "Ana"})
        assert "#9" in t and "Ana" in t and "{" not in t


class TestNpsMessage:
    def test_default_nps_interpola(self):
        from app.services.status_messages import DEFAULT_NPS_MESSAGE, _interpolar
        txt = _interpolar(DEFAULT_NPS_MESSAGE, {"numero_pedido": 15, "nome_cliente": "Jailson"})
        assert "#15" in txt and "Jailson" in txt and "{" not in txt


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


# ============================================================
# 4. TESTES DE TAMANHOS E VARIAÇÕES (AGRUPAMENTO)
# ============================================================

class TestTamanhosVariacoes:
    """Valida as lógicas de múltiplos tamanhos e preços."""

    def test_normalizar_produtos_com_tamanhos(self):
        from app.services.import_cardapio import normalizar_produtos
        raw_items = [
            {
                "nome": "Calabresa",
                "categoria": "pizza",
                "descricao": "Mussarela e calabresa",
                "preco": 0.0,
                "tamanhos": [
                    {"tamanho": "P", "preco": 25.0},
                    {"tamanho": "G", "preco": "35,00"}
                ]
            },
            {
                "nome": "Coca-Cola",
                "categoria": "bebida",
                "preco": 8.5
            }
        ]
        norm = normalizar_produtos(raw_items)
        assert len(norm) == 2
        
        # Produto com tamanhos
        calabresa = norm[0]
        assert calabresa["nome"] == "Calabresa"
        assert calabresa["tamanhos"] is not None
        assert len(calabresa["tamanhos"]) == 2
        assert calabresa["tamanhos"][0]["tamanho"] == "P"
        assert calabresa["tamanhos"][0]["preco"] == 25.0
        assert calabresa["tamanhos"][1]["tamanho"] == "G"
        assert calabresa["tamanhos"][1]["preco"] == 35.0

        # Produto de tamanho único
        coca = norm[1]
        assert coca["nome"] == "Coca-Cola"
        assert coca["tamanhos"] is None
        assert coca["preco"] == 8.5

    def test_importar_confirmar_preco_calculado(self):
        from app.routes.cardapio import ConfirmarImportIn, ProdutoImport
        # Simula o corpo que o FastAPI receberia
        body = ConfirmarImportIn(produtos=[
            ProdutoImport(
                nome="Calabresa",
                categoria="pizza",
                preco=Decimal("0.0"),
                tamanhos=[
                    {"tamanho": "P", "preco": 25.0},
                    {"tamanho": "M", "preco": 30.0},
                    {"tamanho": "G", "preco": 35.0}
                ]
            )
        ])

        p = body.produtos[0]
        nome = p.nome
        tamanhos_list = p.tamanhos
        preco_calculado = Decimal(p.preco)
        
        # Replica a lógica do endpoint para teste unitário rápido
        if tamanhos_list and preco_calculado <= 0:
            precos_tamanhos = [Decimal(str(t.get("preco") or 0)) for t in tamanhos_list if t.get("preco")]
            if precos_tamanhos:
                preco_calculado = min(precos_tamanhos)

        assert preco_calculado == Decimal("25.0")


# ============================================================
# 5. TESTES DAS MELHORIAS E HUMANIZAÇÃO (Fase 4 - Custom)
# ============================================================

class TestHumanizacaoEMelhorias:
    """Valida as novas lógicas de preferências do cliente e busca geral compacta."""

    def test_prompt_contem_preferencias_cliente(self):
        from app.agent.prompt import build_system_prompt
        from unittest.mock import MagicMock
        p = MagicMock()
        p.nome = "Pizzaria Teste"
        p.formas_pagamento_aceitas = ["pix"]
        p.horario_funcionamento = {}

        prompt = build_system_prompt(p, None, cliente_nome="Jailson", cliente_preferencias="gosta de borda de catupiry")
        assert "PREFERÊNCIAS DO CLIENTE" in prompt
        assert "gosta de borda de catupiry" in prompt
        assert "MEMÓRIA ATIVA DO CLIENTE" in prompt

    def test_buscar_cardapio_geral_retorna_compacto_sem_precos(self):
        import asyncio
        from app.agent.tools import buscar_cardapio
        from unittest.mock import MagicMock, AsyncMock

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"

        db = AsyncMock()
        res = MagicMock()
        res.fetchall = MagicMock(return_value=[("Calabresa G", "Pizzas"), ("Coca-Cola 2L", "Bebidas")])
        db.execute = AsyncMock(return_value=res)

        r = asyncio.run(buscar_cardapio(ctx, db, query="cardapio")) # generic query triggers compacto_geral
        assert r["tipo_resultado"] == "compacto_geral"
        assert r["encontrados"] == 2
        assert "preco" not in r["items"][0]
        assert r["items"][0]["nome"] == "Calabresa G"

    def test_obter_preco_produto_calcula_tamanho(self):
        import asyncio
        from app.agent.tools import _obter_preco_produto
        from unittest.mock import AsyncMock, MagicMock

        db = AsyncMock()
        res = MagicMock()
        tamanhos = [{"tamanho": "G", "preco": 55.0}, {"tamanho": "M", "preco": 45.0}]
        res.first = MagicMock(return_value=("Calabresa", 50.0, tamanhos))
        db.execute = AsyncMock(return_value=res)

        p_id = "00000000-0000-0000-0000-000000000001"
        pr, nm = asyncio.run(_obter_preco_produto(db, p_id, "Calabresa", "Grande"))
        assert pr == 55.0
        assert nm == "Calabresa"

    def test_fallback_ia_process_and_reply(self):
        import asyncio
        from unittest.mock import AsyncMock, patch, MagicMock
        from app.agent.runner import process_and_reply

        db = AsyncMock()
        # Simula erro de IA
        with patch("app.agent.runner.run_agent", side_effect=RuntimeError("API Error")):
            with patch("app.services.evolution.evolution.send_text", new_callable=AsyncMock) as mock_send:
                with patch("app.services.broadcaster.broadcaster.publish", new_callable=AsyncMock) as mock_broad:
                    # Configura mocks minimos do db
                    pizz = MagicMock()
                    pizz.instancia = "inst_test"
                    pizz.id = "00000000-0000-0000-0000-000000000001"

                    res_pizz = MagicMock()
                    res_pizz.scalar_one = MagicMock(return_value=pizz)

                    conv = MagicMock()
                    conv.id = "00000000-0000-0000-0000-000000000002"
                    conv.bot_ativo = True
                    conv.cliente_nome = "Jailson"

                    res_conv = MagicMock()
                    res_conv.scalar_one_or_none = MagicMock(return_value=conv)

                    db.execute.side_effect = [res_pizz, res_conv]

                    r = asyncio.run(process_and_reply(db, pizz.id, "5511999999999", "Oi"))

                    assert r["ok"] is False
                    assert r["fallback_acionado"] is True
                    assert conv.bot_ativo is False
                    assert conv.status == "humano_necessario"
                    mock_send.assert_called_once()
                    assert "instabilidade" in mock_send.call_args[1]["texto"]

    def test_registrar_pedido_exige_resumo_previo(self):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock
        from app.agent.tools import registrar_pedido

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.telefone = "5511999999999"
        ctx.estado_atendimento = {}
        ctx.cliente = MagicMock()

        res_prod = MagicMock()
        res_prod.first = MagicMock(return_value=("Calabresa", 50.0, None))
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res_prod)

        r = asyncio.run(registrar_pedido(
            ctx, db,
            itens=[{"nome": "Calabresa", "qtd": 1}],
            valor_total=50,
            tipo="retirada",
            forma_pagamento="dinheiro",
        ))
        assert r["ok"] is False
        assert "preparar_resumo_pedido" in r["erro"]

    def test_guard_response_nao_bloqueia_mais(self):
        """O guard virou pass-through: NÃO pode travar a conversa (causava loop
        'deixa eu confirmar' e travamento no fechamento do pedido)."""
        from app.services.response_guard import guard_response

        # Mesmo citando preço sem tool no turno, o texto deve passar intacto.
        texto, blocked, reason = guard_response("A pizza fica R$ 55,00", [])
        assert blocked is False
        assert reason is None
        assert texto == "A pizza fica R$ 55,00"
        # E nunca devolve a frase de espera que causava o loop.
        assert "deixa eu confirmar" not in texto.lower()
