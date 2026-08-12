"""FastAPI entry point.

Inicializa a app, middleware (CORS), rotas, e expõe healthcheck.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import (
    admin,
    agente,
    auth,
    cardapio,
    cardapio_publico,
    clientes,
    conversas,
    entregadores,
    health,
    metricas,
    pedidos,
    pizzarias,
    webhook,
    webhook_pagamento,
    ws,
)
from app.services.evolution import evolution

settings = get_settings()

logging.basicConfig(level=settings.log_level)
log = logging.getLogger("pizzabot")

# Sentry (no-op sem SENTRY_DSN)
from app.observability import init_sentry  # noqa: E402

init_sentry("api")


async def _resync_webhooks_presence() -> None:
    """Reaplica o webhook (com PRESENCE_UPDATE) em todas as instâncias ativas."""
    from sqlalchemy import select

    from app.db import AsyncSessionLocal
    from app.models import Pizzaria

    base = (settings.public_base_url or "").rstrip("/")
    if not base:
        return
    webhook_url = f"{base}/webhook/evolution"

    async with AsyncSessionLocal() as db:
        instancias = (
            await db.execute(select(Pizzaria.instancia).where(Pizzaria.instancia.isnot(None)))
        ).scalars().all()

    for inst in instancias:
        if not inst:
            continue
        try:
            await evolution.set_webhook(instancia=inst, webhook_url=webhook_url)
            log.info("Webhook re-sincronizado (presence) p/ instância %s", inst)
        except Exception as e:  # noqa: BLE001
            log.debug("Falha re-sincronizando webhook da instância %s: %s", inst, e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("PizzaBot API iniciada (env=%s)", settings.app_env)
    # Aplica migrations SQL pendentes (idempotente, com advisory lock global).
    try:
        import asyncio
        from migrations.apply import run as run_migrations
        await asyncio.to_thread(run_migrations, False)
        log.info("Migrations verificadas/aplicadas.")
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao aplicar migrations no startup: %s", e)
    try:
        from app.services.app_config import ensure_table
        await ensure_table()
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao garantir tabela app_config: %s", e)
    # Re-sincroniza o webhook das instâncias existentes para incluir o novo
    # evento PRESENCE_UPDATE ("digitando"). Best-effort, não bloqueia o boot.
    try:
        await _resync_webhooks_presence()
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao re-sincronizar webhooks de presença: %s", e)
    yield
    # Cleanup
    await evolution.close()
    log.info("PizzaBot API encerrada")


app = FastAPI(
    title="PizzaBot API",
    version="2.0.0",
    description="Backend Python que orquestra o atendimento das pizzarias.",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS — libera o painel React
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rotas
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(pizzarias.router)
app.include_router(conversas.router)
app.include_router(cardapio.router)
app.include_router(agente.router)
app.include_router(pedidos.router)
app.include_router(entregadores.owner_router)
app.include_router(entregadores.driver_router)
app.include_router(metricas.router)
app.include_router(webhook.router)
app.include_router(webhook_pagamento.router)
app.include_router(ws.router)
app.include_router(cardapio_publico.router)
app.include_router(clientes.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": "PizzaBot API",
        "version": "2.0.0",
        "docs": "/docs" if not settings.is_production else "disabled",
    }
