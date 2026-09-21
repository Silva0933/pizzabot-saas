"""
Checagem de prontidão para produção.

Vários pontos do sistema são "fail-open" de propósito, para não travar o setup
inicial: webhook sem token configurado aceita qualquer POST, gateway sem chave
não cobra ninguém, CORS apontando para localhost. Em desenvolvimento isso é
conveniente; em produção, cada um desses é uma porta aberta ou uma função morta
— e todos falham em silêncio.

Este módulo roda no startup e transforma esse silêncio em alerta no painel.
Não bloqueia a subida: derrubar a API por causa de um token faltando seria pior
que o problema que ele resolve.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from app.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class Achado:
    chave: str
    gravidade: str  # "critico" | "atencao"
    titulo: str
    detalhe: str


def _vazio(valor: str | None) -> bool:
    return not (valor or "").strip()


def auditar() -> list[Achado]:
    """Lista o que está faltando para rodar em produção com segurança."""
    s = get_settings()
    achados: list[Achado] = []

    if _vazio(s.evolution_webhook_token):
        achados.append(Achado(
            "EVOLUTION_WEBHOOK_TOKEN", "critico",
            "Webhook do WhatsApp sem token",
            "Sem token a verificação é PULADA e qualquer um pode POSTar mensagens "
            "falsas em /webhook/evolution: o bot responde, consome cota e chega a "
            "registrar pedido.",
        ))

    if _vazio(s.asaas_platform_webhook_token):
        achados.append(Achado(
            "ASAAS_PLATFORM_WEBHOOK_TOKEN", "critico",
            "Webhook de cobrança da plataforma sem token",
            "Sem token, /webhook/asaas-plataforma aceita qualquer POST — dá para "
            "forjar 'pagamento confirmado' e renovar assinatura sem pagar.",
        ))

    if _vazio(s.asaas_platform_api_key):
        achados.append(Achado(
            "ASAAS_PLATFORM_API_KEY", "critico",
            "Gateway de assinatura não configurado",
            "Nenhuma pizzaria consegue assinar nem pagar. A suspensão automática "
            "fica desligada de propósito para não trancar a base inteira sem saída.",
        ))

    if _vazio(s.mp_webhook_secret):
        achados.append(Achado(
            "MP_WEBHOOK_SECRET", "atencao",
            "Assinatura do webhook do Mercado Pago não verificada",
            "O pedido ainda é validado consultando o pagamento na API do MP antes "
            "de aplicar, mas sem o secret não dá para provar que a notificação veio "
            "mesmo deles. O valor por pizzaria fica em pizzarias.mp_webhook_secret.",
        ))

    if s.is_production:
        origens = s.cors_origins_list
        ruins = [o for o in origens if "localhost" in o or "127.0.0.1" in o or o == "*"]
        if ruins:
            achados.append(Achado(
                "CORS_ORIGINS", "critico",
                "CORS liberado para origem de desenvolvimento",
                f"Em produção com allow_credentials, {ruins} permite que uma página "
                "local leia respostas autenticadas da API.",
            ))
        if not origens:
            achados.append(Achado(
                "CORS_ORIGINS", "atencao",
                "CORS sem origem configurada",
                "O painel no navegador não vai conseguir falar com a API.",
            ))

    return achados


async def registrar_prontidao() -> list[Achado]:
    """Audita e publica os achados como alerta no painel admin."""
    achados = auditar()
    if not achados:
        log.info("Prontidão: nenhuma pendência de configuração.")
        return achados

    for a in achados:
        nivel = log.error if a.gravidade == "critico" else log.warning
        nivel("PRONTIDÃO [%s] %s — %s: %s", a.gravidade.upper(), a.chave, a.titulo, a.detalhe)

    criticos = [a for a in achados if a.gravidade == "critico"]
    try:
        from app.db import AsyncSessionLocal
        from app.services.alertas import registrar_alerta

        async with AsyncSessionLocal() as db:
            await registrar_alerta(
                db,
                tipo="prontidao_producao",
                nivel="error" if criticos else "warning",
                detalhe=(
                    f"{len(achados)} pendência(s) de configuração"
                    + (f", {len(criticos)} crítica(s)" if criticos else "")
                    + ": "
                    + "; ".join(f"{a.chave} — {a.titulo}" for a in achados)
                ),
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("Não consegui registrar o alerta de prontidão: %s", e)

    return achados
