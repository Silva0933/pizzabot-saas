"""
Config da Evolution quando a leitura do banco falha.

Regressão de produção: uma conexão morta no pool do worker fazia a leitura do
app_config falhar; `get_config` engolia o erro e devolvia `{}` ("nada salvo"),
o merge caía na EVOLUTION_BASE_URL do .env (um endereço que não responde) e o
monitor disparava "Evolution API INACESSÍVEL" todo dia às 06:33. Falha de
leitura tem que MANTER a config em uso, não trocá-la pelo fallback de ambiente.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


class _DBQuebrado:
    """Sessão cuja leitura falha, como a conexão herdada de um loop fechado."""

    def __init__(self):
        self.rollbacks = 0

    async def execute(self, *a, **k):
        raise RuntimeError("Event loop is closed")

    async def rollback(self):
        self.rollbacks += 1


class _SessaoQuebrada:
    def __call__(self):
        return self

    async def __aenter__(self):
        return _DBQuebrado()

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def env_fallback(monkeypatch):
    """.env apontando para o endereço morto — o que NÃO pode ser escolhido."""
    import app.services.app_config as app_config

    monkeypatch.setattr(app_config, "_settings", SimpleNamespace(
        evolution_base_url="http://evolution.fallback-do-env",
        evolution_api_key="chave-do-env",
        evolution_webhook_token="",
    ))


class TestGetConfig:
    def test_padrao_continua_devolvendo_vazio_na_falha(self):
        """Os demais chamadores (painel, billing) seguem tolerantes como antes."""
        from app.services.app_config import get_config

        db = _DBQuebrado()
        assert asyncio.run(get_config(db, "qualquer")) == {}
        assert db.rollbacks == 1

    def test_estrito_propaga_a_falha(self):
        from app.services.app_config import get_config

        db = _DBQuebrado()
        with pytest.raises(RuntimeError):
            asyncio.run(get_config(db, "qualquer", estrito=True))
        assert db.rollbacks == 1


class TestClienteEvolution:
    def test_falha_de_leitura_mantem_a_url_em_uso(self, monkeypatch, env_fallback):
        import app.db as db_mod
        from app.services.evolution import EvolutionClient

        monkeypatch.setattr(db_mod, "AsyncSessionLocal", _SessaoQuebrada())

        cliente = EvolutionClient()
        cliente.base_url = "https://evo.config-do-banco"
        cliente.api_key = "chave-do-banco"

        asyncio.run(cliente._carregar_config())

        assert cliente.base_url == "https://evo.config-do-banco"
        assert cliente.api_key == "chave-do-banco"
