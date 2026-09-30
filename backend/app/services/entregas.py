"""
Entregas no app do entregador (Fase 1): código de entrega, coordenadas e rota.

Rota: a navegação fica com o Waze/Google Maps que o entregador já usa; aqui só
se decide a ORDEM das paradas (vizinho mais próximo a partir de onde ele está,
ou da pizzaria) e se monta o link com as paradas. Endereço sem coordenada é
geocodificado uma vez (Nominatim, com a cidade da pizzaria) e fica em cache.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import secrets
from typing import Any
from urllib.parse import quote

log = logging.getLogger(__name__)

GEO_CACHE_TTL_S = 30 * 24 * 3600
# Ponto geocodificado a mais que isso da pizzaria é engano do geocoder
# ("Rua Jerusalém" existe em muitas cidades).
RAIO_MAXIMO_KM = 60.0
# Google Maps aceita até 9 paradas intermediárias no link.
MAX_WAYPOINTS = 9


def gerar_codigo_entrega() -> str:
    return f"{secrets.randbelow(10_000):04d}"


def codigo_confere(esperado: str | None, informado: str | None) -> bool:
    if not esperado:
        return True
    dig = "".join(ch for ch in (informado or "") if ch.isdigit())
    return secrets.compare_digest(dig, esperado)


def distancia_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distância em linha reta (haversine)."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def ordenar_paradas(origem: tuple[float, float] | None, paradas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Vizinho mais próximo a partir da origem. Paradas sem coordenada vão no fim,
    na ordem em que vieram (o Maps resolve pelo endereço)."""
    com = [p for p in paradas if p.get("lat") is not None and p.get("lon") is not None]
    sem = [p for p in paradas if p not in com]
    if origem is None and com:
        origem = (com[0]["lat"], com[0]["lon"])
    ordem: list[dict[str, Any]] = []
    atual = origem
    restantes = list(com)
    while restantes:
        prox = min(restantes, key=lambda p: distancia_km(atual, (p["lat"], p["lon"])))  # type: ignore[arg-type]
        prox["distancia_km"] = round(distancia_km(atual, (prox["lat"], prox["lon"])), 2)  # type: ignore[arg-type]
        ordem.append(prox)
        atual = (prox["lat"], prox["lon"])
        restantes.remove(prox)
    return ordem + sem


def cidade_da_pizzaria(endereco_pizzaria: str | None) -> str:
    """"Av. X, 100 - Centro, São Luís - MA" → "São Luís - MA" (as duas últimas
    partes), usado para o geocoder não achar a rua em outra cidade."""
    partes = [p.strip() for p in (endereco_pizzaria or "").split(",") if p.strip()]
    return ", ".join(partes[-2:]) if len(partes) >= 2 else ""


async def coordenadas(endereco: str | None, *, cidade: str = "",
                      perto_de: tuple[float, float] | None = None) -> tuple[float, float] | None:
    """Coordenada de um endereço, com cache no Redis. None se não achar ou se
    cair longe demais da pizzaria."""
    if not (endereco or "").strip():
        return None
    consulta = f"{endereco.strip()}, {cidade}" if cidade and cidade.lower() not in endereco.lower() else endereco.strip()
    chave = "geo:" + hashlib.sha1(consulta.lower().encode()).hexdigest()
    ponto: tuple[float, float] | None = None
    try:
        from app.redis_client import redis
        cache = await redis.get(chave)
        if cache:
            dado = json.loads(cache)
            ponto = (dado[0], dado[1]) if dado else None
            return _dentro_do_raio(ponto, perto_de)
    except Exception as e:  # noqa: BLE001
        log.debug("Cache de geocodificação indisponível: %s", e)
    from app.services.geocoding import geocode_address
    res = await geocode_address(consulta)
    if res.get("lat") is not None and res.get("lon") is not None:
        ponto = (float(res["lat"]), float(res["lon"]))
    try:
        from app.redis_client import redis
        await redis.set(chave, json.dumps(list(ponto) if ponto else None), ex=GEO_CACHE_TTL_S)
    except Exception:  # noqa: BLE001
        pass
    return _dentro_do_raio(ponto, perto_de)


def _dentro_do_raio(ponto: tuple[float, float] | None, perto_de: tuple[float, float] | None):
    if ponto and perto_de and distancia_km(ponto, perto_de) > RAIO_MAXIMO_KM:
        return None
    return ponto


def _local(p: dict[str, Any]) -> str:
    if p.get("lat") is not None and p.get("lon") is not None:
        return f"{p['lat']},{p['lon']}"
    return p.get("endereco") or ""


def link_google_maps(paradas: list[dict[str, Any]]) -> str | None:
    """Rota com várias paradas a partir da posição atual do celular."""
    pontos = [_local(p) for p in paradas if _local(p)]
    if not pontos:
        return None
    destino, meio = pontos[-1], pontos[:-1][:MAX_WAYPOINTS]
    url = f"https://www.google.com/maps/dir/?api=1&travelmode=driving&destination={quote(destino)}"
    if meio:
        url += "&waypoints=" + quote("|".join(meio))
    return url


def link_waze(parada: dict[str, Any]) -> str | None:
    """O Waze navega para um destino por vez."""
    if parada.get("lat") is not None and parada.get("lon") is not None:
        return f"https://waze.com/ul?ll={parada['lat']},{parada['lon']}&navigate=yes"
    if parada.get("endereco"):
        return f"https://waze.com/ul?q={quote(parada['endereco'])}&navigate=yes"
    return None
