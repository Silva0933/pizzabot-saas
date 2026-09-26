"""
Testes de robustez/prova-de-falhas (médios #4 e #6).

Travam comportamentos que, se quebrarem, causam prejuízo direto ao cliente:
  - #6: o bot NUNCA pode dizer que cancelou/alterou um pedido se a operação real
        falhou — tem que escalar pra humano e não confirmar.
  - #4: webhook reentregue pela Evolution não pode ser processado 2x (dedup).
"""
from __future__ import annotations

import asyncio
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ============================================================
# #6 — Falhas silenciosas no engine não confirmam mais "feito"
# ============================================================
def _ctx_db():
    ctx = MagicMock()
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.telefone = "5511999999999"
    db = MagicMock()
    return ctx, db


class TestCancelarFalha:
    def test_cancelar_excecao_escala_e_preserva_estado(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "cancelar", "dados": {}}

        with patch("app.agent.tools.cancelar_pedido", new=AsyncMock(side_effect=RuntimeError("db down"))):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock(return_value={"ok": True})) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="cancela"))

        assert out["decisao"]["acao"] == "escalado"
        # NÃO confirma cancelamento e NÃO reseta o estado do pedido.
        assert out["estado"]["etapa"] == "FINALIZADO"
        mock_esc.assert_awaited_once()

    def test_cancelar_ok_false_escala_com_motivo(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "cancelar", "dados": {}}

        with patch("app.agent.tools.cancelar_pedido",
                   new=AsyncMock(return_value={"ok": False, "erro": "já saiu pra entrega"})):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock()) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="cancela"))

        assert out["decisao"]["acao"] == "escalado"
        assert "já saiu pra entrega" in mock_esc.call_args.kwargs["motivo_escalonamento"]

    def test_cancelar_sucesso_confirma_e_reseta(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "cancelar", "dados": {}}

        with patch("app.agent.tools.cancelar_pedido",
                   new=AsyncMock(return_value={"ok": True, "numero_pedido": 42})):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock()) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="cancela"))

        assert out["decisao"]["acao"] == "cancelado"
        assert out["estado"]["etapa"] == "SAUDACAO"  # resetou (estado_inicial)
        mock_esc.assert_not_awaited()
        assert any("#42" in f for f in out["decisao"]["fatos"])


class TestAlterarFalha:
    def test_alterar_excecao_escala_e_nao_confirma(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "alterar_pedido", "dados": {"forma_pagamento": "pix"}}

        with patch("app.agent.tools.atualizar_pedido", new=AsyncMock(side_effect=RuntimeError("x"))):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock()) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="muda pra pix"))

        assert out["decisao"]["acao"] == "escalado"
        mock_esc.assert_awaited_once()

    def test_alterar_sucesso_confirma(self):
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "alterar_pedido", "dados": {"forma_pagamento": "pix"}}

        with patch("app.agent.tools.atualizar_pedido", new=AsyncMock(return_value={"ok": True})):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock()) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="muda pra pix"))

        assert out["decisao"]["acao"] == "pedido_atualizado"
        mock_esc.assert_not_awaited()


class TestAvaliarFalhaGraceful:
    def test_avaliar_falha_ainda_agradece(self):
        """Avaliação é baixo risco: se falhar ao gravar, ainda agradece (sem escalar)."""
        from app.agent.fsm import engine

        ctx, db = _ctx_db()
        estado = {"pipeline": "fsm", "etapa": "FINALIZADO", "carrinho": []}
        nlu = {"intencao": "avaliar", "dados": {"nota": 9}}

        with patch("app.agent.tools.registrar_avaliacao", new=AsyncMock(side_effect=RuntimeError("x"))):
            with patch("app.agent.tools.escalar_humano", new=AsyncMock()) as mock_esc:
                out = asyncio.run(engine.processar(db, ctx, estado, nlu, user_input="nota 9"))

        assert out["decisao"]["acao"] == "avaliado"
        mock_esc.assert_not_awaited()


# ============================================================
# #4 — Idempotência do webhook (dedup de reentrega)
# ============================================================
class TestWebhookDedup:
    def _payload(self):
        from app.schemas import EvolutionWebhookPayload
        return EvolutionWebhookPayload(
            event="messages.upsert",
            instance="inst1",
            data={
                "key": {"id": "MSG123", "remoteJid": "5511999999999@s.whatsapp.net"},
                "message": {"conversation": "Oi"},
                "pushName": "Cliente",
            },
        )

    def _pizz_db(self):
        pizz = MagicMock()
        pizz.id = "00000000-0000-0000-0000-000000000001"
        pizz.instancia = "inst1"
        pizz.suspensa = False
        pizz.bot_ativo_global = True

        res_pizz = MagicMock()
        res_pizz.scalar_one_or_none = MagicMock(return_value=pizz)
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res_pizz)
        return db

    def test_reentrega_e_ignorada(self):
        from app.routes.webhook import evolution_webhook

        request = MagicMock()
        request.query_params.get = MagicMock(return_value=None)
        db = self._pizz_db()

        # SET NX retornando None => chave já existia => mensagem duplicada.
        with patch("app.redis_client.redis.set", new=AsyncMock(return_value=None)) as mock_set:
            out = asyncio.run(evolution_webhook(self._payload(), request, db))

        assert out["ignored"] == "duplicate"
        assert out["evolution_id"] == "MSG123"
        # Garante que foi um SET NX (não um set comum).
        assert mock_set.call_args.kwargs.get("nx") is True

    def test_falha_ao_persistir_solta_a_marca_para_a_reentrega(self):
        """REGRESSÃO: a marca do dedup era gravada antes de persistir. Se o commit
        falhasse (ex.: 2 primeiras mensagens de um contato novo batendo no UNIQUE
        de conversas), a reentrega da Evolution era descartada como duplicada e a
        mensagem do cliente sumia."""
        from app.routes.webhook import evolution_webhook

        request = MagicMock()
        request.query_params.get = MagicMock(return_value=None)
        db = self._pizz_db()
        db.add = MagicMock()
        db.commit = AsyncMock(side_effect=RuntimeError("UNIQUE violado"))

        conv = MagicMock()
        conv.id = "00000000-0000-0000-0000-0000000000c1"
        conv.unread_count = 0
        with patch("app.redis_client.redis.set", new=AsyncMock(return_value=True)), \
             patch("app.redis_client.redis.delete", new=AsyncMock()) as mock_del, \
             patch("app.routes.webhook._get_or_create_conversa", new=AsyncMock(return_value=conv)), \
             patch("app.routes.webhook.broadcaster.publish", new=AsyncMock()), \
             pytest.raises(RuntimeError):
            asyncio.run(evolution_webhook(self._payload(), request, db))

        mock_del.assert_awaited_once_with("wh:seen:inst1:MSG123")


# ============================================================
# #5 — Inflight: mensagem não se perde se o worker crashar no flush
# ============================================================
@pytest.mark.skipif(
    not os.environ.get("REDIS_URL"),
    reason="Sem REDIS_URL — precisa de Redis real (drain/inflight)",
)
class TestInflightRecuperacao:
    def test_lote_sobrevive_a_crash_e_e_recuperado(self):
        from app.redis_client import redis
        from app.services.queue import confirm_processed, drain_pending, enqueue_message

        async def _run():
            pid = uuid.uuid4()
            phone = "5511888888888"

            await enqueue_message(
                pizzaria_id=pid, telefone=phone, mensagem_id=uuid.uuid4(), conteudo="quero pizza",
            )

            # 1º drain: tira da fila e guarda no inflight (worker vai processar).
            batch1 = await drain_pending(pid, phone)
            assert [b["conteudo"] for b in batch1] == ["quero pizza"]
            assert await redis.exists(f"inflight:{pid}:{phone}") == 1

            # "Crash" antes de confirmar (não chamamos confirm_processed). O próximo
            # drain recupera o lote órfão mesmo sem novas mensagens.
            batch2 = await drain_pending(pid, phone)
            assert [b["conteudo"] for b in batch2] == ["quero pizza"]

            # Confirmando o processamento, o inflight é limpo.
            await confirm_processed(pid, phone)
            assert await redis.exists(f"inflight:{pid}:{phone}") == 0

            # Sem inflight e sem pendentes, nada a recuperar.
            assert await drain_pending(pid, phone) == []

        asyncio.run(_run())


# ============================================================
# #3 — NLU não repete o teste de JSON Mode a cada mensagem
# ============================================================
class TestNluJsonModeCache:
    def test_nao_repete_json_mode_apos_primeira_falha(self):
        from app.agent.fsm import nlu

        chave = "openai:modelo-sem-json"
        nlu._SEM_JSON_MODE.discard(chave)

        chamadas: list[dict] = []

        async def fake_chat(**kw):
            chamadas.append(kw)
            if "response_format" in kw:
                raise RuntimeError("json mode unsupported")
            return {"content": '{"intencao":"saudacao","confianca_intencao":0.9,"dados_extraidos":{}}', "usage": {}}

        try:
            with patch("app.agent.providers.openai_chat", new=fake_chat):
                r1 = asyncio.run(nlu.nlu_extract(
                    provider="openai", api_key="k", model="modelo-sem-json",
                    estado_resumo="", historico_texto="", user_input="oi",
                ))
                assert r1["intencao"] == "saudacao"
                # 1ª vez: tenta com JSON (falha) + sem JSON = 2 chamadas.
                assert len(chamadas) == 2

                chamadas.clear()
                r2 = asyncio.run(nlu.nlu_extract(
                    provider="openai", api_key="k", model="modelo-sem-json",
                    estado_resumo="", historico_texto="", user_input="oi",
                ))
                assert r2["intencao"] == "saudacao"
                # 2ª vez: já sabe que não suporta → 1 chamada só, sem response_format.
                assert len(chamadas) == 1
                assert "response_format" not in chamadas[0]
        finally:
            nlu._SEM_JSON_MODE.discard(chave)
