"""Geração de embeddings via Gemini (gemini-embedding-001, truncado p/ 768 dim).

O modelo antigo text-embedding-004 foi descontinuado (404). Usamos
gemini-embedding-001 com output_dimensionality=768 (Matryoshka) para manter
compatibilidade com a coluna pgvector vector(768) já existente.
"""
import logging

from google import genai
from google.genai import types

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
_EMBED_CONFIG = types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not _settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY não configurado")
        _client = genai.Client(api_key=_settings.gemini_api_key)
    return _client


async def embed_text(texto: str) -> list[float]:
    """Gera embedding para uma string única."""
    client = _get_client()
    result = await client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texto.strip(),
        config=_EMBED_CONFIG,
    )
    return list(result.embeddings[0].values)


async def embed_batch(textos: list[str]) -> list[list[float]]:
    """Gera embeddings em batch (mais econômico)."""
    client = _get_client()
    result = await client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=textos,
        config=_EMBED_CONFIG,
    )
    return [list(e.values) for e in result.embeddings]


def produto_text_for_embedding(nome: str, descricao: str | None, categoria: str | None) -> str:
    """Texto canônico para gerar embedding de um produto."""
    parts = [nome]
    if categoria:
        parts.append(f"categoria: {categoria}")
    if descricao:
        parts.append(descricao)
    return " | ".join(parts)
