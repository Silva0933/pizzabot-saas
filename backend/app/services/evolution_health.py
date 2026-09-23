"""
Monitor de saúde da Evolution API.

A Evolution é a peça que faz TODO o atendimento acontecer: se ela cai (ou a
apikey é trocada/expira), nenhuma pizzaria envia ou recebe mensagem e nenhum
QR Code é gerado — mas o resto do sistema segue respondendo normalmente, então
a falha fica invisível. Este monitor pinga a Evolution e registra um alerta na
central do painel admin na TRANSIÇÃO para offline (não repete a cada rodada).

Chamado de:
  - `workers/periodic.verificar_conexoes_whatsapp` (a cada 5 min)
  - `routes/admin.get_evolution` (status ao vivo no card do painel)
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_config import EVOLUTION_STATUS_KEY, get_config, set_config

log = logging.getLogger(__name__)

# Alerta legível por motivo da falha — é o que o dono do SaaS lê na central.
_DETALHE = {
    "nao_configurada": (
        "Evolution API NÃO CONFIGURADA: nenhuma pizzaria consegue enviar/receber "
        "mensagens nem gerar QR Code. Configure a URL e a chave em "
        "Administração → IA e integrações → Evolution API."
    ),
    "inacessivel": (
        "Evolution API INACESSÍVEL: o servidor não respondeu. O atendimento de "
        "TODAS as pizzarias está parado e nenhum QR Code pode ser gerado."
    ),
    "chave_invalida": (
        "Evolution API recusou a apikey global: o atendimento de TODAS as "
        "pizzarias está parado. Confira a chave em Administração → IA e "
        "integrações → Evolution API."
    ),
    "erro": (
        "Evolution API respondeu com erro. O atendimento de TODAS as pizzarias "
        "pode estar parado."
    ),
}


async def checar_saude_evolution(
    db: AsyncSession,
    *,
    alertar: bool = True,
) -> dict[str, Any]:
    """
    Pinga a Evolution e devolve o resultado do `health()`.

    Quando `alertar`, grava um alerta na central na TRANSIÇÃO online → offline
    (ou quando o motivo da falha muda) e loga a volta. Best-effort: nunca
    propaga exceção — é observabilidade, não pode derrubar o chamador.
    """
    from app.services.evolution import evolution

    try:
        status = await evolution.health()
    except Exception as e:  # noqa: BLE001
        status = {"ok": False, "motivo": "erro", "erro": str(e)[:300],
                  "base_url": None, "instancias": None}

    status["checado_em"] = datetime.now(UTC).isoformat()

    if not alertar:
        return status

    try:
        anterior = await get_config(db, EVOLUTION_STATUS_KEY)
        era_ok = bool(anterior.get("ok", True))
        motivo_anterior = anterior.get("motivo")

        caiu = not status["ok"] and (era_ok or motivo_anterior != status.get("motivo"))
        voltou = status["ok"] and not era_ok

        if caiu:
            from app.services.alertas import registrar_alerta

            motivo = status.get("motivo") or "erro"
            detalhe = _DETALHE.get(motivo, _DETALHE["erro"])
            if status.get("erro"):
                detalhe = f"{detalhe} Detalhe técnico: {status['erro']}"
            await registrar_alerta(
                db,
                tipo="evolution_offline",
                detalhe=detalhe,
                nivel="error",
            )
        elif voltou:
            log.info("Evolution API voltou a responder (%s).", status.get("base_url"))

        await set_config(db, EVOLUTION_STATUS_KEY, {
            "ok": bool(status["ok"]),
            "motivo": status.get("motivo"),
            "erro": status.get("erro"),
            "base_url": status.get("base_url"),
            "checado_em": status["checado_em"],
        })
    except Exception as e:  # noqa: BLE001
        log.debug("Monitor de saúde da Evolution falhou (ignorado): %s", e)

    return status


async def ultimo_status(db: AsyncSession) -> dict[str, Any]:
    """Última saúde registrada (sem pingar a Evolution de novo)."""
    return await get_config(db, EVOLUTION_STATUS_KEY)
