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

`reconciliar_assinaturas_asaas` (diário):
  - Varre as assinaturas ATIVAS no Asaas e cancela as que apontam (pelo
    externalReference) para uma pizzaria que não existe mais. É a rede que pega
    o que o `delete_pizzaria` não alcança: assinaturas anteriores à correção,
    exclusões forçadas e mexidas manuais no painel do Asaas.
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
    from app.services.billing_plataforma import GRACE_DAYS, billing_configurado

    avisos = 0
    suspensas = 0
    try:
        agora = datetime.now(timezone.utc)
        # Sem gateway configurado ninguem consegue pagar. Suspender nesse estado
        # tranca todas as pizzarias para fora sem saida — inclusive as que
        # queriam pagar. Entao avisamos o operador e NAO suspendemos ninguem.
        pode_suspender = billing_configurado()
        async with AsyncSessionLocal() as db:
            pizzarias = (await db.execute(
                select(Pizzaria).where(Pizzaria.suspensa.is_(False))
            )).scalars().all()

            for pizz in pizzarias:
                # --- Trial expirado → suspende ---
                if (pizz.plano or "") == "trial":
                    if pizz.trial_fim and pizz.trial_fim < agora and pode_suspender:
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
                if pizz.plano_vence_em + timedelta(days=GRACE_DAYS) < agora and pode_suspender:
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

            if not pode_suspender:
                await registrar_alerta(
                    db, tipo="billing_nao_configurado", nivel="error",
                    detalhe=(
                        "ASAAS_PLATFORM_API_KEY nao esta configurada: nenhuma pizzaria "
                        "pode assinar nem pagar. A suspensao automatica esta DESLIGADA "
                        "para nao trancar todo mundo sem saida. Configure a chave."
                    ),
                )

            await db.commit()
        return {"ok": True, "avisos": avisos, "suspensas": suspensas, "pode_suspender": pode_suspender}
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


# --- Reconciliação de assinaturas órfãs no Asaas (diária) -------------------
# Rede de segurança do `delete_pizzaria`: ele cancela a assinatura antes de apagar
# a pizzaria, mas isso não alcança (a) assinaturas criadas antes dessa correção,
# (b) exclusões feitas com ?forcar=true e (c) qualquer divergência causada por
# mexida manual no painel do Asaas. Sem isto, uma assinatura órfã cobra em
# silêncio para sempre — o subscription_id some junto com a linha da pizzaria,
# então o único jeito de reencontrá-la é varrer o lado do Asaas.
_RECON_MAX = int(os.getenv("BILLING_RECON_MAX") or 5)   # teto de cancelamentos por rodada
_RECON_CANCELAR = (os.getenv("BILLING_RECON_CANCELAR") or "true").lower() != "false"


@celery_app.task(name="pizzabot.reconciliar_assinaturas_asaas")
def reconciliar_assinaturas_asaas() -> dict:
    return asyncio.run(_reconciliar_assinaturas_asaas_async())


async def _reconciliar_assinaturas_asaas_async() -> dict:
    import uuid as _uuid

    from sqlalchemy import text

    from app.db import AsyncSessionLocal
    from app.services.alertas import registrar_alerta
    from app.services.billing_plataforma import (
        BillingError,
        PlatformAsaasClient,
        billing_configurado,
        carregar_config,
        parse_ext_ref,
    )

    async with AsyncSessionLocal() as db:
        # Cada processo tem o SEU cache de config em memoria, e quem o preenche no
        # startup e o app/main.py — que so roda na API. Sem esta linha, o worker
        # cai no fallback de ambiente (que pode nao ter a chave, ja que ela costuma
        # ser definida so no servico da API) e a reconciliacao sairia calada toda
        # noite: exatamente a falha silenciosa que esta task existe para evitar.
        try:
            await carregar_config(db)
        except Exception as e:  # noqa: BLE001
            log.warning("reconciliação: não recarreguei a config do gateway: %s", e)

        if not billing_configurado():
            # Sem gateway não há o que reconciliar, e alertar todo dia por isso só
            # geraria ruído: a ausência de chave já aparece na tela de Planos.
            return {"ok": False, "motivo": "gateway de cobrança não configurado"}

        try:
            assinaturas = await PlatformAsaasClient().listar_assinaturas(status="ACTIVE")
        except BillingError as e:
            log.warning("reconciliação: não consegui listar assinaturas no Asaas: %s", e)
            return {"ok": False, "motivo": str(e)}

        conhecidas = {
            str(r[0]) for r in (await db.execute(text("SELECT id FROM public.pizzarias"))).all()
        }

        # Guarda-chuva: zero pizzarias com assinaturas ativas lá fora é sintoma de
        # query/banco quebrado, não de realidade. Cancelar em massa aqui seria
        # catastrófico, então preferimos não agir e gritar.
        if not conhecidas and assinaturas:
            await registrar_alerta(
                db, tipo="billing_reconciliacao", nivel="error",
                detalhe=(f"Abortei a reconciliação: o Asaas tem {len(assinaturas)} assinatura(s) "
                         f"ativa(s) e o banco não retornou NENHUMA pizzaria. Suspeita de falha "
                         f"de leitura — nada foi cancelado."),
            )
            await db.commit()
            return {"ok": False, "motivo": "banco sem pizzarias; reconciliação abortada"}

        orfas = []
        for assin in assinaturas:
            pid, _plano = parse_ext_ref(assin.get("externalReference"))
            if not pid:
                continue  # sem referência: não foi esta plataforma que criou — não é nossa
            try:
                _uuid.UUID(pid)
            except (ValueError, AttributeError, TypeError):
                continue  # referência que não é UUID nosso: idem, não tocar
            if pid not in conhecidas:
                orfas.append((assin, pid))

        if not orfas:
            return {"ok": True, "ativas": len(assinaturas), "orfas": 0}

        # Muitas órfãs de uma vez = bug, não estado legítimo. Alerta e não cancela.
        if len(orfas) > _RECON_MAX:
            await registrar_alerta(
                db, tipo="billing_reconciliacao", nivel="error",
                detalhe=(f"{len(orfas)} assinaturas órfãs no Asaas (teto por rodada: {_RECON_MAX}). "
                         f"Nada foi cancelado — isso é volume de bug, não de operação normal. "
                         f"IDs: {', '.join(a.get('id', '?') for a, _ in orfas[:20])}"),
            )
            await db.commit()
            return {"ok": False, "ativas": len(assinaturas), "orfas": len(orfas), "acao": "abortado"}

        canceladas, falhas = [], []
        for assin, pid in orfas:
            sub_id = assin.get("id") or "?"
            resumo = (f"assinatura {sub_id} (R$ {assin.get('value')}, {assin.get('cycle')}, "
                      f"próx. {assin.get('nextDueDate')}) aponta para a pizzaria {pid}, "
                      f"que não existe mais")
            if not _RECON_CANCELAR:
                await registrar_alerta(db, tipo="billing_reconciliacao", nivel="warning",
                                       detalhe=f"Órfã detectada (modo só-alerta): {resumo}.")
                continue
            try:
                await PlatformAsaasClient().cancelar_assinatura(sub_id)
                canceladas.append(sub_id)
                await registrar_alerta(
                    db, tipo="billing_reconciliacao", nivel="warning",
                    detalhe=f"Cancelei automaticamente no Asaas: {resumo}.",
                )
            except BillingError as e:
                falhas.append(sub_id)
                await registrar_alerta(
                    db, tipo="billing_reconciliacao", nivel="error",
                    detalhe=f"NÃO consegui cancelar: {resumo}. Erro: {e}. Cancele no painel do Asaas.",
                )

        await db.commit()

    return {"ok": True, "ativas": len(assinaturas), "orfas": len(orfas),
            "canceladas": canceladas, "falhas": falhas}
