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
    conversas,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("PizzaBot API iniciada (env=%s)", settings.app_env)
    try:
        from app.services.app_config import ensure_table
        await ensure_table()
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao garantir tabela app_config: %s", e)
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
app.include_router(metricas.router)
app.include_router(webhook.router)
app.include_router(webhook_pagamento.router)
app.include_router(ws.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": "PizzaBot API",
        "version": "2.0.0",
        "docs": "/docs" if not settings.is_production else "disabled",
    }
