"""
Nenhum lote some sem desfecho (achados A06/A07 da análise de 01/10).

Antes:
  - dispatcher e worker liberavam o lote (inflight) e confirmavam no `finally`,
    mesmo depois de exceção: o cliente ficava sem resposta, sem humano e sem
    nova tentativa;
  - mensagem gravada pelo webhook que não entrava na fila (Redis/broker fora
    depois do commit) nunca era processada: a reentrega da Evolution caía no
    dedup como duplicada.

Agora a exceção mantém o lote e agenda nova tentativa; esgotadas, a conversa vai
para humano (gravado) e só então o lote sai. O webhook não lança depois do
commit, e o reconciliador do beat recupera a mensagem que ficou sem lote.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import recuperacao

PID = uuid.UUID("00000000-0000-0000-0000-000000000001")
TEL = "5511999990000"
CONV = f"{PID}:{TEL}"


class _FakeSession:
    async def __aenter__(self):
        s = MagicMock()
        s.rollback = AsyncMock()
        return s

    async def __aexit__(self, *a):
        return False


class _FakeRedis:
    """O mínimo de Redis que o desfecho e o reconciliador usam."""

    def __init__(self, dados=None):
        self.dados: dict = dict(dados or {})

    async def incr(self, k):
        self.dados[k] = int(self.dados.get(k, 0)) + 1
        return self.dados[k]

    async def expire(self, *_a, **_k):
        return True

    async def get(self, k):
        return self.dados.get(k)

    async def set(self, k, v, **_k):
        self.dados[k] = v
        return True

    async def exists(self, *ks):
        return sum(1 for k in ks if k in self.dados)

    async def delete(self, *ks):
        for k in ks:
            self.dados.pop(k, None)

    def pipeline(self):
        pai = self

        class _Pipe:
            def __init__(self):
                self.ops = []

            def delete(self, k):
                self.ops.append(("del", k))

            def set(self, k, v, **_k):
                self.ops.append(("set", k, v))

            async def execute(self):
                for op in self.ops:
                    if op[0] == "del":
                        pai.dados.pop(op[1], None)
                    else:
                        pai.dados[op[1]] = op[2]

        return _Pipe()


# --------------------------------------------------------------------------- #
# Dispatcher
# --------------------------------------------------------------------------- #
def _redis_dispatcher():
    r = MagicMock()
    r.incr = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.decr = AsyncMock()
    r.set = AsyncMock(return_value=True)
    r.delete = AsyncMock()
    return r


def _handle(*, process, lote_falhou=None):
    from app.dispatcher import runner
    from app.services import queue
    sem = asyncio.Semaphore(1)
    asyncio.run(sem.acquire())
    falhou = lote_falhou or AsyncMock(return_value=recuperacao.ESPERA_NOVA_TENTATIVA_S)
    with patch("app.redis_client.redis", _redis_dispatcher()), \
         patch.object(queue, "drain_pending", new=AsyncMock(return_value=[{"conteudo": "oi"}])), \
         patch.object(queue, "confirm_processed", new=AsyncMock()) as confirm, \
         patch.object(queue, "rearm_dispatcher", new=AsyncMock()) as rearm, \
         patch.object(runner.streams, "ack", new=AsyncMock()) as ack, \
         patch("app.services.recuperacao.lote_falhou", new=falhou), \
         patch("app.services.recuperacao.lote_concluido", new=AsyncMock()) as concluido, \
         patch("app.agent.runner.process_and_reply", new=process), \
         patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()):
        asyncio.run(runner._handle("9-0", CONV, sem))
    return confirm, rearm, ack, concluido, falhou, sem


class TestDispatcher:
    def test_excecao_mantem_o_lote_e_agenda_nova_tentativa(self):
        confirm, rearm, ack, concluido, falhou, sem = _handle(process=AsyncMock(side_effect=RuntimeError("banco caiu")))
        confirm.assert_not_awaited()          # o lote NÃO sai do inflight
        concluido.assert_not_awaited()
        falhou.assert_awaited_once()
        assert rearm.await_args.args[2] == recuperacao.ESPERA_NOVA_TENTATIVA_S
        ack.assert_awaited_once_with("9-0")   # a entrada do stream sai; quem retoma é o ZSET
        assert not sem.locked()

    def test_desfecho_com_humano_nao_rearma(self):
        _c, rearm, _a, _con, _f, _s = _handle(process=AsyncMock(side_effect=RuntimeError("x")),
                                              lote_falhou=AsyncMock(return_value=None))
        rearm.assert_not_awaited()

    def test_sucesso_conclui_o_lote(self):
        _c, rearm, _a, concluido, falhou, _s = _handle(process=AsyncMock(return_value={"ok": True}))
        concluido.assert_awaited_once()
        falhou.assert_not_awaited()
        rearm.assert_not_awaited()


# --------------------------------------------------------------------------- #
# Tentativas e desistência
# --------------------------------------------------------------------------- #
class TestLoteFalhou:
    def _rodar(self, redis, escalou=True):
        with patch("app.redis_client.redis", redis), \
             patch("app.services.queue.redis", redis), \
             patch.object(recuperacao, "escalar_sem_resposta", new=AsyncMock(return_value=escalou)) as esc:
            espera = asyncio.run(recuperacao.lote_falhou(PID, TEL, RuntimeError("x")))
        return espera, esc

    def test_primeiras_falhas_tentam_de_novo(self):
        r = _FakeRedis()
        for _ in range(recuperacao.MAX_TENTATIVAS_LOTE - 1):
            espera, esc = self._rodar(r)
            assert espera == recuperacao.ESPERA_NOVA_TENTATIVA_S
            esc.assert_not_awaited()

    def test_esgotou_vai_para_humano_e_libera_o_lote(self):
        r = _FakeRedis({recuperacao._chave_tentativas(PID, TEL): recuperacao.MAX_TENTATIVAS_LOTE - 1,
                        f"inflight:{PID}:{TEL}": "lote"})
        espera, esc = self._rodar(r)
        assert espera is None
        esc.assert_awaited_once()
        assert f"inflight:{PID}:{TEL}" not in r.dados               # só agora o lote sai
        assert recuperacao._chave_processado(PID, TEL) in r.dados

    def test_humano_nao_gravou_mantem_o_lote(self):
        r = _FakeRedis({recuperacao._chave_tentativas(PID, TEL): recuperacao.MAX_TENTATIVAS_LOTE - 1,
                        f"inflight:{PID}:{TEL}": "lote"})
        espera, _esc = self._rodar(r, escalou=False)
        assert espera == recuperacao.ESPERA_SEM_DESFECHO_S
        assert f"inflight:{PID}:{TEL}" in r.dados


class TestEscalar:
    def test_cliente_recebe_aviso_de_transferencia_e_conversa_vai_para_humano(self):
        """Esgotadas as tentativas: o cliente é avisado que a equipe vai responder
        (nunca "me manda de novo" — a mensagem dele está gravada)."""
        pizz = MagicMock()
        pizz.instancia = "inst1"
        conv = MagicMock()
        conv.id = uuid.uuid4()
        conv.bot_ativo = True
        conv.cliente_nome = "Ana"
        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        resultados = iter([pizz, conv, None])

        async def _exec(*_a, **_k):
            r = MagicMock()
            v = next(resultados)
            r.scalar_one.return_value = v
            r.scalar_one_or_none.return_value = v
            r.scalars.return_value.first.return_value = v
            return r

        db.execute = _exec

        class _Sessao:
            async def __aenter__(self):
                return db

            async def __aexit__(self, *a):
                return False

        evo = MagicMock()
        evo.send_text = AsyncMock()
        with patch("app.db.AsyncSessionLocal", new=lambda: _Sessao()), \
             patch("app.services.evolution.evolution", new=evo), \
             patch("app.agent.behavior.handoff_message", return_value="Vou chamar alguém da equipe 😊"), \
             patch("app.services.alertas.registrar_alerta", new=AsyncMock()) as alerta, \
             patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock()):
            ok = asyncio.run(recuperacao.escalar_sem_resposta(PID, TEL, motivo="falha técnica"))
        assert ok is True
        assert evo.send_text.await_args.kwargs["texto"] == "Vou chamar alguém da equipe 😊"
        assert conv.bot_ativo is False and conv.status == "humano_necessario"
        assert db.add.call_args.args[0].origem == "sistema"
        assert alerta.await_args.kwargs["tipo"] == "sem_resposta"
        db.commit.assert_awaited()


# --------------------------------------------------------------------------- #
# Worker Celery
# --------------------------------------------------------------------------- #
class TestCelery:
    def test_excecao_nao_confirma_e_reagenda(self):
        from app.workers import tasks
        redis = MagicMock()
        redis.set = AsyncMock(return_value=True)
        redis.delete = AsyncMock()
        redis.aclose = AsyncMock()
        flush = MagicMock()
        with patch("app.redis_client.redis", redis), \
             patch("app.services.queue.should_flush_now", new=AsyncMock(return_value=(True, 0.0))), \
             patch("app.services.queue.drain_pending", new=AsyncMock(return_value=[{"conteudo": "oi"}])), \
             patch("app.services.recuperacao.lote_falhou",
                   new=AsyncMock(return_value=recuperacao.ESPERA_NOVA_TENTATIVA_S)) as falhou, \
             patch("app.services.recuperacao.lote_concluido", new=AsyncMock()) as concluido, \
             patch("app.agent.runner.process_and_reply", new=AsyncMock(side_effect=RuntimeError("x"))), \
             patch("app.db.AsyncSessionLocal", new=lambda: _FakeSession()), \
             patch("app.db.engine", new=MagicMock(dispose=AsyncMock())), \
             patch.object(tasks, "flush_conversation", new=flush):
            out = asyncio.run(tasks._flush_async(PID, TEL, None))
        assert out["ok"] is False
        concluido.assert_not_awaited()
        falhou.assert_awaited_once()
        assert flush.apply_async.call_args.kwargs["countdown"] == recuperacao.ESPERA_NOVA_TENTATIVA_S


# --------------------------------------------------------------------------- #
# Reconciliador
# --------------------------------------------------------------------------- #
def _linha(**kw):
    base = dict(conv_id=uuid.uuid4(), pid=PID, tel_conv=TEL, msg_id=uuid.uuid4(),
                criado=datetime.now(UTC) - timedelta(minutes=5), conteudo="tem calabresa?",
                tel_jid=TEL, horario={}, aberto_manual=None, usar_dispatcher=True)
    base.update(kw)
    return tuple(base.values())


def _reconciliar(linhas, redis, *, remontar=None):
    db = MagicMock()
    db.commit = AsyncMock()

    async def _exec(sql, *_a, **_k):
        r = MagicMock()
        texto = str(sql)
        if "JOIN LATERAL" in texto and "m.origem = 'cliente'" in texto:
            r.all.return_value = linhas
        elif "origem = 'cliente'" in texto and "COALESCE" in texto and "epoch" in texto:
            r.all.return_value = remontar or []
        else:
            r.all.return_value = []
        return r

    db.execute = _exec
    with patch("app.redis_client.redis", redis), \
         patch("app.services.queue.redis", redis), \
         patch("app.services.queue.rearm_dispatcher", new=AsyncMock()) as rearm, \
         patch("app.services.queue.enqueue_message", new=AsyncMock()) as enfileirar, \
         patch.object(recuperacao, "escalar_sem_resposta", new=AsyncMock(return_value=True)) as escalar, \
         patch("app.services.alertas.registrar_alerta", new=AsyncMock()):
        out = asyncio.run(recuperacao.reconciliar(db))
    return out, rearm, enfileirar, escalar


class TestReconciliador:
    def test_lote_perdido_e_remontado_do_banco(self):
        linha = _linha()
        r = _FakeRedis()
        out, rearm, enfileirar, escalar = _reconciliar([linha], r, remontar=[(uuid.uuid4(), "tem calabresa?")])
        assert out["recuperadas"] == 1
        assert enfileirar.await_args.kwargs["conteudo"] == "tem calabresa?"
        rearm.assert_awaited_once()
        escalar.assert_not_awaited()
        assert recuperacao._chave_recuperada(linha[3]) in r.dados

    def test_lote_parado_no_redis_so_rearma(self):
        r = _FakeRedis({f"inflight:{PID}:{TEL}": "lote"})
        out, rearm, enfileirar, _e = _reconciliar([_linha()], r)
        assert out["recuperadas"] == 1
        enfileirar.assert_not_awaited()      # não duplica o que já está na fila
        rearm.assert_awaited_once()

    def test_sendo_processada_agora_nao_mexe(self):
        r = _FakeRedis({f"lock:flush:{PID}:{TEL}": "1"})
        out, rearm, _q, _e = _reconciliar([_linha()], r)
        assert out["recuperadas"] == 0
        rearm.assert_not_awaited()

    def test_processada_sem_resposta_de_proposito_nao_mexe(self):
        """Ex.: cota do plano atingida — process_and_reply não responde de propósito."""
        r = _FakeRedis({recuperacao._chave_processado(PID, TEL): str(time.time())})
        out, rearm, _q, _e = _reconciliar([_linha()], r)
        assert out["recuperadas"] == 0
        rearm.assert_not_awaited()

    def test_ja_recuperada_e_segue_sem_resposta_vai_para_humano(self):
        linha = _linha()
        r = _FakeRedis({recuperacao._chave_recuperada(linha[3]): "1"})
        out, rearm, _q, escalar = _reconciliar([linha], r)
        assert out["escaladas"] == 1
        escalar.assert_awaited_once()
        rearm.assert_not_awaited()

    def test_fora_do_horario_nao_recupera(self):
        """A IA não responde fora do horário de propósito (a loja manda o aviso fixo)."""
        linha = _linha(aberto_manual=False, conteudo="quero uma pizza de frango")
        out, rearm, _q, _e = _reconciliar([linha], _FakeRedis())
        assert out["recuperadas"] == 0
        rearm.assert_not_awaited()


# --------------------------------------------------------------------------- #
# Webhook: Redis fora depois do commit
# --------------------------------------------------------------------------- #
class TestWebhookFilaFora:
    def test_mensagem_gravada_nao_derruba_o_webhook(self):
        """Lançar aqui fazia a Evolution reentregar e o dedup descartar: mensagem
        aceita e nunca processada. Agora fica para o reconciliador."""
        from app.routes.webhook import evolution_webhook
        from app.schemas import EvolutionWebhookPayload
        payload = EvolutionWebhookPayload(
            event="messages.upsert", instance="inst1",
            data={"key": {"id": "MSG9", "remoteJid": f"{TEL}@s.whatsapp.net"},
                  "message": {"conversation": "Oi"}, "pushName": "Cliente"},
        )
        pizz = MagicMock()
        pizz.id = PID
        pizz.instancia = "inst1"
        pizz.suspensa = False
        pizz.bot_ativo_global = True
        pizz.usar_dispatcher = True
        pizz.aberto_manual = True
        conv = MagicMock()
        conv.id = uuid.uuid4()
        conv.bot_ativo = True
        conv.unread_count = 0
        res = MagicMock()
        res.scalar_one_or_none = MagicMock(return_value=pizz)
        res.scalars.return_value.first.return_value = MagicMock()
        res.scalars.return_value.all.return_value = []
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(return_value=res)
        request = MagicMock()
        request.query_params.get = MagicMock(return_value=None)
        # config_atual lê a config da Evolution no banco REAL pelo engine global: no
        # CI (Postgres de verdade) o pool ficava preso ao loop deste teste e o teste
        # de integração seguinte quebrava com "Event loop is closed".
        with patch("app.redis_client.redis.set", new=AsyncMock(return_value=True)), \
             patch("app.services.evolution.evolution.config_atual", new=AsyncMock(return_value={"webhook_token": ""})), \
             patch("app.routes.webhook._get_or_create_conversa", new=AsyncMock(return_value=conv)), \
             patch("app.services.order_audit.registrar_evento_pedido", new=MagicMock()), \
             patch("app.routes.webhook.enqueue_message", new=AsyncMock(side_effect=ConnectionError("Redis fora"))), \
             patch("app.services.alertas.registrar_alerta_seguro", new=AsyncMock()) as alerta, \
             patch("app.routes.webhook.broadcaster.publish", new=AsyncMock(side_effect=ConnectionError("Redis fora"))):
            out = asyncio.run(evolution_webhook(payload, request, db))
        assert out["ok"] is True
        assert any(c.kwargs.get("tipo") == "falha_fila" for c in alerta.await_args_list)
        gravada = next(c.args[0] for c in db.add.call_args_list if getattr(c.args[0], "origem", None) == "cliente")
        assert gravada.metadata_json["telefone_jid"] == TEL
