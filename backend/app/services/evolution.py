"""Cliente HTTP da Evolution API (envio de mensagens WhatsApp)."""
import logging
import time
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()

# A config (URL/apikey) vem do painel admin (tabela app_config) com fallback nas
# variáveis de ambiente. Cacheada por alguns segundos para não bater no banco a
# cada mensagem enviada; o TTL faz o worker/dispatcher pegar uma troca de chave
# sem precisar de restart (o processo da API invalida na hora, via `invalidate`).
_CONFIG_TTL_S = 60.0


class EvolutionError(Exception):
    pass


class EvolutionNaoConfigurada(EvolutionError):
    """Sem URL base ou apikey — a integração ainda não foi configurada."""


def _only_digits(s: str) -> str:
    return "".join(ch for ch in s if ch.isdigit())


class EvolutionClient:
    """
    Wrapper minimalista da Evolution API v2.

    Cada pizzaria tem sua própria `instancia` (string). Os endpoints da
    Evolution embutem essa instância na URL.
    """

    def __init__(self) -> None:
        self.base_url = (_settings.evolution_base_url or "").rstrip("/")
        self.api_key = _settings.evolution_api_key or ""
        self.webhook_token = _settings.evolution_webhook_token or ""
        self._client: httpx.AsyncClient | None = None
        self._cfg_em: float = 0.0

    # =========================
    # Config dinâmica (painel admin → app_config, fallback no .env)
    # =========================
    async def _carregar_config(self) -> None:
        """Relê a config do banco quando o cache expira. Best-effort: se o banco
        estiver indisponível, mantém o que já estava valendo (ou o .env)."""
        if self._cfg_em and (time.monotonic() - self._cfg_em) < _CONFIG_TTL_S:
            return
        base_url, api_key, webhook_token = self.base_url, self.api_key, self.webhook_token
        try:
            from app.db import AsyncSessionLocal
            from app.services.app_config import get_evolution_config

            async with AsyncSessionLocal() as db:
                cfg = await get_evolution_config(db)
            base_url = cfg["base_url"]
            api_key = cfg["api_key"]
            webhook_token = cfg["webhook_token"]
        except Exception as e:  # noqa: BLE001
            log.debug("Config da Evolution não lida do banco (usando atual): %s", e)

        # URL ou chave mudou → derruba o client HTTP para recriar com o novo destino.
        if base_url != self.base_url or api_key != self.api_key:
            await self.close()
        self.base_url, self.api_key, self.webhook_token = base_url, api_key, webhook_token
        self._cfg_em = time.monotonic()

    def invalidate(self) -> None:
        """Força a releitura da config na próxima chamada (após salvar no painel)."""
        self._cfg_em = 0.0

    async def config_atual(self) -> dict[str, str]:
        await self._carregar_config()
        return {
            "base_url": self.base_url,
            "api_key": self.api_key,
            "webhook_token": self.webhook_token,
        }

    async def _http(self) -> httpx.AsyncClient:
        await self._carregar_config()
        if not self.base_url or not self.api_key:
            raise EvolutionNaoConfigurada(
                "Evolution API não configurada. Defina a URL e a chave em "
                "Administração → IA e integrações → Evolution API."
            )
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
    # Saúde da integração (usada pelo painel admin e pelo monitor do Beat)
    # =========================
    async def health(self) -> dict[str, Any]:
        """
        Pinga a Evolution validando URL **e** apikey global. Nunca lança:
        devolve {ok, erro, instancias, versao, base_url}.

        `/instance/fetchInstances` exige a apikey global — é o teste que pega
        tanto "servidor fora do ar" quanto "chave errada".
        """
        try:
            c = await self._http()
        except EvolutionNaoConfigurada as e:
            return {"ok": False, "erro": str(e), "motivo": "nao_configurada",
                    "base_url": self.base_url, "instancias": None}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "erro": str(e)[:300], "motivo": "erro",
                    "base_url": self.base_url, "instancias": None}

        try:
            r = await c.get("/instance/fetchInstances")
        except httpx.HTTPError as e:
            return {"ok": False, "motivo": "inacessivel", "base_url": self.base_url,
                    "instancias": None,
                    "erro": f"Não foi possível alcançar {self.base_url}: {type(e).__name__}: {e}"[:300]}

        if r.status_code in (401, 403):
            return {"ok": False, "motivo": "chave_invalida", "base_url": self.base_url,
                    "instancias": None,
                    "erro": f"A Evolution recusou a apikey (HTTP {r.status_code})."}
        if r.is_error:
            return {"ok": False, "motivo": "erro", "base_url": self.base_url,
                    "instancias": None,
                    "erro": f"HTTP {r.status_code}: {r.text[:200]}"}

        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            data = []
        itens = data if isinstance(data, list) else (data.get("instances") or [])
        return {"ok": True, "erro": None, "motivo": None, "base_url": self.base_url,
                "instancias": len(itens) if isinstance(itens, list) else None,
                "versao": await self._versao(c)}

    async def _versao(self, c: httpx.AsyncClient) -> str | None:
        """Versão da Evolution (GET /) — informativo, nunca lança."""
        try:
            r = await c.get("/")
            data = r.json() if not r.is_error else {}
            if not isinstance(data, dict):
                return None
            return data.get("version") or (data.get("data") or {}).get("version")
        except Exception:  # noqa: BLE001
            return None

    async def list_instances(self) -> list[dict[str, Any]]:
        """Instâncias existentes na Evolution (nome + estado da conexão)."""
        c = await self._http()
        r = await c.get("/instance/fetchInstances")
        data = self._unwrap(r)
        itens = data if isinstance(data, list) else (data.get("instances") or [])
        out: list[dict[str, Any]] = []
        for it in itens if isinstance(itens, list) else []:
            if not isinstance(it, dict):
                continue
            inst = it.get("instance") if isinstance(it.get("instance"), dict) else it
            out.append({
                "nome": inst.get("instanceName") or inst.get("name"),
                "estado": inst.get("connectionStatus") or inst.get("state") or inst.get("status"),
                "numero": inst.get("owner") or inst.get("number"),
            })
        return out

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

    def _webhook_payload(self, url: str) -> dict[str, Any]:
        # Anexa o token de segurança na URL (?token=...). A Evolution devolve a
        # URL exata configurada, então o backend valida esse token no webhook.
        token = self.webhook_token
        if token and "token=" not in url:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}token={token}"
        return {
            "enabled": True,
            "url": url,
            "webhookByEvents": False,
            "webhookBase64": False,
            # PRESENCE_UPDATE = eventos de "digitando/gravando" do cliente,
            # usados pra esticar o debounce enquanto ele ainda está escrevendo.
            # CONNECTION_UPDATE = estado da conexão da instância (open/close),
            # usado pelo monitor de WhatsApp (alerta quando desconecta).
            "events": ["MESSAGES_UPSERT", "PRESENCE_UPDATE", "CONNECTION_UPDATE"],
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

    async def send_media(
        self,
        *,
        instancia: str,
        numero: str,
        media_url: str,
        mediatype: str = "document",
        mimetype: str | None = None,
        filename: str | None = None,
        caption: str | None = None,
    ) -> dict[str, Any]:
        """Envia um arquivo (documento/imagem) por URL para o cliente."""
        body: dict[str, Any] = {
            "number": numero,
            "mediatype": mediatype,   # 'image' | 'document' | 'video' | 'audio'
            "media": media_url,
        }
        if mimetype:
            body["mimetype"] = mimetype
        if filename:
            body["fileName"] = filename
        if caption:
            body["caption"] = caption
        c = await self._http()
        r = await c.post(f"/message/sendMedia/{instancia}", json=body)
        return self._unwrap(r)

    async def get_media_base64(self, *, instancia: str, message: dict[str, Any]) -> str | None:
        """Baixa o conteúdo (base64) de uma mensagem de mídia (áudio/imagem)."""
        c = await self._http()
        r = await c.post(
            f"/chat/getBase64FromMediaMessage/{instancia}",
            json={"message": message, "convertToMp4": False},
        )
        if r.is_error:
            log.warning("getBase64 erro %s: %s", r.status_code, r.text[:200])
            return None
        try:
            data = r.json()
        except Exception:
            return None
        return data.get("base64") or data.get("media") or None

    async def send_presence(
        self,
        *,
        instancia: str,
        numero: str,
        tipo: str = "composing",
        delay_ms: int | None = None,
    ) -> dict[str, Any]:
        """
        Envia indicador de presença (digitando/gravando).

        tipo: 'composing' (digitando) ou 'recording' (gravando áudio).
        """
        body = {
            # Mesmo formato do send_text (número puro) — com sufixo a presença
            # às vezes não chega ao destinatário em algumas versões da Evolution.
            "number": numero,
            "presence": tipo,  # "composing" ou "recording"
            "delay": delay_ms if delay_ms is not None else 8000,
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
