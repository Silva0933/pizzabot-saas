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
    mp_webhook_secret: str = ""

    # URL pública do backend (usada para configurar o webhook na Evolution).
    public_base_url: str = "https://api.pizzabot.secretariaai.eu.cc"

    # --- Logs ---
    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
