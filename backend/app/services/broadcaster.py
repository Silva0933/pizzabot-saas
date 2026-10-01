"""
Broadcaster de eventos pro painel via WebSocket.

Arquitetura:
- Quando algo acontece (msg chega, pedido muda, etc.), o backend publica
  em um canal Redis `ws:pizzaria:{id}`.
- Cada worker FastAPI (uvicorn) mantém um set de WebSockets conectados
  e roda uma task que escuta o pub/sub e reencaminha.
- Assim escala horizontalmente: 5 réplicas FastAPI, cada uma com seus WS,
  e o Redis garante que todos recebem.
"""
import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.redis_client import redis

log = logging.getLogger(__name__)


def _channel(pizzaria_id: uuid.UUID) -> str:
    return f"ws:pizzaria:{pizzaria_id}"


PAPEL_EQUIPE = "equipe"
PAPEL_ENTREGADOR = "entregador"

# O app do entregador usa o evento só como aviso para recarregar as listas pela
# API (que já filtra: pedidos dele + livres, se a loja permite pegar). Antes ele
# recebia o mesmo evento do painel — mensagem.nova com telefone e texto de TODAS
# as conversas, chamados, alertas — e não exibir na tela não impedia o celular de
# receber. Agora só passam estes tipos, e sem payload.
EVENTOS_ENTREGADOR = frozenset({"pedido.novo", "pedido.atualizado", "entregador.atribuicao", "pedidos.limpos"})


def projetar_para_entregador(data: str) -> str | None:
    """Versão do evento que pode ir ao entregador (só tipo), ou None."""
    try:
        evento = json.loads(data)
    except (TypeError, ValueError):
        return None
    if not isinstance(evento, dict) or evento.get("tipo") not in EVENTOS_ENTREGADOR:
        return None
    return json.dumps({"tipo": evento["tipo"], "pizzaria_id": evento.get("pizzaria_id"), "payload": {}})


class Broadcaster:
    """Mantém conexões WS por pizzaria neste worker e bombeia eventos."""

    def __init__(self) -> None:
        # pizzaria → {conexão: papel}
        self._connections: dict[uuid.UUID, dict[WebSocket, str]] = defaultdict(dict)
        self._lock = asyncio.Lock()
        self._listener_task: asyncio.Task | None = None
        self._pubsub = None

    # ----- conexões locais -----
    async def connect(self, pizzaria_id: uuid.UUID, ws: WebSocket, papel: str = PAPEL_EQUIPE) -> None:
        async with self._lock:
            self._connections[pizzaria_id][ws] = papel
        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._listen_loop())

    async def disconnect(self, pizzaria_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._connections.get(pizzaria_id)
            if conns is None:
                return
            conns.pop(ws, None)
            if not conns:
                del self._connections[pizzaria_id]

    async def _entregar(self, pid: uuid.UUID, data: str) -> None:
        """Manda o evento a cada conexão da pizzaria, no formato do papel dela."""
        async with self._lock:
            conns = list((self._connections.get(pid) or {}).items())
        if not conns:
            return
        projetado: str | None = None
        if any(papel == PAPEL_ENTREGADOR for _ws, papel in conns):
            projetado = projetar_para_entregador(data)
        alvos = []
        for ws, papel in conns:
            texto = data if papel != PAPEL_ENTREGADOR else projetado
            if texto is not None:
                alvos.append((ws, texto))
        # Envia em paralelo, ignorando conexões mortas
        results = await asyncio.gather(
            *[ws.send_text(texto) for ws, texto in alvos],
            return_exceptions=True,
        )
        for (ws, _texto), r in zip(alvos, results, strict=False):
            if isinstance(r, Exception):
                await self.disconnect(pid, ws)

    # ----- publicação (qualquer rota/worker pode chamar) -----
    @staticmethod
    async def publish(pizzaria_id: uuid.UUID, evento: dict[str, Any]) -> None:
        await redis.publish(_channel(pizzaria_id), json.dumps(evento, default=str))

    # ----- listener interno -----
    async def _listen_loop(self) -> None:
        """Escuta TODOS os canais ws:pizzaria:* nesta instância."""
        self._pubsub = redis.pubsub()
        await self._pubsub.psubscribe("ws:pizzaria:*")
        log.info("Broadcaster: pub/sub subscribed")
        try:
            async for raw in self._pubsub.listen():
                if raw.get("type") != "pmessage":
                    continue
                channel: str = raw["channel"]
                try:
                    pid = uuid.UUID(channel.rsplit(":", 1)[-1])
                except ValueError:
                    continue
                await self._entregar(pid, raw["data"])
        except asyncio.CancelledError:
            log.info("Broadcaster listener cancelled")
            raise
        except Exception as e:
            log.exception("Broadcaster listener crashed: %s", e)
        finally:
            if self._pubsub:
                await self._pubsub.aclose()


broadcaster = Broadcaster()
