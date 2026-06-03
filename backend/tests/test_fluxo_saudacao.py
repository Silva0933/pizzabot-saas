"""
Testes do comportamento de saudação/cardápio do FSM.

Regra de negócio (pedida pelo cliente do produto):
  - Na saudação/coleta sem itens, em vez de perguntar "qual sabor", o bot OFERECE
    ver o cardápio.
  - Se ele acabou de oferecer e o cliente confirma ("sim"), manda o cardápio.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.nome = "Pizzaria Palazio"
    ctx.telefone = "5511999999999"
    db = MagicMock()
    return ctx, db


class TestSaudacaoOfereceCardapio:
    def test_saudacao_oferece_cardapio_em_vez_de_perguntar_sabor(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        nlu = {"intencao": "saudacao", "dados": {}}

        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="boa noite"))

        decisao = out["decisao"]
        assert decisao["acao"] == "saudacao"
        # A instrução à voz deve oferecer o cardápio, não perguntar "qual sabor".
        assert "cardápio" in decisao["proxima_pergunta"].lower()
        assert "qual sabor" not in decisao["proxima_pergunta"].lower()
        assert out["estado"]["cardapio_ofertado"] is True

    def test_coleta_sem_apresentar_de_novo_oferece_cardapio(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True  # já cumprimentou antes
        nlu = {"intencao": "conversa_fiada", "dados": {}}

        # conversa_fiada cai no responder_duvida; usamos intenção neutra que não
        # adiciona item nem vira dúvida → coleta. Forçamos via intenção 'saudacao'
        # repetida (sem itens) para exercitar o ramo coletar_item.
        nlu = {"intencao": "saudacao", "dados": {}}
        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="oi de novo"))

        decisao = out["decisao"]
        assert decisao["acao"] == "coletar_item"
        assert "cardápio" in decisao["proxima_pergunta"].lower()
        assert out["estado"]["cardapio_ofertado"] is True


class TestConfirmaVerCardapio:
    def test_sim_apos_oferta_envia_o_cardapio(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        estado["cardapio_ofertado"] = True  # acabamos de oferecer

        nlu = {"intencao": "confirmar_resumo", "dados": {}}  # "sim"

        with patch("app.agent.tools.enviar_cardapio_arquivo",
                   new=AsyncMock(return_value={"ok": True})) as mock_card:
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="sim"))

        mock_card.assert_awaited_once()
        assert out["decisao"]["acao"] == "cardapio"
        assert out["estado"]["cardapio_enviado"] is True

    def test_sim_sem_oferta_previa_nao_dispara_cardapio(self):
        """Sem ter oferecido antes, um 'sim' solto não deve mandar o cardápio."""
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        # cardapio_ofertado = False (padrão)

        nlu = {"intencao": "confirmar_resumo", "dados": {}}

        with patch("app.agent.tools.enviar_cardapio_arquivo",
                   new=AsyncMock(return_value={"ok": True})) as mock_card:
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="sim"))

        mock_card.assert_not_awaited()
        assert out["decisao"]["acao"] != "cardapio"
