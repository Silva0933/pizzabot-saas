"""
Testes do upsell do FSM (oferta de bebida/borda/adicional após o 1º item).

Travam o comportamento pedido pelo dono do produto:
  - só oferece o que a casa REALMENTE tem (verifica antes de oferecer);
  - quando o cliente aceita mas não diz o quê (só "quero") e há VÁRIAS opções,
    LISTA as opções e pergunta qual — não fecha o pedido sem o item;
  - quando a oferta nomeou UM item específico ("Quer uma Coca Cola 2L?") e o
    cliente diz "quero", adiciona ESSE item direto — nunca pergunta "qual?"
    com uma opção só (bug reportado em produção);
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
        # Os nomes reais vão nos FATOS (a voz oferece SÓ esses, sem inventar).
        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca" in fatos          # nomeia a bebida real
        assert "borda" not in fatos     # não tem borda → não menciona
        # A pergunta proíbe explicitamente inventar marcas/sabores.
        assert "invente" in out["decisao"]["proxima_pergunta"].lower()

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


# ============================================================
# Upsell de ITEM ÚNICO: "quero" adiciona direto (nunca "qual?" com 1 opção)
# ============================================================
def _calc_ok_com_coca():
    return {
        "ok": True,
        "itens": [
            {"nome": "Portuguesa (M)", "quantidade": 1, "preco_unit": 45.0},
            {"nome": "Coca Cola 2L", "quantidade": 1, "preco_unit": 12.0},
        ],
        "valor_total": 57.0,
        "taxa_entrega": 0,
    }


class TestUpsellItemUnico:
    def test_oferta_com_opcao_unica_grava_o_item(self):
        """Só existe a Coca → a oferta guarda o nome pro aceite seco."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        nlu = {"intencao": "adicionar_item", "dados": {}}

        with patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": ["Coca Cola 2L"], "bordas": [], "adicionais": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="ok"))

        assert out["decisao"]["acao"] == "upsell"
        assert out["estado"]["upsell_item_unico"] == "Coca Cola 2L"

    def test_aceite_seco_adiciona_o_item_oferecido(self):
        """Bug de produção: ofereceu 'Coca Cola 2L', cliente disse 'quero' e a
        atendente listou a única opção e perguntou qual. Agora adiciona direto."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True
        estado["upsell_item_unico"] = "Coca Cola 2L"
        nlu = {"intencao": "confirmar_resumo", "dados": {}}  # "quero"

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=_calc_ok_com_coca())):
            with patch("app.agent.fsm.engine._sincronizar_rascunho", new=AsyncMock()):
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero"))

        # Item entrou no carrinho e o funil SEGUE (pergunta entrega/retirada) —
        # nada de "qual você quer adicionar?".
        nomes = [i["nome"].lower() for i in out["estado"]["carrinho"]]
        assert any("coca" in n for n in nomes)
        assert out["decisao"]["acao"] == "pedir_info"
        assert "entrega" in out["decisao"]["proxima_pergunta"].lower()
        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca cola 2l" in fatos
        assert out["estado"]["aguardando_upsell"] is False
        assert "upsell_item_unico" not in out["estado"]

    def test_recusa_descarta_o_item_unico(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True
        estado["upsell_item_unico"] = "Coca Cola 2L"
        nlu = {"intencao": "conversa_fiada", "dados": {}}

        out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="não, só a pizza"))

        nomes = [i["nome"].lower() for i in out["estado"]["carrinho"]]
        assert not any("coca" in n for n in nomes)
        assert out["decisao"]["acao"] == "pedir_info"
        assert "upsell_item_unico" not in out["estado"]

    def test_aceite_com_varias_opcoes_continua_listando(self):
        """Com VÁRIAS opções o comportamento antigo continua: lista e pergunta."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = _estado_com_pizza()
        estado["upsell_feito"] = True
        estado["aguardando_upsell"] = True  # sem upsell_item_unico
        nlu = {"intencao": "confirmar_resumo", "dados": {}}

        with patch("app.agent.fsm.engine._opcoes_upsell",
                   new=AsyncMock(return_value={"bebidas": ["Coca", "Guaraná"], "bordas": [], "adicionais": []})):
            out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero"))

        assert out["decisao"]["acao"] == "coletar_item"
        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca" in fatos and "guaraná" in fatos


# ============================================================
# Bebida pedida que NÃO existe → nomeia a real, sem "outras opções" vago
# ============================================================
class TestBebidaInexistente:
    def test_nomeia_a_unica_bebida_real(self):
        """Bug: cliente pede 'guaraná' (não existe) e a atendente dizia 'temos outras
        opções' (vago/errado) quando só há uma bebida. Agora nomeia a real."""
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "guaraná", "qtd": 1}]}}
        calc_fail = {"ok": False, "erro": "produto não encontrado", "produto_invalido": "guaraná"}

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=calc_fail)):
            with patch("app.agent.fsm.engine._opcoes_upsell",
                       new=AsyncMock(return_value={"bebidas": ["Coca-Cola 2L"], "bordas": [], "adicionais": []})):
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero guarana"))

        assert out["decisao"]["acao"] == "pendencia"
        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca-cola 2l" in fatos          # nomeia a bebida real
        assert "única" in fatos                 # deixa claro que só há uma (não 'outras opções')
        assert out["estado"]["sugestao_item"] == "Coca-Cola 2L"

    def test_varias_bebidas_lista_todas(self):
        from app.agent.fsm import engine
        ctx, db = _ctx_db()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        nlu = {"intencao": "adicionar_item", "dados": {"produtos": [{"nome": "fanta", "qtd": 1}]}}
        calc_fail = {"ok": False, "erro": "não encontrado", "produto_invalido": "fanta"}

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=calc_fail)):
            with patch("app.agent.fsm.engine._opcoes_upsell",
                       new=AsyncMock(return_value={"bebidas": ["Coca-Cola 2L", "Suco de Laranja"], "bordas": [], "adicionais": []})):
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="quero tubaina"))

        fatos = " ".join(out["decisao"]["fatos"]).lower()
        assert "coca-cola 2l" in fatos and "suco de laranja" in fatos
