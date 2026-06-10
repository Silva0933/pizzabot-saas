"""
Tasks periódicas (Celery Beat).

Agendadas em `celery_app.conf.beat_schedule` e executadas pelo worker normal —
o serviço com APP_ROLE=beat só dispara, quem processa é o worker.

`verificar_conexoes_whatsapp`:
  - Rede de segurança do evento CONNECTION_UPDATE do webhook: a cada 5 min
    consulta o estado real de cada instância na Evolution e corrige divergências
    (ex.: evento perdido durante um deploy). Alerta na TRANSIÇÃO para 'close'.
"""
import asyncio
import logging

from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="pizzabot.verificar_conexoes_whatsapp")
def verificar_conexoes_whatsapp() -> dict:
    return asyncio.run(_verificar_conexoes_async())


async def _verificar_conexoes_async() -> dict:
    from sqlalchemy import select

    from app.db import AsyncSessionLocal, engine
    from app.models import Pizzaria
    from app.services.evolution import evolution
    from app.services.whatsapp_status import aplicar_estado_conexao

    verificadas = 0
    mudancas = 0
    try:
        async with AsyncSessionLocal() as db:
            pizzarias = (await db.execute(
                select(Pizzaria).where(
                    Pizzaria.instancia.is_not(None),
                    Pizzaria.suspensa.is_(False),
                )
            )).scalars().all()

            for pizz in pizzarias:
                try:
                    estado = await evolution.connection_state(instancia=pizz.instancia)
                except Exception as e:  # noqa: BLE001
                    # Evolution fora do ar/instância inexistente: não marca 'close'
                    # (poderia ser falha da PRÓPRIA Evolution) — só loga.
                    log.warning(
                        "Falha ao consultar estado da instância %s: %s", pizz.instancia, e
                    )
                    continue
                verificadas += 1
                if estado != pizz.whatsapp_estado:
                    mudancas += 1
                    await aplicar_estado_conexao(db, pizz, estado)

            await db.commit()
        return {"ok": True, "verificadas": verificadas, "mudancas": mudancas}
    except Exception as e:  # noqa: BLE001
        log.exception("Falha na verificação de conexões WhatsApp: %s", e)
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
