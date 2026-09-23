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


class Broadcaster:
    """Mantém conexões WS por pizzaria neste worker e bombeia eventos."""

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._listener_task: asyncio.Task | None = None
        self._pubsub = None

    # ----- conexões locais -----
    async def connect(self, pizzaria_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self._connections[pizzaria_id].add(ws)
        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._listen_loop())

    async def disconnect(self, pizzaria_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self._connections[pizzaria_id].discard(ws)
            if not self._connections[pizzaria_id]:
                del self._connections[pizzaria_id]

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
                data = raw["data"]
                async with self._lock:
                    conns = list(self._connections.get(pid, set()))
                if not conns:
                    continue
                # Envia em paralelo, ignorando conexões mortas
                results = await asyncio.gather(
                    *[ws.send_text(data) for ws in conns],
                    return_exceptions=True,
                )
                for ws, r in zip(conns, results, strict=False):
                    if isinstance(r, Exception):
                        await self.disconnect(pid, ws)
        except asyncio.CancelledError:
            log.info("Broadcaster listener cancelled")
            raise
        except Exception as e:
            log.exception("Broadcaster listener crashed: %s", e)
        finally:
            if self._pubsub:
                await self._pubsub.aclose()


broadcaster = Broadcaster()
