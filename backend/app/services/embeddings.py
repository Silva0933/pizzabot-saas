"""Geração de embeddings via Gemini text-embedding-004 (768 dim)."""
import logging

from google import genai

from app.config import get_settings

log = logging.getLogger(__name__)
_settings = get_settings()

EMBEDDING_MODEL = "text-embedding-004"
EMBEDDING_DIM = 768

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
    )
    return list(result.embeddings[0].values)


async def embed_batch(textos: list[str]) -> list[list[float]]:
    """Gera embeddings em batch (mais econômico)."""
    client = _get_client()
    result = await client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=textos,
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
