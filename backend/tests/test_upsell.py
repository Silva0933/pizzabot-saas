"""
Testes do upsell do FSM (oferta de bebida/borda/adicional após o 1º item).

Travam o comportamento pedido pelo dono do produto:
  - só oferece o que a casa REALMENTE tem (verifica antes de oferecer);
  - quando o cliente aceita mas não diz o quê (só "quero"), LISTA as opções e
    pergunta qual — não fecha o pedido sem o item (bug reportado);
  - recusar não trava o fluxo.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.nome = "Pizzaria Palazio"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.taxas_bairro = None
    ctx.telefone = "5511999999999"
    db = MagicMock()
    return ctx, db


def _estado_com_pizza():
    from app.agent.fsm import engine
    estado = engine.estado_inicial()
    estado["apresentou"] = True
    # Preço congelado → _calcular_pedido não toca no banco.
    estado["carrinho"] = [{
        "nome": "Portuguesa", "tamanho": "M", "qtd": 1,
        "preco_congelado": 45.0, "nome_congelado": "Portuguesa (M)",
    }]
    return estado


# ============================================================
# Helpers puros
# ============================================================
class TestAfirmouUpsell:
    def test_aceites(self):
        from app.agent.fsm.engine import _afirmou_upsell
        assert _afirmou_upsell("confirmar_resumo", "quero")
        assert _afirmou_upsell(None, "quero")
        assert _afirmou_upsell(None, "pode ser")
        assert _afirmou_upsell("adicionar_item", "manda")

    def test_recusas(self):
        from app.agent.fsm.engine import _afirmou_upsell
        assert not _afirmou_upsell("conversa_fiada", "não, só a pizza")
        assert not _afirmou_upsell(None, "não quero")
        assert not _afirmou_upsell("confirmar_resumo", "pode fechar")
        assert not _afirmou_upsell(None, "tá bom assim")


class TestOpcoesUpsell:
    def test_separa_bebidas_bordas_adicionais(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        ctx.pizzaria.adicionais = [
            {"nome": "Borda Catupiry", "tipo": "borda", "preco": 8},
            {"nome": "Bacon extra", "tipo": "adicional", "preco": 5},
        ]
        res = MagicMock()
        res.fetchall.return_value = [("Coca-Cola 2L",), ("Guaraná Lata",)]
        db.execute = AsyncMock(return_value=res)

        opc = asyncio.run(engine._opcoes_upsell(ctx, db))
        assert opc["bebidas"] == ["Coca-Cola 2L", "Guaraná Lata"]
        assert opc["bordas"] == ["Borda Catupiry"]
        assert opc["adicionais"] == ["Bacon extra"]


# ============================================================
# Oferta do upsell
# ============================================================
class TestOfertaUpsell:
    def test_oferece_so_o_que_existe(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        nlu = {"intencao": "adicionar_item", "dados": {}}

        with patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": ["Coca"], "bordas": [], "adicionais": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="ok"))

        assert out["decisao"]["acao"] == "upsell"
        assert out["estado"]["aguardando_upsell"] is True
        pergunta = out["decisao"]["proxima_pergunta"].lower()
        assert "bebida" in pergunta
        assert "borda" not in pergunta  # não tem borda cadastrada → não oferece

    def test_pula_upsell_quando_nada_a_oferecer(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        nlu = {"intencao": "adicionar_item", "dados": {}}

        with patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": [], "bordas": [], "adicionais": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="ok"))

        # Sem nada pra oferecer → não faz upsell, avança o funil (entrega/retirada).
        assert out["decisao"]["acao"] == "pedir_info"
        assert "entrega" in out["decisao"]["proxima_pergunta"].lower()
        assert out["estado"]["upsell_feito"] is True


# ============================================================
# Resposta ao upsell
# ============================================================
class TestRespostaUpsell:
    def test_aceita_sem_dizer_o_que_lista_opcoes(self):
        """Bug reportado: cliente diz 'quero' e o pedido fechava sem a bebida.
        Agora deve LISTAR as opções e perguntar qual."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True
        nlu = {"intencao": "confirmar_resumo", "dados": {}}  # "quero"

        with patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": ["Coca", "Guaraná"], "bordas": ["Catupiry"], "adicionais": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero"))

        assert out["decisao"]["acao"] == "coletar_item"
        assert out["estado"]["aguardando_upsell"] is False
        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca" in fatos and "guaraná" in fatos

    def test_recusa_nao_trava_o_fluxo(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True
        nlu = {"intencao": "conversa_fiada", "dados": {}}

        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="não, só a pizza"))

        assert out["decisao"]["acao"] == "pedir_info"
        assert "entrega" in out["decisao"]["proxima_pergunta"].lower()
        assert out["estado"]["aguardando_upsell"] is False
