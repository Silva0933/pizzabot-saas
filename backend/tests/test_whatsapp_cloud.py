"""
API oficial do WhatsApp (Cloud API da Meta) como conexão separada da Evolution.

A integração "WHATSAPP-BUSINESS" da Evolution v2.3.7 guarda o número do cliente
numa variável da instância antes de processar a mensagem: com dois clientes
escrevendo juntos, a mensagem de um podia ser atribuída ao outro — e ela não
confere a assinatura da Meta. Por isso a Meta fala direto com o PizzaBot:
entrada pelo /webhook/whatsapp-cloud/{id} (assinatura conferida) e saída pela
Graph API, desviada dentro do cliente da Evolution pelo prefixo da instância.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import whatsapp_cloud as wc

# Valores FALSOS no formato da Meta (token longo, App Secret de 32 hex).
TOKEN_FALSO = "EAA" + "x" * 60
SECRET_FALSO = "0123456789abcdef0123456789abcdef"
CRED = wc.Credencial(pizzaria_id=uuid.uuid4(), phone_number_id="111", token="tok-falso")


def _assinar(segredo: str, corpo: bytes) -> str:
    return "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------- #
# Assinatura e conversão da mensagem
# --------------------------------------------------------------------------- #
class TestAssinatura:
    def test_confere_com_app_secret(self):
        corpo = b'{"a":1}'
        assert wc.assinatura_confere("segredo", corpo, _assinar("segredo", corpo))

    def test_recusa_assinatura_errada_ausente_ou_sem_segredo(self):
        corpo = b'{"a":1}'
        assert not wc.assinatura_confere("segredo", corpo, _assinar("outro", corpo))
        assert not wc.assinatura_confere("segredo", corpo, None)
        assert not wc.assinatura_confere(None, corpo, _assinar("segredo", corpo))
        assert not wc.assinatura_confere("segredo", b'{"a":2}', _assinar("segredo", corpo))


class TestConversao:
    def _conv(self, m, contatos=None):
        from app.routes.webhook import _extract_content
        data = wc.mensagem_para_evolution({"from": "5511988887777", "id": "wamid.X", "timestamp": "1700000000", **m},
                                          contatos or {"5511988887777": "Ana"})
        return data, (_extract_content(data) if data else None)

    def test_texto_vira_conversation_com_jid_e_nome(self):
        data, (conteudo, tipo, meta) = self._conv({"type": "text", "text": {"body": "quero uma calabresa"}})
        assert data["key"] == {"remoteJid": "5511988887777@s.whatsapp.net", "fromMe": False, "id": "wamid.X"}
        assert data["pushName"] == "Ana"
        assert (conteudo, tipo) == ("quero uma calabresa", "texto")

    def test_audio_guarda_id_da_midia_e_mime_base(self):
        data, (conteudo, tipo, _) = self._conv(
            {"type": "audio", "audio": {"id": "MID1", "mime_type": "audio/ogg; codecs=opus", "voice": True}})
        assert (conteudo, tipo) == ("[áudio]", "audio")
        assert data["message"]["audioMessage"] == {"id": "MID1", "mimetype": "audio/ogg", "ptt": True}

    def test_botao_e_lista_viram_o_titulo(self):
        _, (c1, _, _) = self._conv({"type": "interactive",
                                    "interactive": {"type": "button_reply", "button_reply": {"id": "b1", "title": "Sim"}}})
        _, (c2, _, _) = self._conv({"type": "button", "button": {"text": "Quero pedir", "payload": "x"}})
        assert (c1, c2) == ("Sim", "Quero pedir")

    def test_localizacao_no_formato_do_pipeline(self):
        _, (conteudo, tipo, _) = self._conv({"type": "location", "location": {"latitude": -23.5, "longitude": -46.6}})
        assert tipo == "localizacao" and conteudo.startswith("[localizacao lat=-23.5 lon=-46.6]")

    def test_documento_vira_nao_suportada_e_reacao_e_ignorada(self):
        _, (conteudo, _, _) = self._conv({"type": "document", "document": {"id": "D"}})
        assert conteudo == "[mensagem não suportada]"
        data, _ = self._conv({"type": "reaction", "reaction": {"message_id": "x", "emoji": "👍"}})
        assert data is None


# --------------------------------------------------------------------------- #
# Envio: o cliente da Evolution desvia a instância da API oficial para a Meta
# --------------------------------------------------------------------------- #
class TestEnvio:
    def _rodar(self, coro_fn, *, janela=True, cred=CRED):
        chamadas: list[tuple] = []

        async def fake_chamar(metodo, path, token, **kw):
            chamadas.append((metodo, path, kw.get("json")))
            return {"messages": [{"id": "wamid.SAIU"}]}

        with patch.object(wc, "credencial", new=AsyncMock(return_value=cred)), \
             patch.object(wc, "_janela_aberta", new=AsyncMock(return_value=janela)), \
             patch.object(wc, "_nome_do_cliente", new=AsyncMock(return_value="Ana")), \
             patch.object(wc, "_chamar", new=fake_chamar), \
             patch("app.services.protecao_whatsapp.aguardar_vez", new=AsyncMock(return_value=0.0)):
            out = asyncio.run(coro_fn())
        return out, chamadas

    def test_texto_dentro_da_janela_sai_pela_graph_com_id(self):
        from app.services.evolution import evolution
        out, chamadas = self._rodar(lambda: evolution.send_text(
            instancia="cloudapi-loja", numero="5511988887777", texto="Oi!"))
        assert out["key"]["id"] == "wamid.SAIU"   # humanized_delivery lê daqui
        metodo, path, body = chamadas[0]
        assert (metodo, path) == ("POST", "111/messages")
        assert body["to"] == "5511988887777" and body["type"] == "text" and body["text"]["body"] == "Oi!"

    def test_fora_da_janela_usa_o_modelo_com_nome_e_texto_sem_quebra(self):
        from app.services.evolution import evolution
        cred = wc.Credencial(pizzaria_id=CRED.pizzaria_id, phone_number_id="111", token="t",
                             modelo_nome="atualizacao_pedido", modelo_idioma="pt_BR", modelo_parametros=2)
        _, chamadas = self._rodar(lambda: evolution.send_text(
            instancia="cloudapi-loja", numero="5511988887777", texto="Pedido #12 confirmado!\n\n1x Calabresa"),
            janela=False, cred=cred)
        body = chamadas[0][2]
        assert body["type"] == "template" and body["template"]["name"] == "atualizacao_pedido"
        params = [p["text"] for p in body["template"]["components"][0]["parameters"]]
        assert params == ["Ana", "Pedido #12 confirmado! · 1x Calabresa"]

    def test_fora_da_janela_sem_modelo_falha_como_envio_que_nao_saiu(self):
        from app.services.evolution import EvolutionError, evolution
        with pytest.raises(EvolutionError):
            self._rodar(lambda: evolution.send_text(instancia="cloudapi-loja", numero="55119", texto="x"), janela=False)

    def test_midia_recebida_baixa_pela_graph(self):
        from app.services.evolution import evolution
        with patch.object(wc, "credencial", new=AsyncMock(return_value=CRED)), \
             patch.object(wc, "baixar_midia", new=AsyncMock(return_value="QkFTRTY0")) as baixar:
            b64 = asyncio.run(evolution.get_media_base64(
                instancia="cloudapi-loja",
                message={"key": {"id": "w"}, "message": {"audioMessage": {"id": "MID1", "mimetype": "audio/ogg"}}}))
        assert b64 == "QkFTRTY0"
        baixar.assert_awaited_once_with(CRED, "MID1")

    def test_digitando_sem_mensagem_recebida_nao_quebra(self):
        from app.services.evolution import evolution
        redis = MagicMock(get=AsyncMock(return_value=None))
        with patch.object(wc, "credencial", new=AsyncMock(return_value=CRED)), \
             patch("app.redis_client.redis", redis):
            out = asyncio.run(evolution.send_presence(instancia="cloudapi-loja", numero="5511988887777"))
        assert out == {"ok": False}

    def test_instancia_da_evolution_nao_consulta_a_api_oficial(self):
        from app.services.evolution import evolution
        cliente = MagicMock(post=AsyncMock(return_value=MagicMock(is_error=False, json=lambda: {"key": {"id": "E"}})))
        with patch.object(wc, "credencial", new=AsyncMock()) as cred, \
             patch.object(evolution, "_http", new=AsyncMock(return_value=cliente)), \
             patch("app.services.protecao_whatsapp.aguardar_vez", new=AsyncMock(return_value=0.0)):
            asyncio.run(evolution.send_text(instancia="pizzaria-loja", numero="5511", texto="Oi"))
        cred.assert_not_awaited()
        assert cliente.post.await_args.args[0] == "/message/sendText/pizzaria-loja"

    def test_webhook_da_evolution_nao_e_reaplicado_na_api_oficial(self):
        from app.services.evolution import evolution
        with patch.object(evolution, "_http", new=AsyncMock(side_effect=AssertionError("não devia chamar"))):
            assert asyncio.run(evolution.set_webhook(instancia="cloudapi-loja", webhook_url="x")) == {"api_oficial": True}
            assert asyncio.run(evolution.delete_instance(instancia="cloudapi-loja")) == {"api_oficial": True}


def test_variavel_do_modelo_sem_quebra_de_linha_nem_espacos_seguidos():
    assert wc._texto_de_variavel("a\n\n  b\tc     d") == "a · b c d"
    assert len(wc._texto_de_variavel("x" * 2000)) == 900


def test_api_oficial_nao_entra_em_aquecimento():
    from app.services.protecao_whatsapp import em_aquecimento
    assert em_aquecimento(SimpleNamespace(whatsapp_tipo="cloud_api", whatsapp_conectado_desde=None)) is False
    assert em_aquecimento(SimpleNamespace(whatsapp_tipo="qrcode", whatsapp_conectado_desde=None)) is True


def test_config_publica_nunca_devolve_token_nem_app_secret():
    pizz = SimpleNamespace(whatsapp_tipo="cloud_api",
                           whatsapp_cloud={"token": "enc:x", "app_secret": "enc:y", "phone_number_id": "1"})
    pub = wc.config_publica(pizz)
    assert pub["token_configurado"] and pub["app_secret_configurado"]
    assert "enc:x" not in json.dumps(pub) and "enc:y" not in json.dumps(pub)


# --------------------------------------------------------------------------- #
# Webhook da Meta
# --------------------------------------------------------------------------- #
def _pizzaria(**cfg):
    from app.services.secrets import encrypt_secret
    base = {"phone_number_id": "111", "app_secret": encrypt_secret("segredo-app"), "verify_token": "verif-123"}
    base.update(cfg)
    return SimpleNamespace(id=uuid.uuid4(), whatsapp_tipo="cloud_api", instancia="cloudapi-loja", whatsapp_cloud=base)


def _request(corpo: bytes = b"", assinatura: str | None = None, query: dict | None = None):
    req = MagicMock()
    req.body = AsyncMock(return_value=corpo)
    req.headers = {"x-hub-signature-256": assinatura} if assinatura else {}
    req.query_params = query or {}
    return req


def _payload(numero_id="111", mensagens=None, statuses=None):
    value = {"metadata": {"phone_number_id": numero_id},
             "contacts": [{"wa_id": "5511988887777", "profile": {"name": "Ana"}}]}
    if mensagens is not None:
        value["messages"] = mensagens
    if statuses is not None:
        value["statuses"] = statuses
    return json.dumps({"object": "whatsapp_business_account",
                       "entry": [{"changes": [{"field": "messages", "value": value}]}]}).encode()


class TestWebhookMeta:
    def _receber(self, pizz, corpo, assinatura):
        from app.routes import webhook
        with patch.object(webhook, "_pizzaria_por_id", new=AsyncMock(return_value=pizz)), \
             patch.object(webhook, "processar_mensagem", new=AsyncMock(return_value={"ok": True})) as proc, \
             patch.object(wc, "guardar_ultima_recebida", new=AsyncMock()), \
             patch.object(webhook, "_registrar_falha_cloud", new=AsyncMock()) as falha, \
             patch.object(webhook, "_primeira_na_hora", new=AsyncMock(return_value=True)), \
             patch("app.services.alertas.registrar_alerta_seguro", new=AsyncMock()) as alerta:
            out = asyncio.run(webhook.whatsapp_cloud_receber(str(pizz.id), _request(corpo, assinatura), AsyncMock()))
        return out, proc, falha, alerta

    def test_assinatura_invalida_recusa_e_alerta(self):
        corpo = _payload(mensagens=[{"from": "5511988887777", "id": "w1", "type": "text", "text": {"body": "oi"}}])
        out, proc, _, alerta = self._receber(_pizzaria(), corpo, _assinar("chute", corpo))
        assert out.status_code == 401
        proc.assert_not_awaited()
        alerta.assert_awaited_once()

    def test_mensagem_assinada_entra_no_mesmo_fluxo_da_evolution(self):
        corpo = _payload(mensagens=[{"from": "5511988887777", "id": "w1", "type": "text", "text": {"body": "oi"}}])
        pizz = _pizzaria()
        out, proc, _, _ = self._receber(pizz, corpo, _assinar("segredo-app", corpo))
        assert out == {"ok": True, "mensagens": 1}
        _, instancia, data = proc.await_args.args
        assert instancia == "cloudapi-loja"
        assert data["key"]["remoteJid"] == "5511988887777@s.whatsapp.net" and data["pushName"] == "Ana"

    def test_mensagem_para_outro_numero_e_ignorada(self):
        corpo = _payload(numero_id="999", mensagens=[{"from": "55", "id": "w1", "type": "text", "text": {"body": "x"}}])
        out, proc, _, _ = self._receber(_pizzaria(), corpo, _assinar("segredo-app", corpo))
        assert out["mensagens"] == 0
        proc.assert_not_awaited()

    def test_loja_ainda_no_qrcode_nao_processa(self):
        corpo = _payload(mensagens=[{"from": "55", "id": "w1", "type": "text", "text": {"body": "x"}}])
        pizz = _pizzaria()
        pizz.whatsapp_tipo = "qrcode"
        out, proc, _, _ = self._receber(pizz, corpo, _assinar("segredo-app", corpo))
        assert out == {"ignored": "api_oficial_inativa"}
        proc.assert_not_awaited()

    def test_falha_de_entrega_avisada_depois_e_registrada(self):
        corpo = _payload(statuses=[{"id": "wamid.SAIU", "status": "failed", "recipient_id": "55",
                                    "errors": [{"code": 131047, "title": "Re-engagement message"}]}])
        out, _, falha, _ = self._receber(_pizzaria(), corpo, _assinar("segredo-app", corpo))
        assert out["ok"]
        falha.assert_awaited_once()
        assert "24 h" in wc.motivo_falha(falha.await_args.args[2])

    def test_verificacao_devolve_o_challenge_e_marca_verificado(self):
        from app.routes import webhook
        pizz = _pizzaria()
        db = AsyncMock()
        q = {"hub.mode": "subscribe", "hub.verify_token": "verif-123", "hub.challenge": "42"}
        with patch.object(webhook, "_pizzaria_por_id", new=AsyncMock(return_value=pizz)):
            resp = asyncio.run(webhook.whatsapp_cloud_verificar(str(pizz.id), _request(query=q), db))
        assert resp.body == b"42"
        assert pizz.whatsapp_cloud["webhook_verificado_em"]
        db.commit.assert_awaited()

    def test_verificacao_com_token_errado_recusa(self):
        from app.routes import webhook
        pizz = _pizzaria()
        q = {"hub.mode": "subscribe", "hub.verify_token": "chute", "hub.challenge": "42"}
        with patch.object(webhook, "_pizzaria_por_id", new=AsyncMock(return_value=pizz)):
            resp = asyncio.run(webhook.whatsapp_cloud_verificar(str(pizz.id), _request(query=q), AsyncMock()))
        assert resp.status_code == 403
        assert "webhook_verificado_em" not in pizz.whatsapp_cloud

    def test_webhook_da_evolution_ignora_nome_de_instancia_oficial(self):
        from app.routes import webhook
        from app.schemas import EvolutionWebhookPayload
        payload = EvolutionWebhookPayload(event="messages.upsert", instance="cloudapi-loja",
                                          data={"key": {"remoteJid": "55@s.whatsapp.net", "id": "x"}})
        req = MagicMock()
        req.query_params.get = MagicMock(return_value=None)
        s = MagicMock(is_production=False, evolution_webhook_token="")
        with patch("app.config.get_settings", return_value=s), \
             patch("app.services.evolution.evolution.config_atual", new=AsyncMock(return_value={"webhook_token": ""})), \
             patch.object(webhook, "processar_mensagem", new=AsyncMock()) as proc:
            out = asyncio.run(webhook.evolution_webhook(payload, req, AsyncMock()))
        assert out == {"ignored": "instancia_api_oficial"}
        proc.assert_not_awaited()


# --------------------------------------------------------------------------- #
# Rotas do painel
# --------------------------------------------------------------------------- #
class TestRotasPainel:
    def test_ativar_exige_webhook_verificado(self):
        from fastapi import HTTPException

        from app.routes import pizzarias
        pizz = _pizzaria()
        pizz.whatsapp_tipo = "qrcode"
        pizz.whatsapp_cloud["token"] = "tok-claro"
        with patch.object(pizzarias, "_pizzaria_ou_404", new=AsyncMock(return_value=pizz)):
            with pytest.raises(HTTPException) as e:
                asyncio.run(pizzarias.api_oficial_ativar(pizz.id, AsyncMock(), None))
        assert e.value.status_code == 400 and "verificou" in e.value.detail

    def test_ativar_desliga_o_qrcode_e_troca_a_instancia(self):
        from app.routes import pizzarias
        pizz = _pizzaria(webhook_verificado_em="2026-10-01T00:00:00+00:00", token="tok-claro")
        pizz.whatsapp_tipo, pizz.instancia, pizz.nome, pizz.whatsapp_estado = "qrcode", "pizzaria-loja", "Loja", "close"
        with patch.object(pizzarias, "_pizzaria_ou_404", new=AsyncMock(return_value=pizz)), \
             patch.object(wc, "estado", new=AsyncMock(return_value="open")), \
             patch.object(pizzarias, "_unique_instancia", new=AsyncMock(side_effect=lambda db, base, pid: base)), \
             patch.object(pizzarias.evolution, "delete_instance", new=AsyncMock()) as apagar, \
             patch("app.services.whatsapp_status.aplicar_estado_conexao", new=AsyncMock()):
            out = asyncio.run(pizzarias.api_oficial_ativar(pizz.id, AsyncMock(), None))
        apagar.assert_awaited_once_with(instancia="pizzaria-loja")
        assert pizz.whatsapp_tipo == "cloud_api" and pizz.instancia == "cloudapi-loja"
        assert out["ativa"] and "token" not in out

    def test_qrcode_recusa_enquanto_a_api_oficial_esta_ativa(self):
        from fastapi import HTTPException

        from app.routes import pizzarias
        pizz = _pizzaria()
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: pizz))
        with pytest.raises(HTTPException) as e:
            asyncio.run(pizzarias.whatsapp_conectar(pizz.id, pizzarias.WhatsAppConnectIn(), db, None))
        assert e.value.status_code == 409

    def test_salvar_valida_na_meta_e_guarda_token_cifrado(self):
        from app.routes import pizzarias
        pizz = SimpleNamespace(id=uuid.uuid4(), whatsapp_tipo="qrcode", instancia=None, whatsapp_estado=None,
                               whatsapp_cloud={})
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(first=lambda: None))
        body = pizzarias.ApiOficialIn(phone_number_id=" 11122 ", waba_id="22233", token=TOKEN_FALSO,
                                      app_secret=SECRET_FALSO)
        with patch.object(pizzarias, "_pizzaria_ou_404", new=AsyncMock(return_value=pizz)), \
             patch.object(wc, "validar_numero", new=AsyncMock(return_value={"numero_exibicao": "+55 11 9999-0000",
                                                                            "nome_verificado": "Loja", "qualidade": "GREEN"})), \
             patch.object(wc, "inscrever_app", new=AsyncMock()) as inscrever:
            out = asyncio.run(pizzarias.api_oficial_salvar(pizz.id, body, db, None))
        inscrever.assert_awaited_once_with(TOKEN_FALSO, "22233")
        cfg = pizz.whatsapp_cloud
        assert cfg["phone_number_id"] == "11122" and cfg["token"] != TOKEN_FALSO and cfg["app_secret"] != SECRET_FALSO
        assert cfg["verify_token"] and out["verify_token"] == cfg["verify_token"]
        assert out["webhook_url"].endswith(f"/webhook/whatsapp-cloud/{pizz.id}")
        assert TOKEN_FALSO not in json.dumps(out) and SECRET_FALSO not in json.dumps(out)

    def test_salvar_recusa_numero_de_outra_loja(self):
        from fastapi import HTTPException

        from app.routes import pizzarias
        pizz = SimpleNamespace(id=uuid.uuid4(), whatsapp_tipo="qrcode", instancia=None, whatsapp_cloud={})
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(first=lambda: ("Outra",)))
        body = pizzarias.ApiOficialIn(phone_number_id="11122", waba_id="22233", token=TOKEN_FALSO,
                                      app_secret=SECRET_FALSO)
        with patch.object(pizzarias, "_pizzaria_ou_404", new=AsyncMock(return_value=pizz)), \
             patch.object(wc, "validar_numero", new=AsyncMock()) as validar:
            with pytest.raises(HTTPException) as e:
                asyncio.run(pizzarias.api_oficial_salvar(pizz.id, body, db, None))
        assert e.value.status_code == 409
        validar.assert_not_awaited()

    @pytest.mark.parametrize("campos", [
        # O que o preenchimento automático do navegador pôs no formulário em
        # produção: e-mail salvo no ID da conta e a senha salva no token.
        {"waba_id": "fulano.0933@gmail.com"},
        {"token": "MinhaSenha123"},
        {"app_secret": "senha-salva-no-navegador"},
        {"phone_number_id": "abc"},
    ])
    def test_formato_errado_nunca_chega_a_meta(self, campos):
        from fastapi import HTTPException

        from app.routes import pizzarias
        pizz = SimpleNamespace(id=uuid.uuid4(), whatsapp_tipo="qrcode", instancia=None, whatsapp_cloud={})
        dados = {"phone_number_id": "11122", "waba_id": "22233", "token": TOKEN_FALSO, "app_secret": SECRET_FALSO}
        dados.update(campos)
        with patch.object(pizzarias, "_pizzaria_ou_404", new=AsyncMock(return_value=pizz)), \
             patch.object(wc, "validar_numero", new=AsyncMock()) as validar, \
             patch.object(wc, "inscrever_app", new=AsyncMock()) as inscrever:
            with pytest.raises(HTTPException) as e:
                asyncio.run(pizzarias.api_oficial_salvar(pizz.id, pizzarias.ApiOficialIn(**dados), AsyncMock(), None))
        assert e.value.status_code == 400
        validar.assert_not_awaited()
        inscrever.assert_not_awaited()
        assert pizz.whatsapp_cloud == {}
