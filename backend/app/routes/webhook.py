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
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import case, select, text
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

# Tasks disparadas depois da resposta (ex.: transcrição de áudio fora do agente).
_TAREFAS_FUNDO: set = set()


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
        # Guarda só o essencial (o payload tem thumbnail base64 enorme).
        lat = loc.get("degreesLatitude")
        lon = loc.get("degreesLongitude")
        metadata["localizacao"] = {
            "lat": lat, "lon": lon,
            "name": loc.get("name"), "address": loc.get("address"),
        }
        if lat is not None and lon is not None:
            # Formato estruturado que o pipeline FSM converte em endereço via
            # reverse geocoding (fsm/pipeline._nlu_localizacao).
            extras = " · ".join(str(x) for x in (loc.get("name"), loc.get("address")) if x)
            texto = f"[localizacao lat={lat} lon={lon}]" + (f" {extras}" if extras else "")
            return texto, "localizacao", metadata
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
    # O mesmo número chega com e sem o 9º dígito (cardápio digital × JID do
    # WhatsApp). Procurar só o exato abria uma conversa nova para quem acabou de
    # pedir pelo cardápio, separada da confirmação que o sistema mandou.
    from app.services.telefones import telefones_equivalentes
    stmt = select(Conversa).where(
        Conversa.pizzaria_id == pizzaria_id,
        Conversa.cliente_telefone.in_(sorted(telefones_equivalentes(telefone) | {telefone})),
    ).order_by(case((Conversa.cliente_telefone == telefone, 0), else_=1))
    conv = (await db.execute(stmt)).scalars().first()
    if conv:
        return conv

    # ON CONFLICT: as duas primeiras mensagens de um contato novo chegam quase
    # juntas; as duas não acham a conversa e tentam criar. Com INSERT simples a
    # segunda estourava o UNIQUE (pizzaria_id, cliente_telefone) e o webhook
    # dava 500. Agora a segunda só não insere e usa a que a primeira criou.
    await db.execute(
        pg_insert(Conversa)
        .values(pizzaria_id=pizzaria_id, cliente_telefone=telefone, cliente_nome=nome)
        .on_conflict_do_nothing(index_elements=["pizzaria_id", "cliente_telefone"])
    )
    return (await db.execute(stmt)).scalars().first()


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
        if getattr(pizz, "usar_dispatcher", False):
            # Dispatcher: sincroniza o ZSET de prazos com o flush_at esticado.
            from app.services.queue import arm_dispatcher
            await arm_dispatcher(pizz.id, telefone)
        else:
            # Celery: reagenda a checagem de flush pra depois da janela de digitação.
            from app.workers.tasks import flush_conversation
            flush_conversation.apply_async(
                args=[str(pizz.id), telefone], countdown=TYPING_GRACE_SECONDS + 0.5,
            )
    return {"ok": True, "typing": True, "extended": esticou}


async def _handle_connection_update(
    payload: EvolutionWebhookPayload, db: AsyncSession
) -> dict[str, Any]:
    """
    Trata o CONNECTION_UPDATE da Evolution: persiste o estado da conexão da
    instância ('open'/'connecting'/'close'), avisa o painel em tempo real e
    registra alerta quando a pizzaria desconecta (atendimento parado).
    A lógica de aplicação é compartilhada com o poll periódico do Beat.
    """
    if not payload.instance:
        return {"ignored": "no_instance"}

    data = payload.data or {}
    estado = data.get("state")
    if not estado and isinstance(data.get("instance"), dict):
        estado = data["instance"].get("state")
    if estado not in ("open", "connecting", "close"):
        return {"ignored": "unknown_state", "state": estado}

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.instancia == payload.instance))
    ).scalar_one_or_none()
    if not pizz:
        return {"ignored": "unknown_instance"}

    if estado == pizz.whatsapp_estado:
        return {"ok": True, "unchanged": estado}

    from app.services.whatsapp_status import aplicar_estado_conexao
    await aplicar_estado_conexao(db, pizz, estado)
    await db.commit()
    log.info(
        "Conexão WhatsApp atualizada: pizzaria=%s instancia=%s estado=%s",
        pizz.id, payload.instance, estado,
    )
    return {"ok": True, "estado": estado}


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
    #
    # Aceita TANTO o token atual (painel admin) quanto o do .env: ao trocar o
    # token, as instâncias já criadas seguem mandando o antigo na URL até o
    # admin rodar "Reaplicar webhooks" — sem isso o atendimento pararia calado.
    from app.config import get_settings as _gs
    from app.services.evolution import evolution as _evo

    try:
        _cfg = await _evo.config_atual()   # cacheado ~60s, não bate no banco a cada msg
        _tokens = {_cfg.get("webhook_token") or "", _gs().evolution_webhook_token or ""}
    except Exception:  # noqa: BLE001
        _tokens = {_gs().evolution_webhook_token or ""}
    _tokens.discard("")
    from app.services.secrets import token_confere
    if _tokens and not token_confere(request.query_params.get("token"), _tokens):
        log.warning("Webhook rejeitado: token inválido (instance=%s)", payload.instance)
        return {"ignored": "bad_token"}

    # Loga uma única linha pra debug (sem expor dados sensíveis)
    log.info("Evolution webhook: event=%s instance=%s", payload.event, payload.instance)

    # "Digitando…" do cliente: estica o debounce em vez de responder na hora.
    if payload.event in ("presence.update", "presence_update"):
        return await _handle_presence(payload, db)

    # Estado da conexão da instância (monitor de WhatsApp desconectado).
    if payload.event in ("connection.update", "connection_update"):
        return await _handle_connection_update(payload, db)

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
    dedup_key: str | None = None
    ped_rascunho = None
    if evolution_msg_id:
        from app.redis_client import redis as _redis
        try:
            primeiro = await _redis.set(
                f"wh:seen:{payload.instance}:{evolution_msg_id}", "1", nx=True, ex=600,
            )
            if not primeiro:
                log.info("Webhook duplicado ignorado (evolution_id=%s)", evolution_msg_id)
                return {"ignored": "duplicate", "evolution_id": evolution_msg_id}
            dedup_key = f"wh:seen:{payload.instance}:{evolution_msg_id}"
        except Exception as e:  # noqa: BLE001
            log.debug("Falha no dedup de webhook (seguindo sem dedup): %s", e)

    # A marca do dedup é gravada ANTES de persistir. Se a persistência falhar
    # (ex.: duas primeiras mensagens de um contato novo chegando juntas batem no
    # UNIQUE de conversas/clientes), a Evolution reentrega o evento — e sem soltar
    # a marca a reentrega era descartada como duplicada: mensagem perdida.
    try:
        # ---- áudio: a transcrição NÃO acontece aqui ----
        # Baixar + transcrever antes do 200 fazia a Evolution estourar o timeout
        # em áudio longo e reentregar. A mensagem entra como "[áudio]" e o
        # worker/dispatcher transcreve antes do agente (services/transcricao).
        midia_audio = None
        if tipo == "audio" and pizz.instancia:
            from app.services.transcricao import referencia_midia
            midia_audio = referencia_midia(data)

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
        conv.last_timestamp = datetime.now(UTC)
        conv.unread_count = (conv.unread_count or 0) + 1
        if push_name and not conv.cliente_nome:
            conv.cliente_nome = push_name

        # ---- Garante rascunho de pedido em 'Novos' se não houver pedido ativo ----
        from decimal import Decimal

        from app.models import Cliente, Pedido
        from app.services.telefones import telefones_equivalentes
        stmt_cli = select(Cliente).where(
            Cliente.pizzaria_id == pizz.id,
            Cliente.telefone.in_(sorted(telefones_equivalentes(telefone) | {telefone})),
        ).order_by(case((Cliente.telefone == telefone, 0), else_=1))
        cli = (await db.execute(stmt_cli)).scalars().first()
        if not cli:
            # Mesmo motivo da conversa: contato novo com mensagens simultâneas.
            await db.execute(
                pg_insert(Cliente)
                .values(pizzaria_id=pizz.id, telefone=telefone, nome=push_name)
                .on_conflict_do_nothing(index_elements=["pizzaria_id", "telefone"])
            )
            cli = (await db.execute(stmt_cli)).scalars().first()
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
            Pedido.status.in_(["novo", "confirmado", "no_forno", "pronto_entrega", "a_caminho"]),
        ).order_by(Pedido.created_at.desc())
        # Rascunho antigo (o cliente sumiu sem fechar) não é pedido ativo: é
        # encerrado e o contato de hoje ganha um card novo. Antes o rascunho de
        # 23/09 foi reaproveitado em 29/09 — o pedido do dia nasceu com data velha
        # e sumiu do quadro "de hoje".
        from app.agent.tools import eh_rascunho, encerrar_rascunho, rascunho_recente
        ped_ativo = None
        for ped_existente in (await db.execute(stmt_ped)).scalars().all():
            if eh_rascunho(ped_existente) and not rascunho_recente(ped_existente):
                await encerrar_rascunho(db, ped_existente)
                continue
            ped_ativo = ped_ativo or ped_existente

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
            from app.services.order_audit import registrar_evento_pedido
            registrar_evento_pedido(db, ped_rascunho, tipo="criado", status_novo="novo", ator_nome="WhatsApp", ator_tipo="cliente")

        await db.commit()
        await db.refresh(msg)
    except Exception:
        if dedup_key:
            try:
                from app.redis_client import redis as _redis
                await _redis.delete(dedup_key)
            except Exception as e_del:  # noqa: BLE001
                log.debug("Falha ao soltar a marca de dedup: %s", e_del)
        raise

    # Aviso do rascunho só DEPOIS do commit: antes, se o commit falhasse o painel
    # ganhava um card de pedido que não existe; e mesmo dando certo, o painel
    # podia buscar o pedido antes de ele estar visível. O refresh traz o número,
    # que é gerado por trigger no INSERT (antes ia vazio no evento).
    if ped_rascunho is not None:
        try:
            await db.refresh(ped_rascunho)
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
        except Exception as e:  # noqa: BLE001
            log.warning("Falha ao avisar o painel do rascunho de pedido: %s", e)

    # ---- Reação ✅ ao comprovante do Pix manual (best-effort, decorativa) ----
    # Se há pedido aguardando conferência e a mensagem parece o comprovante
    # (imagem ou "paguei"), reage com ✅ na própria mensagem — feedback imediato
    # e humano; o ack textual continua por conta do pipeline.
    if evolution_msg_id:
        try:
            from app.agent.fsm.pipeline import _parece_comprovante
            texto_check = conteudo if tipo == "texto" else f"[{tipo}]"
            if _parece_comprovante(texto_check):
                em_analise = (await db.execute(select(Pedido).where(
                    Pedido.pizzaria_id == pizz.id,
                    Pedido.cliente_id == cli.id,
                    Pedido.payment_status == "em_analise",
                ))).scalars().first()
                if em_analise:
                    await evolution.send_reaction(
                        instancia=pizz.instancia, numero=remote_jid,
                        message_id=evolution_msg_id, emoji="✅",
                    )
        except Exception as e:  # noqa: BLE001
            log.debug("Reação ao comprovante falhou (não-fatal): %s", e)

    # ---- fila + broadcast (não bloqueia retorno) ----
    if pizz.bot_ativo_global and conv.bot_ativo:
        from app.services.business_hours import esta_aberto

        if not esta_aberto(
            pizz.horario_funcionamento or {},
            override=getattr(pizz, "aberto_manual", None),
        ) and not _pode_responder_fora_horario_com_ia(conteudo):
            # Fora do horário: responde UMA mensagem e NÃO aciona a IA.
            await _responder_fora_horario(db, pizz, conv, telefone)
        else:
            await enqueue_message(
                pizzaria_id=pizz.id,
                telefone=telefone,
                mensagem_id=msg.id,
                conteudo=conteudo,
                metadata={"evolution_msg_id": evolution_msg_id, "tipo": tipo, "midia": midia_audio},
            )
            midia_audio = None  # quem transcreve agora é o worker/dispatcher
            if getattr(pizz, "usar_dispatcher", False):
                # Etapa 1: arma no ZSET de prazos; o serviço dispatcher drena.
                from app.services.queue import arm_dispatcher
                await arm_dispatcher(pizz.id, telefone)
            else:
                # Caminho Celery: agenda flush alinhado ao debounce base (+ folga).
                from app.services.queue import DEBOUNCE_SECONDS
                from app.workers.tasks import flush_conversation
                flush_conversation.apply_async(
                    args=[str(pizz.id), telefone],
                    countdown=DEBOUNCE_SECONDS + 0.5,
                )
    elif conteudo:
        # Conversa com um humano: a IA não responde, mas o que o cliente disse
        # entra no histórico dela. Sem isso, ao devolver a conversa ao bot, ele
        # voltava sem saber o que foi combinado com o atendente.
        try:
            from app.agent.memory import append_turn
            await append_turn(db, pizz.id, telefone, role="user", content=conteudo)
            await db.commit()
        except Exception as e:  # noqa: BLE001
            log.debug("Memória do atendimento humano (cliente) falhou: %s", e)

    if midia_audio:
        # Não foi para o agente (bot desligado / fora do horário): transcreve em
        # segundo plano só para a equipe ler no painel.
        import asyncio

        from app.services.transcricao import transcrever_em_segundo_plano
        tarefa = asyncio.create_task(transcrever_em_segundo_plano(pizz.id, msg.id, midia_audio))
        # Sem guardar a referência, o GC pode matar a task no meio.
        _TAREFAS_FUNDO.add(tarefa)
        tarefa.add_done_callback(_TAREFAS_FUNDO.discard)

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
