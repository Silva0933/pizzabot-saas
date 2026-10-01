"""
Texto gerado não é prova de envio (achado A05 da análise de 01/10).

Uma falha da Evolution só virava alerta: a resposta era gravada como mensagem do
bot, igual a uma entregue, e as não lidas eram zeradas — no painel parecia que o
cliente tinha sido respondido. Agora o envio devolve o que de fato saiu (enviado
| parcial | falhou | interrompido), isso vai para o metadata da mensagem e as
não lidas só zeram quando a resposta chegou inteira. E nada depois do envio
lança exceção: o lote seria tentado de novo e o cliente receberia a resposta duas
vezes.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.humanized_delivery import send_humanized_text

TEXTO_2_BALOES = "Primeira parte da resposta.\n\nSegunda parte da resposta?"


def _evolution(send_text):
    evo = MagicMock()
    evo.send_presence = AsyncMock()
    evo.send_text = send_text
    return evo


def _enviar(evo, can_send=None):
    with patch("app.services.humanized_delivery.asyncio.sleep", new=AsyncMock()):
        return asyncio.run(send_humanized_text(
            evolution=evo, instancia="inst", numero="5511999999999", texto=TEXTO_2_BALOES, can_send=can_send,
        ))


class TestResultadoDoEnvio:
    def test_tudo_enviado(self):
        evo = _evolution(AsyncMock(return_value={"key": {"id": "WA1"}}))
        r = _enviar(evo)
        assert r.status == "enviado" and r.partes_enviadas == 2 and r.partes_total == 2
        assert r.ids == ["WA1", "WA1"]

    def test_falha_no_primeiro_balao_nao_lanca(self):
        evo = _evolution(AsyncMock(side_effect=RuntimeError("Evolution 500")))
        r = _enviar(evo)
        assert r.status == "falhou" and r.partes_enviadas == 0
        assert "Evolution 500" in r.erro

    def test_falha_no_meio_e_parcial(self):
        evo = _evolution(AsyncMock(side_effect=[{"key": {"id": "WA1"}}, RuntimeError("caiu")]))
        r = _enviar(evo)
        assert r.status == "parcial" and r.partes_enviadas == 1
        assert r.como_dict()["partes_total"] == 2

    def test_humano_assumiu_no_meio(self):
        respostas = iter([True, True, False])   # pode antes do 1º digitando, antes do 1º envio; depois não

        async def _pode():
            return next(respostas, False)

        evo = _evolution(AsyncMock(return_value={}))
        r = _enviar(evo, can_send=_pode)
        assert r.status == "interrompido" and r.partes_enviadas == 1


# ----------------------------------------------------------------------------
# process_and_reply: o que vai para o histórico
# ----------------------------------------------------------------------------
def _rodar(*, send_text, commit=None):
    from app.agent.runner import process_and_reply

    db = AsyncMock()
    db.add = MagicMock()
    if commit is not None:
        db.commit = commit
    pizz = MagicMock()
    pizz.pipeline_fsm = True
    pizz.instancia = "inst"
    pizz.id = "00000000-0000-0000-0000-000000000001"
    pizz.suspensa = False
    pizz.bot_ativo_global = True
    res_pizz = MagicMock()
    res_pizz.scalar_one = MagicMock(return_value=pizz)
    conv = MagicMock()
    conv.id = "00000000-0000-0000-0000-000000000002"
    conv.bot_ativo = True
    conv.unread_count = 3
    res_conv = MagicMock()
    res_conv.scalars.return_value.first.return_value = conv
    generico = MagicMock()
    generico.scalar_one_or_none = MagicMock(return_value=True)   # bot segue ativo entre os balões
    db.execute.side_effect = [res_pizz, res_conv] + [generico] * 20

    resultado = MagicMock()
    resultado.texto = TEXTO_2_BALOES
    resultado.iteracoes = 1
    resultado.tool_calls = ["fsm:responder_duvida:duvida_geral"]
    resultado.precos_tool = set()
    resultado.trace = {}

    with patch("app.agent.fsm.pipeline.run_fsm_agent", new=AsyncMock(return_value=resultado)), \
         patch("app.agent.behavior.delivery_options", return_value={}), \
         patch("app.services.humanized_delivery.asyncio.sleep", new=AsyncMock()), \
         patch("app.agent.runner.evolution.send_presence", new=AsyncMock()), \
         patch("app.agent.runner.evolution.send_text", new=send_text), \
         patch("app.services.alertas.registrar_alerta_seguro", new_callable=AsyncMock) as alerta, \
         patch("app.agent.runner.broadcaster.publish", new_callable=AsyncMock) as publicar:
        r = asyncio.run(process_and_reply(db, pizz.id, "5511999999999", "tem estacionamento?"))
    gravadas = [c.args[0] for c in db.add.call_args_list]
    return r, conv, gravadas, alerta, publicar


class TestHistorico:
    def test_falha_de_envio_fica_registrada_e_nao_zera_nao_lidas(self):
        r, conv, gravadas, alerta, publicar = _rodar(send_text=AsyncMock(side_effect=RuntimeError("Evolution fora")))
        msg = gravadas[-1]
        assert msg.origem == "bot"
        assert msg.metadata_json["envio"]["status"] == "falhou"
        assert conv.unread_count == 3            # segue pedindo atenção no painel
        assert r["envio"]["status"] == "falhou"
        assert any(c.kwargs.get("tipo") == "falha_envio" for c in alerta.call_args_list)
        # o painel recebe o estado junto com a mensagem
        nova = next(c.args[1] for c in publicar.call_args_list if c.args[1]["tipo"] == "mensagem.nova")
        assert nova["payload"]["metadata"]["envio"]["status"] == "falhou"

    def test_envio_ok_zera_nao_lidas(self):
        r, conv, gravadas, _alerta, _pub = _rodar(send_text=AsyncMock(return_value={"key": {"id": "WA9"}}))
        assert gravadas[-1].metadata_json["envio"]["status"] == "enviado"
        assert conv.unread_count == 0
        assert r["ok"] is True

    def test_falha_ao_gravar_depois_do_envio_nao_lanca(self):
        """A resposta já saiu: lançar aqui faria o lote ser reprocessado e o
        cliente receber tudo de novo."""
        r, _conv, _gravadas, alerta, _pub = _rodar(
            send_text=AsyncMock(return_value={}), commit=AsyncMock(side_effect=RuntimeError("banco caiu")),
        )
        assert r["envio"]["status"] == "enviado"
        assert any(c.kwargs.get("tipo") == "falha_registro" for c in alerta.call_args_list)
