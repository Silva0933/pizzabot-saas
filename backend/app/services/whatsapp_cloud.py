"""
API oficial do WhatsApp (Cloud API da Meta), ligada DIRETO no PizzaBot.

É uma opção de conexão separada da Evolution (QR Code). A Evolution v2.3.7 até
fala com a Cloud API (integração WHATSAPP-BUSINESS), mas guarda o número do
cliente numa variável da instância ANTES de processar a mensagem: com dois
clientes escrevendo juntos (ou um aviso de "entregue/lido" chegando no meio),
a mensagem de um era atribuída ao outro. Ela também não confere a assinatura da
Meta no webhook. Por isso aqui:

  - entrada: a Meta chama /webhook/whatsapp-cloud/{pizzaria_id}; a assinatura
    (X-Hub-Signature-256, com o App Secret) é conferida e cada mensagem vira o
    mesmo formato que a Evolution entrega — o resto do atendimento não muda;
  - saída: o cliente da Evolution (services/evolution.py) reconhece a instância
    da API oficial pelo prefixo e manda pela Graph API.

Janela de 24 h: fora dela a Meta só aceita mensagem de MODELO aprovado. A Meta
não recusa na hora — aceita e avisa a falha depois, no webhook —, então a janela
é conferida ANTES de enviar. Fora dela, usa o modelo de atualização da loja (se
configurado) ou falha com ForaDaJanela, e quem chamou trata como envio que não
saiu (ex.: a confirmação do cardápio avisa a loja).

Nunca loga nem devolve o token ou o App Secret.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.services.evolution import EvolutionError

log = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v20.0"
JANELA_ATENDIMENTO = timedelta(hours=24)
# Instância da API oficial: o nome identifica o transporte sem ir ao banco
# (toda mensagem enviada passa por aqui; instância de QR Code nunca consulta).
PREFIXO_INSTANCIA = "cloudapi-"
# Modelo de atualização: até 2 variáveis — {{1}} = texto, ou {{1}} = nome e {{2}} = texto.
MAX_PARAMETROS_MODELO = 2


class CloudApiErro(EvolutionError):
    """Erro com mensagem pronta para o dono da pizzaria. Herda de EvolutionError
    porque quem envia já trata essa família como "não saiu"."""


class ForaDaJanela(CloudApiErro):
    """Mais de 24 h desde a última mensagem do cliente e a loja não tem modelo."""


# --------------------------------------------------------------------------- #
# Graph API
# --------------------------------------------------------------------------- #
_ERROS_ENTREGA = {
    131047: "passaram 24 h desde a última mensagem do cliente; fora disso só sai modelo aprovado",
    131026: "o número não recebe mensagens (sem WhatsApp ou versão antiga)",
    131049: "a Meta segurou a mensagem para não saturar o cliente",
    131050: "o cliente parou de receber mensagens de marketing da loja",
    131051: "tipo de mensagem não suportado",
    131053: "falha ao enviar a mídia",
    130472: "o número do cliente está num experimento da Meta",
    131042: "problema de pagamento na conta do WhatsApp Business",
    131031: "a conta do WhatsApp Business está bloqueada",
    132001: "o modelo não existe ou não está aprovado nesse idioma",
    132000: "o número de variáveis não bate com o modelo",
    132018: "o texto da variável tem caractere que o modelo não aceita",
}


def _mensagem_erro(r: httpx.Response) -> str:
    try:
        err = (r.json() or {}).get("error") or {}
    except Exception:  # noqa: BLE001
        err = {}
    code, sub = err.get("code"), err.get("error_subcode")
    if r.status_code == 401 or code == 190:
        return "O token de acesso foi recusado pela Meta (inválido ou expirado). Gere um token permanente."
    if code in _ERROS_ENTREGA:
        return f"A Meta recusou: {_ERROS_ENTREGA[code]} ({code})."
    if code == 100 or r.status_code == 404:
        return "A Meta não encontrou esse ID. Confira o ID do número de telefone e o ID da conta do WhatsApp Business."
    if code in (10, 200) or r.status_code == 403:
        return ("O token não tem permissão para esta conta. Ele precisa das permissões "
                "whatsapp_business_messaging e whatsapp_business_management.")
    detalhe = err.get("message") or r.text[:160]
    return f"A Meta recusou a operação ({r.status_code}{f'/{sub}' if sub else ''}): {detalhe}"


async def _chamar(metodo: str, path: str, token: str, **kw: Any) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.request(metodo, f"{GRAPH}/{path}", headers={"Authorization": f"Bearer {token}"}, **kw)
    except httpx.HTTPError as e:
        raise CloudApiErro(f"Não foi possível falar com a Meta ({type(e).__name__}). Tente de novo.") from e
    if r.is_error:
        raise CloudApiErro(_mensagem_erro(r))
    try:
        return r.json() or {}
    except Exception:  # noqa: BLE001
        return {}


# --------------------------------------------------------------------------- #
# Configuração (feita uma vez, pelo painel)
# --------------------------------------------------------------------------- #
async def validar_numero(token: str, phone_number_id: str) -> dict[str, Any]:
    """Confere token + ID do número. Devolve número de exibição, nome verificado
    e a qualidade do número na Meta."""
    data = await _chamar("GET", phone_number_id, token,
                         params={"fields": "display_phone_number,verified_name,quality_rating"})
    return {
        "numero_exibicao": data.get("display_phone_number") or "",
        "nome_verificado": data.get("verified_name") or "",
        "qualidade": data.get("quality_rating") or "",
    }


async def inscrever_app(token: str, waba_id: str) -> None:
    """Inscreve o app do token na conta do WhatsApp Business: sem isto a Meta não
    entrega as mensagens dos clientes no webhook, e a atendente fica muda."""
    await _chamar("POST", f"{waba_id}/subscribed_apps", token)


async def modelos_aprovados(token: str, waba_id: str) -> list[dict[str, Any]]:
    """Modelos APROVADOS da conta: nome, idioma, texto e quantas variáveis o corpo usa."""
    data = await _chamar("GET", f"{waba_id}/message_templates", token,
                         params={"fields": "name,language,status,components", "limit": 200})
    out = []
    for t in data.get("data") or []:
        if str(t.get("status") or "").upper() != "APPROVED":
            continue
        comps = t.get("components") or []
        corpo = next((c for c in comps if str(c.get("type")).upper() == "BODY"), {})
        texto = corpo.get("text") or ""
        # Cabeçalho com mídia/variável pediria parâmetros que o PizzaBot não tem.
        cab = next((c for c in comps if str(c.get("type")).upper() == "HEADER"), None)
        cab_ok = cab is None or (str(cab.get("format")).upper() == "TEXT" and "{{" not in (cab.get("text") or ""))
        out.append({
            "nome": t.get("name"), "idioma": t.get("language"), "texto": texto,
            "parametros": len(set(re.findall(r"\{\{\s*(\w+)\s*\}\}", texto))),
            "compativel": cab_ok,
        })
    return out


def eh_cloud(pizz: Any) -> bool:
    return (getattr(pizz, "whatsapp_tipo", None) or "qrcode") == "cloud_api"


def eh_instancia_cloud(instancia: str | None) -> bool:
    return bool(instancia) and str(instancia).startswith(PREFIXO_INSTANCIA)


def config_publica(pizz: Any) -> dict[str, Any]:
    """O que pode ir para o painel (sem token nem App Secret)."""
    c = dict(getattr(pizz, "whatsapp_cloud", None) or {})
    return {
        "ativa": eh_cloud(pizz),
        "phone_number_id": c.get("phone_number_id") or "",
        "waba_id": c.get("waba_id") or "",
        "token_configurado": bool(c.get("token")),
        "app_secret_configurado": bool(c.get("app_secret")),
        "verify_token": c.get("verify_token") or "",
        "webhook_verificado_em": c.get("webhook_verificado_em"),
        "numero_exibicao": c.get("numero_exibicao") or "",
        "nome_verificado": c.get("nome_verificado") or "",
        "qualidade": c.get("qualidade") or "",
        "modelo_nome": c.get("modelo_nome") or "",
        "modelo_idioma": c.get("modelo_idioma") or "",
        "modelo_parametros": int(c.get("modelo_parametros") or 0),
        "modelo_texto": c.get("modelo_texto") or "",
    }


# --------------------------------------------------------------------------- #
# Credenciais por instância (envio)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Credencial:
    pizzaria_id: uuid.UUID
    phone_number_id: str
    token: str
    modelo_nome: str = ""
    modelo_idioma: str = "pt_BR"
    modelo_parametros: int = 0


_CACHE_TTL_S = 30.0
_cache: dict[str, tuple[float, Credencial | None]] = {}


def invalidar(instancia: str | None = None) -> None:
    """Chamado ao salvar a configuração (este processo relê na hora; os outros
    em até 30 s)."""
    if instancia:
        _cache.pop(instancia, None)
    else:
        _cache.clear()


def credencial_de(pizzaria_id: Any, cfg: dict[str, Any]) -> Credencial | None:
    from app.services.secrets import decrypt_secret
    token = decrypt_secret(cfg.get("token"))
    if not token or not cfg.get("phone_number_id"):
        return None
    return Credencial(
        pizzaria_id=pizzaria_id,
        phone_number_id=str(cfg["phone_number_id"]),
        token=token,
        modelo_nome=cfg.get("modelo_nome") or "",
        modelo_idioma=cfg.get("modelo_idioma") or "pt_BR",
        modelo_parametros=int(cfg.get("modelo_parametros") or 0),
    )


async def credencial(instancia: str) -> Credencial:
    """Credencial da instância da API oficial. Lança CloudApiErro se a pizzaria
    não está (mais) na API oficial ou ficou sem token — mandar pela Evolution
    uma instância que lá não existe só esconderia o problema."""
    agora = time.monotonic()
    hit = _cache.get(instancia)
    if hit and agora - hit[0] < _CACHE_TTL_S:
        cred = hit[1]
    else:
        from sqlalchemy import select

        from app.db import AsyncSessionLocal
        from app.models import Pizzaria
        async with AsyncSessionLocal() as db:
            row = (await db.execute(
                select(Pizzaria.id, Pizzaria.whatsapp_tipo, Pizzaria.whatsapp_cloud)
                .where(Pizzaria.instancia == instancia)
            )).first()
        cred = None
        if row and row[1] == "cloud_api":
            cred = credencial_de(row[0], row[2] or {})
        _cache[instancia] = (agora, cred)
    if cred is None:
        raise CloudApiErro("API oficial sem credenciais válidas para esta loja. Reconfigure em Meu Negócio → WhatsApp.")
    return cred


# --------------------------------------------------------------------------- #
# Envio
# --------------------------------------------------------------------------- #
def _digitos(numero: str) -> str:
    return re.sub(r"\D", "", (numero or "").split("@", 1)[0])


def _como_evolution(resp: dict[str, Any], numero: str) -> dict[str, Any]:
    """Resposta da Graph no formato que o resto do código lê da Evolution
    (humanized_delivery pega o id em key.id)."""
    msgs = resp.get("messages") or [{}]
    return {"key": {"id": msgs[0].get("id"), "fromMe": True, "remoteJid": f"{_digitos(numero)}@s.whatsapp.net"},
            "status": "PENDING", "api_oficial": True}


async def _post_mensagem(cred: Credencial, numero: str, corpo: dict[str, Any]) -> dict[str, Any]:
    body = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": _digitos(numero), **corpo}
    resp = await _chamar("POST", f"{cred.phone_number_id}/messages", cred.token, json=body)
    return _como_evolution(resp, numero)


async def _janela_aberta(pizzaria_id: Any, numero: str) -> bool:
    from app.db import AsyncSessionLocal
    from app.services.protecao_whatsapp import _ultima_msg_do_cliente
    async with AsyncSessionLocal() as db:
        ultima = await _ultima_msg_do_cliente(db, pizzaria_id, _digitos(numero))
    return ultima is not None and datetime.now(UTC) - ultima <= JANELA_ATENDIMENTO


def _texto_de_variavel(texto: str, limite: int = 900) -> str:
    """A Meta recusa variável com quebra de linha, tab ou mais de 4 espaços (132018)."""
    linhas = [re.sub(r"\s+", " ", ln).strip() for ln in (texto or "").splitlines()]
    plano = " · ".join(ln for ln in linhas if ln)
    return plano if len(plano) <= limite else plano[: limite - 1].rstrip() + "…"


async def _nome_do_cliente(pizzaria_id: Any, numero: str) -> str:
    try:
        from sqlalchemy import select

        from app.db import AsyncSessionLocal
        from app.models import Cliente
        from app.services.telefones import mesmo_telefone, preferir_exato
        async with AsyncSessionLocal() as db:
            nome = (await db.execute(
                select(Cliente.nome).where(Cliente.pizzaria_id == pizzaria_id,
                                           mesmo_telefone(Cliente.telefone, _digitos(numero)))
                .order_by(preferir_exato(Cliente.telefone, _digitos(numero)))
            )).scalars().first()
    except Exception:  # noqa: BLE001
        nome = None
    primeiro = (nome or "").strip().split(" ")[0]
    return primeiro or "cliente"


async def enviar_modelo(cred: Credencial, numero: str, nome: str, idioma: str,
                        parametros: list[str] | None = None) -> dict[str, Any]:
    template: dict[str, Any] = {"name": nome, "language": {"code": idioma or "pt_BR"}}
    if parametros:
        template["components"] = [{
            "type": "body",
            "parameters": [{"type": "text", "text": _texto_de_variavel(p)} for p in parametros],
        }]
    return await _post_mensagem(cred, numero, {"type": "template", "template": template})


async def _enviar_por_modelo(cred: Credencial, numero: str, texto: str) -> dict[str, Any]:
    if not cred.modelo_nome:
        raise ForaDaJanela(
            "Fora da janela de 24 h da API oficial e a loja não tem modelo de atualização aprovado: "
            "a mensagem não foi enviada."
        )
    params: list[str] = []
    if cred.modelo_parametros == 1:
        params = [texto]
    elif cred.modelo_parametros >= 2:
        params = [await _nome_do_cliente(cred.pizzaria_id, numero), texto]
    log.info("API oficial: fora da janela de 24 h, enviando pelo modelo %s", cred.modelo_nome)
    return await enviar_modelo(cred, numero, cred.modelo_nome, cred.modelo_idioma, params)


async def enviar_texto(cred: Credencial, numero: str, texto: str) -> dict[str, Any]:
    if not await _janela_aberta(cred.pizzaria_id, numero):
        return await _enviar_por_modelo(cred, numero, texto)
    return await _post_mensagem(cred, numero, {"type": "text", "text": {"body": texto, "preview_url": False}})


async def enviar_midia(cred: Credencial, numero: str, *, media_url: str, mediatype: str = "document",
                       filename: str | None = None, caption: str | None = None) -> dict[str, Any]:
    if not await _janela_aberta(cred.pizzaria_id, numero):
        raise ForaDaJanela("Fora da janela de 24 h da API oficial: arquivo não enviado.")
    tipo = mediatype if mediatype in ("image", "document", "video", "audio") else "document"
    midia: dict[str, Any] = {"link": media_url}
    if caption and tipo != "audio":
        midia["caption"] = caption
    if filename and tipo == "document":
        midia["filename"] = filename
    return await _post_mensagem(cred, numero, {"type": tipo, tipo: midia})


async def enviar_reacao(cred: Credencial, numero: str, message_id: str, emoji: str) -> dict[str, Any]:
    return await _post_mensagem(cred, numero, {"type": "reaction",
                                               "reaction": {"message_id": message_id, "emoji": emoji}})


def _chave_ultima(pizzaria_id: Any, numero: str) -> str:
    return f"wa:cloud:ultima:{pizzaria_id}:{_digitos(numero)}"


async def guardar_ultima_recebida(pizzaria_id: Any, numero: str, message_id: str) -> None:
    """O "digitando…" da API oficial é preso a uma mensagem recebida (e marca
    ela como lida). Guarda a última de cada cliente para o send_presence."""
    try:
        from app.redis_client import redis
        await redis.set(_chave_ultima(pizzaria_id, numero), message_id, ex=int(JANELA_ATENDIMENTO.total_seconds()))
    except Exception as e:  # noqa: BLE001
        log.debug("Não guardou a última mensagem recebida (digitando fica sem): %s", e)


async def digitando(cred: Credencial, numero: str) -> dict[str, Any]:
    """Marca como lida e mostra "digitando…" (some ao responder ou em 25 s).
    Best-effort, como a presença da Evolution."""
    try:
        from app.redis_client import redis
        from app.services.telefones import telefones_equivalentes
        message_id = None
        for n in [_digitos(numero), *sorted(telefones_equivalentes(_digitos(numero)))]:
            message_id = await redis.get(_chave_ultima(cred.pizzaria_id, n))
            if message_id:
                break
        if not message_id:
            return {"ok": False}
        if isinstance(message_id, bytes):
            message_id = message_id.decode()
        await _chamar("POST", f"{cred.phone_number_id}/messages", cred.token, json={
            "messaging_product": "whatsapp", "status": "read", "message_id": message_id,
            "typing_indicator": {"type": "text"},
        })
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        log.debug("Digitando (API oficial) não enviado (não-fatal): %s", e)
        return {"ok": False}


async def baixar_midia(cred: Credencial, media_id: str) -> str | None:
    """Mídia recebida (ex.: áudio para transcrever) em base64."""
    try:
        info = await _chamar("GET", media_id, cred.token)
        url = info.get("url")
        if not url:
            return None
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(url, headers={"Authorization": f"Bearer {cred.token}"})
        if r.is_error:
            log.warning("Download de mídia da Meta falhou: HTTP %s", r.status_code)
            return None
        return base64.b64encode(r.content).decode()
    except Exception as e:  # noqa: BLE001
        log.warning("Download de mídia da Meta falhou: %s", e)
        return None


async def estado(cred: Credencial) -> str:
    """'open' se a Meta aceita o token para o número; 'close' se recusou (token
    revogado/expirado). Erro de rede LANÇA — o monitor não marca desconectado
    por falha momentânea."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(f"{GRAPH}/{cred.phone_number_id}", params={"fields": "id"},
                            headers={"Authorization": f"Bearer {cred.token}"})
    except httpx.HTTPError as e:
        raise CloudApiErro(f"Meta inacessível ({type(e).__name__})") from e
    if r.is_error:
        if r.status_code >= 500:
            raise CloudApiErro(f"Meta respondeu {r.status_code}")
        return "close"
    return "open"


# --------------------------------------------------------------------------- #
# Entrada (webhook da Meta)
# --------------------------------------------------------------------------- #
def assinatura_confere(app_secret: str | None, corpo: bytes, cabecalho: str | None) -> bool:
    """X-Hub-Signature-256 = sha256=HMAC(App Secret, corpo cru). Sem isto qualquer
    um que soubesse a URL postaria "mensagens de cliente" que a atendente responderia."""
    if not app_secret or not cabecalho or not cabecalho.startswith("sha256="):
        return False
    esperado = hmac.new(app_secret.encode("utf-8"), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, cabecalho[len("sha256="):].strip())


def _mime(m: dict[str, Any]) -> str:
    # "audio/ogg; codecs=opus" → "audio/ogg" (a transcrição escolhe o formato pelo tipo base)
    return str(m.get("mime_type") or "").split(";", 1)[0].strip()


# Tipos que não são conversa do cliente: não viram mensagem.
_IGNORAR = {"reaction", "system", "ephemeral", "request_welcome", "errors"}


def mensagem_para_evolution(m: dict[str, Any], contatos: dict[str, str]) -> dict[str, Any] | None:
    """Mensagem da Meta → o `data` do messages.upsert da Evolution (o que
    routes/webhook.processar_mensagem já sabe tratar)."""
    tipo = m.get("type")
    wa_id = str(m.get("from") or "")
    if not wa_id or not m.get("id") or tipo in _IGNORAR:
        return None
    conteudo: dict[str, Any]
    if tipo == "text":
        conteudo = {"conversation": (m.get("text") or {}).get("body") or ""}
    elif tipo == "interactive":
        inter = m.get("interactive") or {}
        resp = inter.get(inter.get("type")) or {}
        conteudo = {"conversation": resp.get("title") or resp.get("id") or ""}
    elif tipo == "button":
        b = m.get("button") or {}
        conteudo = {"conversation": b.get("text") or b.get("payload") or ""}
    elif tipo == "audio":
        a = m.get("audio") or {}
        conteudo = {"audioMessage": {"id": a.get("id"), "mimetype": _mime(a) or "audio/ogg", "ptt": bool(a.get("voice"))}}
    elif tipo == "image":
        i = m.get("image") or {}
        conteudo = {"imageMessage": {"id": i.get("id"), "mimetype": _mime(i), "caption": i.get("caption")}}
    elif tipo == "sticker":
        s = m.get("sticker") or {}
        conteudo = {"stickerMessage": {"id": s.get("id"), "mimetype": _mime(s)}}
    elif tipo == "location":
        loc = m.get("location") or {}
        conteudo = {"locationMessage": {
            "degreesLatitude": loc.get("latitude"), "degreesLongitude": loc.get("longitude"),
            "name": loc.get("name"), "address": loc.get("address"),
        }}
    else:
        # documento, vídeo, contato, enquete...: o mesmo "[mensagem não suportada]" do QR Code.
        conteudo = {"naoSuportada": {"tipo": tipo}}
    try:
        ts = int(m.get("timestamp") or 0)
    except (TypeError, ValueError):
        ts = 0
    return {
        "key": {"remoteJid": f"{wa_id}@s.whatsapp.net", "fromMe": False, "id": m["id"]},
        "pushName": contatos.get(wa_id),
        "message": conteudo,
        "messageTimestamp": ts or int(time.time()),
        "api_oficial": True,
    }


def motivo_falha(status: dict[str, Any]) -> str:
    erros = status.get("errors") or [{}]
    code = erros[0].get("code")
    if code in _ERROS_ENTREGA:
        return f"{_ERROS_ENTREGA[code]} ({code})"
    titulo = erros[0].get("title") or erros[0].get("message") or "motivo não informado"
    return f"{titulo} ({code})" if code else titulo
