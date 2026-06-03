"""
Webhook do Evolution API (entrada de mensagens WhatsApp).

Fluxo:
  1. Recebe POST do Evolution
  2. Identifica pizzaria por `instance`
  3. Extrai texto/áudio/imagem
  4. Salva mensagem + atualiza conversa
  5. Empilha na fila Redis (debounce 3s)
  6. Agenda Celery flush_conversation
  7. Broadcast WS para o painel
  8. Retorna 200 imediato (Evolution não pode esperar)
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Conversa, Mensagem, Pizzaria
from app.schemas import EvolutionWebhookPayload
from app.services.broadcaster import broadcaster
from app.services.evolution import evolution
from app.services.queue import enqueue_message

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


# ============================================
# Helpers
# ============================================
def _extract_phone(remote_jid: str) -> str:
    """`5511999999999@s.whatsapp.net` → `5511999999999`."""
    return remote_jid.split("@", 1)[0]


async def _responder_fora_horario(
    db: AsyncSession, pizz: Pizzaria, conv: Conversa, telefone: str
) -> None:
    """
    Envia UMA mensagem de 'fora do horário' por janela de 6h (evita spam),
    sem acionar a IA.
    """
    from app.services.business_hours import mensagem_fora_horario

    # Já avisamos nas últimas 6h? Então fica quieto.
    ja_avisou = (await db.execute(text("""
        SELECT 1 FROM public.mensagens
        WHERE conversa_id = :cid AND origem = 'sistema'
          AND metadata->>'trigger' = 'fora_horario'
          AND created_at > now() - interval '6 hours'
        LIMIT 1
    """), {"cid": str(conv.id)})).first()
    if ja_avisou:
        return

    if not pizz.instancia:
        return

    texto = mensagem_fora_horario(pizz)
    try:
        await evolution.send_text(instancia=pizz.instancia, numero=telefone, texto=texto)
    except Exception as e:  # noqa: BLE001
        log.warning("Falha ao enviar msg fora do horário: %s", e)
        return

    msg = Mensagem(
        conversa_id=conv.id,
        pizzaria_id=pizz.id,
        origem="sistema",
        tipo="texto",
        conteudo=texto,
        metadata_json={"trigger": "fora_horario"},
    )
    db.add(msg)
    conv.last_message = texto
    await db.commit()
    await db.refresh(msg)

    await broadcaster.publish(
        pizz.id,
        {
            "tipo": "mensagem.nova",
            "pizzaria_id": str(pizz.id),
            "payload": {
                "conversa_id": str(conv.id),
                "mensagem_id": str(msg.id),
                "telefone": telefone,
                "conteudo": texto,
                "origem": "sistema",
            },
        },
    )


def _extract_content(data: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """Retorna (conteudo, tipo, metadata)."""
    msg = data.get("message") or {}
    push_name = data.get("pushName")
    metadata = {"pushName": push_name, "evolution_id": data.get("key", {}).get("id")}

    if texto := msg.get("conversation"):
        return texto, "texto", metadata
    if ext := msg.get("extendedTextMessage"):
        return ext.get("text") or "", "texto", metadata
    if audio := msg.get("audioMessage"):
        metadata["audio"] = audio
        return "[áudio]", "audio", metadata
    if img := msg.get("imageMessage"):
        metadata["imagem"] = img
        return img.get("caption") or "[imagem]", "imagem", metadata
    if sticker := msg.get("stickerMessage"):
        metadata["figurinha"] = sticker
        return "[figurinha]", "figurinha", metadata
    if loc := msg.get("locationMessage"):
        metadata["localizacao"] = loc
        return "[localização]", "localizacao", metadata
    return "[mensagem não suportada]", "texto", metadata



def _pode_responder_fora_horario_com_ia(texto: str) -> bool:
    t = (texto or "").lower()
    termos_info = ("cardap", "menu", "horario", "horário", "abre", "funciona", "endereco", "endereço", "taxa")
    termos_fechamento = ("fechar pedido", "confirmar pedido", "pode fechar", "quero pedir", "entrega")
    return any(x in t for x in termos_info) and not any(x in t for x in termos_fechamento)


async def _get_or_create_conversa(
    db: AsyncSession,
    pizzaria_id: uuid.UUID,
    telefone: str,
    nome: str | None,
) -> Conversa:
    stmt = select(Conversa).where(
        Conversa.pizzaria_id == pizzaria_id,
        Conversa.cliente_telefone == telefone,
    )
    conv = (await db.execute(stmt)).scalar_one_or_none()
    if conv:
        return conv

    conv = Conversa(
        pizzaria_id=pizzaria_id,
        cliente_telefone=telefone,
        cliente_nome=nome,
    )
    db.add(conv)
    await db.flush()
    return conv


async def _handle_presence(payload: EvolutionWebhookPayload, db: AsyncSession) -> dict[str, Any]:
    """
    Trata o evento de presença ('digitando'/'gravando'). Se o cliente está
    escrevendo e já existe um lote pendente, estica o debounce — assim a gente
    espera ele terminar antes de responder. Best-effort (eventos de presença do
    WhatsApp não são 100% confiáveis; o debounce base cobre o resto).
    """
    if not payload.instance:
        return {"ignored": "no_instance"}

    data = payload.data or {}
    jid = data.get("id") or ""
    presenca = None
    presences = data.get("presences")
    if isinstance(presences, dict) and presences:
        if not jid:
            jid = next(iter(presences.keys()), "")
        node = presences.get(jid) or next(iter(presences.values()), None)
        if isinstance(node, dict):
            presenca = node.get("lastKnownPresence") or node.get("presence")
    presenca = presenca or data.get("lastKnownPresence") or data.get("presence")

    if presenca not in ("composing", "recording"):
        return {"ignored": "presence", "presence": presenca}
    if jid.endswith("@g.us") or "@broadcast" in jid:
        return {"ignored": "group"}

    telefone = _extract_phone(jid)
    if not telefone:
        return {"ignored": "no_phone"}

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.instancia == payload.instance))
    ).scalar_one_or_none()
    if not pizz:
        return {"ignored": "unknown_instance"}

    from app.services.queue import TYPING_GRACE_SECONDS, touch_typing

    esticou = await touch_typing(pizz.id, telefone)
    if esticou:
        # Reagenda a checagem de flush pra depois da janela de digitação.
        from app.workers.tasks import flush_conversation
        flush_conversation.apply_async(
            args=[str(pizz.id), telefone], countdown=TYPING_GRACE_SECONDS + 0.5,
        )
    return {"ok": True, "typing": True, "extended": esticou}


# ============================================
# Endpoint
# ============================================
@router.post("/evolution", status_code=status.HTTP_200_OK)
async def evolution_webhook(
    payload: EvolutionWebhookPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # ---- Autenticação anti-spoofing (C1) ----
    # Se um token estiver configurado, a Evolution o devolve em ?token=... (foi
    # gravado na URL do webhook). Sem o token correto, rejeita silenciosamente.
    from app.config import get_settings as _gs
    _wh_token = _gs().evolution_webhook_token
    if _wh_token and request.query_params.get("token") != _wh_token:
        log.warning("Webhook rejeitado: token inválido (instance=%s)", payload.instance)
        return {"ignored": "bad_token"}

    # Loga uma única linha pra debug (sem expor dados sensíveis)
    log.info("Evolution webhook: event=%s instance=%s", payload.event, payload.instance)

    # "Digitando…" do cliente: estica o debounce em vez de responder na hora.
    if payload.event in ("presence.update", "presence_update"):
        return await _handle_presence(payload, db)

    if payload.event not in (None, "messages.upsert"):
        return {"ignored": payload.event}

    data = payload.data or {}
    key = data.get("key") or {}
    if key.get("fromMe"):
        # Ignora ecos das nossas próprias mensagens
        return {"ignored": "fromMe"}

    if not payload.instance:
        return {"ignored": "no_instance"}

    # ---- localiza pizzaria pela instância ----
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.instancia == payload.instance))
    ).scalar_one_or_none()
    if not pizz:
        log.warning("Webhook para instância desconhecida: %s", payload.instance)
        return {"ignored": "unknown_instance"}

    # Pizzaria suspensa pelo admin (ex.: inadimplência): atendimento 100% desligado.
    if getattr(pizz, "suspensa", False):
        log.info("Pizzaria %s suspensa — ignorando mensagem", pizz.id)
        return {"ignored": "suspended"}

    if not pizz.bot_ativo_global:
        log.info("Bot global desligado para pizzaria %s", pizz.id)
        # Ainda salvamos a msg pra histórico, mas não processamos com IA
        # (deixa o painel decidir o que fazer)

    # ---- filtra grupos e broadcasts ----
    remote_jid = key.get("remoteJid", "")
    if remote_jid.endswith("@g.us"):
        log.debug("Ignorando mensagem de grupo: %s", remote_jid)
        return {"ignored": "group_message"}
    if "@broadcast" in remote_jid:
        log.debug("Ignorando mensagem de broadcast: %s", remote_jid)
        return {"ignored": "broadcast_message"}

    # ---- extrai dados ----
    telefone = _extract_phone(remote_jid)
    if not telefone:
        return {"ignored": "no_phone"}

    conteudo, tipo, metadata = _extract_content(data)
    evolution_msg_id = key.get("id")
    push_name = data.get("pushName")

    # ---- Idempotência (dedup de reentrega) ----
    # A Evolution reenvia o mesmo evento quando não recebe o 200 a tempo. Sem dedup,
    # a mesma mensagem é persistida 2x e o conteúdo entra duplicado na fila de
    # debounce (vira "Oi\nOi"). Marcamos o id do evento no Redis (SET NX, TTL 10min):
    # se já vimos, ignoramos silenciosamente. Best-effort — se o Redis falhar, segue.
    if evolution_msg_id:
        from app.redis_client import redis as _redis
        try:
            primeiro = await _redis.set(
                f"wh:seen:{payload.instance}:{evolution_msg_id}", "1", nx=True, ex=600,
            )
            if not primeiro:
                log.info("Webhook duplicado ignorado (evolution_id=%s)", evolution_msg_id)
                return {"ignored": "duplicate", "evolution_id": evolution_msg_id}
        except Exception as e:  # noqa: BLE001
            log.debug("Falha no dedup de webhook (seguindo sem dedup): %s", e)

    # ---- áudio: transcreve para o agente entender o pedido por voz ----
    if tipo == "audio" and pizz.instancia:
        try:
            from app.services.transcricao import transcrever_audio
            b64 = await evolution.get_media_base64(instancia=pizz.instancia, key=key)
            if b64:
                mtype = (metadata.get("audio") or {}).get("mimetype") or "audio/ogg"
                texto = await transcrever_audio(db, b64, mtype)
                if texto:
                    conteudo = texto
                    tipo = "texto"
                    metadata["transcrito_de"] = "audio"
        except Exception as e:  # noqa: BLE001
            log.warning("Falha na transcrição de áudio: %s", e)

    # ---- persiste ----
    conv = await _get_or_create_conversa(db, pizz.id, telefone, push_name)
    msg = Mensagem(
        conversa_id=conv.id,
        pizzaria_id=pizz.id,
        origem="cliente",
        tipo=tipo,
        conteudo=conteudo,
        metadata_json=metadata,
    )
    db.add(msg)

    # Atualiza conversa
    conv.last_message = conteudo
    conv.last_timestamp = datetime.now(timezone.utc)
    conv.unread_count = (conv.unread_count or 0) + 1
    if push_name and not conv.cliente_nome:
        conv.cliente_nome = push_name

    # ---- Garante rascunho de pedido em 'Novos' se não houver pedido ativo ----
    from app.models import Cliente, Pedido
    from decimal import Decimal

    stmt_cli = select(Cliente).where(
        Cliente.pizzaria_id == pizz.id,
        Cliente.telefone == telefone,
    )
    cli = (await db.execute(stmt_cli)).scalar_one_or_none()
    if not cli:
        cli = Cliente(
            pizzaria_id=pizz.id,
            telefone=telefone,
            nome=push_name,
        )
        db.add(cli)
        await db.flush()
    else:
        if push_name and not cli.nome:
            cli.nome = push_name
            await db.flush()

    # Lead em "Novos": cria um card de rascunho para CADA conversa/contato novo
    # (mesmo que a 1ª mensagem seja só "oi"), desde que não exista um pedido ativo
    # do cliente. Assim a equipe vê todo contato que chega no Kanban. Como o card
    # só nasce quando NÃO há pedido ativo, mensagens repetidas não duplicam o card.
    stmt_ped = select(Pedido).where(
        Pedido.pizzaria_id == pizz.id,
        Pedido.cliente_id == cli.id,
        Pedido.status.in_(["novo", "confirmado", "no_forno", "a_caminho"]),
    )
    ped_ativo = (await db.execute(stmt_ped)).scalars().first()

    if not ped_ativo:
        ped_rascunho = Pedido(
            pizzaria_id=pizz.id,
            cliente_id=cli.id,
            itens=[],
            valor_total=Decimal("0.00"),
            status="novo",
            tipo="delivery",
        )
        db.add(ped_rascunho)
        await db.flush()

        # Dispara o broadcast de novo pedido rascunho para atualizar o painel
        await broadcaster.publish(
            pizz.id,
            {
                "tipo": "pedido.novo",
                "pizzaria_id": str(pizz.id),
                "payload": {
                    "pedido_id": str(ped_rascunho.id),
                    "numero_pedido": ped_rascunho.numero_pedido,
                    "status": ped_rascunho.status,
                },
            },
        )

    await db.commit()
    await db.refresh(msg)

    # ---- fila + broadcast (não bloqueia retorno) ----
    if pizz.bot_ativo_global and conv.bot_ativo:
        from app.services.business_hours import esta_aberto

        if not esta_aberto(pizz.horario_funcionamento or {}) and not _pode_responder_fora_horario_com_ia(conteudo):
            # Fora do horário: responde UMA mensagem e NÃO aciona a IA.
            await _responder_fora_horario(db, pizz, conv, telefone)
        else:
            await enqueue_message(
                pizzaria_id=pizz.id,
                telefone=telefone,
                mensagem_id=msg.id,
                conteudo=conteudo,
                metadata={"evolution_msg_id": evolution_msg_id, "tipo": tipo},
            )
            # Agenda flush_conversation alinhado ao debounce base (+ folga).
            from app.services.queue import DEBOUNCE_SECONDS
            from app.workers.tasks import flush_conversation
            flush_conversation.apply_async(
                args=[str(pizz.id), telefone],
                countdown=DEBOUNCE_SECONDS + 0.5,
            )

    await broadcaster.publish(
        pizz.id,
        {
            "tipo": "mensagem.nova",
            "pizzaria_id": str(pizz.id),
            "payload": {
                "conversa_id": str(conv.id),
                "mensagem_id": str(msg.id),
                "telefone": telefone,
                "nome": push_name,
                "conteudo": conteudo,
                "tipo": tipo,
                "origem": "cliente",
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            },
        },
    )

    return {"ok": True, "conversa_id": str(conv.id), "mensagem_id": str(msg.id)}
