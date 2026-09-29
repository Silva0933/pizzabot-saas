"""
Proteção do número contra banimento (API não oficial do WhatsApp).

O que mais derruba número não é "ser bot": é denúncia de quem recebeu mensagem
que não pediu, rajada de envios e número novo com volume alto. Aqui ficam as
regras que o sistema inteiro segue:

  1. Porteiro das mensagens ATIVAS (as que o sistema manda por conta própria:
     lembrete de confirmação, resgate de carrinho, pesquisa de satisfação):
     só para quem falou com a loja nas últimas 24 h (a mesma regra da API
     oficial), nunca para quem pediu para parar, e com teto por hora por número.
  2. Descadastro: "pare de me mandar mensagem" → o cliente não recebe mais
     mensagens automáticas (respostas ao que ele mesmo escreve continuam).
  3. Ritmo por número: espaço mínimo entre envios do MESMO número, maior para
     o que não é resposta. O dono avança 15 pedidos de uma vez e os avisos de
     status saem espaçados, não em rajada.
  4. Aquecimento: nos primeiros 14 dias do número no sistema, nada de resgate
     de carrinho nem pesquisa, e teto de mensagens ativas menor.

Mensagens TRANSACIONAIS (status e confirmação do pedido que o próprio cliente
fez) não passam pelo porteiro — o cliente espera por elas — mas respeitam o ritmo.
"""
from __future__ import annotations

import logging
import random
import re
import time
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Any

log = logging.getLogger(__name__)

AQUECIMENTO_DIAS = 14
JANELA_ATIVA = timedelta(hours=24)
# Teto de mensagens ATIVAS por número por hora (normal × aquecimento).
TETO_ATIVAS_HORA = 30
TETO_ATIVAS_HORA_AQUECIMENTO = 10
# Tipos de mensagem ativa bloqueados durante o aquecimento.
BLOQUEADAS_NO_AQUECIMENTO = {"resgate_carrinho", "nps"}

# Espaço entre dois envios do mesmo número (s) e espera máxima, por categoria.
_RITMO: dict[str, tuple[float, float, float]] = {
    # categoria: (gap mínimo, gap máximo, espera máxima)
    "resposta": (0.4, 0.4, 10.0),
    "transacional": (2.0, 4.0, 60.0),
    "ativa": (4.0, 8.0, 120.0),
}

MSG_DESCADASTRO = (
    "Pronto, não te mando mais mensagens automáticas 👍 "
    "Quando quiser pedir, é só chamar aqui que eu te atendo!"
)

# Pedido explícito para parar. Frases, não palavras soltas: "pare" sozinho
# também é "pare a pizza" e "cancela" é sobre o pedido.
_PARAR_RE = re.compile(
    r"\b("
    r"(pare|para|parem|parar) de (me )?(mandar|enviar|mandarem)"
    r"|nao (quero|desejo) (mais )?receber"
    r"|nao me (mande|mandem|envie|enviem) mais"
    r"|(me )?(tira|tire|remove|remova|exclui|exclua) (meu numero|da lista|dessa lista|desta lista)"
    r"|descadastr\w*|sair da lista|stop"
    r")\b"
)


def _normalizar(texto: str) -> str:
    s = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def eh_pedido_para_parar(texto: str | None) -> bool:
    return bool(_PARAR_RE.search(_normalizar(texto or "")))


def em_aquecimento(pizz: Any, agora: datetime | None = None) -> bool:
    desde = getattr(pizz, "whatsapp_conectado_desde", None)
    if desde is None:
        # Nunca conectou pelo fluxo novo: conservador — trata como número novo.
        return True
    if not isinstance(desde, datetime):
        return False
    return (agora or datetime.now(UTC)) - desde < timedelta(days=AQUECIMENTO_DIAS)


async def marcar_nao_perturbe(db: Any, pizzaria_id: Any, telefone: str) -> bool:
    """Marca o cliente como "não perturbe". True se achou o cadastro."""
    from sqlalchemy import select

    from app.models import Cliente
    from app.services.telefones import mesmo_telefone, preferir_exato
    cli = (await db.execute(
        select(Cliente).where(Cliente.pizzaria_id == pizzaria_id, mesmo_telefone(Cliente.telefone, telefone))
        .order_by(preferir_exato(Cliente.telefone, telefone))
    )).scalars().first()
    if cli is None:
        return False
    if not cli.nao_perturbe:
        cli.nao_perturbe = True
        cli.nao_perturbe_em = datetime.now(UTC)
    return True


async def _ultima_msg_do_cliente(db: Any, pizzaria_id: Any, telefone: str) -> datetime | None:
    from sqlalchemy import func, select

    from app.models import Conversa, Mensagem
    from app.services.telefones import mesmo_telefone
    return (await db.execute(
        select(func.max(Mensagem.created_at)).join(Conversa, Conversa.id == Mensagem.conversa_id).where(
            Conversa.pizzaria_id == pizzaria_id,
            mesmo_telefone(Conversa.cliente_telefone, telefone),
            Mensagem.origem == "cliente",
        )
    )).scalar()


async def _cliente_nao_perturbe(db: Any, pizzaria_id: Any, telefone: str) -> bool:
    from sqlalchemy import select

    from app.models import Cliente
    from app.services.telefones import mesmo_telefone
    return bool((await db.execute(
        select(Cliente.id).where(
            Cliente.pizzaria_id == pizzaria_id, mesmo_telefone(Cliente.telefone, telefone),
            Cliente.nao_perturbe.is_(True),
        ).limit(1)
    )).first())


async def _consumir_cota_ativa(instancia: str, teto: int) -> bool:
    """Conta a mensagem ativa na hora corrente do número. False se estourou."""
    try:
        from app.redis_client import redis
        chave = f"wa:ativas:{instancia}:{int(time.time() // 3600)}"
        n = await redis.incr(chave)
        if n == 1:
            await redis.expire(chave, 3700)
        if n > teto:
            await redis.decr(chave)
            return False
        return True
    except Exception as e:  # noqa: BLE001
        log.debug("Cota de mensagens ativas indisponível (segue): %s", e)
        return True


async def pode_enviar_ativo(db: Any, pizz: Any, telefone: str, *, tipo: str) -> tuple[bool, str]:
    """Porteiro de toda mensagem que o sistema manda por conta própria.
    Devolve (pode, motivo); o motivo vai para o log/resultado da task."""
    agora = datetime.now(UTC)
    aquecendo = em_aquecimento(pizz, agora)
    if aquecendo and tipo in BLOQUEADAS_NO_AQUECIMENTO:
        return False, "numero_em_aquecimento"
    if await _cliente_nao_perturbe(db, pizz.id, telefone):
        return False, "cliente_pediu_para_parar"
    ultima = await _ultima_msg_do_cliente(db, pizz.id, telefone)
    if ultima is None or agora - ultima > JANELA_ATIVA:
        return False, "fora_da_janela_24h"
    teto = TETO_ATIVAS_HORA_AQUECIMENTO if aquecendo else TETO_ATIVAS_HORA
    if not await _consumir_cota_ativa(pizz.instancia or str(pizz.id), teto):
        return False, "teto_por_hora"
    return True, "ok"


# Lua: reserva o próximo horário livre do número e devolve quanto esperar (ms).
_LUA_RESERVAR = """
local agora = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local prox = tonumber(redis.call('GET', KEYS[1]) or '0')
local inicio = math.max(agora, prox)
redis.call('SET', KEYS[1], tostring(inicio + gap), 'PX', 300000)
return inicio - agora
"""


async def aguardar_vez(instancia: str, categoria: str = "resposta") -> float:
    """Espera a vez do número (ritmo por número, compartilhado entre API,
    worker e dispatcher via Redis). Devolve os segundos esperados. Sem Redis,
    não espera (não pode travar o atendimento)."""
    import asyncio

    gap_min, gap_max, espera_max = _RITMO.get(categoria, _RITMO["resposta"])
    gap_ms = int(random.uniform(gap_min, gap_max) * 1000)
    try:
        from app.redis_client import redis
        espera_ms = int(await redis.eval(_LUA_RESERVAR, 1, f"wa:ritmo:{instancia}", int(time.time() * 1000), gap_ms))
    except Exception as e:  # noqa: BLE001
        log.debug("Ritmo de envio indisponível (segue sem esperar): %s", e)
        return 0.0
    espera = min(max(espera_ms, 0) / 1000.0, espera_max)
    if espera > 0:
        await asyncio.sleep(espera)
    return espera
