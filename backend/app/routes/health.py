"""Endpoints de saúde para Coolify/load balancer."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Healthcheck simples — usado pelo Docker/Coolify."""
    return {"status": "ok"}


@router.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Healthcheck com ping no banco."""
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
