"""Configurações da aplicação, lidas via variáveis de ambiente."""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_env: Literal["development", "staging", "production"] = "development"
    app_port: int = 8000
    app_secret_key: str = Field(min_length=32)
    cors_origins: str = "http://localhost:5173"

    # --- DB ---
    database_url: str
    database_url_sync: str | None = None

    # --- Redis ---
    redis_url: str = "redis://redis:6379/0"

    # --- Auth ---
    jwt_algorithm: str = "HS256"
    jwt_access_token_ttl_minutes: int = 60
    jwt_refresh_token_ttl_days: int = 30

    # --- Integrações ---
    evolution_base_url: str = ""
    evolution_api_key: str = ""
    gemini_api_key: str = ""
    # Chaves LLM opcionais via env (fallback quando não configuradas no painel).
    openrouter_api_key: str = ""
    openai_api_key: str = ""
    # Provider/modelo padrão via env (usado quando não configurado no banco).
    # Exemplo: LLM_PROVIDER=openrouter  LLM_MODEL=openai/gpt-4o-mini
    llm_provider: str = ""   # gemini | openai | openrouter
    llm_model: str = ""
    mp_webhook_secret: str = ""
    # --- Cobrança da PLATAFORMA (assinatura mensal das pizzarias via Asaas) ---
    # Conta Asaas do DONO da plataforma — separada das contas das pizzarias.
    asaas_platform_api_key: str = ""
    # Token de autenticação do webhook (configurado no Asaas em Webhooks →
    # "Token de autenticação"; chega no header asaas-access-token).
    asaas_platform_webhook_token: str = ""
    # Base da API (troque para https://api-sandbox.asaas.com/v3 nos testes).
    asaas_platform_base_url: str = "https://api.asaas.com/v3"
    # Segredo que a Evolution devolve na URL do webhook (?token=...). Se vazio,
    # a validação fica DESLIGADA (compatível com o estado atual). Defina no
    # ambiente para ativar a proteção anti-spoofing do webhook.
    evolution_webhook_token: str = ""

    # URL pública do backend (usada para configurar o webhook na Evolution).
    public_base_url: str = "https://api.pizzabot.secretariaai.eu.cc"

    # --- Logs ---
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"

    # --- Observabilidade ---
    # DSN do Sentry (https://sentry.io). Vazio = monitoramento DESLIGADO.
    sentry_dsn: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
