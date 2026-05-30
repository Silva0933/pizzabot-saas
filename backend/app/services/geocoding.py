"""Serviço de geocodificação de endereços utilizando OpenStreetMap Nominatim e fallback de Regex."""
import logging
import re
from typing import Any

import httpx

log = logging.getLogger(__name__)


async def geocode_address(endereco: str) -> dict[str, Any]:
    """
    Geocodifica um endereço usando a API gratuita Nominatim do OpenStreetMap.
    
    Retorna um dicionário contendo:
      - ok: bool
      - bairro: str | None
      - display_name: str | None
      - lat: float | None
      - lon: float | None
      - fonte: str ('nominatim' | 'fallback_regex' | 'nenhuma')
    """
    if not endereco or not endereco.strip():
        return {
            "ok": False,
            "bairro": None,
            "display_name": None,
            "lat": None,
            "lon": None,
            "fonte": "nenhuma",
        }

    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": endereco.strip(),
        "format": "json",
        "addressdetails": 1,
        "limit": 1,
    }
    headers = {
        "User-Agent": "PizzaBot-Geocoding/1.0 (contato: admin@pizzabot.com)"
    }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(url, params=params, headers=headers)
            if r.status_code == 200:
                data = r.json()
                if data:
                    res = data[0]
                    addr = res.get("address") or {}
                    # Bairro pode estar em suburb, neighbourhood, quarter, city_district, hamlet, village
                    bairro = (
                        addr.get("suburb")
                        or addr.get("neighbourhood")
                        or addr.get("quarter")
                        or addr.get("city_district")
                        or addr.get("hamlet")
                        or addr.get("village")
                    )
                    return {
                        "ok": True,
                        "bairro": bairro,
                        "display_name": res.get("display_name"),
                        "lat": float(res["lat"]) if "lat" in res else None,
                        "lon": float(res["lon"]) if "lon" in res else None,
                        "fonte": "nominatim",
                    }
    except Exception as e:
        log.warning("Falha na geocodificação Nominatim: %s", e)

    # Fallback Regex caso a API falhe ou retorne vazia
    bairro_detectado = _extract_bairro_regex(endereco)
    if bairro_detectado:
        return {
            "ok": True,
            "bairro": bairro_detectado,
            "display_name": endereco,
            "lat": None,
            "lon": None,
            "fonte": "fallback_regex",
        }

    return {
        "ok": False,
        "bairro": None,
        "display_name": endereco,
        "lat": None,
        "lon": None,
        "fonte": "nenhuma",
    }


def _extract_bairro_regex(endereco: str) -> str | None:
    """Extração ingênua de bairro via Regex."""
    # Procura por "bairro <nome>" ou "bairro: <nome>" ou "b. <nome>"
    match = re.search(r"(?:bairro|b\.|bairro:)\s*([^,-]+)", endereco, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None
