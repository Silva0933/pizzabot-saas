"""
Desfecho de cada lote de mensagens e recuperação do que ficou sem resposta.

Achados A06/A07 da análise de 01/10. Antes:
  - o worker e o dispatcher limpavam o lote (inflight) e confirmavam o stream no
    `finally`, inclusive quando o agente lançava exceção: o lote sumia sem
    resposta, sem transferência para humano e sem nova tentativa;
  - mensagem gravada pelo webhook que não entrava na fila (Redis/broker fora
    depois do commit) nunca era processada — a reentrega da Evolution caía no
    dedup como duplicada.

Agora:
  - `lote_concluido`: só com desfecho (resposta, handoff ou "não responder" de
    propósito, como cota) o inflight sai;
  - `lote_falhou`: exceção sem desfecho → o lote fica no inflight e é tentado de
    novo; esgotadas as tentativas, a conversa vai para um humano (gravado no
    banco) e só então o lote sai;
  - `reconciliar`: o beat procura mensagem de cliente sem resposta e sem lote em
    andamento — remonta o lote do banco uma vez; se continuar sem resposta,
    transfere para humano. Também reenvia resposta que a Evolution recusou.

Não é inbox/outbox completo: a mensagem do cliente já está no Postgres e é a
fonte para remontar o lote; o Redis segue acelerando o debounce.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

MAX_TENTATIVAS_LOTE = 3            # 1ª execução + 2 novas tentativas
ESPERA_NOVA_TENTATIVA_S = 20.0
ESPERA_SEM_DESFECHO_S = 120.0      # nem o handoff gravou (banco fora): tenta depois
# Janela do reconciliador: depois do debounce máximo (45 s) + o turno (FSM 15 s,
# legado 40 s) com folga; e só a última hora (mais velho que isso, um humano vê).
RECONCILIAR_APOS_S = 150
RECONCILIAR_JANELA_MIN = 60
# Reenvio de resposta que a Evolution recusou (A05): só enquanto ainda faz sentido.
REENVIO_JANELA_MIN = 10
MAX_REENVIOS = 2


def _chave_tentativas(pid: Any, tel: str) -> str:
    return f"lote:tentativas:{pid}:{tel}"


def _chave_processado(pid: Any, tel: str) -> str:
    return f"lote:processado_em:{pid}:{tel}"


def _chave_recuperada(mensagem_id: Any) -> str:
    return f"lote:recuperada:{mensagem_id}"


# --------------------------------------------------------------------------- #
# Desfecho do lote (worker Celery e dispatcher)
# --------------------------------------------------------------------------- #
async def lote_concluido(pizzaria_id: uuid.UUID, telefone: str) -> None:
    """O lote teve desfecho gravado: libera o inflight e marca a hora (o
    reconciliador não mexe no que já foi processado, mesmo sem resposta)."""
    from app.redis_client import redis
    from app.services.queue import confirm_processed
    await confirm_processed(pizzaria_id, telefone)
    try:
        pipe = redis.pipeline()
        pipe.delete(_chave_tentativas(pizzaria_id, telefone))
        pipe.set(_chave_processado(pizzaria_id, telefone), str(time.time()), ex=3 * 3600)
        await pipe.execute()
    except Exception as e:  # noqa: BLE001
        log.debug("Marcadores do lote não gravados: %s", e)


async def lote_falhou(pizzaria_id: uuid.UUID, telefone: str, erro: BaseException) -> float | None:
    """Exceção sem desfecho. O lote fica no inflight. Devolve em quantos segundos
    tentar de novo, ou None se o lote foi encerrado (conversa com humano)."""
    from app.redis_client import redis
    try:
        n = int(await redis.incr(_chave_tentativas(pizzaria_id, telefone)))
        await redis.expire(_chave_tentativas(pizzaria_id, telefone), 3600)
    except Exception as e:  # noqa: BLE001
        log.warning("Contador de tentativas indisponível (%s); tentando de novo depois", e)
        return ESPERA_SEM_DESFECHO_S
    if n < MAX_TENTATIVAS_LOTE:
        log.warning("Lote sem desfecho (tentativa %s/%s, pid=%s tel=%s): %s",
                    n, MAX_TENTATIVAS_LOTE, pizzaria_id, telefone, erro)
        return ESPERA_NOVA_TENTATIVA_S
    motivo = f"falha técnica depois de {n} tentativas ({type(erro).__name__}: {str(erro)[:150]})"
    if await escalar_sem_resposta(pizzaria_id, telefone, motivo=motivo):
        await lote_concluido(pizzaria_id, telefone)
        return None
    return ESPERA_SEM_DESFECHO_S


async def escalar_sem_resposta(pizzaria_id: uuid.UUID, telefone: str, *, motivo: str) -> bool:
    """A atendente não conseguiu responder: avisa o cliente que alguém da equipe
    vai responder, passa a conversa para humano e alerta o painel. True se ficou
    gravado (só então o lote pode sair da fila)."""
    from app.agent.behavior import handoff_message
    from app.db import AsyncSessionLocal
    from app.models import Conversa, Mensagem, PersonalidadeAtendente, Pizzaria
    from app.services.alertas import registrar_alerta
    from app.services.broadcaster import broadcaster
    from app.services.evolution import evolution
    from app.services.telefones import mesmo_telefone, preferir_exato

    try:
        async with AsyncSessionLocal() as db:
            pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pizzaria_id))).scalar_one()
            conv = (await db.execute(
                select(Conversa).where(
                    Conversa.pizzaria_id == pizzaria_id, mesmo_telefone(Conversa.cliente_telefone, telefone),
                ).order_by(preferir_exato(Conversa.cliente_telefone, telefone))
            )).scalars().first()
            pers = (await db.execute(select(PersonalidadeAtendente).where(
                PersonalidadeAtendente.pizzaria_id == pizzaria_id))).scalar_one_or_none()
            aviso = handoff_message(pers, pizzaria=pizz, cliente_nome=conv.cliente_nome if conv else None)
            try:
                if pizz.instancia:
                    await evolution.send_text(instancia=pizz.instancia, numero=telefone, texto=aviso)
            except Exception as e:  # noqa: BLE001
                log.warning("Aviso de transferência não enviado ao cliente: %s", e)
            msg = None
            if conv is not None:
                conv.bot_ativo = False
                conv.status = "humano_necessario"
                conv.last_timestamp = datetime.now(UTC)
                msg = Mensagem(
                    conversa_id=conv.id, pizzaria_id=pizzaria_id, origem="sistema", tipo="texto",
                    conteudo=f"⚠️ A atendente não conseguiu responder ({motivo}). "
                             "Atendimento transferido para humano — responda por aqui.",
                    metadata_json={"trigger": "sem_resposta", "motivo": motivo[:300]},
                )
                db.add(msg)
            await registrar_alerta(
                db, tipo="sem_resposta", pizzaria_id=pizzaria_id, nivel="error",
                detalhe=f"Cliente {telefone} ficou sem resposta da IA: {motivo}. Conversa transferida para humano.",
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("Não consegui transferir para humano (pid=%s tel=%s): %s", pizzaria_id, telefone, e)
        return False
    if conv is not None:
        for evento in (
            {"tipo": "atendimento.humano", "payload": {
                "conversa_id": str(conv.id), "telefone": telefone, "cliente_nome": conv.cliente_nome,
                "motivo": "A atendente não conseguiu responder"}},
            {"tipo": "conversa.atualizada", "payload": {
                "conversa_id": str(conv.id), "telefone": telefone, "bot_ativo": False,
                "status": "humano_necessario"}},
            {"tipo": "mensagem.nova", "payload": {
                "conversa_id": str(conv.id), "mensagem_id": str(msg.id) if msg else None, "telefone": telefone,
                "conteudo": msg.conteudo if msg else "", "origem": "sistema",
                "created_at": datetime.now(UTC).isoformat()}},
        ):
            try:
                await broadcaster.publish(pizzaria_id, {**evento, "pizzaria_id": str(pizzaria_id)})
            except Exception as e:  # noqa: BLE001
                log.debug("Aviso ao painel falhou: %s", e)
    return True


# --------------------------------------------------------------------------- #
# Reconciliador (beat)
# --------------------------------------------------------------------------- #
_SQL_SEM_RESPOSTA = text("""
    SELECT c.id, c.pizzaria_id, c.cliente_telefone, m.id, m.created_at, m.conteudo,
           m.metadata->>'telefone_jid', p.horario_funcionamento, p.aberto_manual, p.usar_dispatcher
      FROM public.conversas c
      JOIN public.pizzarias p ON p.id = c.pizzaria_id
      JOIN LATERAL (
            SELECT id, origem, created_at, conteudo, metadata
              FROM public.mensagens
             WHERE conversa_id = c.id
             ORDER BY created_at DESC
             LIMIT 1
      ) m ON TRUE
     WHERE c.bot_ativo AND p.bot_ativo_global AND NOT p.suspensa
       AND c.last_timestamp > now() - make_interval(mins => :janela)
       AND m.origem = 'cliente'
       AND m.created_at < now() - make_interval(secs => :apos)
       AND m.created_at > now() - make_interval(mins => :janela)
     ORDER BY m.created_at
     LIMIT 50
""")


async def _rearmar(pid: Any, tel: str, usar_dispatcher: bool, atraso: float) -> None:
    if usar_dispatcher:
        from app.services.queue import rearm_dispatcher
        await rearm_dispatcher(pid, tel, atraso)
    else:
        from app.workers.tasks import flush_conversation
        flush_conversation.apply_async(args=[str(pid), tel], countdown=atraso)


async def _remontar_lote(db: AsyncSession, conversa_id: Any, pid: uuid.UUID, tel: str) -> int:
    """Lote perdido (Redis reiniciou, a fila falhou no webhook): as mensagens do
    cliente desde a última resposta voltam para a fila, a partir do banco."""
    from app.services.queue import enqueue_message
    rows = (await db.execute(text("""
        SELECT id, conteudo FROM public.mensagens
         WHERE conversa_id = :cid AND origem = 'cliente'
           AND created_at > COALESCE((SELECT max(created_at) FROM public.mensagens
                                       WHERE conversa_id = :cid AND origem <> 'cliente'), 'epoch')
         ORDER BY created_at
         LIMIT 10
    """), {"cid": str(conversa_id)})).all()
    for mid, conteudo in rows:
        await enqueue_message(pizzaria_id=pid, telefone=tel, mensagem_id=mid, conteudo=conteudo or "",
                              metadata={"recuperada": True})
    return len(rows)


async def reconciliar(db: AsyncSession) -> dict[str, int]:
    """Beat: mensagem de cliente sem resposta e sem lote andando. 1ª vez: volta
    para a fila; se continuar sem resposta: humano."""
    from app.redis_client import redis
    from app.routes.webhook import _pode_responder_fora_horario_com_ia
    from app.services.alertas import registrar_alerta
    from app.services.business_hours import TZ, esta_aberto
    from app.services.queue import _inflight_key, _pending_key

    out = {"recuperadas": 0, "escaladas": 0, "reenviadas": 0}
    rows = (await db.execute(_SQL_SEM_RESPOSTA, {"janela": RECONCILIAR_JANELA_MIN, "apos": float(RECONCILIAR_APOS_S)})).all()
    for (conv_id, pid, tel_conv, msg_id, criado, conteudo, tel_jid, horario, aberto_manual, usar_dispatcher) in rows:
        tel = tel_jid or tel_conv
        # Fora do horário a IA não responde de propósito (a loja manda o aviso fixo).
        quando = criado.astimezone(TZ) if TZ else criado
        if not esta_aberto(horario or {}, quando, override=aberto_manual) \
                and not _pode_responder_fora_horario_com_ia(conteudo or ""):
            continue
        if await redis.exists(f"lock:flush:{pid}:{tel}"):
            continue                                    # sendo processada agora
        processado = await redis.get(_chave_processado(pid, tel))
        if processado and float(processado) >= criado.timestamp():
            continue                                    # teve desfecho sem resposta (ex.: cota do plano)
        if await redis.get(_chave_recuperada(msg_id)):
            # Já voltou para a fila uma vez e segue sem resposta: humano.
            if await escalar_sem_resposta(pid, tel, motivo="mensagem sem resposta mesmo depois de nova tentativa"):
                out["escaladas"] += 1
            continue
        tem_lote = await redis.exists(_pending_key(pid, tel), _inflight_key(pid, tel))
        remontadas = 0 if tem_lote else await _remontar_lote(db, conv_id, pid, tel)
        await redis.set(_chave_recuperada(msg_id), "1", ex=2 * 3600)
        await _rearmar(pid, tel, bool(usar_dispatcher), 2.0)
        out["recuperadas"] += 1
        await registrar_alerta(
            db, tipo="mensagem_recuperada", pizzaria_id=pid, nivel="warning",
            detalhe=(f"Mensagem de {tel} estava sem resposta há {int(time.time() - criado.timestamp())} s "
                     f"({'lote parado' if tem_lote else f'{remontadas} mensagem(ns) remontada(s) do banco'}); "
                     "voltou para a fila."),
        )
        await db.commit()
    out["reenviadas"] = await _reenviar_respostas_que_falharam(db)
    return out


async def _reenviar_respostas_que_falharam(db: AsyncSession) -> int:
    """Resposta que a Evolution recusou (envio 'falhou') e ainda é a última coisa
    da conversa: manda de novo, poucas vezes e só nos primeiros minutos."""
    from app.models import Mensagem
    from app.services.broadcaster import broadcaster
    from app.services.evolution import evolution

    rows = (await db.execute(text("""
        SELECT m.id, p.instancia, COALESCE(u.metadata->>'telefone_jid', c.cliente_telefone)
          FROM public.mensagens m
          JOIN public.conversas c ON c.id = m.conversa_id
          JOIN public.pizzarias p ON p.id = m.pizzaria_id
          LEFT JOIN LATERAL (
                SELECT metadata FROM public.mensagens
                 WHERE conversa_id = c.id AND origem = 'cliente'
                 ORDER BY created_at DESC LIMIT 1
          ) u ON TRUE
         WHERE m.origem = 'bot'
           AND m.metadata->'envio'->>'status' = 'falhou'
           AND COALESCE((m.metadata->'envio'->>'reenvios')::int, 0) < :max
           AND m.created_at > now() - make_interval(mins => :janela)
           AND c.bot_ativo AND p.instancia IS NOT NULL AND NOT p.suspensa
           AND NOT EXISTS (SELECT 1 FROM public.mensagens n
                            WHERE n.conversa_id = m.conversa_id AND n.created_at > m.created_at)
         LIMIT 20
    """), {"max": MAX_REENVIOS, "janela": REENVIO_JANELA_MIN})).all()
    reenviadas = 0
    for msg_id, instancia, tel in rows:
        msg = (await db.execute(select(Mensagem).where(Mensagem.id == msg_id))).scalar_one()
        envio = dict((msg.metadata_json or {}).get("envio") or {})
        envio["reenvios"] = int(envio.get("reenvios") or 0) + 1
        try:
            await evolution.send_text(instancia=instancia, numero=tel, texto=msg.conteudo)
            envio.update(status="enviado", partes_enviadas=envio.get("partes_total") or 1, erro=None,
                         reenviado_em=datetime.now(UTC).isoformat())
            reenviadas += 1
        except Exception as e:  # noqa: BLE001
            envio["erro"] = f"{type(e).__name__}: {e}"[:300]
        msg.metadata_json = {**(msg.metadata_json or {}), "envio": envio}
        await db.commit()
        try:
            await broadcaster.publish(msg.pizzaria_id, {
                "tipo": "mensagem.atualizada", "pizzaria_id": str(msg.pizzaria_id),
                "payload": {"conversa_id": str(msg.conversa_id), "mensagem_id": str(msg.id),
                            "metadata": {"envio": envio}},
            })
        except Exception:  # noqa: BLE001
            pass
    return reenviadas
