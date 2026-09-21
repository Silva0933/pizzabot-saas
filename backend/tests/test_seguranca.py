"""
Testes de segurança das bordas públicas.

Travam correções de falhas encontradas na varredura — cada uma com o cenário de
ataque que a motivou, para ninguém "simplificar" de volta.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def _req(xff: str | None = None, host: str = "10.0.0.1"):
    r = MagicMock()
    r.headers = {"x-forwarded-for": xff} if xff else {}
    r.client.host = host
    return r


class TestClientIp:
    """
    X-Forwarded-For é "cliente, proxy1, proxy2…" — o começo da lista é escrito
    pelo próprio cliente. Ler o PRIMEIRO valor tornava o rate limit inútil:
    bastava mandar um header diferente a cada tentativa pra ganhar identidade
    nova e furar o limite de login, cadastro e cardápio público.
    """

    def test_sem_header_usa_o_socket(self):
        from app.services.rate_limit import client_ip
        assert client_ip(_req()) == "10.0.0.1"

    def test_um_proxy_devolve_o_cliente(self):
        from app.services.rate_limit import client_ip
        assert client_ip(_req("203.0.113.9")) == "203.0.113.9"

    def test_xff_forjado_nao_troca_a_identidade(self):
        from app.services.rate_limit import client_ip
        # O atacante injeta um IP; o proxy apenda o real no fim.
        assert client_ip(_req("1.2.3.4, 203.0.113.9")) == "203.0.113.9"
        assert client_ip(_req("9.9.9.9, 8.8.8.8, 203.0.113.9")) == "203.0.113.9"

    def test_forjar_varios_ips_nao_muda_o_resultado(self):
        """Duas tentativas com forjas diferentes caem na MESMA chave de limite."""
        from app.services.rate_limit import client_ip
        a = client_ip(_req("11.11.11.11, 203.0.113.9"))
        b = client_ip(_req("22.22.22.22, 203.0.113.9"))
        assert a == b == "203.0.113.9"

    def test_header_vazio_ou_lixo_nao_quebra(self):
        from app.services.rate_limit import client_ip
        assert client_ip(_req("   ")) == "10.0.0.1"
        assert client_ip(_req(",,,")) == "10.0.0.1"


class TestSegredosNaoVazam:
    def test_pizzaria_out_mascara_credenciais(self):
        """A resposta da API nunca devolve token de gateway em claro."""
        from app.routes.pizzarias import PizzariaOut

        campos = PizzariaOut.model_fields
        for campo in ("asaas_api_key", "mp_access_token", "mp_webhook_secret"):
            assert campo in campos, f"{campo} sumiu do schema"

        from app.services.secrets import mask_secret
        mascarado = mask_secret("APP_USR-1234567890abcdef")
        assert "1234567890" not in mascarado
        assert "••••" in mascarado

    def test_secret_curto_nao_vira_dica(self):
        from app.services.secrets import mask_secret
        assert mask_secret("abc123") == "••••"


class TestCriptografiaDeSegredos:
    def test_round_trip_e_prefixo(self):
        from app.services.secrets import decrypt_secret, encrypt_secret

        claro = "APP_USR-token-super-secreto"
        cifrado = encrypt_secret(claro)
        assert cifrado != claro
        assert cifrado.startswith("enc:")
        assert decrypt_secret(cifrado) == claro

    def test_nao_cifra_duas_vezes(self):
        from app.services.secrets import encrypt_secret
        uma = encrypt_secret("segredo")
        assert encrypt_secret(uma) == uma

    def test_valor_antigo_sem_prefixo_continua_legivel(self):
        """Compatibilidade: base gravada antes da criptografia."""
        from app.services.secrets import decrypt_secret
        assert decrypt_secret("texto-puro-antigo") == "texto-puro-antigo"


class TestProntidao:
    """
    Pontos fail-open que existem pra não travar o setup, mas que em produção
    são porta aberta: webhook sem token aceita POST forjado, gateway sem chave
    não cobra ninguém. A auditoria transforma esse silêncio em alerta.
    """

    def _settings(self, **kw):
        base = dict(
            evolution_webhook_token="tok", asaas_platform_webhook_token="tok",
            asaas_platform_api_key="key", mp_webhook_secret="sec",
            is_production=False, cors_origins_list=[],
        )
        base.update(kw)
        s = MagicMock()
        for k, v in base.items():
            setattr(s, k, v)
        return s

    def test_tudo_configurado_nao_acusa_nada(self, monkeypatch):
        import app.services.prontidao as p
        monkeypatch.setattr(p, "get_settings", lambda: self._settings())
        assert p.auditar() == []

    def test_webhook_sem_token_e_critico(self, monkeypatch):
        import app.services.prontidao as p
        monkeypatch.setattr(p, "get_settings", lambda: self._settings(evolution_webhook_token=""))
        achados = p.auditar()
        assert [a.chave for a in achados] == ["EVOLUTION_WEBHOOK_TOKEN"]
        assert achados[0].gravidade == "critico"

    def test_webhook_de_cobranca_sem_token_e_critico(self, monkeypatch):
        """Sem token dá pra forjar 'pagamento confirmado' e renovar de graça."""
        import app.services.prontidao as p
        monkeypatch.setattr(p, "get_settings", lambda: self._settings(asaas_platform_webhook_token=""))
        achados = p.auditar()
        assert achados[0].chave == "ASAAS_PLATFORM_WEBHOOK_TOKEN"
        assert achados[0].gravidade == "critico"

    def test_mp_secret_e_so_atencao(self, monkeypatch):
        """O webhook do MP ainda consulta o pagamento na API antes de aplicar."""
        import app.services.prontidao as p
        monkeypatch.setattr(p, "get_settings", lambda: self._settings(mp_webhook_secret=""))
        assert p.auditar()[0].gravidade == "atencao"

    def test_cors_de_desenvolvimento_em_producao_e_critico(self, monkeypatch):
        import app.services.prontidao as p
        monkeypatch.setattr(
            p, "get_settings",
            lambda: self._settings(is_production=True, cors_origins_list=["http://localhost:5173"]),
        )
        achados = p.auditar()
        assert any(a.chave == "CORS_ORIGINS" and a.gravidade == "critico" for a in achados)

    def test_cors_de_desenvolvimento_fora_de_producao_e_ok(self, monkeypatch):
        import app.services.prontidao as p
        monkeypatch.setattr(
            p, "get_settings",
            lambda: self._settings(is_production=False, cors_origins_list=["http://localhost:5173"]),
        )
        assert p.auditar() == []
