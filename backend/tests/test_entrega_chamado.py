"""
Resposta do chamado só é "resolvida" quando chega ao cliente (achado A04 da
análise de 01/10).

Antes: o chamado virava 'respondido' (o painel mostrava "Resolvido") e a entrega
dependia de uma task publicada DEPOIS do commit. Broker fora nesse intervalo,
erro da Evolution ou worker caindo deixavam a resposta sem chegar — a task só
devolvia {ok: false}, nada tentava de novo e a expiração só olhava chamados
abertos. Também não havia trava: task duplicada mandava duas vezes, e a
expiração podia gravar 'expirado' por cima de uma resposta recém-salva.

Agora: entrega 'pendente' nasce na mesma transação da resposta; um UPDATE
condicional deixa um só worker enviar; falha volta para 'pendente' e o beat
tenta de novo; esgotadas as tentativas, a conversa vai para um humano.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import chamados


def _chamado(**kw):
    base = dict(id=uuid.uuid4(), pizzaria_id=uuid.uuid4(), conversa_id=uuid.uuid4(), telefone="5598999999999",
                pergunta="vocês têm estacionamento?", motivo="sem_resposta", contexto={}, status="respondido",
                resposta="Temos, na lateral da loja.", respondido_por=None, respondido_em=datetime.now(UTC),
                created_at=datetime.now(UTC) - timedelta(minutes=10), entrega_status="enviando",
                entrega_tentativas=1, entrega_atualizada_em=datetime.now(UTC), entrega_erro=None, entregue_em=None)
    base.update(kw)
    return SimpleNamespace(**base)


def _res(valor=None, linhas=None, ids=None):
    r = MagicMock()
    r.scalar_one_or_none.return_value = valor
    r.scalar_one.return_value = valor
    r.all.return_value = linhas or []
    r.scalars.return_value.all.return_value = ids or []
    return r


def _db(*resultados):
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock(side_effect=list(resultados))
    return db


def _entregar(db, *, send_text):
    evo = MagicMock()
    evo.send_text = send_text
    with patch("app.services.evolution.evolution", new=evo), \
         patch("app.services.chamados._limpar_pendente", new=AsyncMock()), \
         patch("app.services.app_config.get_llm_config", new=AsyncMock(side_effect=RuntimeError("sem LLM"))), \
         patch("app.agent.memory.append_turn", new=AsyncMock()), \
         patch("app.services.alertas.registrar_alerta", new=AsyncMock()) as alerta, \
         patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()) as pub:
        out = asyncio.run(chamados.entregar_resposta(db, uuid.uuid4()))
    return out, evo, alerta, pub


def _fluxo(ch, conv, tentativa):
    pizz = SimpleNamespace(id=ch.pizzaria_id, instancia="loja", nome="Pizzaria", plano="pro")
    return _db(
        _res(tentativa),     # UPDATE ... RETURNING (trava)
        _res(ch), _res(pizz), _res(conv),
        _res(None),          # personalidade
        _res(True),          # bot segue ativo antes do envio
    )


class TestResponder:
    def test_resposta_nasce_com_entrega_pendente(self):
        ch = _chamado(status="aberto", entrega_status=None, resposta=None)
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(return_value=_res(ch))
        out = asyncio.run(chamados.responder(db, ch.pizzaria_id, ch.id, resposta="Temos.",
                                             usuario_id=None, salvar_conhecimento=False))
        assert out.status == "respondido" and out.entrega_status == "pendente"
        db.commit.assert_awaited_once()      # resposta + intenção de entregar na MESMA transação


class TestEntrega:
    def test_outro_worker_ja_pegou_nao_envia(self):
        """Task duplicada: o UPDATE condicional não pega nenhuma linha."""
        db = _db(_res(None))
        out, evo, _a, _p = _entregar(db, send_text=AsyncMock())
        assert out["motivo"] == "ja_em_entrega_ou_entregue"
        evo.send_text.assert_not_awaited()

    def test_sucesso_marca_enviado_e_grava_a_mensagem(self):
        ch = _chamado()
        conv = SimpleNamespace(id=ch.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana",
                               last_message=None, last_timestamp=None)
        db = _fluxo(ch, conv, tentativa=1)
        out, evo, _a, pub = _entregar(db, send_text=AsyncMock(return_value={}))
        assert out["ok"] is True
        assert ch.entrega_status == "enviado" and ch.entregue_em is not None
        enviado = evo.send_text.await_args.kwargs["texto"]
        assert enviado == "Confirmei aqui com a equipe: Temos, na lateral da loja."   # LLM fora: resposta direta
        assert ch.contexto["mensagem_ao_cliente"] == enviado
        assert db.add.call_args.args[0].origem == "bot"
        assert "chamado.respondido" in [c.args[1]["tipo"] for c in pub.await_args_list]

    def test_falha_de_envio_volta_para_pendente(self):
        ch = _chamado()
        conv = SimpleNamespace(id=ch.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana")
        db = _fluxo(ch, conv, tentativa=1)
        out, _evo, _a, _p = _entregar(db, send_text=AsyncMock(side_effect=RuntimeError("Evolution 500")))
        assert out["motivo"] == "vai_tentar_de_novo"
        assert ch.entrega_status == "pendente" and "Evolution 500" in ch.entrega_erro
        assert conv.bot_ativo is True            # ainda não desistiu

    def test_ultima_tentativa_falha_vai_para_humano(self):
        ch = _chamado(entrega_tentativas=chamados.MAX_TENTATIVAS_ENTREGA)
        conv = SimpleNamespace(id=ch.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana")
        db = _fluxo(ch, conv, tentativa=chamados.MAX_TENTATIVAS_ENTREGA)
        out, _evo, alerta, pub = _entregar(db, send_text=AsyncMock(side_effect=RuntimeError("Evolution 500")))
        assert out["motivo"] == "falhou"
        assert ch.entrega_status == "falhou"
        assert conv.bot_ativo is False and conv.status == "humano_necessario"
        assert db.add.call_args.args[0].origem == "sistema"
        alerta.assert_awaited()
        assert "atendimento.humano" in [c.args[1]["tipo"] for c in pub.await_args_list]

    def test_humano_assumiu_durante_a_voz_nao_envia(self):
        ch = _chamado()
        conv = SimpleNamespace(id=ch.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana")
        pizz = SimpleNamespace(id=ch.pizzaria_id, instancia="loja", nome="Pizzaria", plano="pro")
        db = _db(_res(1), _res(ch), _res(pizz), _res(conv), _res(None), _res(False))
        out, evo, _a, _p = _entregar(db, send_text=AsyncMock())
        assert out["motivo"] == "humano_assumiu" and ch.entrega_status == "humano"
        evo.send_text.assert_not_awaited()


class TestBeat:
    def test_retoma_pendente_e_desiste_do_que_esgotou(self):
        esgotado = _chamado(entrega_tentativas=chamados.MAX_TENTATIVAS_ENTREGA, entrega_erro="Evolution 500")
        normal = _chamado(entrega_tentativas=1)
        conv = SimpleNamespace(id=esgotado.conversa_id, bot_ativo=True, status="bot_ativo", cliente_nome="Ana")
        db = _db(_res(ids=[esgotado.id, normal.id]), _res(esgotado), _res(conv), _res(normal))
        with patch("app.services.chamados.entregar_resposta", new=AsyncMock(return_value={"ok": True})) as entregar, \
             patch("app.services.alertas.registrar_alerta", new=AsyncMock()), \
             patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()):
            out = asyncio.run(chamados.retomar_entregas(db))
        assert out == {"retomados": 1, "desistidos": 1}
        assert esgotado.entrega_status == "falhou" and conv.status == "humano_necessario"
        assert entregar.await_args.args[1] == normal.id

    def test_expiracao_nao_atropela_resposta_recente(self):
        """A linha travada pelo `responder` (ou já respondida) volta None no SKIP
        LOCKED: nada de gravar 'expirado' por cima da resposta."""
        ch = _chamado(status="aberto")
        db = _db(_res(linhas=[(ch.id, ch.pizzaria_id, ch.created_at)]), _res(None), _res(None))
        with patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()) as pub:
            n = asyncio.run(chamados.expirar_vencidos(db))
        assert n == 0 and ch.status == "aberto"
        pub.assert_not_awaited()


class TestRota:
    def test_broker_fora_nao_derruba_a_resposta(self):
        """Antes: `.delay` lançava depois do commit → 500 no painel com a resposta
        já salva, e ninguém mais publicava a entrega. Agora o beat retoma."""
        from app.routes import chamados as rota
        ch = _chamado(status="respondido", entrega_status="pendente")
        tarefa = MagicMock()
        tarefa.delay.side_effect = ConnectionError("broker fora")
        with patch("app.services.chamados.responder", new=AsyncMock(return_value=ch)), \
             patch("app.workers.periodic.entregar_resposta_chamado", new=tarefa), \
             patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()):
            out = asyncio.run(rota.responder_chamado(
                ch.pizzaria_id, ch.id, rota.ResponderIn(resposta="Temos."), db=AsyncMock(), vinculo=MagicMock(),
            ))
        assert out["ok"] is True and out["entrega_status"] == "pendente"
