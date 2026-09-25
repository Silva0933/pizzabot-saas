"""
Camadas 1 e 2 da blindagem: catálogo por pizzaria + NLU de comandos.

Cada caso aqui é um erro real das baterias no agente de produção que agora não
pode acontecer por construção: a IA só escolhe códigos do catálogo, o preço sai
por ID e as mudanças no carrinho são comandos sobre o ID do item.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.fsm import engine
from app.agent.fsm.catalogo import ErroItem, montar_catalogo
from app.agent.fsm.nlu_comandos import (
    NAO_ENCONTRADO,
    carrinho_para_nlu,
    converter,
    garantir_ids_itens,
    montar_schema,
    nlu_comandos,
)


def _prod(pid, nome, categoria, preco, tamanhos=None, meia=None, adicionais=None, aliases=None, ordem=0):
    return SimpleNamespace(
        id=pid, nome=nome, categoria=categoria, preco=Decimal(str(preco)), disponivel=True, ordem=ordem,
        tamanhos=[{"tamanho": t, "preco": p} for t, p in (tamanhos or [])] or None,
        opcoes={"adicionais": adicionais or []},
        regras={"meia_meia": meia} if meia is not None else {},
        aliases=aliases or [], descricao="",
    )


PRODUTOS = [
    _prod("id-supreme", "Brasa Supreme", "lanche", 39.9),
    _prod("id-cheese", "Cheese Clássico", "lanche", 28.9),
    _prod("id-brasa", "Pizza Brasa", "pizza", 49.9, [("M", 49.9), ("G", 64.9)],
          meia={"permitido": True, "max_sabores": 2, "calculo": "maior_valor"}),
    _prod("id-marg", "Pizza Margherita", "pizza", 37.9, [("P", 37.9), ("M", 49.9), ("G", 62.9), ("GG", 74.9)],
          meia={"permitido": True, "max_sabores": 2},
          adicionais=[{"nome": "Borda Catupiry", "preco": 10, "tipo": "borda"}]),
    _prod("id-calab", "Pizza Calabresa", "pizza", 46.9, [("M", 46.9), ("G", 59.9)], meia={"permitido": False}),
    _prod("id-doce", "Pizza Doce de Chocolate", "sobremesa", 39.9, [("M", 39.9), ("G", 52.9)]),
    _prod("id-coca", "Coca-Cola 2L", "bebida", 15.9),
]
GLOBAIS = [{"nome": "Bacon crocante", "preco": 5}, {"nome": "Queijo extra", "preco": 4}]


@pytest.fixture
def cat():
    return montar_catalogo("pz-1", PRODUTOS, GLOBAIS)


def _cod(cat, pid):
    return cat.por_id(pid).codigo


def _cmd(**kw):
    base = {"acao": "adicionar", "item": None, "produtos": [], "texto_cliente": None, "tamanho": None,
            "tamanho_texto": None, "qtd": None, "adicionais": [], "adicionais_nao_encontrados": [], "categoria": None}
    return {**base, **kw}


def _bruto(*comandos, intencao="adicionar_item", **kw):
    return {"intencao": intencao, "confianca": 0.9, "comandos": list(comandos), **kw}


# ---------------- Catálogo: a regra única de preço ----------------
class TestPrecificar:
    def test_pizza_brasa_m_e_a_pizza_nao_o_lanche(self, cat):
        pi = cat.precificar(["id-brasa"], "M")
        assert (pi.nome, pi.preco_unit) == ("Pizza Brasa (M)", Decimal("49.90"))

    def test_gg_nao_vira_g(self, cat):
        assert cat.precificar(["id-marg"], "GG").preco_unit == Decimal("74.90")

    def test_tamanho_obrigatorio_e_existente(self, cat):
        with pytest.raises(ErroItem) as e:
            cat.precificar(["id-brasa"], None)
        assert e.value.tipo == "tamanho_faltando"
        with pytest.raises(ErroItem) as e:
            cat.precificar(["id-brasa"], "P")
        assert e.value.tipo == "tamanho_invalido" and "M, G" in str(e.value)

    def test_meia_regras(self, cat):
        assert cat.precificar(["id-brasa", "id-marg"], "G").preco_unit == Decimal("64.90")
        for ids in (["id-brasa", "id-calab"], ["id-brasa", "id-doce"]):
            with pytest.raises(ErroItem) as e:
                cat.precificar(ids, "G")
            assert e.value.tipo == "meia_invalida"

    def test_adicional_do_produto_ou_global(self, cat):
        assert cat.precificar(["id-marg"], "G", ["borda catupiry"]).preco_unit == Decimal("72.90")
        assert cat.precificar(["id-cheese"], None, ["Bacon crocante"]).preco_unit == Decimal("33.90")
        with pytest.raises(ErroItem) as e:
            cat.precificar(["id-marg"], "G", ["Bacon crocante"])  # tem adicionais próprios
        assert e.value.tipo == "adicional_invalido"


# ---------------- Esquema estrito ----------------
def test_schema_so_aceita_codigos_do_catalogo(cat):
    sch = montar_schema(cat, ["I1"])
    cmd = sch["properties"]["comandos"]["items"]["properties"]
    assert cmd["produtos"]["items"]["enum"] == [p.codigo for p in cat.produtos] + [NAO_ENCONTRADO]
    assert set(cmd["tamanho"]["enum"]) == {"M", "G", "P", "GG", None}
    assert cmd["item"]["enum"] == ["I1", None]
    # Strict mode: todo campo é obrigatório e nada além do esquema.
    for obj in (sch, sch["properties"]["comandos"]["items"], sch["properties"]["endereco"]):
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])


# ---------------- Conversão dos comandos ----------------
class TestConverter:
    def test_adicionar_resolve_por_id(self, cat):
        estado = engine.estado_inicial()
        out = converter(_bruto(_cmd(produtos=[_cod(cat, "id-brasa")], tamanho="M", qtd=1)), cat, estado)
        p = out["dados"]["produtos"][0]
        assert (p["nome"], p["produto_id"], p["tamanho"], p["qtd"]) == ("Pizza Brasa", "id-brasa", "M", 1)

    def test_meio_a_meio_leva_os_ids(self, cat):
        out = converter(_bruto(_cmd(produtos=[_cod(cat, "id-brasa"), _cod(cat, "id-marg")], tamanho="G")),
                        cat, engine.estado_inicial())
        p = out["dados"]["produtos"][0]
        assert p["sabores_ids"] == ["id-brasa", "id-marg"]
        assert p["sabores_meia"] == ["Pizza Brasa", "Pizza Margherita"]

    def test_codigo_inventado_nunca_vira_produto_parecido(self, cat):
        out = converter(_bruto(_cmd(produtos=["P999"], texto_cliente="strogonoff")), cat, engine.estado_inicial())
        p = out["dados"]["produtos"][0]
        assert p["nome"] == "strogonoff" and "produto_id" not in p

    def test_adicional_por_codigo_e_nao_encontrado(self, cat):
        cods = {v: k for k, v in cat.codigos_adicionais().items()}
        out = converter(_bruto(_cmd(produtos=[_cod(cat, "id-cheese")], adicionais=[cods["Bacon crocante"]],
                                    adicionais_nao_encontrados=["borda de nutella"])), cat, engine.estado_inicial())
        assert out["dados"]["produtos"][0]["adicionais"] == ["Bacon crocante", "borda de nutella"]

    def test_tamanho_nao_cadastrado_segue_como_texto(self, cat):
        out = converter(_bruto(_cmd(produtos=[_cod(cat, "id-brasa")], tamanho_texto="família")),
                        cat, engine.estado_inicial())
        assert out["dados"]["produtos"][0]["tamanho"] == "família"

    def test_op_em_item_inexistente_e_ignorada(self, cat):
        estado = engine.estado_inicial()
        estado["carrinho"] = [{"nome": "Coca-Cola 2L", "qtd": 1}]
        garantir_ids_itens(estado)
        out = converter(_bruto(_cmd(acao="remover", item="I9"), _cmd(acao="remover", item="I1")), cat, estado)
        assert [o["iid"] for o in out["dados"]["_ops_itens"]] == ["I1"]

    def test_generico_marca_categoria(self, cat):
        out = converter(_bruto(_cmd(acao="pedido_generico", categoria="pizza", qtd=2, tamanho="G")),
                        cat, engine.estado_inicial())
        p = out["dados"]["produtos"][0]
        assert p["_generico"] and (p["nome"], p["qtd"], p["tamanho"]) == ("pizza", 2, "G")


# ---------------- Comandos aplicados no carrinho (engine) ----------------
class TestOpsNoCarrinho:
    def _estado(self):
        estado = engine.estado_inicial()
        estado["carrinho"] = [
            {"nome": "Pizza Calabresa", "produto_id": "id-calab", "sabores": [], "tamanho": "G", "qtd": 1, "adicionais": []},
            {"nome": "Pizza Calabresa", "produto_id": "id-calab", "sabores": [], "tamanho": "M", "qtd": 2, "adicionais": []},
            {"nome": "Coca-Cola 2L", "produto_id": "id-coca", "sabores": [], "tamanho": None, "qtd": 1, "adicionais": []},
        ]
        garantir_ids_itens(estado)
        return estado

    def test_remover_tira_so_o_item_certo(self):
        est = self._estado()
        engine._aplicar_nlu(est, {"_ops_itens": [{"op": "remover", "iid": "I2"}]})
        assert [(i["iid"], i["tamanho"]) for i in est["carrinho"]] == [("I1", "G"), ("I3", None)]

    def test_definir_e_somar_quantidade(self):
        est = self._estado()
        engine._aplicar_nlu(est, {"_ops_itens": [{"op": "definir_qtd", "iid": "I1", "qtd": 3},
                                                 {"op": "somar_qtd", "iid": "I3", "qtd": 1}]})
        assert [i["qtd"] for i in est["carrinho"]] == [3, 2, 2]

    def test_definir_zero_remove(self):
        est = self._estado()
        engine._aplicar_nlu(est, {"_ops_itens": [{"op": "definir_qtd", "iid": "I3", "qtd": 0}]})
        assert len(est["carrinho"]) == 2

    def test_trocar_tamanho_e_adicionais_descongelam(self):
        est = self._estado()
        est["carrinho"][0]["preco_congelado"] = 59.9
        est["carrinho"][0]["nome_congelado"] = "Pizza Calabresa (G)"
        engine._aplicar_nlu(est, {"_ops_itens": [
            {"op": "trocar_tamanho", "iid": "I1", "tamanho": "M"},
            {"op": "adicionar_adicional", "iid": "I1", "adicionais": ["Queijo extra"]},
        ]})
        it = est["carrinho"][0]
        assert it["tamanho"] == "M" and it["adicionais"] == ["Queijo extra"] and "preco_congelado" not in it

    def test_item_novo_ganha_iid_e_produto_id(self):
        est = self._estado()
        engine._aplicar_nlu(est, {"produtos": [{"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "M", "qtd": 1}]})
        novo = est["carrinho"][-1]
        assert novo["iid"] == "I4" and novo["produto_id"] == "id-brasa"

    def test_nome_do_catalogo_com_numero_nao_vira_quantidade(self):
        est = engine.estado_inicial()
        engine._aplicar_nlu(est, {"produtos": [{"nome": "2 Hambúrgueres + Refri", "produto_id": "id-combo", "qtd": 1}]})
        assert (est["carrinho"][0]["nome"], est["carrinho"][0]["qtd"]) == ("2 Hambúrgueres + Refri", 1)

    def test_carrinho_para_nlu_mostra_ids(self):
        txt = carrinho_para_nlu(self._estado())
        assert txt.splitlines()[0] == "I1: 1x Pizza Calabresa (tamanho G)"
        assert "I3: 1x Coca-Cola 2L (SEM tamanho)" in txt


# ---------------- Cálculo do pedido por ID ----------------
def test_calcular_pedido_usa_o_catalogo_por_id(cat):
    from app.agent.tools import _calcular_pedido
    ctx = MagicMock()
    ctx.pizzaria.id = "pz-1"
    ctx.pizzaria.adicionais = GLOBAIS
    with patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)), \
         patch("app.agent.tools._obter_preco_produto", new=AsyncMock(side_effect=AssertionError("busca por nome"))):
        r = asyncio.run(_calcular_pedido(ctx, MagicMock(), itens=[
            {"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "M", "qtd": 2},
            {"nome": "pizza", "sabores": ["Pizza Brasa", "Pizza Calabresa"], "sabores_ids": ["id-brasa", "id-calab"],
             "tamanho": "G", "qtd": 1},
        ][:1], tipo="retirada", forma_pagamento="pix"))
    assert r["ok"] and r["itens"][0]["nome"] == "Pizza Brasa (M)" and r["valor_total"] == pytest.approx(99.8)


def test_calcular_pedido_meia_proibida_por_id(cat):
    from app.agent.tools import _calcular_pedido
    ctx = MagicMock()
    ctx.pizzaria.id = "pz-1"
    with patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)):
        r = asyncio.run(_calcular_pedido(ctx, MagicMock(), itens=[
            {"nome": "pizza", "sabores": ["Pizza Brasa", "Pizza Calabresa"], "sabores_ids": ["id-brasa", "id-calab"],
             "tamanho": "G", "qtd": 1}], tipo="retirada", forma_pagamento="pix"))
    assert r["ok"] is False and r["meia_invalida"] == ["Pizza Brasa", "Pizza Calabresa"]


# ---------------- Chamada: modo estrito e fallback ----------------
def test_nlu_comandos_manda_schema_estrito_e_cai_para_json_object(cat):
    from app.agent.fsm import nlu_comandos as mod
    mod._SEM_SCHEMA.clear()
    resposta = {"content": '{"intencao": "adicionar_item", "confianca": 0.9, "comandos": ['
                           f'{{"acao": "adicionar", "produtos": ["{_cod(cat, "id-coca")}"], "qtd": 2}}]}}',
                "usage": {}}
    chamadas = []

    async def fake_chat(**kw):
        chamadas.append(kw["response_format"]["type"])
        if kw["response_format"]["type"] == "json_schema":
            assert kw["response_format"]["json_schema"]["strict"] is True
            raise RuntimeError("400 json_schema não suportado")
        return resposta

    with patch("app.agent.providers.openai_chat", new=fake_chat):
        out = asyncio.run(nlu_comandos(provider="x", api_key="k", model="m", cat=cat, estado=engine.estado_inicial(),
                                       estado_resumo="", historico_texto="", user_input="2 cocas"))
    assert chamadas == ["json_schema", "json_object"]
    assert out["dados"]["produtos"][0]["produto_id"] == "id-coca" and out["dados"]["produtos"][0]["qtd"] == 2
    # Modelo que recusou o esquema não é tentado de novo.
    chamadas.clear()
    with patch("app.agent.providers.openai_chat", new=fake_chat):
        asyncio.run(nlu_comandos(provider="x", api_key="k", model="m", cat=cat, estado=engine.estado_inicial(),
                                 estado_resumo="", historico_texto="", user_input="2 cocas"))
    assert chamadas == ["json_object"]


def test_nlu_comandos_catalogo_vazio_devolve_none():
    vazio = montar_catalogo("pz", [], [])
    out = asyncio.run(nlu_comandos(provider="x", api_key="k", model="m", cat=vazio, estado=engine.estado_inicial(),
                                   estado_resumo="", historico_texto="", user_input="oi"))
    assert out is None


def test_mesmo_produto_em_tamanhos_diferentes_sao_dois_itens():
    """Linha de base (NLU livre): "2 calabresa G e 1 calabresa M" virou "2x calabresa (M)"
    e "tira a M" apagou tudo."""
    est = engine.estado_inicial()
    engine._aplicar_nlu(est, {"produtos": [
        {"nome": "Pizza Calabresa", "produto_id": "id-calab", "tamanho": "G", "qtd": 2},
        {"nome": "Pizza Calabresa", "produto_id": "id-calab", "tamanho": "M", "qtd": 1},
    ]})
    assert [(i["qtd"], i["tamanho"]) for i in est["carrinho"]] == [(2, "G"), (1, "M")]
    # Repetir o mesmo item (mesmo produto e tamanho) não duplica.
    engine._aplicar_nlu(est, {"produtos": [{"nome": "Pizza Calabresa", "produto_id": "id-calab", "tamanho": "G", "qtd": 1}]})
    assert len(est["carrinho"]) == 2 and est["carrinho"][0]["qtd"] == 2


# ---------------- Camada 3: validador (porta do pedido) ----------------
from app.agent.fsm.validador import validar_pedido, vincular_catalogo  # noqa: E402


def _estado_pronto(itens):
    est = engine.estado_inicial()
    est.update({"tipo": "retirada", "pagamento": "pix", "carrinho": itens})
    garantir_ids_itens(est)
    return est


def _calc(*precos, taxa=0.0):
    itens = [{"nome": "x", "quantidade": q, "preco_unit": p} for p, q in precos]
    return {"ok": True, "itens": itens, "taxa_entrega": taxa, "valor_total": sum(p * q for p, q in precos) + taxa}


class TestValidador:
    def test_pedido_certo_passa(self, cat):
        est = _estado_pronto([{"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "M", "qtd": 2}])
        assert validar_pedido(cat, est, _calc((49.9, 2))) == []

    def test_preco_cobrado_diferente_do_catalogo(self, cat):
        est = _estado_pronto([{"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "M", "qtd": 1}])
        v = validar_pedido(cat, est, _calc((39.9, 1)))
        assert [x.codigo for x in v] == ["preco_divergente"]

    def test_item_sem_catalogo_tamanho_invalido_e_qtd(self, cat):
        est = _estado_pronto([
            {"nome": "strogonoff", "qtd": 1},
            {"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "P", "qtd": 1},
            {"nome": "Coca-Cola 2L", "produto_id": "id-coca", "qtd": 99},
        ])
        codigos = [x.codigo for x in validar_pedido(cat, est, _calc((1, 1), (1, 1), (1, 1)))]
        assert codigos == ["item_sem_catalogo", "item_invalido", "qtd_invalida"]

    def test_total_divergente(self, cat):
        est = _estado_pronto([{"nome": "Coca-Cola 2L", "produto_id": "id-coca", "qtd": 1}])
        calc = _calc((15.9, 1))
        calc["valor_total"] = 5.0
        assert [x.codigo for x in validar_pedido(cat, est, calc)] == ["total_divergente"]

    def test_entrega_sem_endereco_e_sem_pagamento(self, cat):
        est = _estado_pronto([{"nome": "Coca-Cola 2L", "produto_id": "id-coca", "qtd": 1}])
        est.update({"tipo": "delivery", "endereco": None, "pagamento": None})
        assert {x.codigo for x in validar_pedido(cat, est, _calc((15.9, 1)))} == {"sem_endereco", "sem_pagamento"}

    def test_vincula_so_por_nome_exato(self, cat):
        est = _estado_pronto([
            {"nome": "Coca-Cola 2L", "qtd": 1},
            {"nome": "brasa", "nome_congelado": "Pizza Brasa (G) + Queijo extra", "tamanho": "G", "qtd": 1},
            {"nome": "brasa", "tamanho": "G", "qtd": 1},
            {"nome": "pizza", "sabores": ["Pizza Brasa", "Pizza Margherita"], "tamanho": "G", "qtd": 1},
        ])
        vincular_catalogo(cat, est)
        c = est["carrinho"]
        assert c[0]["produto_id"] == "id-coca" and c[1]["produto_id"] == "id-brasa"
        assert "produto_id" not in c[2]  # "brasa" solto é ambíguo: não liga por aproximação
        assert c[3]["sabores_ids"] == ["id-brasa", "id-marg"]


def _ctx_catalogo():
    ctx = MagicMock()
    ctx.pizzaria.id = "pz-1"
    ctx.pizzaria.configuracoes = {}
    ctx.pizzaria.formas_pagamento_aceitas = ["pix"]
    ctx.simulation = True
    return ctx


def test_porta_barra_pedido_invalido_e_nao_registra(cat):
    est = _estado_pronto([{"nome": "Pizza Brasa", "produto_id": "id-brasa", "tamanho": "P", "qtd": 1}])
    est.update({"etapa": "AGUARDANDO_CONFIRMACAO", "pagar_agora": False, "apresentou": True})
    calc = _calc((49.9, 1))
    registrar = AsyncMock()
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
         patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=calc)), \
         patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)), \
         patch("app.agent.fsm.engine._modo_pagamento", return_value="desativado"), \
         patch("app.agent.tools.registrar_pedido", new=registrar):
        res = asyncio.run(engine.processar(MagicMock(), _ctx_catalogo(), est,
                                           {"intencao": "confirmar_resumo", "dados": {}}, user_input="sim"))
    assert not registrar.await_count
    assert res["decisao"]["acao"] == "pendencia" and res["decisao"]["validacao"] == ["item_invalido"]
    assert res["estado"]["validador_recusas"] == 1


# ---------------- Camada 5: conferência humana ----------------
def test_mensagem_de_fechamento_com_conferencia_nao_promete_prazo():
    msg = engine._montar_registro_msg(42, "40 min", None, False, revisao=True)
    assert "#42 recebido" in msg and "conferir" in msg and "40 min" not in msg
    assert "fechado" in engine._montar_registro_msg(42, "40 min", None, False)


def test_config_padrao_da_conferencia():
    from app.agent.behavior import AtendimentoConfig
    h = AtendimentoConfig().handoff
    assert h.revisar_pedidos is False and h.validador_limite == 2
    h2 = AtendimentoConfig.model_validate({"handoff": {"revisar_pedidos": True, "validador_limite": 3}}).handoff
    assert h2.revisar_pedidos is True and h2.validador_limite == 3


# ---------------- Camada 4: confirmação do sistema, gatilhos e guard ----------------
from app.agent.fsm.confirmacao import confirmacao_do_turno  # noqa: E402
from app.agent.fsm.guard import produtos_sem_lastro  # noqa: E402


class TestConfirmacao:
    def test_descreve_so_o_que_mudou(self):
        antes = [
            {"iid": "I1", "nome": "Smash Duplo", "qtd": 2, "nome_congelado": "Smash Duplo"},
            {"iid": "I2", "nome": "Coca-Cola 2L", "qtd": 1},
            {"iid": "I3", "nome": "Pizza Brasa", "tamanho": "G", "qtd": 1},
        ]
        depois = [
            {"iid": "I1", "nome": "Smash Duplo", "qtd": 3, "nome_congelado": "Smash Duplo"},
            {"iid": "I3", "nome": "Pizza Brasa", "tamanho": "G", "qtd": 1},
            {"iid": "I4", "nome": "Cheese Clássico", "qtd": 3, "adicionais": ["Bacon crocante"]},
        ]
        txt = confirmacao_do_turno(antes, depois)
        assert txt == "✅ Anotei: 3x Cheese Clássico + Bacon crocante · Ajustei: 3x Smash Duplo · Tirei: Coca-Cola 2L"

    def test_sem_mudanca_nao_confirma(self):
        itens = [{"iid": "I1", "nome": "Coca-Cola 2L", "qtd": 1}]
        assert confirmacao_do_turno(itens, [dict(itens[0])]) is None


class TestGuardDeProduto:
    NOMES = ["Pizza Brasa", "Pizza Calabresa", "Brasa Supreme", "Coca-Cola 2L", "Pudim"]

    def test_produto_fora_do_contexto_e_barrado(self):
        # Caso real: pechincha com a Brasa no carrinho, voz citou a calabresa.
        fora = produtos_sem_lastro(
            "A Pizza Calabresa média sai por R$ 46,90.", self.NOMES, "carrinho: 1x Pizza Brasa (G)",
        )
        assert fora == ["Pizza Calabresa"]

    def test_produto_do_contexto_pode(self):
        assert produtos_sem_lastro("Sua Brasa sai rapidinho!", self.NOMES, "1x Pizza Brasa (G)") == []

    def test_nome_curto_nao_da_falso_alarme(self):
        # "pudim" tem só 5 letras e é o nome inteiro: citar sem contexto é citar o produto.
        assert produtos_sem_lastro("Quer um pudim?", self.NOMES, "") == ["Pudim"]
        assert produtos_sem_lastro("Tudo certo por aqui!", self.NOMES, "") == []


def test_duvida_usa_os_dados_dos_produtos_citados(cat):
    estado = engine.estado_inicial()
    estado["apresentou"] = True
    nlu = {"intencao": "duvida_geral", "dados": {"_nlu": "comandos", "_citados": ["id-brasa"]}}
    busca = AsyncMock(return_value={"items": [{"nome": "Pizza Calabresa", "preco": 46.9}]})
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
         patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)), \
         patch("app.agent.tools.buscar_cardapio", new=busca):
        res = asyncio.run(engine.processar(MagicMock(), _ctx_catalogo(), estado, nlu, user_input="o que vem na brasa?"))
    fatos = " ".join(res["decisao"]["fatos"])
    assert "Pizza Brasa: M R$ 49,90 · G R$ 64,90" in fatos and "Calabresa" not in fatos
    assert not busca.await_count
    assert 64.9 in res["decisao"]["precos_validos"]


def test_duvida_de_categoria_lista_a_categoria(cat):
    estado = engine.estado_inicial()
    estado["apresentou"] = True
    nlu = {"intencao": "duvida_geral", "dados": {"_nlu": "comandos", "_citados": [], "_categoria_citada": "bebida"}}
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
         patch("app.agent.fsm.catalogo.carregar_catalogo", new=AsyncMock(return_value=cat)):
        res = asyncio.run(engine.processar(MagicMock(), _ctx_catalogo(), estado, nlu, user_input="quais bebidas?"))
    assert "Coca-Cola 2L: R$ 15,90" in " ".join(res["decisao"]["fatos"])


def test_converter_leva_citados(cat):
    out = converter(_bruto(intencao="duvida_geral", produtos_citados=[_cod(cat, "id-brasa"), "P999"],
                           categoria_citada="bebida"), cat, engine.estado_inicial())
    assert out["dados"]["_citados"] == ["id-brasa"] and out["dados"]["_categoria_citada"] == "bebida"


# ---------------- Checagens sobre a escolha da IA (conjunto de referência) ----------------
from app.agent.fsm.nlu_comandos import checar_escolhas  # noqa: E402


class TestChecarEscolhas:
    def _out(self, *produtos, ops=None):
        return {"dados": {"produtos": list(produtos), "_ops_itens": ops or []}}

    def test_tamanho_dito_troca_o_lanche_pela_pizza(self, cat):
        # Produção: "uma brasa media" → Brasa Supreme (lanche, sem tamanhos) → R$ 39,90.
        out = self._out({"nome": "Brasa Supreme", "produto_id": "id-supreme", "tamanho": "media", "qtd": 1})
        checar_escolhas(out, cat, engine.estado_inicial(), "uma brasa media")
        p = out["dados"]["produtos"][0]
        assert (p["produto_id"], p["nome"]) == ("id-brasa", "Pizza Brasa")

    def test_tamanho_sem_alternativa_e_descartado(self, cat):
        out = self._out({"nome": "Coca-Cola 2L", "produto_id": "id-coca", "tamanho": "2l", "qtd": 1})
        checar_escolhas(out, cat, engine.estado_inicial(), "uma coca 2l")
        assert out["dados"]["produtos"][0]["tamanho"] is None

    def test_sabor_descartado_pela_ia_nao_vira_item(self, cat):
        # Produção: "G com 3 sabores" virou meia de 2 sem avisar o cliente.
        out = self._out({"nome": "pizza", "sabores_ids": ["id-brasa", "id-marg"], "tamanho": "G", "qtd": 1})
        checar_escolhas(out, cat, engine.estado_inicial(), "quero uma G com 3 sabores: brasa, margherita e frango")
        assert out["dados"]["produtos"] == []
        assert "3 sabores" in out["dados"]["_fatos_nlu"][0] and "máximo 2" in out["dados"]["_fatos_nlu"][0]

    def test_trocar_tamanho_de_item_sem_tamanho_nao_aplica(self, cat):
        est = engine.estado_inicial()
        est["carrinho"] = [{"iid": "I1", "nome": "Coca-Cola 2L", "produto_id": "id-coca", "qtd": 1}]
        out = self._out(ops=[{"op": "trocar_tamanho", "iid": "I1", "tamanho": "G"}])
        checar_escolhas(out, cat, est, "aumenta pra grande")
        assert out["dados"]["_ops_itens"] == [] and "não tem opção de tamanho" in out["dados"]["_fatos_nlu"][0]
