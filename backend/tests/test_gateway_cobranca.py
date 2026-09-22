"""
Gateway de cobrança da plataforma configurável pelo painel.

Mesmo contrato da Evolution e do LLM: o valor salvo no banco tem prioridade
sobre a variável de ambiente, e `origem` diz de onde veio cada campo — sem isso
o admin editaria algo que não está valendo.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _limpa_cache():
    from app.services.billing_plataforma import invalidar_config
    invalidar_config()
    yield
    invalidar_config()


def _settings(api_key="", webhook_token="", base_url="https://api.asaas.com/v3"):
    s = MagicMock()
    s.asaas_platform_api_key = api_key
    s.asaas_platform_webhook_token = webhook_token
    s.asaas_platform_base_url = base_url
    return s


def _rodar_config(salvo: dict, env=None):
    """get_billing_config com o banco e o ambiente controlados."""
    import app.services.app_config as ac

    async def falso_get_config(_db, _chave):
        return salvo

    with patch.object(ac, "get_config", falso_get_config), \
         patch.object(ac, "_settings", env or _settings()), \
         patch.object(ac, "decrypt_secret", side_effect=lambda v: v):
        return asyncio.run(ac.get_billing_config(MagicMock()))


class TestPrioridade:
    def test_banco_ganha_do_ambiente(self):
        cfg = _rodar_config(
            {"api_key": "chave-do-painel", "webhook_token": "tok-painel", "base_url": ""},
            _settings(api_key="chave-do-env", webhook_token="tok-env"),
        )
        assert cfg["api_key"] == "chave-do-painel"
        assert cfg["webhook_token"] == "tok-painel"
        assert cfg["origem"]["api_key"] == "banco"
        assert cfg["origem"]["webhook_token"] == "banco"

    def test_ambiente_quando_o_banco_esta_vazio(self):
        cfg = _rodar_config({}, _settings(api_key="chave-do-env"))
        assert cfg["api_key"] == "chave-do-env"
        assert cfg["origem"]["api_key"] == "env"

    def test_vazio_dos_dois_lados(self):
        cfg = _rodar_config({}, _settings())
        assert cfg["api_key"] == ""
        assert cfg["origem"]["api_key"] == "vazio"
        assert cfg["configurada"] is False

    def test_configurada_depende_so_da_chave(self):
        """Sem chave não existe cobrança; o token do webhook é outra coisa."""
        assert _rodar_config({"api_key": "k"}, _settings())["configurada"] is True
        assert _rodar_config({"webhook_token": "t"}, _settings())["configurada"] is False

    def test_base_url_cai_no_padrao_de_producao(self):
        cfg = _rodar_config({}, _settings(base_url=""))
        assert cfg["base_url"] == "https://api.asaas.com/v3"

    def test_base_url_sem_barra_no_fim(self):
        cfg = _rodar_config({"base_url": "https://api-sandbox.asaas.com/v3/"}, _settings())
        assert cfg["base_url"] == "https://api-sandbox.asaas.com/v3"
        assert cfg["origem"]["base_url"] == "banco"


class TestCacheDoProcesso:
    def test_sem_carregar_cai_no_ambiente(self):
        import app.services.billing_plataforma as b
        with patch.object(b, "_settings", _settings(api_key="do-env")):
            assert b.config_em_cache()["api_key"] == "do-env"
            assert b.billing_configurado() is True

    def test_aplicar_config_passa_a_valer(self):
        import app.services.billing_plataforma as b
        with patch.object(b, "_settings", _settings(api_key="do-env")):
            b.aplicar_config({"api_key": "do-painel", "base_url": "https://x/v3"})
            assert b.config_em_cache()["api_key"] == "do-painel"

    def test_invalidar_volta_pro_ambiente(self):
        import app.services.billing_plataforma as b
        with patch.object(b, "_settings", _settings(api_key="do-env")):
            b.aplicar_config({"api_key": "do-painel"})
            b.invalidar_config()
            assert b.config_em_cache()["api_key"] == "do-env"

    def test_sem_chave_o_cliente_recusa_com_mensagem_util(self):
        import app.services.billing_plataforma as b
        with patch.object(b, "_settings", _settings()):
            with pytest.raises(b.BillingError) as e:
                b.PlatformAsaasClient()
            # A mensagem precisa dizer ONDE resolver, não só que faltou.
            assert "Planos" in str(e.value)

    def test_cliente_aceita_config_explicita(self):
        """A rota de teste passa a config recém-salva sem depender do cache."""
        import app.services.billing_plataforma as b
        c = b.PlatformAsaasClient({"api_key": "k", "base_url": "https://api-sandbox.asaas.com/v3"})
        assert c.key == "k"
        assert "sandbox" in c.base


class TestProntidaoUsaOBanco:
    def test_chave_salva_no_painel_nao_e_acusada(self, monkeypatch):
        """Antes a auditoria olhava só o ambiente e acusava o que já estava salvo."""
        import app.services.prontidao as p

        s = MagicMock()
        s.evolution_webhook_token = "tok"
        s.mp_webhook_secret = "sec"
        s.asaas_platform_api_key = ""       # ambiente vazio...
        s.asaas_platform_webhook_token = ""
        s.is_production = False
        monkeypatch.setattr(p, "get_settings", lambda: s)

        # ...mas o painel tem os dois salvos.
        achados = p.auditar({"api_key": "k", "webhook_token": "t"})
        chaves = [a.chave for a in achados]
        assert "ASAAS_PLATFORM_API_KEY" not in chaves
        assert "ASAAS_PLATFORM_WEBHOOK_TOKEN" not in chaves

    def test_sem_nada_continua_acusando(self, monkeypatch):
        import app.services.prontidao as p

        s = MagicMock()
        s.evolution_webhook_token = "tok"
        s.mp_webhook_secret = "sec"
        s.asaas_platform_api_key = ""
        s.asaas_platform_webhook_token = ""
        s.is_production = False
        monkeypatch.setattr(p, "get_settings", lambda: s)

        chaves = [a.chave for a in p.auditar({"api_key": "", "webhook_token": ""})]
        assert "ASAAS_PLATFORM_API_KEY" in chaves
        assert "ASAAS_PLATFORM_WEBHOOK_TOKEN" in chaves
