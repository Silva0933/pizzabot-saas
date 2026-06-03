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

# TTL do lock de flush por conversa. PRECISA ser maior que o pior caso de
# processamento do agente (FSM_TIMEOUT_SECONDS + LEGACY_TIMEOUT_SECONDS no runner,
# ~55s) + a folga de envio de mensagens/broadcast, senão o lock expira no meio do
# processamento e outro worker pega a MESMA conversa → resposta duplicada.
FLUSH_LOCK_TTL = 90


@celery_app.task(name="pizzabot.flush_conversation", bind=True)
def flush_conversation(self, pizzaria_id: str, telefone: str) -> dict:
    return asyncio.run(_flush_async(uuid.UUID(pizzaria_id), telefone, self))


@celery_app.task(name="pizzabot.enviar_nps")
def enviar_nps(pizzaria_id: str, pedido_id: str) -> dict:
    """Pós-venda: envia a pesquisa de satisfação algum tempo após a entrega sair."""
    return asyncio.run(_enviar_nps_async(uuid.UUID(pedido_id)))


# Tempo (segundos) sem confirmação até mandar UM lembrete perguntando se pode fechar.
# Evita o cliente achar que o pedido já está fechado e ir buscar sem ter confirmado.
CONFIRM_REMINDER_SECONDS = 480  # 8 min


@celery_app.task(name="pizzabot.lembrar_confirmacao")
def lembrar_confirmacao(pizzaria_id: str, telefone: str) -> dict:
    """Se o cliente viu o resumo e não confirmou, manda UM lembrete perguntando."""
    return asyncio.run(_lembrar_confirmacao_async(uuid.UUID(pizzaria_id), telefone))


async def _lembrar_confirmacao_async(pizzaria_id: uuid.UUID, telefone: str) -> dict:
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.db import AsyncSessionLocal, engine
    from app.models import Conversa, Mensagem, Pizzaria
    from app.services.broadcaster import broadcaster
    from app.services.conversation_state import load_state, save_state
    from app.services.evolution import evolution

    try:
        async with AsyncSessionLocal() as db:
            estado = await load_state(db, pizzaria_id, telefone)
            # Só lembra se AINDA está aguardando confirmação e ainda não lembramos.
            if not isinstance(estado, dict) or estado.get("etapa") != "AGUARDANDO_CONFIRMACAO":
                return {"ok": False, "motivo": "nao_aguardando"}
            if estado.get("confirmacao_lembrada"):
                return {"ok": False, "motivo": "ja_lembrado"}

            conv = (await db.execute(select(Conversa).where(
                Conversa.pizzaria_id == pizzaria_id,
                Conversa.cliente_telefone == telefone,
            ))).scalar_one_or_none()
            # Se um humano assumiu, não interferimos.
            if conv is not None and not getattr(conv, "bot_ativo", True):
                return {"ok": False, "motivo": "humano_assumiu"}

            pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one_or_none()

            texto = (
                "Oi! Seu pedido ainda *não foi fechado* 😊 Quando quiser, é só me confirmar que "
                "eu mando pra cozinha. Posso fechar o pedido?"
            )
            try:
                if pizz and pizz.instancia:
                    await evolution.send_text(instancia=pizz.instancia, numero=telefone, texto=texto)
            except Exception as e_send:  # noqa: BLE001
                log.warning("Falha ao enviar lembrete de confirmação: %s", e_send)
                return {"ok": False, "erro": str(e_send)}

            # Marca como lembrado (evita reenvio) e registra no histórico.
            estado["confirmacao_lembrada"] = True
            await save_state(db, pizzaria_id, telefone, estado)
            try:
                from app.agent.memory import append_turn
                await append_turn(db, pizzaria_id, telefone, role="assistant", content=texto)
            except Exception:  # noqa: BLE001
                pass

            if conv is not None:
                msg = Mensagem(
                    conversa_id=conv.id, pizzaria_id=pizzaria_id,
                    origem="bot", tipo="texto", conteudo=texto,
                    metadata_json={"trigger": "lembrete_confirmacao"},
                )
                db.add(msg)
                conv.last_message = texto
                conv.last_timestamp = datetime.now(timezone.utc)
                await db.commit()
                await broadcaster.publish(pizzaria_id, {
                    "tipo": "mensagem.nova", "pizzaria_id": str(pizzaria_id),
                    "payload": {
                        "conversa_id": str(conv.id), "mensagem_id": str(msg.id),
                        "telefone": telefone, "conteudo": texto, "origem": "bot",
                        "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    },
                })
            else:
                await db.commit()
            log.info("Lembrete de confirmação enviado: pizzaria=%s tel=%s", pizzaria_id, telefone)
            return {"ok": True}
    except Exception as e:  # noqa: BLE001
        log.exception("Falha no lembrete de confirmação: %s", e)
        return {"ok": False, "erro": str(e)}
    finally:
        try:
            await engine.dispose()
        except Exception:
            pass
        try:
            await evolution.close()
        except Exception:
            pass


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
    from app.services.queue import confirm_processed, drain_pending, should_flush_now

    has_lock = False
    drained = False
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
        acquired = await redis.set(lock_key, "1", nx=True, ex=FLUSH_LOCK_TTL)
        if not acquired:
            log.info("Conversa travada por outro worker, reagendando: pizzaria=%s tel=%s", pizzaria_id, telefone)
            flush_conversation.apply_async(
                args=[str(pizzaria_id), telefone],
                countdown=2.0,  # Tenta novamente em 2s
            )
            return {"rescheduled": True, "reason": "locked"}
        has_lock = True

        pending = await drain_pending(pizzaria_id, telefone)
        drained = True  # a partir daqui o lote está no inflight; o finally o libera
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
                result = await process_and_reply(db, pizzaria_id, telefone, conteudo)
                return result
            except Exception as e:
                log.exception("Agente falhou: %s", e)
                await db.rollback()
                return {"ok": False, "erro": str(e)}
    finally:
        # Libera o lote inflight: chegando neste finally, a mensagem já foi tratada
        # (respondida ou falha tratada). Só um crash DURO do worker — que não roda
        # este finally — preserva o inflight pra reprocessamento numa reentrega.
        if drained:
            try:
                await confirm_processed(pizzaria_id, telefone)
            except Exception:
                pass
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
