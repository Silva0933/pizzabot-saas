"""
Tasks Celery.

`flush_conversation`:
  - Espera o cliente parar de digitar (debounce)
  - Agrega mensagens
  - Chama o agente IA
  - Envia resposta pelo WhatsApp via Evolution
"""
import asyncio
import logging
import uuid

from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="pizzabot.flush_conversation", bind=True)
def flush_conversation(self, pizzaria_id: str, telefone: str) -> dict:
    return asyncio.run(_flush_async(uuid.UUID(pizzaria_id), telefone, self))


@celery_app.task(name="pizzabot.enviar_nps")
def enviar_nps(pizzaria_id: str, pedido_id: str) -> dict:
    """Pós-venda: envia a pesquisa de satisfação algum tempo após a entrega sair."""
    return asyncio.run(_enviar_nps_async(uuid.UUID(pedido_id)))


async def _enviar_nps_async(pedido_id: uuid.UUID) -> dict:
    from sqlalchemy import select

    from app.db import AsyncSessionLocal, engine
    from app.models import Pedido
    from app.services.status_messages import enviar_pesquisa_nps

    try:
        async with AsyncSessionLocal() as db:
            ped = (await db.execute(select(Pedido).where(Pedido.id == pedido_id))).scalar_one_or_none()
            if not ped:
                return {"ok": False, "motivo": "pedido_inexistente"}
            enviado = await enviar_pesquisa_nps(db, ped)
            await db.commit()
            return {"ok": enviado}
    except Exception as e:  # noqa: BLE001
        log.exception("Falha no envio de NPS: %s", e)
        return {"ok": False, "erro": str(e)}
    finally:
        try:
            await engine.dispose()
        except Exception:
            pass
        try:
            from app.services.evolution import evolution
            await evolution.close()
        except Exception:
            pass


async def _flush_async(pizzaria_id: uuid.UUID, telefone: str, task) -> dict:
    from app.agent.runner import process_and_reply
    from app.db import AsyncSessionLocal, engine
    from app.services.queue import drain_pending, should_flush_now

    has_lock = False
    try:
        can_flush, wait = await should_flush_now(pizzaria_id, telefone)
        if not can_flush:
            log.info("Aguardando mais %.1fs (pizzaria=%s tel=%s)", wait, pizzaria_id, telefone)
            flush_conversation.apply_async(
                args=[str(pizzaria_id), telefone],
                countdown=max(wait + 0.1, 0.5),
            )
            return {"rescheduled": True, "wait": wait}

        # Trava de concorrência por conversa
        from app.redis_client import redis
        lock_key = f"lock:flush:{pizzaria_id}:{telefone}"
        acquired = await redis.set(lock_key, "1", nx=True, ex=45)
        if not acquired:
            log.info("Conversa travada por outro worker, reagendando: pizzaria=%s tel=%s", pizzaria_id, telefone)
            flush_conversation.apply_async(
                args=[str(pizzaria_id), telefone],
                countdown=2.0,  # Tenta novamente em 2s
            )
            return {"rescheduled": True, "reason": "locked"}
        has_lock = True

        pending = await drain_pending(pizzaria_id, telefone)
        if not pending:
            return {"empty": True}

        # Concatena as msgs batched
        conteudo = "\n".join(item["conteudo"] for item in pending if item.get("conteudo"))
        if not conteudo.strip():
            return {"empty_content": True}

        log.info(
            "Flush → agente: pizzaria=%s tel=%s msgs=%d",
            pizzaria_id, telefone, len(pending),
        )

        async with AsyncSessionLocal() as db:
            try:
                from sqlalchemy import text
                res_prod = await db.execute(text("SELECT COUNT(*) FROM public.produtos WHERE pizzaria_id = :pid AND disponivel = TRUE"), {"pid": str(pizzaria_id)})
                prod_count = res_prod.scalar()
                log.info("DIAGNOSTIC: produtos disponiveis count=%s para pizzaria=%s", prod_count, pizzaria_id)

                result = await process_and_reply(db, pizzaria_id, telefone, conteudo)
                return result
            except Exception as e:
                log.exception("Agente falhou: %s", e)
                await db.rollback()
                return {"ok": False, "erro": str(e)}
    finally:
        if has_lock:
            try:
                from app.redis_client import redis
                await redis.delete(f"lock:flush:{pizzaria_id}:{telefone}")
            except Exception:
                pass
        await engine.dispose()
        try:
            from app.agent.llm import reset_client
            await reset_client()
        except Exception:
            pass
        try:
            from app.services.evolution import evolution
            await evolution.close()
        except Exception:
            pass
        try:
            from app.redis_client import redis
            await redis.aclose()
        except Exception:
            pass
