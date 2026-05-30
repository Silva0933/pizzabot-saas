"""
Importação de cardápio com IA.

Recebe texto livre, imagem (foto/print) ou páginas de PDF (já como imagens)
e pede ao provedor de LLM configurado para extrair os produtos em JSON:
    [{"nome", "categoria", "descricao", "preco"}]

Itens com vários tamanhos viram UM produto por tamanho (ex.: "Calabresa (P)").
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_config import get_llm_config

log = logging.getLogger(__name__)

CATEGORIAS_VALIDAS = {"pizza", "lanche", "bebida", "sobremesa", "outro"}
MAX_PDF_PAGINAS = 6

_PROMPT = (
    "Você é um extrator de cardápios. A partir do conteúdo a seguir, extraia TODOS os "
    "produtos do cardápio. Para itens com vários tamanhos/preços (P/M/G, broto/grande, etc.), "
    "gere um ÚNICO produto com as opções estruturadas no campo 'tamanhos' e coloque o 'preco' principal "
    "como o preço do menor tamanho (ou 0). O campo 'tamanhos' deve ser um array de objetos: "
    "[{\"tamanho\": str, \"preco\": number}]. Se o produto não tiver variações de tamanho, "
    "o campo 'tamanhos' deve ser nulo (null).\n\n"
    "Responda SOMENTE com um array JSON válido, sem texto fora dele, no formato:\n"
    "[{\"nome\": str, \"categoria\": str, \"descricao\": str, \"preco\": number, \"tamanhos\": [{\"tamanho\": str, \"preco\": number}] | null}]\n"
    "Regras: 'preco' e preços em 'tamanhos' são números em reais (ponto decimal). 'categoria' em minúsculas, uma de: "
    "pizza, lanche, bebida, sobremesa, outro. 'descricao' curta (ingredientes), pode ser vazia. "
    "Não invente itens nem preços; se um preço não estiver claro, use 0."
)


def _parse_json_array(raw: str) -> list[dict[str, Any]]:
    """Extrai um array JSON de uma resposta (tolera ```json e texto ao redor)."""
    if not raw:
        return []
    txt = raw.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.MULTILINE).strip()
    # Pega do primeiro '[' até o último ']'
    i, j = txt.find("["), txt.rfind("]")
    if i != -1 and j != -1 and j > i:
        txt = txt[i:j + 1]
    try:
        data = json.loads(txt)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def normalizar_produtos(itens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Valida/normaliza a lista de produtos (nome, categoria, descricao, preco, tamanhos)."""
    out: list[dict[str, Any]] = []
    for it in itens:
        if not isinstance(it, dict):
            continue
        nome = str(it.get("nome") or it.get("produto") or "").strip()
        if not nome:
            continue
        try:
            preco = float(str(it.get("preco") or it.get("preco_unit") or 0).replace(",", "."))
        except (TypeError, ValueError):
            preco = 0.0
        cat = str(it.get("categoria") or "outro").strip().lower()
        if cat not in CATEGORIAS_VALIDAS:
            cat = "outro"

        tamanhos_raw = it.get("tamanhos")
        tamanhos_norm = None
        if isinstance(tamanhos_raw, list):
            tamanhos_norm = []
            for t in tamanhos_raw:
                if not isinstance(t, dict):
                    continue
                t_nome = str(t.get("tamanho") or t.get("nome") or "").strip()
                if not t_nome:
                    continue
                try:
                    t_preco = float(str(t.get("preco") or 0).replace(",", "."))
                except (TypeError, ValueError):
                    t_preco = 0.0
                tamanhos_norm.append({
                    "tamanho": t_nome[:30],
                    "preco": round(max(t_preco, 0.0), 2)
                })
            if not tamanhos_norm:
                tamanhos_norm = None

        out.append({
            "nome": nome[:120],
            "categoria": cat,
            "descricao": (str(it.get("descricao") or "").strip())[:500],
            "preco": round(max(preco, 0.0), 2),
            "tamanhos": tamanhos_norm,
        })
    return out


async def extrair_produtos(
    db: AsyncSession,
    *,
    texto: str | None = None,
    imagens: list[bytes] | None = None,
) -> list[dict[str, Any]]:
    """Chama a LLM configurada para extrair produtos de texto e/ou imagens."""
    cfg = await get_llm_config(db)
    provider, model, keys = cfg["provider"], cfg["model"], cfg["keys"]
    imagens = imagens or []

    if provider in ("openrouter", "openai"):
        key = keys.get(provider)
        if not key:
            raise RuntimeError(f"Chave do {provider} não configurada.")
        content: list[dict[str, Any]] = [{"type": "text", "text": _PROMPT}]
        if texto:
            content.append({"type": "text", "text": f"\nCARDÁPIO (texto):\n{texto}"})
        for img in imagens:
            b64 = base64.b64encode(img).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        from app.agent.providers import openai_chat
        res = await openai_chat(
            provider=provider, api_key=key, model=model,
            messages=[{"role": "user", "content": content}],
            temperature=0.0, max_tokens=4000,
        )
        raw = res.get("content") or ""
    else:  # gemini
        key = keys.get("gemini")
        if not key:
            raise RuntimeError("Chave do Gemini não configurada.")
        from google.genai import types
        from app.agent.llm import get_client
        client = get_client(key)
        parts: list[Any] = [_PROMPT]
        if texto:
            parts.append(f"\nCARDÁPIO (texto):\n{texto}")
        for img in imagens:
            parts.append(types.Part.from_bytes(data=img, mime_type="image/png"))
        resp = await client.aio.models.generate_content(model=model, contents=parts)
        raw = resp.text or ""

    return normalizar_produtos(_parse_json_array(raw))


def pdf_para_imagens(pdf_bytes: bytes, max_paginas: int = MAX_PDF_PAGINAS) -> list[bytes]:
    """Renderiza as primeiras páginas de um PDF como PNG (via PyMuPDF)."""
    import fitz  # PyMuPDF
    imgs: list[bytes] = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc[:max_paginas]:
            pix = page.get_pixmap(dpi=150)
            imgs.append(pix.tobytes("png"))
    finally:
        doc.close()
    return imgs
