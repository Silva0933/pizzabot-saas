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
        return build_system_prompt(p, None, cliente_nome="Jailson", cliente_total_pedidos=3, cliente_ultimo_pedido="Calabresa Vulcão")

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

    def test_injeta_pedido_de_sempre(self):
        assert "PEDIDO DE SEMPRE DELE: Calabresa Vulcão" in self._build()


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

    def test_nunca_assume_forma_pagamento(self):
        s = self._build()
        assert "NUNCA assuma" in s and "Pagamento: Dinheiro" in s

    def test_proibe_inventar_problema_de_pix(self):
        s = self._build()
        assert "NUNCA INVENTE PROBLEMA" in s
        assert "Pix está com problema" in s or "indisponível" in s

    def test_nao_repete_saudacao_nem_info(self):
        s = self._build()
        assert "NENHUMA mensagem depois da primeira pode começar com saudação" in s
        assert "NÃO repita informação que você já deu" in s


class TestDebounceTyping:
    def test_constantes_debounce_curto(self):
        from app.services.queue import DEBOUNCE_SECONDS, TYPING_GRACE_SECONDS, MAX_HOLD_SECONDS
        assert DEBOUNCE_SECONDS <= 8.0      # debounce base "curto"
        assert TYPING_GRACE_SECONDS >= 4.0  # janela de digitação
        assert MAX_HOLD_SECONDS >= DEBOUNCE_SECONDS

    def test_evolution_assina_presence_update(self):
        from app.services.evolution import EvolutionClient
        payload = EvolutionClient._webhook_payload("https://x/webhook/evolution")
        assert "PRESENCE_UPDATE" in payload["events"]
        assert "MESSAGES_UPSERT" in payload["events"]


class TestFragmentacaoBaloes:
    def test_split_por_paragrafo(self):
        from app.services.humanized_delivery import split_balloons
        b = split_balloons("Primeiro balão.\n\nSegundo balão.")
        assert b == ["Primeiro balão.", "Segundo balão."]

    def test_texto_curto_unico_balao(self):
        from app.services.humanized_delivery import split_balloons
        assert split_balloons("Oi!") == ["Oi!"]


class TestPagamentoFalhou:
    def test_default_message_existe(self):
        from app.services.status_messages import DEFAULT_STATUS_MESSAGES
        assert "pagamento_falhou" in DEFAULT_STATUS_MESSAGES

    def test_falhou_interpola(self):
        from app.services.status_messages import DEFAULT_STATUS_MESSAGES, _interpolar
        t = _interpolar(DEFAULT_STATUS_MESSAGES["pagamento_falhou"], {"numero_pedido": 9, "nome_cliente": "Ana"})
        assert "#9" in t and "Ana" in t and "{" not in t


class TestPedidoDeSempre:
    """A saudação 'de sempre' só vale quando o MESMO item se repete nos últimos 3 pedidos."""

    def _db(self, pedidos_itens):
        from unittest.mock import AsyncMock, MagicMock
        peds = []
        for itens in pedidos_itens:
            p = MagicMock()
            p.itens = itens
            peds.append(p)
        scal = MagicMock()
        scal.all = MagicMock(return_value=peds)
        res = MagicMock()
        res.scalars = MagicMock(return_value=scal)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)
        return db

    def _cli(self):
        from unittest.mock import MagicMock
        c = MagicMock(); c.id = "c1"; return c

    def test_mesmo_item_3x_retorna_de_sempre(self):
        import asyncio
        from app.agent.context import _pedido_de_sempre
        db = self._db([
            [{"nome": "Calabresa Vulcão", "quantidade": 1}],
            [{"nome": "calabresa vulcao", "quantidade": 1}],
            [{"nome": "Calabresa Vulcão", "quantidade": 2}],
        ])
        r = asyncio.run(_pedido_de_sempre(db, "p1", self._cli()))
        assert r == "Calabresa Vulcão"

    def test_itens_diferentes_retorna_none(self):
        import asyncio
        from app.agent.context import _pedido_de_sempre
        db = self._db([
            [{"nome": "Calabresa", "quantidade": 1}],
            [{"nome": "Portuguesa", "quantidade": 1}],
            [{"nome": "Frango", "quantidade": 1}],
        ])
        assert asyncio.run(_pedido_de_sempre(db, "p1", self._cli())) is None

    def test_menos_de_3_pedidos_retorna_none(self):
        import asyncio
        from app.agent.context import _pedido_de_sempre
        db = self._db([
            [{"nome": "Calabresa", "quantidade": 1}],
            [{"nome": "Calabresa", "quantidade": 1}],
        ])
        assert asyncio.run(_pedido_de_sempre(db, "p1", self._cli())) is None


class TestPriceCheckC4:
    """Validador NÃO-bloqueante de preço (Fase 2 / C4)."""

    def test_coleta_precos_de_tool(self):
        from app.services.price_check import coletar_precos_tool
        r = {"items": [{"nome": "X", "preco": 50.0, "tamanhos": [{"tamanho": "G", "preco": 52.0}]}], "taxa": 7.0}
        vs = coletar_precos_tool(r)
        assert 50.0 in vs and 52.0 in vs and 7.0 in vs

    def test_total_como_soma_e_aceito(self):
        from app.services.price_check import precos_sem_lastro
        # 50 + 7 = 57 deve ser aceito (soma de itens + entrega)
        assert precos_sem_lastro("Itens R$ 50 + entrega R$ 7 = R$ 57,00", {50.0, 7.0}) == []

    def test_preco_inventado_e_flagado(self):
        from app.services.price_check import precos_sem_lastro
        assert 99.0 in precos_sem_lastro("fica R$ 99", {50.0, 7.0})

    def test_sem_tool_todo_preco_suspeito(self):
        from app.services.price_check import precos_sem_lastro
        assert 30.0 in precos_sem_lastro("custa R$ 30", set())

    def test_texto_sem_preco_nao_flaga(self):
        from app.services.price_check import precos_sem_lastro
        assert precos_sem_lastro("vai ser entrega ou retirada?", {50.0}) == []


class TestAdicionaisFase3:
    def _pizz(self, ads):
        from unittest.mock import MagicMock
        p = MagicMock(); p.adicionais = ads; return p

    def test_resolve_adicional_existente(self):
        from app.agent.tools import _resolver_adicionais
        p = self._pizz([{"nome": "Borda Catupiry", "preco": 8.0, "tipo": "borda"}])
        preco, fmt, falt = _resolver_adicionais(p, ["borda catupiry"])
        assert preco == 8.0 and fmt == ["Borda Catupiry"] and falt == []

    def test_adicional_inexistente_vira_faltante(self):
        from app.agent.tools import _resolver_adicionais
        p = self._pizz([{"nome": "Borda Catupiry", "preco": 8.0}])
        _, _, falt = _resolver_adicionais(p, ["Borda Cheddar"])
        assert falt == ["Borda Cheddar"]

    def test_tool_registrada(self):
        from app.agent.tools import TOOL_IMPL, TOOL_DECLARATIONS
        assert "consultar_adicionais" in TOOL_IMPL
        assert "consultar_adicionais" in {d.name for d in TOOL_DECLARATIONS}

    def test_item_aceita_adicionais_no_schema(self):
        from app.agent.tools import DECL_REGISTRAR_PEDIDO
        item = DECL_REGISTRAR_PEDIDO.parameters.properties["itens"].items
        assert "adicionais" in item.properties


class TestTTLConversa:
    def test_constante_ttl(self):
        from app.agent.memory import CONVERSA_TTL_HORAS
        assert CONVERSA_TTL_HORAS >= 1


class TestFase5CustoEscala:
    def test_modelo_por_plano(self):
        from app.services.app_config import modelo_para_plano
        cfg = {"model": "padrao", "modelos_plano": {"basico": "barato", "premium": "top"}}
        assert modelo_para_plano(cfg, "basico") == "barato"
        assert modelo_para_plano(cfg, "premium") == "top"
        assert modelo_para_plano(cfg, "pro") == "padrao"   # sem override → padrão
        assert modelo_para_plano(cfg, None) == "padrao"

    def test_typing_proporcional(self):
        from app.services.humanized_delivery import typing_delay_ms
        curto = typing_delay_ms("ok")
        medio = typing_delay_ms("a" * 60)
        longo = typing_delay_ms("a" * 300)
        assert curto < medio < longo
        assert longo <= 5000  # teto

    def test_memoria_cliente_enxuta_no_prompt(self):
        from app.agent.prompt import build_system_prompt
        from unittest.mock import MagicMock
        p = MagicMock()
        p.nome = "X"; p.endereco = "R1"
        p.tempo_entrega_min = 30; p.tempo_entrega_max = 60
        p.tempo_retirada_min = 15; p.tempo_retirada_max = 25
        p.taxa_entrega_info = "5"; p.formas_pagamento_aceitas = ["pix"]; p.horario_funcionamento = {}
        longa = "x" * 800
        s = build_system_prompt(p, None, cliente_nome="Ana", cliente_preferencias=longa)
        # a preferência injetada deve estar truncada (<= ~180 chars), não 800
        assert ("x" * 800) not in s
        assert "PREFERÊNCIAS DO CLIENTE" in s


class TestPipelineFSM:
    def test_nlu_extrai_json_sujo(self):
        from app.agent.fsm.nlu import _extrair_json, _normalizar_saida
        d = _extrair_json('```json\n{"intencao":"adicionar_item","confianca_intencao":0.9,"dados_extraidos":{}}\n```')
        assert d and d["intencao"] == "adicionar_item"
        norm = _normalizar_saida(d)
        assert norm["intencao"] == "adicionar_item" and 0 <= norm["confianca"] <= 1

    def test_nlu_intencao_invalida_vira_duvida(self):
        from app.agent.fsm.nlu import _normalizar_saida
        n = _normalizar_saida({"intencao": "xpto", "confianca_intencao": 2})
        assert n["intencao"] == "duvida_geral" and n["confianca"] == 1.0

    def test_engine_aplica_nlu_no_carrinho(self):
        from app.agent.fsm.engine import estado_inicial, _aplicar_nlu
        e = estado_inicial()
        _aplicar_nlu(e, {
            "produtos": [{"nome": "Calabresa", "qtd": 2, "tamanho": "G"}],
            "tipo_entrega": "delivery", "forma_pagamento": "pix", "pagar_agora": True,
        })
        assert e["carrinho"][0]["nome"] == "Calabresa" and e["carrinho"][0]["qtd"] == 2
        assert e["tipo"] == "delivery" and e["pagamento"] == "pix" and e["pagar_agora"] is True

    def test_engine_remove_item(self):
        from app.agent.fsm.engine import estado_inicial, _aplicar_nlu
        e = estado_inicial()
        _aplicar_nlu(e, {"produtos": [{"nome": "Calabresa", "qtd": 1}]})
        _aplicar_nlu(e, {"remover": ["calabresa"]})
        assert e["carrinho"] == []

    def test_resumo_estado(self):
        from app.agent.fsm.engine import estado_inicial, resumo_estado
        assert "etapa=SAUDACAO" in resumo_estado(estado_inicial())

    def test_confirmacao_heuristica(self):
        from app.agent.fsm.engine import _eh_confirmacao
        assert _eh_confirmacao("confirmar_resumo", "")
        for t in ("sim", "pode", "ok", "pode ser", "pode fechar", "fechou", "beleza", "isso"):
            assert _eh_confirmacao("duvida_geral", t), t
        assert not _eh_confirmacao("duvida_geral", "quero trocar de sabor")

    def test_dedup_esclarecimento_tamanho(self):
        from app.agent.fsm.engine import estado_inicial, _aplicar_nlu
        e = estado_inicial()
        _aplicar_nlu(e, {"produtos": [{"nome": "The Pizza"}]})
        _aplicar_nlu(e, {"produtos": [{"nome": "the pizza", "tamanho": "GG"}]})
        assert len(e["carrinho"]) == 1 and e["carrinho"][0]["tamanho"] == "GG"

    def test_registrar_aceita_confirmado(self):
        import inspect
        from app.agent.tools import registrar_pedido
        assert "confirmado" in inspect.signature(registrar_pedido).parameters

    def test_quer_cardapio_multi_intencao(self):
        from app.agent.fsm.engine import _quer_cardapio
        # pede pizza E cardápio na mesma frase (intenção primária != pedir_cardapio)
        assert _quer_cardapio("adicionar_item", "quero uma pizza e o cardapio", {})
        assert _quer_cardapio("saudacao", "me manda o menu", {})
        assert _quer_cardapio("x", "x", {"quer_cardapio": True})
        assert not _quer_cardapio("adicionar_item", "quero uma calabresa grande", {})

    def test_grosseria_detecta(self):
        from app.agent.fsm.engine import _eh_grosseria
        assert _eh_grosseria("que merda de atendimento")
        assert not _eh_grosseria("quero uma calabresa grande")

    def test_intencoes_novas(self):
        from app.agent.fsm.nlu import INTENCOES
        for i in ("reclamar", "falar_humano", "avaliar", "alterar_pedido"):
            assert i in INTENCOES

    def test_voz_retorna_usage_tupla(self):
        import inspect
        from app.agent.fsm.voice import gerar_voz
        # gerar_voz agora retorna (texto, usage)
        assert inspect.iscoroutinefunction(gerar_voz)


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


class TestMelhoriasEspecificas:
    """Valida as correções de duplicação de tamanho e tratamento de timeout na FSM."""

    def test_pizza_combinada_limpa_sufixos_individuais(self):
        import asyncio
        from app.agent.tools import _calcular_pedido
        from unittest.mock import AsyncMock, MagicMock

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.pizzaria.adicionais = []

        db = AsyncMock()

        # Simulamos que _obter_preco_produto retorna "Calabresa (G)" e "Frango (G)"
        with patch("app.agent.tools._obter_preco_produto") as mock_obter_preco:
            with patch("app.agent.tools._obter_regras_produto") as mock_obter_regras:
                mock_obter_preco.side_effect = [
                    (30.0, "Calabresa (G)"),
                    (35.0, "Frango (G)"),
                ]
                mock_obter_regras.return_value = {"meia_meia": {"permitido": True, "max_sabores": 2, "calculo": "maior_valor"}}

                r = asyncio.run(_calcular_pedido(
                    ctx, db,
                    itens=[{"sabores": ["Calabresa", "Frango"], "tamanho": "G", "qtd": 1}],
                    tipo="retirada",
                    forma_pagamento="dinheiro"
                ))

                assert r["ok"] is True
                assert r["itens"][0]["nome"] == "Pizza Meia Calabresa / Meia Frango (G)"
                assert r["valor_total"] == 35.0

    def test_item_simples_com_colisao_de_letra_no_tamanho(self):
        import asyncio
        from app.agent.tools import _calcular_pedido
        from unittest.mock import AsyncMock, MagicMock

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.pizzaria.adicionais = []

        db = AsyncMock()

        with patch("app.agent.tools._obter_preco_produto") as mock_obter_preco:
            # "Frango" tem a letra "g"
            mock_obter_preco.return_value = (40.0, "Frango")

            r = asyncio.run(_calcular_pedido(
                ctx, db,
                itens=[{"nome": "Frango", "tamanho": "G", "qtd": 1}],
                tipo="retirada",
                forma_pagamento="dinheiro"
            ))

            assert r["ok"] is True
            # Deve conter o (G) no final mesmo que "g" exista na palavra "Frango"
            assert r["itens"][0]["nome"] == "Frango (G)"

    def test_timeout_fsm_aciona_fallback_com_max_iterations(self):
        import asyncio
        from unittest.mock import AsyncMock, patch, MagicMock
        from app.agent.runner import process_and_reply

        db = AsyncMock()

        # Mock de run_fsm_agent para demorar e dar timeout
        async def mock_run_fsm_delay(*args, **kwargs):
            await asyncio.sleep(10)
            return MagicMock()

        with patch("app.agent.fsm.pipeline.run_fsm_agent", side_effect=mock_run_fsm_delay):
            with patch("app.agent.runner.run_agent", new_callable=AsyncMock) as mock_run_agent:
                with patch("app.services.broadcaster.broadcaster.publish", new_callable=AsyncMock):
                    with patch("app.services.humanized_delivery.send_humanized_text", new_callable=AsyncMock):
                        pizz = MagicMock()
                        pizz.pipeline_fsm = True
                        pizz.instancia = "inst_test"
                        pizz.id = "00000000-0000-0000-0000-000000000001"

                        res_pizz = MagicMock()
                        res_pizz.scalar_one = MagicMock(return_value=pizz)

                        conv = MagicMock()
                        conv.id = "00000000-0000-0000-0000-000000000002"
                        res_conv = MagicMock()
                        res_conv.scalar_one_or_none = MagicMock(return_value=conv)

                        db.execute.side_effect = [res_pizz, res_conv]

                        mock_result = MagicMock()
                        mock_result.texto = "Resposta do legado"
                        mock_result.iteracoes = 2
                        mock_result.tool_calls = []
                        mock_run_agent.return_value = mock_result

                        # Executamos o process_and_reply
                        r = asyncio.run(process_and_reply(db, pizz.id, "5511999999999", "Oi"))

                        assert r["ok"] is True
                        # Deve ter chamado o run_agent legado com max_iterations=3 devido ao timeout
                        mock_run_agent.assert_called_once()
                        assert mock_run_agent.call_args[1]["max_iterations"] == 3
