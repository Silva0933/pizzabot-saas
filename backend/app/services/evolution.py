"""Cliente HTTP da Evolution API (envio de mensagens WhatsApp)."""
import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()


class EvolutionError(Exception):
    pass


def _only_digits(s: str) -> str:
    return "".join(ch for ch in s if ch.isdigit())


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
    # Gestão de instância (onboarding WhatsApp)
    # =========================
    async def create_instance(
        self,
        *,
        instancia: str,
        webhook_url: str | None = None,
        numero: str | None = None,
    ) -> dict[str, Any]:
        """
        Cria uma instância na Evolution já com o webhook configurado.

        Retorna o payload da Evolution (inclui `qrcode.base64` quando disponível).
        Se a instância já existir, a Evolution responde 403 — tratamos como
        "já existe" e seguimos para conectar/gerar QR.
        """
        body: dict[str, Any] = {
            "instanceName": instancia,
            "integration": "WHATSAPP-BAILEYS",
            "qrcode": True,
        }
        if numero:
            body["number"] = _only_digits(numero)
        if webhook_url:
            body["webhook"] = self._webhook_payload(webhook_url)

        c = await self._http()
        r = await c.post("/instance/create", json=body)
        if r.status_code in (401, 403, 409):
            # Já existe (ou conflito de nome): não é erro fatal no onboarding.
            log.info("Instância '%s' já existe na Evolution (%s).", instancia, r.status_code)
            return {"already_exists": True}
        return self._unwrap(r)

    async def connect_instance(self, *, instancia: str) -> dict[str, Any]:
        """Dispara a conexão e retorna o QR Code (campo `base64`)."""
        c = await self._http()
        r = await c.get(f"/instance/connect/{instancia}")
        return self._unwrap(r)

    async def connection_state(self, *, instancia: str) -> str:
        """Retorna o estado: 'open' (conectado), 'connecting' ou 'close'."""
        c = await self._http()
        r = await c.get(f"/instance/connectionState/{instancia}")
        data = self._unwrap(r)
        inst = data.get("instance") or {}
        return inst.get("state") or data.get("state") or "close"

    async def set_webhook(self, *, instancia: str, webhook_url: str) -> dict[str, Any]:
        """(Re)configura o webhook de uma instância existente."""
        c = await self._http()
        r = await c.post(
            f"/webhook/set/{instancia}",
            json={"webhook": self._webhook_payload(webhook_url)},
        )
        return self._unwrap(r)

    async def delete_instance(self, *, instancia: str) -> dict[str, Any]:
        """Remove a instância da Evolution (logout + delete)."""
        c = await self._http()
        try:
            await c.delete(f"/instance/logout/{instancia}")
        except Exception:  # noqa: BLE001
            pass
        r = await c.delete(f"/instance/delete/{instancia}")
        return self._unwrap(r)

    @staticmethod
    def _webhook_payload(url: str) -> dict[str, Any]:
        return {
            "enabled": True,
            "url": url,
            "webhookByEvents": False,
            "webhookBase64": False,
            "events": ["MESSAGES_UPSERT"],
        }

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

    async def send_presence(
        self,
        *,
        instancia: str,
        numero: str,
        tipo: str = "composing",
    ) -> dict[str, Any]:
        """
        Envia indicador de presença (digitando/gravando).

        tipo: 'composing' (digitando) ou 'recording' (gravando áudio).
        """
        body = {
            "number": f"{numero}@s.whatsapp.net",
            "presence": tipo,  # "composing" ou "recording"
            "delay": 8000,
        }
        try:
            c = await self._http()
            r = await c.post(f"/chat/sendPresence/{instancia}", json=body)
            return self._unwrap(r)
        except Exception as e:
            log.debug("Presença não enviada (não-fatal): %s", e)
            return {"ok": False}

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
