"""Configuração do Celery."""
from celery import Celery

from app.config import get_settings
from app.observability import init_sentry

_settings = get_settings()

# Sentry no worker/beat (no-op sem SENTRY_DSN)
init_sentry("worker")

celery_app = Celery(
    "pizzabot",
    broker=_settings.redis_url,
    backend=_settings.redis_url,
    include=["app.workers.tasks", "app.workers.periodic"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Sao_Paulo",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=4,
    task_default_retry_delay=5,
    task_default_max_retries=3,
)

# Jobs periódicos (rodam no serviço com APP_ROLE=beat; ver workers/periodic.py).
celery_app.conf.beat_schedule = {
    "verificar-conexoes-whatsapp": {
        "task": "pizzabot.verificar_conexoes_whatsapp",
        "schedule": 300.0,  # a cada 5 min — rede de segurança do CONNECTION_UPDATE
    },
}
