"""Cliente HTTP da Evolution API (envio de mensagens WhatsApp)."""
import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()


class EvolutionError(Exception):
    pass


class EvolutionClient:
    """
    Wrapper minimalista da Evolution API v2.

    Cada pizzaria tem sua própria `instancia` (string). Os endpoints da
    Evolution embutem essa instância na URL.
    """

    def __init__(self) -> None:
        self.base_url = _settings.evolution_base_url.rstrip("/")
        self.api_key = _settings.evolution_api_key
        self._client: httpx.AsyncClient | None = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={"apikey": self.api_key, "Content-Type": "application/json"},
                timeout=httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0),
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # =========================
    # Operações públicas
    # =========================
    async def send_text(
        self,
        *,
        instancia: str,
        numero: str,
        texto: str,
        delay_ms: int | None = None,
    ) -> dict[str, Any]:
        """Envia mensagem de texto para o cliente."""
        body: dict[str, Any] = {"number": numero, "text": texto}
        if delay_ms:
            body["delay"] = delay_ms

        c = await self._http()
        r = await c.post(f"/message/sendText/{instancia}", json=body)
        return self._unwrap(r)

    async def send_reaction(
        self,
        *,
        instancia: str,
        numero: str,
        message_id: str,
        emoji: str = "❤️",
    ) -> dict[str, Any]:
        """Reage a uma mensagem específica do cliente."""
        body = {
            "key": {"remoteJid": numero, "fromMe": False, "id": message_id},
            "reaction": emoji,
        }
        c = await self._http()
        r = await c.post(f"/message/sendReaction/{instancia}", json=body)
        return self._unwrap(r)

    async def mark_as_read(
        self,
        *,
        instancia: str,
        numero: str,
        message_id: str,
    ) -> dict[str, Any]:
        """Marca a mensagem como lida (✓✓ azul)."""
        body = {
            "readMessages": [
                {"remoteJid": numero, "fromMe": False, "id": message_id}
            ]
        }
        c = await self._http()
        r = await c.post(f"/chat/markMessageAsRead/{instancia}", json=body)
        return self._unwrap(r)

    @staticmethod
    def _unwrap(r: httpx.Response) -> dict[str, Any]:
        if r.is_error:
            log.error("Evolution error %s: %s", r.status_code, r.text[:500])
            raise EvolutionError(f"HTTP {r.status_code}: {r.text[:200]}")
        try:
            return r.json()
        except Exception:
            return {"raw": r.text}


# Singleton da app
evolution = EvolutionClient()
