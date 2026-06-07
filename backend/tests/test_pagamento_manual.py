"""
Testes do pagamento na conversa configurável (automatico/manual/desativado) e do
fluxo de Pix manual com conferência do comprovante.

Travam os comportamentos que evitam prejuízo:
  - modo do pagamento lido com default seguro ('automatico');
  - Pix manual marca o pedido como 'em_analise' e envia o copia-e-cola;
  - mensagem de fechamento fala em comprovante (não promete confirmação automática);
  - comprovante de pedido 'em_analise' é detectado e NÃO reabre o funil.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ============================================================
# Helpers de modo / wording (funções puras)
# ============================================================
class TestModoPagamento:
    def test_default_automatico(self):
        from app.agent.fsm.engine import _modo_pagamento
        p = MagicMock()
        p.modo_pagamento_online = None
        assert _modo_pagamento(p) == "automatico"

    def test_le_valor_configurado(self):
        from app.agent.fsm.engine import _modo_pagamento
        p = MagicMock()
        p.modo_pagamento_online = "manual"
        assert _modo_pagamento(p) == "manual"
        p.modo_pagamento_online = "desativado"
        assert _modo_pagamento(p) == "desativado"


class TestRegistroPixManual:
    def test_fechamento_fala_em_comprovante(self):
        from app.agent.fsm.engine import _montar_registro_msg
        m = _montar_registro_msg(99, "40 min", "pix_manual", True)
        assert "#99" in m
        assert "comprovante" in m.lower()
        # não pode prometer confirmação automática
        assert "pagamento cair" not in m.lower()


# ============================================================
# Detecção do comprovante (função pura)
# ============================================================
class TestPareceComprovante:
    def test_detecta_imagem_e_frases(self):
        from app.agent.fsm.pipeline import _parece_comprovante
        assert _parece_comprovante("[imagem]")
        assert _parece_comprovante("acabei de pagar, segue o comprovante")
        assert _parece_comprovante("Paguei!")
        assert _parece_comprovante("fiz o pix")

    def test_ignora_mensagem_normal(self):
        from app.agent.fsm.pipeline import _parece_comprovante
        assert not _parece_comprovante("quero uma pizza de calabresa")
        assert not _parece_comprovante("qual o endereço de vocês?")


# ============================================================
# Pix manual: envia copia-e-cola e marca 'em_analise'
# ============================================================
class TestEnviarPixManual:
    def test_marca_em_analise_e_envia_codigo(self):
        import app.agent.tools as tools

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.pizzaria.instancia = "inst"
        ctx.pizzaria.pix_manual_titular = "Maria"
        ctx.telefone = "5511999999999"
        db = MagicMock()
        db.flush = AsyncMock()
        ped = MagicMock()
        ped.valor_total = 55.0
        ped.numero_pedido = 7

        with patch("app.services.evolution.evolution.send_text", new=AsyncMock()) as send:
            with patch("app.agent.tools._notificar_painel_pagamento_manual", new=AsyncMock()) as notif:
                res = asyncio.run(tools._enviar_pix_manual(ctx, db, ped, "PIXCOPIACOLA123"))

        assert ped.payment_status == "em_analise"
        assert res["ok"] is True and res["metodo"] == "pix_manual"
        # intro + código (em mensagens separadas, igual ao fluxo do gateway)
        assert send.await_count == 2
        textos = [c.kwargs.get("texto") for c in send.await_args_list]
        assert "PIXCOPIACOLA123" in textos
        notif.assert_awaited_once()


# ============================================================
# Comprovante: dá ack + notifica e NÃO roda o funil
# ============================================================
def _db_com_pedido(ped):
    """db.execute(...).scalars().first() → ped."""
    exec_result = MagicMock()
    exec_result.scalars.return_value.first.return_value = ped
    db = MagicMock()
    db.execute = AsyncMock(return_value=exec_result)
    db.commit = AsyncMock()
    return db


class TestCheckComprovante:
    def test_comprovante_em_pedido_em_analise_responde_e_notifica(self):
        from app.agent.fsm import pipeline

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.cliente.id = "00000000-0000-0000-0000-0000000000aa"
        ped = MagicMock()
        ped.numero_pedido = 7
        ped.payment_status = "em_analise"
        db = _db_com_pedido(ped)

        with patch("app.agent.tools._notificar_painel_pagamento_manual", new=AsyncMock()) as notif:
            with patch("app.agent.memory.append_turn", new=AsyncMock()):
                res = asyncio.run(pipeline._checar_comprovante_manual(db, ctx, ctx.pizzaria.id, "[imagem]"))

        assert res is not None
        assert res.tool_calls == ["fsm:comprovante_recebido"]
        assert "conferir" in res.texto.lower() or "confiro" in res.texto.lower() or "confirmo" in res.texto.lower()
        notif.assert_awaited_once()

    def test_mensagem_normal_nao_dispara(self):
        from app.agent.fsm import pipeline

        ctx = MagicMock()
        res = asyncio.run(pipeline._checar_comprovante_manual(MagicMock(), ctx, "5511999999999", "quero uma calabresa"))
        assert res is None

    def test_sem_pedido_em_analise_segue_fluxo(self):
        from app.agent.fsm import pipeline

        ctx = MagicMock()
        ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
        ctx.cliente.id = "00000000-0000-0000-0000-0000000000aa"
        db = _db_com_pedido(None)  # nenhum pedido aguardando conferência

        res = asyncio.run(pipeline._checar_comprovante_manual(db, ctx, ctx.pizzaria.id, "paguei"))
        assert res is None
