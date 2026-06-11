"""
Testes do curto-circuito determinístico da NLU (pipeline FSM).

Travam:
  - confirmação pura em AGUARDANDO_CONFIRMACAO → confirmar_resumo sem LLM;
  - aceite/recusa puros ao upsell → intenção sintética sem LLM;
  - saudação pura na abertura → saudacao sem LLM;
  - mensagens com conteúdo extra ("sim, mas sem cebola") SEMPRE vão à LLM;
  - formato de saída idêntico ao da NLU real (intencao/confianca/dados/_usage).
"""
from __future__ import annotations

import pytest

from app.agent.fsm.pipeline import _nlu_deterministica


def _estado(**kw):
    base = {"etapa": "COLETA_ITENS", "carrinho": [], "apresentou": False}
    base.update(kw)
    return base


class TestConfirmacao:
    @pytest.mark.parametrize("msg", ["sim", "Sim!", "pode fechar", "fechado", "ok", "confirmo", "tá bom"])
    def test_confirmacao_pura_em_aguardando(self, msg):
        out = _nlu_deterministica(msg, _estado(etapa="AGUARDANDO_CONFIRMACAO", carrinho=[{"x": 1}]))
        assert out is not None
        assert out["intencao"] == "confirmar_resumo"
        assert out["confianca"] == 1.0
        assert out["dados"] == {}
        assert out["_usage"]["total_tokens"] == 0
        assert out["_deterministica"] is True

    @pytest.mark.parametrize("msg", [
        "sim, mas sem cebola",
        "pode fechar e manda uma coca",
        "sim quero trocar o endereço",
    ])
    def test_confirmacao_com_extra_vai_para_llm(self, msg):
        assert _nlu_deterministica(msg, _estado(etapa="AGUARDANDO_CONFIRMACAO")) is None

    def test_fora_da_etapa_nao_dispara(self):
        assert _nlu_deterministica("sim", _estado(etapa="ENTREGA")) is None


class TestUpsell:
    @pytest.mark.parametrize("msg", ["não", "nao", "não, obrigado", "nada não", "Não quero"])
    def test_recusa_pura(self, msg):
        out = _nlu_deterministica(msg, _estado(aguardando_upsell=True, carrinho=[{"x": 1}]))
        assert out is not None
        assert out["intencao"] == "conversa_fiada"

    @pytest.mark.parametrize("msg", ["quero", "sim", "pode ser", "manda", "aceito"])
    def test_aceite_puro(self, msg):
        out = _nlu_deterministica(msg, _estado(aguardando_upsell=True, carrinho=[{"x": 1}]))
        assert out is not None
        assert out["intencao"] == "confirmar_resumo"

    def test_aceite_com_item_vai_para_llm(self):
        # "quero uma coca" tem conteúdo (o item) → a LLM precisa extrair.
        assert _nlu_deterministica("quero uma coca", _estado(aguardando_upsell=True)) is None

    def test_sem_upsell_pendente_nao_dispara(self):
        assert _nlu_deterministica("não", _estado()) is None


class TestSaudacao:
    @pytest.mark.parametrize("msg", ["oi", "Olá!", "boa noite", "opa", "bom dia!!"])
    def test_saudacao_pura_na_abertura(self, msg):
        out = _nlu_deterministica(msg, _estado())
        assert out is not None
        assert out["intencao"] == "saudacao"

    def test_saudacao_com_pedido_vai_para_llm(self):
        assert _nlu_deterministica("oi, quero uma pizza grande", _estado()) is None

    def test_ja_apresentou_nao_dispara(self):
        # Conversa em andamento: "oi" pode ser retomada de assunto → LLM decide.
        assert _nlu_deterministica("oi", _estado(apresentou=True)) is None

    def test_com_carrinho_nao_dispara(self):
        assert _nlu_deterministica("oi", _estado(carrinho=[{"x": 1}])) is None


class TestCardapioOfertado:
    """Bug real: bot ofereceu o cardápio, cliente disse 'Quero' e a atendente
    respondeu 'Quero o quê?'. Aceite puro à oferta = pedir_cardapio."""

    def _estado(self):
        return _estado(apresentou=True, cardapio_ofertado=True)

    @pytest.mark.parametrize("msg", ["quero", "sim", "pode mandar", "manda", "pode", "ok"])
    def test_aceite_puro_vira_pedir_cardapio(self, msg):
        out = _nlu_deterministica(msg, self._estado())
        assert out is not None
        assert out["intencao"] == "pedir_cardapio"

    def test_com_pedido_junto_vai_para_llm(self):
        assert _nlu_deterministica("quero uma calabresa", self._estado()) is None

    def test_cardapio_ja_enviado_nao_dispara(self):
        estado = self._estado()
        estado["cardapio_enviado"] = True
        assert _nlu_deterministica("quero", estado) is None

    def test_sem_oferta_nao_dispara(self):
        assert _nlu_deterministica("quero", _estado(apresentou=True)) is None


class TestLimites:
    def test_mensagem_longa_nao_dispara(self):
        assert _nlu_deterministica("sim " * 20, _estado(etapa="AGUARDANDO_CONFIRMACAO")) is None

    def test_vazio_nao_dispara(self):
        assert _nlu_deterministica("", _estado()) is None
        assert _nlu_deterministica("   ", _estado()) is None
