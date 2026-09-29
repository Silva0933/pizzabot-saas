"""
Proteção do número contra banimento (services/protecao_whatsapp.py).

Denúncia de quem recebeu mensagem que não pediu, rajada de envios e número novo
com volume alto são o que mais derruba número na API não oficial.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import protecao_whatsapp as pw


def _pizz(dias_conectado: float | None = 30):
    desde = None if dias_conectado is None else datetime.now(UTC) - timedelta(days=dias_conectado)
    return SimpleNamespace(id="p1", instancia="inst", whatsapp_conectado_desde=desde)


class TestDescadastro:
    @pytest.mark.parametrize("texto", [
        "pare de me mandar mensagem",
        "Para de mandar mensagem por favor",
        "não quero mais receber essas mensagens",
        "Nao me mande mais nada",
        "me tira dessa lista",
        "quero me descadastrar",
        "STOP",
    ])
    def test_pedido_para_parar(self, texto):
        assert pw.eh_pedido_para_parar(texto)

    @pytest.mark.parametrize("texto", [
        "quero uma pizza para mim",
        "pare",  # ambíguo: não descadastra
        "cancela o pedido",
        "para de hoje à noite, uma calabresa",
        "pode mandar o cardápio",
    ])
    def test_nao_e_pedido_para_parar(self, texto):
        assert not pw.eh_pedido_para_parar(texto)

    def test_marca_o_cliente(self):
        cli = SimpleNamespace(nao_perturbe=False, nao_perturbe_em=None)
        res = MagicMock()
        res.scalars.return_value.first.return_value = cli
        db = AsyncMock()
        db.execute = AsyncMock(return_value=res)
        assert asyncio.run(pw.marcar_nao_perturbe(db, "p1", "5598999999999"))
        assert cli.nao_perturbe is True and cli.nao_perturbe_em is not None


class TestAquecimento:
    def test_janela_de_14_dias(self):
        assert pw.em_aquecimento(_pizz(3))
        assert not pw.em_aquecimento(_pizz(20))
        assert pw.em_aquecimento(_pizz(None))  # nunca conectou: conservador


def _porteiro(pizz, *, tipo, nao_perturbe=False, horas_ultima_msg=1.0, cota=True):
    ultima = None if horas_ultima_msg is None else datetime.now(UTC) - timedelta(hours=horas_ultima_msg)
    with patch.object(pw, "_cliente_nao_perturbe", new=AsyncMock(return_value=nao_perturbe)), \
         patch.object(pw, "_ultima_msg_do_cliente", new=AsyncMock(return_value=ultima)), \
         patch.object(pw, "_consumir_cota_ativa", new=AsyncMock(return_value=cota)):
        return asyncio.run(pw.pode_enviar_ativo(AsyncMock(), pizz, "5598999999999", tipo=tipo))


class TestPorteiroMensagensAtivas:
    def test_cliente_da_conversa_recente_recebe(self):
        assert _porteiro(_pizz(), tipo="resgate_carrinho") == (True, "ok")

    def test_fora_da_janela_de_24h(self):
        assert _porteiro(_pizz(), tipo="nps", horas_ultima_msg=30) == (False, "fora_da_janela_24h")

    def test_quem_nunca_escreveu_nao_recebe(self):
        # Pedido do cardápio digital sem conversa no WhatsApp: sem pesquisa.
        assert _porteiro(_pizz(), tipo="nps", horas_ultima_msg=None) == (False, "fora_da_janela_24h")

    def test_quem_pediu_para_parar(self):
        assert _porteiro(_pizz(), tipo="lembrete_confirmacao", nao_perturbe=True) == (
            False, "cliente_pediu_para_parar")

    def test_aquecimento_bloqueia_resgate_e_pesquisa(self):
        assert _porteiro(_pizz(2), tipo="resgate_carrinho") == (False, "numero_em_aquecimento")
        assert _porteiro(_pizz(2), tipo="nps") == (False, "numero_em_aquecimento")
        # O lembrete de "posso fechar?" ajuda o cliente: segue no aquecimento.
        assert _porteiro(_pizz(2), tipo="lembrete_confirmacao") == (True, "ok")

    def test_teto_por_hora(self):
        assert _porteiro(_pizz(), tipo="resgate_carrinho", cota=False) == (False, "teto_por_hora")


class TestRitmoPorNumero:
    def test_espera_a_vez_do_numero(self):
        redis = MagicMock()
        redis.eval = AsyncMock(return_value=1500)  # próximo envio livre daqui a 1,5 s
        dormir = AsyncMock()
        with patch("app.redis_client.redis", redis), patch("asyncio.sleep", dormir):
            esperou = asyncio.run(pw.aguardar_vez("inst", "transacional"))
        assert esperou == 1.5
        dormir.assert_awaited_once_with(1.5)
        # Gap de transacional (2–4 s) reservado para o próximo envio.
        gap_ms = redis.eval.await_args.args[-1]
        assert 2000 <= gap_ms <= 4000

    def test_resposta_nunca_espera_demais(self):
        redis = MagicMock()
        redis.eval = AsyncMock(return_value=90_000)
        with patch("app.redis_client.redis", redis), patch("asyncio.sleep", AsyncMock()):
            assert asyncio.run(pw.aguardar_vez("inst", "resposta")) == 10.0

    def test_sem_redis_nao_trava_o_atendimento(self):
        redis = MagicMock()
        redis.eval = AsyncMock(side_effect=ConnectionError("redis fora"))
        with patch("app.redis_client.redis", redis):
            assert asyncio.run(pw.aguardar_vez("inst")) == 0.0
