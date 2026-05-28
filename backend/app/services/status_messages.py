"""
Mensagens automáticas quando o status do pedido muda.

Cada pizzaria configura o template (via `pizzarias.mensagens_status`).
Quando o status muda de X→Y, despachamos a mensagem via Evolution.

Suporta placeholders no template:
  {numero_pedido}, {nome_cliente}, {valor_total}, {tempo_entrega}
"""
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Cliente, Conversa, Mensagem, Pedido, Pizzaria
from app.services.broadcaster import broadcaster
from app.services.evolution import evolution

log = logging.getLogger(__name__)


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
    if novo_status not in ("confirmado", "no_forno", "a_caminho", "entregue", "cancelado"):
        return False

    # Busca pizzaria
    pizz = (
        await db.execute(select(Pizzaria).where(Pizzaria.id == pedido.pizzaria_id))
    ).scalar_one_or_none()
    if not pizz or not pizz.instancia:
        return False

    template = (pizz.mensagens_status or {}).get(novo_status)
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
        "nome_cliente": (cliente.nome or "").split(" ")[0] or "",
        "valor_total": f"R$ {float(pedido.valor_total):.2f}".replace(".", ","),
        "tempo_entrega": f"{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min"
            if pedido.tipo == "delivery"
            else f"{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min",
    }
    texto = _interpolar(template, ctx)

    # Envia
    try:
        await evolution.send_text(
            instancia=pizz.instancia,
            numero=cliente.telefone,
            texto=texto,
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
