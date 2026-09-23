"""
Mensagens automáticas quando o status do pedido muda.

Cada pizzaria configura o template (via `pizzarias.mensagens_status`).
Quando o status muda de X→Y, despachamos a mensagem via Evolution.

Suporta placeholders no template:
  {numero_pedido}, {nome_cliente}, {valor_total}, {tempo_entrega}
"""
import logging
from datetime import UTC
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Cliente, Conversa, Mensagem, Pedido, Pizzaria
from app.services.broadcaster import broadcaster
from app.services.evolution import evolution

log = logging.getLogger(__name__)

# Mensagens padrão usadas quando a pizzaria não configurou um template próprio.
# Placeholders: {numero_pedido}, {nome_cliente}, {valor_total}, {tempo_entrega}
DEFAULT_STATUS_MESSAGES: dict[str, str] = {
    "pagamento_aprovado": "✅ Pagamento confirmado, {nome_cliente}! Seu pedido #{numero_pedido} foi enviado pro preparo e logo entra na cozinha. 🍕",
    "pagamento_falhou": "Ops, {nome_cliente}, não consegui confirmar o pagamento do pedido #{numero_pedido} 😕 Sem problema: você pode tentar o Pix de novo ou pagar na entrega (dinheiro/cartão). Como prefere? Se você já pagou, me manda o comprovante que eu confiro com a equipe. 🙏",
    "confirmado": "Oi {nome_cliente}! ✅ Seu pedido #{numero_pedido} foi confirmado e enviado pro preparo. Logo entra na cozinha! 🍕",
    "no_forno": "🔥 Seu pedido #{numero_pedido} já está no forno, {nome_cliente}! Em breve fica pronto.",
    "a_caminho": "🛵 Saiu para entrega! Seu pedido #{numero_pedido} chega em breve. 😋",
    "entregue": "🎉 Pedido #{numero_pedido} entregue! Obrigado pela preferência, {nome_cliente}. Bom apetite! 😋",
    "cancelado": "Seu pedido #{numero_pedido} foi cancelado. Qualquer dúvida é só chamar a gente. 🙏",
}


DEFAULT_NPS_MESSAGE = (
    "Oi {nome_cliente}! 🍕 Passando rapidinho pra saber se o pedido #{numero_pedido} "
    "chegou quentinho e tava gostoso. De 0 a 10, que nota você dá pro nosso atendimento? "
    "Sua opinião ajuda demais a gente a melhorar! ❤️"
)


async def enviar_pesquisa_nps(db: AsyncSession, pedido: Pedido) -> bool:
    """
    Envia a pesquisa de satisfação (NPS) pós-entrega. Idempotente: só manda uma
    vez por pedido (marca `nps_enviado_at`). Não envia se cancelado ou já avaliado.
    """
    if pedido.status == "cancelado" or pedido.nps_enviado_at is not None or pedido.nps_nota is not None:
        return False

    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))
    ).scalar_one_or_none()
    if not pizz or not pizz.instancia:
        return False

    cliente = (
        await db.execute(select(Cliente).where(Cliente.id == pedido.cliente_id))
    ).scalar_one_or_none()
    if not cliente:
        return False

    template = (pizz.mensagens_status or {}).get("nps") or DEFAULT_NPS_MESSAGE
    texto = _interpolar(template, {
        "numero_pedido": pedido.numero_pedido or "",
        "nome_cliente": (cliente.nome or "").split(" ")[0].lstrip("@").strip() or "cliente",
    })

    try:
        delay_ms = int(min(max(len(texto) * 55, 1500), 8000))
        try:
            await evolution.send_presence(instancia=pizz.instancia, numero=cliente.telefone, tipo="composing")
        except Exception:  # noqa: BLE001
            pass
        await evolution.send_text(instancia=pizz.instancia, numero=cliente.telefone, texto=texto, delay_ms=delay_ms)
    except Exception as e:  # noqa: BLE001
        log.exception("Falha ao enviar NPS: %s", e)
        return False

    from datetime import datetime
    pedido.nps_enviado_at = datetime.now(UTC)

    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizz.id,
                Conversa.cliente_telefone == cliente.telefone,
            )
        )
    ).scalar_one_or_none()
    if conv:
        msg = Mensagem(
            conversa_id=conv.id,
            pizzaria_id=pizz.id,
            origem="sistema",
            tipo="texto",
            conteudo=texto,
            metadata_json={"trigger": "nps", "pedido_id": str(pedido.id)},
        )
        db.add(msg)
        conv.last_message = texto
    await db.flush()
    log.info("NPS enviado: pedido=%s", pedido.numero_pedido)
    return True


def _interpolar(template: str, ctx: dict[str, Any]) -> str:
    """Substitui placeholders {chave} no template."""
    out = template
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", str(v))
    return out


async def enviar_mensagem_status(
    db: AsyncSession,
    pedido: Pedido,
    novo_status: str,
) -> bool:
    """
    Envia mensagem automática para o cliente quando o status muda.

    Retorna True se enviou, False se não havia template ou outro erro.
    """
    if novo_status not in ("pagamento_aprovado", "pagamento_falhou", "confirmado", "no_forno", "a_caminho", "entregue", "cancelado"):
        return False

    # Idempotência: se já enviamos a mensagem desse status para este pedido,
    # não envia de novo (evita duplicatas em cliques/atualizações repetidas).
    from sqlalchemy import text as _text
    ja_enviou = (await db.execute(_text("""
        SELECT 1 FROM public.mensagens
        WHERE pizzaria_id = :pid AND origem = 'sistema'
          AND metadata->>'trigger' = :trig AND metadata->>'pedido_id' = :ped
        LIMIT 1
    """), {"pid": str(pedido.pizzaria_id), "trig": f"status:{novo_status}", "ped": str(pedido.id)})).first()
    if ja_enviou:
        return False

    # Busca pizzaria
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))
    ).scalar_one_or_none()
    if not pizz or not pizz.instancia:
        return False

    # Usa o template configurado pela pizzaria; senão, um padrão sensato.
    template = (pizz.mensagens_status or {}).get(novo_status) or DEFAULT_STATUS_MESSAGES.get(novo_status)
    if not template:
        return False

    cliente = (
        await db.execute(select(Cliente).where(Cliente.id == pedido.cliente_id))
    ).scalar_one_or_none()
    if not cliente:
        return False

    # Monta contexto
    ctx = {
        "numero_pedido": pedido.numero_pedido or "",
        "nome_cliente": (cliente.nome or "").split(" ")[0].lstrip("@").strip() or "cliente",
        "valor_total": f"R$ {float(pedido.valor_total):.2f}".replace(".", ","),
        "tempo_entrega": f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
            if pedido.tipo == "delivery"
            else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min",
    }
    texto = _interpolar(template, ctx)

    # Envia com "digitando…" (presença + delay proporcional ao tamanho)
    try:
        delay_ms = int(min(max(len(texto) * 55, 1500), 8000))
        try:
            await evolution.send_presence(instancia=pizz.instancia, numero=cliente.telefone, tipo="composing")
        except Exception:  # noqa: BLE001
            pass
        await evolution.send_text(
            instancia=pizz.instancia,
            numero=cliente.telefone,
            texto=texto,
            delay_ms=delay_ms,
        )
    except Exception as e:
        log.exception("Falha ao enviar mensagem de status: %s", e)
        return False

    # Persiste como mensagem do sistema (mostra no painel)
    conv = (
        await db.execute(
            select(Conversa).where(
                Conversa.pizzaria_id == pizz.id,
                Conversa.cliente_telefone == cliente.telefone,
            )
        )
    ).scalar_one_or_none()
    if conv:
        msg = Mensagem(
            conversa_id=conv.id,
            pizzaria_id=pizz.id,
            origem="sistema",
            tipo="texto",
            conteudo=texto,
            metadata_json={"trigger": f"status:{novo_status}", "pedido_id": str(pedido.id)},
        )
        db.add(msg)
        conv.last_message = texto
        await db.flush()

        await broadcaster.publish(
            pizz.id,
            {
                "tipo": "mensagem.nova",
                "pizzaria_id": str(pizz.id),
                "payload": {
                    "conversa_id": str(conv.id),
                    "mensagem_id": str(msg.id),
                    "telefone": cliente.telefone,
                    "conteudo": texto,
                    "origem": "sistema",
                },
            },
        )

    log.info(
        "Status msg sent: pedido=%s %s→%s",
        pedido.numero_pedido, pedido.status, novo_status,
    )
    return True
