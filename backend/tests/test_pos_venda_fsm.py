"""
Pós-venda do FSM: status e pagamento de um pedido JÁ fechado.

Conversas reais do teste com o agente (playground da Fornalha, 29/09):
  - "já ficou pronto meu pedido?" logo após fechar → "✅ Tirei: Pizza Brasa (M)"
    (o reset do estado esvaziava o carrinho e a confirmação anunciava remoção);
  - "já paguei o pix" → OUTRA cobrança + "o Pix já foi pago, reenviei o QR";
  - "vou pagar na hora de buscar" → OUTRA cobrança Pix + "reenviei o Pix".
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


def _ctx():
    ctx = MagicMock()
    ctx.pizzaria.id = "p"
    ctx.pizzaria.nome = "Fornalha"
    ctx.pizzaria.adicionais = []
    ctx.pizzaria.taxas_bairro = None
    ctx.pizzaria.taxa_entrega_fixa = None
    ctx.pizzaria.tema_cardapio = {}
    ctx.ultimo_pedido_resumo = None
    return ctx


def _estado_fechado(tipo="retirada"):
    from app.agent.fsm import engine
    estado = engine.estado_inicial()
    estado.update({
        "apresentou": True, "etapa": "FINALIZADO", "tipo": tipo, "pagamento": "pix",
        "pedido_numero": 42, "pedido_tipo": tipo,
        "carrinho": [{"iid": "i1", "nome": "Pizza Brasa", "tamanho": "M", "qtd": 1,
                      "preco_congelado": 49.9, "nome_congelado": "Pizza Brasa (M)"}],
    })
    return estado


def _pedido(status="no_forno", tipo="retirada", payment_status="pending", **kw):
    base = dict(numero_pedido=42, status=status, tipo=tipo, payment_status=payment_status,
                origem="whatsapp", aguardando_revisao=False)
    base.update(kw)
    return SimpleNamespace(**base)


def _rodar(estado, intencao, texto, *, ativo=None, dados=None, extras=None):
    from app.agent.fsm import engine
    gerar = AsyncMock(return_value={"ok": True})
    patches = [
        patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=ativo)),
        patch("app.agent.tools.gerar_pagamento", new=gerar),
        patch("app.agent.tools.buscar_cardapio", new=AsyncMock(return_value={"items": []})),
    ]
    for alvo, mock in (extras or {}).items():
        patches.append(patch(alvo, new=mock))
    for p in patches:
        p.start()
    try:
        nlu = {"intencao": intencao, "dados": dados or {}}
        out = asyncio.run(engine.processar(MagicMock(), _ctx(), estado, nlu, user_input=texto))
    finally:
        for p in patches:
            p.stop()
    return out, gerar


class TestStatusDepoisDeFechar:
    def test_ja_ficou_pronto_responde_o_status_real(self):
        out, _ = _rodar(_estado_fechado(), "duvida_geral", "já ficou pronto meu pedido?",
                        ativo=_pedido(status="no_forno"))
        assert out["decisao"]["acao"] == "status_pedido"
        assert out["decisao"]["mensagem_pronta"] == "Seu pedido #42 está no forno agora 🔥"
        # Não reseta o estado: o carrinho do pedido fechado continua lá.
        assert out["estado"]["etapa"] == "FINALIZADO"
        assert len(out["estado"]["carrinho"]) == 1

    def test_sem_pedido_no_banco_usa_o_numero_do_estado(self):
        out, _ = _rodar(_estado_fechado(), "duvida_geral", "já saiu?", ativo=None)
        assert out["decisao"]["acao"] == "status_pedido"
        assert "#42" in out["decisao"]["mensagem_pronta"]

    def test_pronto_para_entrega(self):
        out, _ = _rodar(_estado_fechado("delivery"), "duvida_geral", "cadê meu pedido?",
                        ativo=_pedido(status="a_caminho", tipo="delivery"))
        assert "saiu para entrega" in out["decisao"]["mensagem_pronta"]

    def test_novo_contato_apos_fechar_nao_anuncia_remocao(self):
        """Pergunta que não é de status: o estado reseta, e a decisão avisa o
        pipeline — que não pode anunciar '✅ Tirei' do pedido fechado."""
        out, _ = _rodar(_estado_fechado(), "duvida_geral", "vocês abrem domingo?", ativo=None)
        assert out["decisao"]["carrinho_resetado"] is True
        assert out["estado"]["carrinho"] == []

    def test_confirmacao_ignora_carrinho_resetado(self):
        from app.agent.fsm.confirmacao import confirmacao_do_turno
        antes = _estado_fechado()["carrinho"]
        # Com o reset, o pipeline compara com [] — nada a anunciar.
        assert confirmacao_do_turno([], []) is None
        assert "Tirei" in (confirmacao_do_turno(antes, []) or "")  # o bug, sem o flag


class TestPagamentoPosVenda:
    def test_ja_paguei_nao_gera_cobranca(self):
        reenviar = AsyncMock()
        out, gerar = _rodar(_estado_fechado(), "informar_pagamento", "já paguei o pix",
                            ativo=_pedido(status="novo", payment_id="pay_1"),
                            extras={"app.agent.tools.reenviar_cobranca": reenviar})
        gerar.assert_not_awaited()
        reenviar.assert_not_awaited()
        assert "Assim que o pagamento cair" in out["decisao"]["mensagem_pronta"]

    def test_ja_paguei_com_pagamento_aprovado(self):
        out, gerar = _rodar(_estado_fechado(), "informar_pagamento", "já paguei",
                            ativo=_pedido(status="confirmado", payment_status="approved"))
        gerar.assert_not_awaited()
        assert out["decisao"]["mensagem_pronta"].startswith("Pagamento confirmado ✅")

    def test_manda_o_pix_de_novo_reenvia_a_mesma_cobranca(self):
        reenviar = AsyncMock(return_value={"ok": True, "metodo": "pix", "reenviada": True})
        out, gerar = _rodar(_estado_fechado(), "informar_pagamento", "manda o pix de novo",
                            ativo=_pedido(status="novo", payment_id="pay_1"),
                            extras={"app.agent.tools.reenviar_cobranca": reenviar})
        reenviar.assert_awaited_once()
        gerar.assert_not_awaited()
        assert out["decisao"]["mensagem_pronta"] == "Reenviei o código Pix aí em cima 👆"

    def test_pagar_na_retirada_pergunta_a_forma_e_nao_cobra(self):
        atualizar = AsyncMock(return_value={"ok": True, "numero_pedido": 42})
        estado = _estado_fechado()
        out, gerar = _rodar(estado, "alterar_pedido", "vou pagar na hora de buscar, pode ser?",
                            ativo=_pedido(status="novo", payment_id="pay_1"),
                            extras={"app.agent.tools.atualizar_pedido": atualizar})
        gerar.assert_not_awaited()
        atualizar.assert_not_awaited()
        assert "dinheiro, cartão ou Pix" in out["decisao"]["mensagem_pronta"]
        assert out["estado"]["aguardando_forma_pos_venda"] is True

        out2, gerar2 = _rodar(out["estado"], "informar_pagamento", "dinheiro",
                              ativo=_pedido(status="novo", payment_id="pay_1"),
                              extras={"app.agent.tools.atualizar_pedido": atualizar})
        gerar2.assert_not_awaited()
        atualizar.assert_awaited_once()
        assert atualizar.await_args.kwargs == {"nova_forma_pagamento": "dinheiro", "pagar_na_entrega": True}
        assert out2["decisao"]["mensagem_pronta"] == "Combinado! O pedido #42 fica pra pagar em dinheiro na retirada 😊"
        assert "aguardando_forma_pos_venda" not in out2["estado"]

    def test_pagar_na_entrega_com_a_forma_ja_dita(self):
        atualizar = AsyncMock(return_value={"ok": True, "numero_pedido": 42})
        out, gerar = _rodar(_estado_fechado("delivery"), "alterar_pedido", "vou pagar no cartão na entrega",
                            ativo=_pedido(status="novo", tipo="delivery", payment_id="pay_1"),
                            extras={"app.agent.tools.atualizar_pedido": atualizar})
        gerar.assert_not_awaited()
        assert atualizar.await_args.kwargs["nova_forma_pagamento"] == "cartao"
        assert "no cartão na entrega" in out["decisao"]["mensagem_pronta"]


class TestReenviarCobranca:
    def _ctx_real(self):
        ctx = MagicMock()
        ctx.simulation = False
        ctx.pizzaria.instancia = "loja"
        ctx.telefone = "5598999999999"
        return ctx

    def test_reenvia_o_codigo_guardado_sem_nova_cobranca(self):
        from app.agent import tools
        ped = _pedido(status="novo", payment_id="pay_1", link_pagamento=None,
                      pix_copia_cola="00020126PIX", forma_pagamento="pix")
        evo = MagicMock()
        evo.send_text = AsyncMock()
        gerar = AsyncMock()
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=ped)), \
             patch("app.agent.tools._gerar_cobranca", new=gerar), \
             patch("app.services.evolution.evolution", new=evo):
            r = asyncio.run(tools.reenviar_cobranca(self._ctx_real(), MagicMock()))
        assert r["ok"] and r["reenviada"]
        evo.send_text.assert_awaited_once()
        assert evo.send_text.await_args.kwargs["texto"] == "00020126PIX"
        gerar.assert_not_awaited()

    def test_sem_cobranca_e_pagamento_na_entrega(self):
        from app.agent import tools
        ped = _pedido(status="confirmado", payment_id=None, link_pagamento=None,
                      pix_copia_cola=None, forma_pagamento="pix")
        gerar = AsyncMock()
        with patch("app.agent.tools.pedido_ativo_do_cliente", new=AsyncMock(return_value=ped)), \
             patch("app.agent.tools._gerar_cobranca", new=gerar):
            r = asyncio.run(tools.reenviar_cobranca(self._ctx_real(), MagicMock()))
        assert r == {"ok": False, "motivo": "pagamento_na_entrega", "numero_pedido": 42}
        gerar.assert_not_awaited()


class TestMensagemDeFechamento:
    def test_entrega_diz_chega_em(self):
        from app.agent.fsm.engine import _montar_registro_msg
        msg = _montar_registro_msg(7, "30-45 min", None, False, tipo="delivery")
        assert "Chega em aproximadamente 30-45 min." in msg

    def test_retirada_diz_fica_pronto(self):
        from app.agent.fsm.engine import _montar_registro_msg
        msg = _montar_registro_msg(7, "15-25 min", None, False, tipo="retirada")
        assert "Fica pronto em aproximadamente 15-25 min." in msg
