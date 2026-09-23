"""
Estado da conexão WhatsApp (Evolution) por pizzaria.

Lógica compartilhada entre o webhook (evento CONNECTION_UPDATE) e o poll
periódico do Beat (workers/periodic.py): persiste a mudança, avisa o painel
em tempo real e alerta na transição para 'close'.
"""
import logging
from datetime import UTC, datetime

log = logging.getLogger(__name__)


async def aplicar_estado_conexao(db, pizz, estado: str) -> None:
    """
    Atualiza o estado salvo, publica `whatsapp.status` pro painel e registra
    alerta na TRANSIÇÃO para 'close' (não repete enquanto seguir desconectada).
    Não faz commit — o chamador decide a transação.
    """
    from app.services.alertas import registrar_alerta
    from app.services.broadcaster import broadcaster

    anterior = pizz.whatsapp_estado
    pizz.whatsapp_estado = estado
    pizz.whatsapp_estado_em = datetime.now(UTC)

    try:
        await broadcaster.publish(pizz.id, {
            "tipo": "whatsapp.status",
            "pizzaria_id": str(pizz.id),
            "payload": {"estado": estado, "anterior": anterior},
        })
    except Exception as e:  # noqa: BLE001
        log.debug("Broadcast whatsapp.status falhou (não-fatal): %s", e)

    if estado == "close" and anterior != "close":
        await registrar_alerta(
            db,
            tipo="whatsapp_desconectado",
            detalhe=(
                f"WhatsApp da pizzaria '{pizz.nome}' desconectou (instância "
                f"{pizz.instancia}). O atendimento está PARADO até reconectar "
                f"em Meu Negócio → WhatsApp."
            ),
            pizzaria_id=pizz.id,
            nivel="error",
        )
    elif estado == "open" and anterior == "close":
        log.info("WhatsApp da pizzaria %s reconectou (instância %s)", pizz.id, pizz.instancia)
