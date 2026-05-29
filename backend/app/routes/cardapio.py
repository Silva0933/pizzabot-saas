"""
CRUD do cardápio + reindexação de embeddings.
"""
import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import membership
from app.models import Produto
from app.services.embeddings import embed_batch, produto_text_for_embedding

log = logging.getLogger(__name__)
router = APIRouter(prefix="/pizzarias/{pizzaria_id}/cardapio", tags=["cardapio"])


class ProdutoIn(BaseModel):
    nome: str = Field(min_length=1)
    categoria: str | None = None
    descricao: str | None = None
    preco: Decimal = Field(gt=0)
    disponivel: bool = True
    imagem_url: str | None = None
    ordem: int = 0


class ProdutoOut(BaseModel):
    id: uuid.UUID
    pizzaria_id: uuid.UUID
    nome: str
    categoria: str | None
    descricao: str | None
    preco: Decimal
    disponivel: bool
    imagem_url: str | None
    ordem: int

    model_config = {"from_attributes": True}


@router.get("", response_model=list[ProdutoOut])
async def list_produtos(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> list[Produto]:
    stmt = (
        select(Produto)
        .where(Produto.pizzaria_id == pizzaria_id)
        .order_by(Produto.ordem, Produto.nome)
    )
    return list((await db.execute(stmt)).scalars().all())


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
async def create_produto(
    pizzaria_id: uuid.UUID,
    body: ProdutoIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Produto:
    p = Produto(pizzaria_id=pizzaria_id, **body.model_dump())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@router.patch("/{produto_id}", response_model=ProdutoOut)
async def update_produto(
    pizzaria_id: uuid.UUID,
    produto_id: uuid.UUID,
    body: ProdutoIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> Produto:
    p = (
        await db.execute(
            select(Produto).where(Produto.id == produto_id, Produto.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return p


@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_produto(
    pizzaria_id: uuid.UUID,
    produto_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> None:
    p = (
        await db.execute(
            select(Produto).where(Produto.id == produto_id, Produto.pizzaria_id == pizzaria_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produto não encontrado")
    await db.delete(p)
    await db.commit()


@router.post("/reindex")
async def reindex_embeddings(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Recalcula embeddings dos produtos da pizzaria. Chamar após criar/atualizar em lote."""
    stmt = (
        select(Produto)
        .where(Produto.pizzaria_id == pizzaria_id, Produto.disponivel == True)  # noqa: E712
    )
    produtos = list((await db.execute(stmt)).scalars().all())
    if not produtos:
        return {"ok": True, "produtos": 0}

    textos = [
        produto_text_for_embedding(p.nome, p.descricao, p.categoria)
        for p in produtos
    ]

    try:
        vecs = await embed_batch(textos)
    except RuntimeError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    # Atualiza um por um via SQL puro (pgvector espera formato '[1.2, 3.4, ...]')
    for p, v in zip(produtos, vecs):
        vec_str = "[" + ",".join(str(x) for x in v) + "]"
        await db.execute(
            text("UPDATE public.produtos SET embedding = CAST(:v AS vector) WHERE id = :id"),
            {"v": vec_str, "id": str(p.id)},
        )
    await db.commit()

    log.info("Reindex pizzaria %s: %d produtos", pizzaria_id, len(produtos))
    return {"ok": True, "produtos": len(produtos)}
