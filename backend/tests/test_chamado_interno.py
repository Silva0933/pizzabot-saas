"""
Chamado interno: a atendente pergunta à equipe em vez de transferir.

Travam: quando abre (só pergunta que nenhum dado cobre), a mensagem de espera,
o "ainda estou confirmando", a base de conhecimento respondendo sozinha, a
resposta da equipe chegando ao cliente e o prazo que vira atendimento humano.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import chamados


class TestConhecimento:
    def test_casa_pergunta_parecida(self):
        itens = [("vocês têm estacionamento?", "Temos, na lateral da loja."),
                 ("aceitam vale refeição?", "Aceitamos Sodexo e VR.")]
        assert chamados.casar_conhecimento("tem estacionamento aí?", itens) == "Temos, na lateral da loja."
        assert chamados.casar_conhecimento("aceita VR refeição?", itens) == "Aceitamos Sodexo e VR."

    def test_nao_casa_pergunta_diferente(self):
        itens = [("vocês têm estacionamento?", "Temos, na lateral da loja.")]
        assert chamados.casar_conhecimento("fazem festa de aniversário?", itens) is None
        assert chamados.casar_conhecimento("oi", itens) is None

    def test_bairro_parecido_nao_herda_a_resposta(self):
        """A10: a resposta de "Centro" saía para "Centro Novo" (2 de 3 palavras em comum)."""
        itens = [("Vocês entregam no Centro?", "Entregamos sim, taxa de R$ 5.")]
        assert chamados.casar_conhecimento("Vocês entregam no Centro Novo?", itens) is None
        assert chamados.casar_conhecimento("entregam no centro?", itens) == "Entregamos sim, taxa de R$ 5."
        # e ao contrário: a resposta do bairro específico não vale para o genérico
        itens2 = [("Entregam no Centro Novo?", "Não entregamos lá.")]
        assert chamados.casar_conhecimento("Entregam no Centro?", itens2) is None

    def test_negacao_muda_a_pergunta(self):
        itens = [("tem pizza com lactose?", "Todas levam queijo com lactose.")]
        assert chamados.casar_conhecimento("tem pizza sem lactose?", itens) is None
        itens2 = [("tem pizza sem lactose?", "Não temos opção sem lactose.")]
        assert chamados.casar_conhecimento("tem pizza com lactose?", itens2) is None

    def test_numero_diferente_nao_casa(self):
        itens = [("abrem dia 24?", "No dia 24 abrimos até 22h.")]
        assert chamados.casar_conhecimento("abrem dia 25?", itens) is None

    def test_respostas_em_conflito_nao_escolhe(self):
        itens = [("aceitam pix?", "Aceitamos."), ("aceita pix?", "Só na entrega.")]
        assert chamados.casar_conhecimento("vocês aceitam pix?", itens) is None


class TestQuandoAbrir:
    def _pode(self, texto, **dados):
        from app.agent.fsm.engine import _pergunta_sem_dados
        return _pergunta_sem_dados({"_nlu": "comandos", **dados}, texto)

    def test_pergunta_sem_dados_abre(self):
        assert self._pode("vocês têm estacionamento?")
        assert self._pode("fazem festa de aniversário aí?")

    def test_temas_que_o_sistema_responde_nao_abrem(self):
        for t in ("que horas vocês abrem?", "aceita cartão?", "qual a taxa de entrega?",
                  "tem pizza de frango?", "quanto tempo demora?", "tem cupom?"):
            assert not self._pode(t), t

    def test_cardapio_citado_nao_abre(self):
        assert not self._pode("tem guaraná jesus?", _nao_encontrados=[{"texto": "guaraná jesus"}])
        assert not self._pode("essa aí é boa?", _citados=["p1"])

    def test_sem_nlu_de_comandos_nao_abre(self):
        from app.agent.fsm.engine import _pergunta_sem_dados
        assert not _pergunta_sem_dados({}, "vocês têm estacionamento?")


def _ctx(simulation=True):
    ctx = MagicMock()
    ctx.simulation = simulation
    ctx.simulation_events = []
    ctx.pizzaria.id = "p"
    ctx.pizzaria.nome = "Fornalha"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxas_bairro = None
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.tema_cardapio = {}
    ctx.ultimo_pedido_resumo = None
    ctx.personalidade = None
    return ctx


def _processar(estado, texto, *, conhecimento=None, ctx=None):
    from app.agent.fsm import engine
    nlu = {"intencao": "duvida_geral", "dados": {"_nlu": "comandos", "_citados": [], "_nao_encontrados": []}}
    with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=None)), \
         patch("app.services.chamados.buscar_conhecimento", new=AsyncMock(return_value=conhecimento)):
        return asyncio.run(engine.processar(MagicMock(), ctx or _ctx(), estado, nlu, user_input=texto))


class TestNoAtendimento:
    def test_abre_chamado_e_responde_que_vai_confirmar(self):
        from app.agent.fsm import engine
        ctx = _ctx()
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        out = _processar(estado, "vocês têm estacionamento?", ctx=ctx)
        assert out["decisao"]["acao"] == "chamado_aberto"
        assert out["decisao"]["mensagem_pronta"] == chamados.MSG_ESPERA
        assert out["estado"]["chamado_pendente"] == "simulado"
        assert ctx.simulation_events[0]["action"] == "abrir_chamado"

    def test_segunda_pergunta_com_chamado_aberto_nao_abre_outro(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado.update({"apresentou": True, "chamado_pendente": "abc"})
        out = _processar(estado, "e vocês têm wifi?")
        assert out["decisao"]["mensagem_pronta"] == chamados.MSG_AINDA_ESPERANDO

    def test_base_de_conhecimento_responde_sem_chamado(self):
        from app.agent.fsm import engine
        estado = engine.estado_inicial()
        estado["apresentou"] = True
        out = _processar(estado, "vocês têm estacionamento?", conhecimento="Temos, na lateral da loja.")
        assert out["decisao"]["acao"] == "responder_duvida"
        assert "Temos, na lateral da loja." in " ".join(out["decisao"]["fatos"])
        assert "chamado_pendente" not in out["estado"]


def _chamado(**kw):
    base = dict(id=uuid.uuid4(), pizzaria_id=uuid.uuid4(), conversa_id=uuid.uuid4(), telefone="5598999999999",
                pergunta="vocês têm estacionamento?", motivo="sem_resposta", contexto={}, status="aberto",
                resposta=None, respondido_por=None, respondido_em=None,
                created_at=datetime.now(UTC) - timedelta(minutes=10))
    base.update(kw)
    return SimpleNamespace(**base)


class TestResposta:
    def test_responder_fecha_e_salva_conhecimento(self):
        ch = _chamado()
        res = MagicMock()
        res.scalar_one_or_none.return_value = ch
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(return_value=res)
        out = asyncio.run(chamados.responder(db, ch.pizzaria_id, ch.id, resposta=" Temos, na lateral. ",
                                             usuario_id="u1", salvar_conhecimento=True))
        assert out.status == "respondido" and out.resposta == "Temos, na lateral."
        salvo = db.add.call_args.args[0]
        assert salvo.pergunta == "vocês têm estacionamento?" and salvo.resposta == "Temos, na lateral."

    def test_chamado_ja_encerrado_nao_responde(self):
        res = MagicMock()
        res.scalar_one_or_none.return_value = _chamado(status="expirado")
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)
        assert asyncio.run(chamados.responder(db, uuid.uuid4(), uuid.uuid4(), resposta="x",
                                              usuario_id=None, salvar_conhecimento=False)) is None

    def test_precos_da_equipe_sao_lastro(self):
        assert 8.0 in chamados._precos_da_resposta("a taxa pro Cohatrac é R$ 8,00")

    def test_valor_com_cara_de_dinheiro_conta(self):
        assert chamados._precos_da_resposta("A taxa pro Centro Novo é 8 reais") == [8.0]
        assert chamados._precos_da_resposta("fica 15 a borda recheada") == [15.0]
        assert chamados._precos_da_resposta("a de calabresa sai 12,50") == [12.5]

    def test_prazo_endereco_e_quantidade_nao_viram_preco(self):
        """A09: qualquer número virava preço autorizado — "30 minutos" e o "nº 120"
        liberavam a voz a falar R$ 30 e R$ 120."""
        assert chamados._precos_da_resposta("Entregamos em 30 minutos no número 120, sem taxa extra.") == []
        assert chamados._precos_da_resposta("a pizza fica pronta em 40 min") == []
        assert chamados._precos_da_resposta("a família serve 4 pessoas, são 12 fatias") == []
        assert chamados._precos_da_resposta("liga no 98 98888-7777 que a gente resolve") == []
        assert chamados._precos_da_resposta("a taxa é 8 e chega em 40 minutos") == [8.0]


class TestPrazo:
    def test_chamado_vencido_vira_atendimento_humano(self):
        ch = _chamado()
        conv = SimpleNamespace(id=ch.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana")
        pizz = SimpleNamespace(id=ch.pizzaria_id, instancia="loja")

        def _res(valor, lista=False):
            r = MagicMock()
            r.scalars.return_value.all.return_value = valor if lista else []
            r.scalar_one_or_none.return_value = valor
            r.scalar_one.return_value = valor
            return r

        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(side_effect=[_res([ch], lista=True), _res(None), _res(pizz), _res(conv)])
        evo = MagicMock()
        evo.send_text = AsyncMock()
        with patch("app.services.evolution.evolution", new=evo), \
             patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()) as pub, \
             patch("app.services.chamados._limpar_pendente", new=AsyncMock()):
            n = asyncio.run(chamados.expirar_vencidos(db))

        assert n == 1 and ch.status == "expirado"
        assert conv.bot_ativo is False and conv.status == "humano_necessario"
        assert evo.send_text.await_args.kwargs["texto"] == chamados.MSG_EXPIRADO
        tipos = [c.args[1]["tipo"] for c in pub.await_args_list]
        assert "atendimento.humano" in tipos and "chamado.expirado" in tipos
