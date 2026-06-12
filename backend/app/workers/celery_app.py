"""Configuração do Celery."""
import os

from celery import Celery

from app.config import get_settings
from app.observability import init_sentry

_settings = get_settings()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except (TypeError, ValueError):
        return default

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
    # Etapa 0 (vazão): concorrência e prefetch tunáveis por env (Coolify), sem
    # rebuild. CELERY_CONCURRENCY default 8 (era 4 fixo no Dockerfile) — mais
    # conversas I/O-bound em paralelo por réplica. prefetch=1 é o valor correto
    # com acks_late + tasks de duração variável: cada processo reserva 1 task por
    # vez, então um flush longo não faz o processo "segurar" outras conversas
    # enquanto processos vizinhos ficam ociosos (justiça sob pico).
    worker_concurrency=_int_env("CELERY_CONCURRENCY", 8),
    worker_prefetch_multiplier=_int_env("CELERY_PREFETCH_MULTIPLIER", 1),
    task_default_retry_delay=5,
    task_default_max_retries=3,
)

# Jobs periódicos (rodam no serviço com APP_ROLE=beat; ver workers/periodic.py).
from celery.schedules import crontab  # noqa: E402

celery_app.conf.beat_schedule = {
    "verificar-conexoes-whatsapp": {
        "task": "pizzabot.verificar_conexoes_whatsapp",
        "schedule": 300.0,  # a cada 5 min — rede de segurança do CONNECTION_UPDATE
    },
    "verificar-assinaturas": {
        "task": "pizzabot.verificar_assinaturas",
        # Diário às 08:00 (timezone America/Sao_Paulo, configurada acima):
        # avisos de vencimento + suspensão por inadimplência/trial expirado.
        "schedule": crontab(hour=8, minute=0),
    },
    "monitorar-fila-dispatcher": {
        "task": "pizzabot.monitorar_fila_dispatcher",
        "schedule": 120.0,  # a cada 2 min — alerta de saturação do dispatcher
    },
}
