"""
Tasks periódicas (Celery Beat).

Agendadas em `celery_app.conf.beat_schedule` e executadas pelo worker normal —
o serviço com APP_ROLE=beat só dispara, quem processa é o worker.

`verificar_conexoes_whatsapp`:
  - Antes de tudo, pinga a PRÓPRIA Evolution (URL + apikey global) e alerta na
    transição para offline — sem ela nenhuma pizzaria envia/recebe mensagem nem
    gera QR Code, e essa falha não aparece em lugar nenhum sem este monitor.
  - Rede de segurança do evento CONNECTION_UPDATE do webhook: a cada 5 min
    consulta o estado real de cada instância na Evolution e corrige divergências
    (ex.: evento perdido durante um deploy). Alerta na TRANSIÇÃO para 'close'.

`verificar_assinaturas` (dunning — diário):
  - Alerta de vencimento em D-3, D-1 e no dia (sem duplicar no mesmo dia).
  - Suspende automaticamente após GRACE_DAYS de atraso (inadimplência) e
    trials expirados. A REATIVAÇÃO é automática via webhook de pagamento
    (services/billing_plataforma.aplicar_pagamento_plataforma).
"""
import asyncio
import logging
import os

from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

# --- Monitor de saturação do dispatcher (autoscaling ASSISTIDO) ---
# O Coolify (StandaloneDocker) não tem autoscaling nativo, mas o dispatcher é um
# consumer de fila e escala por réplicas. Este job vê a fila a cada ~2min e
# ALERTA (log WARNING → Sentry) quando satura por checagens consecutivas, pra o
# operador escalar manual (subir DISPATCHER_CONCURRENCY ou +1 réplica). Tudo env.
_ALERT_DUE = int(os.getenv("DISPATCHER_ALERT_DUE") or 50)       # conversas vencidas na fila
_ALERT_PEL = int(os.getenv("DISPATCHER_ALERT_PEL") or 30)       # entradas em voo (PEL)
_ALERT_STREAK = int(os.getenv("DISPATCHER_ALERT_STREAK") or 2)  # checagens seguidas saturadas
_ALERT_COOLDOWN = int(os.getenv("DISPATCHER_ALERT_COOLDOWN") or 1800)  # s entre alertas


@celery_app.task(name="pizzabot.verificar_conexoes_whatsapp")
def verificar_conexoes_whatsapp() -> dict:
    return asyncio.run(_verificar_conexoes_async())


async def _verificar_conexoes_async() -> dict:
    from sqlalchemy import select

    from app.db import AsyncSessionLocal, engine
    from app.models import Pizzaria
    from app.services.evolution import evolution
    from app.services.evolution_health import checar_saude_evolution
    from app.services.whatsapp_status import aplicar_estado_conexao

    verificadas = 0
    mudancas = 0
    try:
        async with AsyncSessionLocal() as db:
            # Saúde da Evolution em si. Se ela está fora, consultar instância por
            # instância só geraria ruído — alerta uma vez e encerra a rodada.
            saude = await checar_saude_evolution(db)
            await db.commit()
            if not saude.get("ok"):
                log.warning(
                    "Evolution indisponível (%s): %s",
                    saude.get("motivo"), saude.get("erro"),
                )
                return {"ok": False, "evolution": saude.get("motivo") or "erro",
                        "verificadas": 0, "mudancas": 0}

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


@celery_app.task(name="pizzabot.verificar_assinaturas")
def verificar_assinaturas() -> dict:
    return asyncio.run(_verificar_assinaturas_async())


async def _ja_alertado_hoje(db, pizzaria_id, tipo: str) -> bool:
    """Evita alerta duplicado: já existe um aberto do mesmo tipo criado hoje?"""
    from sqlalchemy import text

    row = (await db.execute(text("""
        SELECT 1 FROM public.plataforma_alertas
        WHERE pizzaria_id = :pid AND tipo = :tipo AND resolvido = false
          AND created_at >= date_trunc('day', now())
        LIMIT 1
    """), {"pid": str(pizzaria_id), "tipo": tipo})).first()
    return row is not None


async def _verificar_assinaturas_async() -> dict:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.db import AsyncSessionLocal, engine
    from app.models import Pizzaria
    from app.services.alertas import registrar_alerta
    from app.services.billing_plataforma import GRACE_DAYS

    avisos = 0
    suspensas = 0
    try:
        agora = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            pizzarias = (await db.execute(
                select(Pizzaria).where(Pizzaria.suspensa.is_(False))
            )).scalars().all()

            for pizz in pizzarias:
                # --- Trial expirado → suspende ---
                if (pizz.plano or "") == "trial":
                    if pizz.trial_fim and pizz.trial_fim < agora:
                        pizz.suspensa = True
                        pizz.suspensa_motivo = "trial_expirado"
                        suspensas += 1
                        await registrar_alerta(
                            db, tipo="trial_expirado", pizzaria_id=pizz.id, nivel="warning",
                            detalhe=(
                                f"Teste grátis de '{pizz.nome}' terminou sem assinatura. "
                                f"Pizzaria suspensa — reativa sozinha ao assinar um plano."
                            ),
                        )
                    continue

                if not pizz.plano_vence_em:
                    continue
                dias = (pizz.plano_vence_em - agora).days

                # --- Atraso além da carência → suspende (inadimplência) ---
                if pizz.plano_vence_em + timedelta(days=GRACE_DAYS) < agora:
                    pizz.suspensa = True
                    pizz.suspensa_motivo = "inadimplencia"
                    suspensas += 1
                    await registrar_alerta(
                        db, tipo="suspensa_inadimplencia", pizzaria_id=pizz.id, nivel="error",
                        detalhe=(
                            f"'{pizz.nome}' suspensa automaticamente: assinatura vencida há "
                            f"mais de {GRACE_DAYS} dias (vencimento "
                            f"{pizz.plano_vence_em.date().isoformat()}). "
                            f"Reativa sozinha quando o pagamento confirmar."
                        ),
                    )
                    continue

                # --- Avisos D-3 / D-1 / D0 e vencida em carência ---
                if dias in (0, 1, 2, 3) or pizz.plano_vence_em < agora:
                    if not await _ja_alertado_hoje(db, pizz.id, "assinatura_vence"):
                        vencida = pizz.plano_vence_em < agora
                        avisos += 1
                        await registrar_alerta(
                            db, tipo="assinatura_vence", pizzaria_id=pizz.id,
                            nivel="warning" if not vencida else "error",
                            detalhe=(
                                f"Assinatura de '{pizz.nome}' "
                                + (f"VENCEU em {pizz.plano_vence_em.date().isoformat()} "
                                   f"(suspensão automática após {GRACE_DAYS} dias de atraso)."
                                   if vencida else
                                   f"vence em {dias} dia(s) "
                                   f"({pizz.plano_vence_em.date().isoformat()}).")
                            ),
                        )

            await db.commit()
        return {"ok": True, "avisos": avisos, "suspensas": suspensas}
    except Exception as e:  # noqa: BLE001
        log.exception("Falha no dunning de assinaturas: %s", e)
        return {"ok": False, "erro": str(e)}
    finally:
        try:
            await engine.dispose()
        except Exception:
            pass


@celery_app.task(name="pizzabot.monitorar_fila_dispatcher")
def monitorar_fila_dispatcher() -> dict:
    return asyncio.run(_monitorar_fila_dispatcher_async())


async def _monitorar_fila_dispatcher_async() -> dict:
    # Client Redis próprio (asyncio.run cria loop novo por task → evita reusar o
    # client global preso a outro loop).
    from redis.asyncio import Redis

    from app.config import get_settings

    r = Redis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        return await _avaliar_fila_dispatcher(r)
    except Exception as e:  # noqa: BLE001
        log.exception("Falha ao monitorar a fila do dispatcher: %s", e)
        return {"ok": False, "erro": str(e)}
    finally:
        try:
            await r.aclose()
        except Exception:  # noqa: BLE001
            pass


async def _avaliar_fila_dispatcher(r) -> dict:
    """Lê a profundidade da fila e alerta na saturação sustentada. Recebe o client
    Redis (testável). Estado de streak/cooldown vive no próprio Redis."""
    from app.dispatcher.streams import DUE_KEY, GROUP, READY_STREAM

    due = await r.zcard(DUE_KEY)
    try:
        pend = await r.xpending(READY_STREAM, GROUP)
        pel = (pend.get("pending") if isinstance(pend, dict) else pend) or 0
    except Exception:  # noqa: BLE001
        pel = 0

    saturado = due >= _ALERT_DUE or pel >= _ALERT_PEL
    if not saturado:
        await r.delete("disp:alert:streak")
        return {"due": due, "pel": pel, "saturado": False}

    streak = await r.incr("disp:alert:streak")
    await r.expire("disp:alert:streak", 600)
    alerta = False
    # Só alerta após N checagens seguidas e respeitando o cooldown (anti-spam).
    if streak >= _ALERT_STREAK and await r.set("disp:alert:cooldown", "1", nx=True, ex=_ALERT_COOLDOWN):
        alerta = True
        log.warning(
            "ALERTA: dispatcher saturado (due=%s, pel=%s; limites due>=%s ou pel>=%s por "
            "%s checagens). Escale: aumente DISPATCHER_CONCURRENCY ou adicione 1 réplica do "
            "pizzabot-dispatcher.",
            due, pel, _ALERT_DUE, _ALERT_PEL, _ALERT_STREAK,
        )
    return {"due": due, "pel": pel, "saturado": True, "streak": streak, "alerta": alerta}
