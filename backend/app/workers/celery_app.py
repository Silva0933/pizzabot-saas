"""Configuração do Celery."""
from celery import Celery

from app.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "pizzabot",
    broker=_settings.redis_url,
    backend=_settings.redis_url,
    include=["app.workers.tasks"],
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
