"""
Tasks periódicas (Celery Beat).

Agendadas em `celery_app.conf.beat_schedule` e executadas pelo worker normal —
o serviço com APP_ROLE=beat só dispara, quem processa é o worker.

`verificar_conexoes_whatsapp`:
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
