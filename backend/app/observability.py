"""
Inicialização do Sentry (erros com stack trace + contexto).

Chamado no boot da API (main.py) e do worker/beat (workers/celery_app.py).
Sem SENTRY_DSN configurado, vira no-op — nada muda em dev.
"""
import logging

from app.config import get_settings

log = logging.getLogger(__name__)


def init_sentry(role: str) -> None:
    settings = get_settings()
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=settings.app_env,
            # FastAPI/Starlette e Celery são detectados e instrumentados
            # automaticamente pelas default integrations do SDK.
            send_default_pii=False,
            traces_sample_rate=0.0,  # só erros; sem tracing de performance (custo)
        )
        sentry_sdk.set_tag("app_role", role)
        log.info("Sentry ativo (env=%s role=%s)", settings.app_env, role)
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao iniciar Sentry (seguindo sem): %s", e)
