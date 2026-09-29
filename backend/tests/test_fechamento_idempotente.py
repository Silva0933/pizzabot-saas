"""
Fechamento do pedido à prova de duplicidade.

Antes: o turno de fechamento podia estourar o tempo depois de gravar o pedido
(gateway lento). O agente legado assumia o turno pela metade e, sem conhecer o
carrinho do FSM, podia registrar outro pedido e gerar outro Pix. E o registro
reaproveitava QUALQUER pedido 'novo'/'confirmado' não pago do cliente: o 2º
pedido da noite sobrescrevia os itens do 1º, já na cozinha.

Agora: o pedido é gravado antes do gateway; o "sim" repetido acha o MESMO pedido
pela chave de idempotência (id do fechamento criado no resumo) e reenvia a
cobrança existente; só o rascunho do funil é reaproveitado.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx():
    ctx = MagicMock()
    ctx.simulation = False
    ctx.telefone = "5598999999999"
    ctx.pizzaria.id = "00000000-0000-0000-0000-000000000001"
    ctx.pizzaria.instancia = "loja"
    ctx.pizzaria.tempo_entrega_min, ctx.pizzaria.tempo_entrega_max = 30, 45
    ctx.pizzaria.tempo_retirada_min, ctx.pizzaria.tempo_retirada_max = 15, 25
    ctx.pizzaria.modo_pagamento_online = "automatico"
    ctx.pizzaria.pix_manual_copia_cola = None
    return ctx


def _calc():
    return {"ok": True, "itens": [{"nome": "Pizza Brasa (G)", "quantidade": 1, "preco_unit": 64.9}],
            "valor_itens": 64.9, "taxa_entrega": 0.0, "valor_total": 64.9, "fingerprint": "f"}


def _pedido(**kw):
    base = dict(
        id="00000000-0000-0000-0000-0000000000aa", numero_pedido=77, status="novo", tipo="retirada",
        valor_total=64.9, taxa_entrega=0, payment_status="pending", payment_id="pay_1",
        link_pagamento=None, pix_copia_cola="000201PIX", aguardando_revisao=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _registrar(db, **kw):
    from app.agent.tools import registrar_pedido
    args = dict(itens=[{"nome": "Pizza Brasa", "tamanho": "G", "qtd": 1}], valor_total=64.9,
                tipo="retirada", forma_pagamento="pix", pagar_agora=True, confirmado=True)
    args.update(kw)
    return asyncio.run(registrar_pedido(_ctx(), db, **args))


class TestRetentativaDoFechamento:
    def test_sim_repetido_devolve_o_mesmo_pedido_e_reenvia_o_pix(self):
        existente = _pedido()
        res_lock = MagicMock()
        res_chave = MagicMock()
        res_chave.scalars.return_value.first.return_value = existente
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(side_effect=[res_lock, res_chave])
        evo = MagicMock()
        evo.send_text = AsyncMock()
        gerar = AsyncMock()

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=_calc())), \
             patch("app.agent.tools._gerar_cobranca", new=gerar), \
             patch("app.services.evolution.evolution", new=evo):
            r = _registrar(db, chave_idempotencia="wa:abc")

        assert r["ok"] and r["repetido"]
        assert r["numero_pedido"] == 77
        db.add.assert_not_called()          # nenhum pedido novo
        gerar.assert_not_awaited()          # nenhuma cobrança nova
        assert evo.send_text.await_args.kwargs["texto"] == "000201PIX"
        assert r["pagamento"] == {"ok": True, "metodo": "pix", "reenviada": True}

    def test_pedido_gravado_sem_cobranca_gera_a_cobranca_uma_vez(self):
        """O turno caiu entre gravar o pedido e chamar o gateway: a retentativa gera."""
        existente = _pedido(payment_id=None, pix_copia_cola=None)
        res_chave = MagicMock()
        res_chave.scalars.return_value.first.return_value = existente
        db = AsyncMock()
        db.add = MagicMock()
        db.execute = AsyncMock(side_effect=[MagicMock(), res_chave])
        gerar = AsyncMock(return_value={"ok": True, "metodo": "pix"})

        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=_calc())), \
             patch("app.agent.tools._gerar_cobranca", new=gerar):
            r = _registrar(db, chave_idempotencia="wa:abc")

        gerar.assert_awaited_once()
        assert r["pagamento"]["ok"]


class TestSoRascunhoEReaproveitado:
    def test_eh_rascunho(self):
        from app.agent.tools import eh_rascunho
        rascunho = _pedido(payment_id=None, pix_copia_cola=None)
        assert eh_rascunho(rascunho)
        assert not eh_rascunho(_pedido())                                   # tem cobrança
        assert not eh_rascunho(_pedido(status="confirmado", payment_id=None, pix_copia_cola=None))
        assert not eh_rascunho(_pedido(payment_id=None, pix_copia_cola=None, aguardando_revisao=True))
        assert not eh_rascunho(_pedido(payment_id=None, pix_copia_cola=None, payment_status="em_analise"))
        assert not eh_rascunho(None)


class TestRascunhoTemValidade:
    """Rascunho de 23/09 reaproveitado em 29/09: o pedido do dia nasceu com data
    velha e sumiu do quadro 'de hoje'. Rascunho vale 12 h."""

    def test_rascunho_recente_e_antigo(self):
        from datetime import UTC, datetime, timedelta

        from app.agent.tools import rascunho_recente
        base = dict(payment_id=None, pix_copia_cola=None)
        assert rascunho_recente(_pedido(**base, created_at=datetime.now(UTC) - timedelta(hours=2)))
        assert not rascunho_recente(_pedido(**base, created_at=datetime.now(UTC) - timedelta(days=6)))
        # Pedido de verdade (com cobrança) nunca é "rascunho", recente ou não.
        assert not rascunho_recente(_pedido(created_at=datetime.now(UTC)))

    def test_encerrar_rascunho_cancela_com_motivo(self):
        from unittest.mock import patch as _patch

        from app.agent.tools import encerrar_rascunho
        ped = _pedido(payment_id=None, pix_copia_cola=None, cancelado_at=None, cancelamento_motivo=None)
        with _patch("app.services.order_audit.registrar_evento_pedido") as evento:
            asyncio.run(encerrar_rascunho(MagicMock(), ped))
        assert ped.status == "cancelado" and "abandonado" in ped.cancelamento_motivo
        evento.assert_called_once()


class TestAvisoDoPainelDepoisDoCommit:
    def test_commit_antes_do_broadcast_e_do_gateway(self):
        """Painel e gateway só depois do pedido gravado (antes: flush + broadcast)."""
        from app.agent import tools

        ordem: list[str] = []
        cli = MagicMock()
        cli.id = "c1"
        cli.total_pedidos = 0
        cli.total_gasto = 0
        ctx = _ctx()
        ctx.cliente = cli
        res_chave = MagicMock()
        res_chave.scalars.return_value.first.return_value = None  # fechamento novo
        res_rascunho = MagicMock()
        res_rascunho.scalars.return_value.all.return_value = []
        db = AsyncMock()
        db.add = MagicMock()
        # trava do cliente, busca pela chave, busca do rascunho, ...
        db.execute = AsyncMock(side_effect=[MagicMock(), res_chave, res_rascunho] + [MagicMock()] * 5)

        async def _commit():
            ordem.append("commit")
        db.commit = AsyncMock(side_effect=_commit)

        async def _publish(*a, **k):
            ordem.append("broadcast")

        async def _cobrar(*a, **k):
            ordem.append("gateway")
            return {"ok": True, "metodo": "pix"}

        calc = {**_calc(), "taxa_entrega": 3.0, "valor_total": 67.9}
        with patch("app.agent.tools._calcular_pedido", new=AsyncMock(return_value=calc)), \
             patch("app.agent.tools._coords_localizacao_recente", new=AsyncMock(return_value=None)), \
             patch("app.services.order_audit.registrar_evento_pedido", new=MagicMock()), \
             patch("app.services.broadcaster.broadcaster.publish", new=AsyncMock(side_effect=_publish)), \
             patch("app.agent.tools._gerar_cobranca", new=AsyncMock(side_effect=_cobrar)), \
             patch("app.agent.behavior.get_behavior") as gb:
            gb.return_value.handoff.revisar_pedidos = False
            r = asyncio.run(tools.registrar_pedido(
                ctx, db, itens=[{"nome": "Pizza Brasa", "tamanho": "G", "qtd": 1}], valor_total=64.9,
                tipo="retirada", forma_pagamento="pix", pagar_agora=True, confirmado=True,
                chave_idempotencia="wa:novo",
            ))

        assert r["ok"]
        assert ordem[:3] == ["commit", "broadcast", "gateway"]
        novo = db.add.call_args_list[0].args[0]
        assert novo.chave_idempotencia == "wa:novo"
        # Taxa gravada no pedido, não só somada ao total (teste real de 29/09).
        assert float(novo.taxa_entrega) == 3.0
