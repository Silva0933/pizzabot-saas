# syntax=docker/dockerfile:1.7
# ============================================
# PizzaBot Backend — Imagem de produção
# ============================================

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Dependências de sistema mínimas (psycopg + bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala deps primeiro (cache de camada)
COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install --no-cache-dir .

# Copia código
COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts

# Usuário não-root
RUN useradd --create-home --shell /bin/bash app && \
    chown -R app:app /app
USER app

EXPOSE 8000

# Healthcheck condicional ao papel do container:
#   APP_ROLE=worker  -> ping no Celery
#   (default/api)     -> HTTP /health do uvicorn
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=3 \
    CMD sh -c 'if [ "$APP_ROLE" = "worker" ]; then celery -A app.workers.celery_app inspect ping -t 8 >/dev/null 2>&1 || exit 1; else curl -fsS http://localhost:8000/health || exit 1; fi'

# CMD condicional: o mesmo Dockerfile serve API e worker.
#   APP_ROLE=worker  -> celery worker
#   (default/api)     -> uvicorn
CMD ["sh", "-c", "if [ \"$APP_ROLE\" = \"worker\" ]; then exec celery -A app.workers.celery_app worker --loglevel=INFO --concurrency=4; else python migrations/apply.py && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2; fi"]
