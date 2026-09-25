"""
CRUD do cardápio + reindexação de embeddings.
"""
import logging
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import membership
from app.models import Produto
from app.services.embeddings import embed_batch, produto_text_for_embedding

log = logging.getLogger(__name__)
_settings = get_settings()
router = APIRouter(prefix="/pizzarias/{pizzaria_id}/cardapio", tags=["cardapio"])

# Limite de upload do arquivo de cardápio (PDF/imagem).
MAX_ARQUIVO_BYTES = 8 * 1024 * 1024  # 8 MB
TIPOS_ARQUIVO_OK = ("application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp")


class ProdutoIn(BaseModel):
    nome: str = Field(min_length=1)
    categoria: str | None = None
    descricao: str | None = None
    preco: Decimal = Field(ge=0)
    disponivel: bool = True
    imagem_url: str | None = None
    ordem: int = 0
    tamanhos: list[dict[str, Any]] | None = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    opcoes: dict[str, Any] = Field(default_factory=dict)
    regras: dict[str, Any] = Field(default_factory=dict)


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
    tamanhos: list[dict[str, Any]] | None = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    opcoes: dict[str, Any] = Field(default_factory=dict)
    regras: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


def _invalidar_catalogo(pizzaria_id) -> None:
    """Cardápio mudou: o atendente passa a ver a versão nova já na próxima mensagem
    (sem esperar o TTL do cache do catálogo). Vale só neste processo; os workers
    pegam a mudança pelo TTL curto."""
    from app.agent.fsm.catalogo import invalidar_cache
    invalidar_cache(pizzaria_id)


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
    data = body.model_dump()
    if data.get("tamanhos") and (data.get("preco") is None or data.get("preco") <= 0):
        try:
            precos = [Decimal(str(t.get("preco") or 0)) for t in data["tamanhos"] if t.get("preco")]
            if precos:
                data["preco"] = min(precos)
        except Exception:
            pass

    p = Produto(pizzaria_id=pizzaria_id, **data)
    db.add(p)
    await db.commit()
    _invalidar_catalogo(pizzaria_id)
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

    data = body.model_dump()
    if data.get("tamanhos") and (data.get("preco") is None or data.get("preco") <= 0):
        try:
            precos = [Decimal(str(t.get("preco") or 0)) for t in data["tamanhos"] if t.get("preco")]
            if precos:
                data["preco"] = min(precos)
        except Exception:
            pass

    for k, v in data.items():
        setattr(p, k, v)
    await db.commit()
    _invalidar_catalogo(pizzaria_id)
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
    _invalidar_catalogo(pizzaria_id)


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
        produto_text_for_embedding(
            p.nome,
            " | ".join(filter(None, [
                p.descricao,
                "aliases: " + ", ".join(p.aliases or []) if p.aliases else None,
                "tags: " + ", ".join(p.tags or []) if p.tags else None,
            ])),
            p.categoria,
        )
        for p in produtos
    ]

    try:
        vecs = await embed_batch(textos)
    except Exception as e:
        log.exception("Erro ao gerar embeddings para reindexação")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Erro ao gerar embeddings: {e}") from e

    # Atualiza um por um via SQL puro (pgvector espera formato '[1.2, 3.4, ...]')
    for p, v in zip(produtos, vecs, strict=False):
        vec_str = "[" + ",".join(str(x) for x in v) + "]"
        await db.execute(
            text("UPDATE public.produtos SET embedding = CAST(:v AS vector) WHERE id = :id"),
            {"v": vec_str, "id": str(p.id)},
        )
    await db.commit()

    log.info("Reindex pizzaria %s: %d produtos", pizzaria_id, len(produtos))
    return {"ok": True, "produtos": len(produtos)}


# ============================================
# Arquivo do cardápio (PDF/imagem) — upload/serve/info/delete
# ============================================
def _arquivo_url(pizzaria_id: uuid.UUID) -> str:
    base = (_settings.public_base_url or "").rstrip("/")
    return f"{base}/pizzarias/{pizzaria_id}/cardapio/arquivo"


@router.post("/arquivo")
async def upload_arquivo(
    pizzaria_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Sobe o cardápio em PDF/imagem (1 por pizzaria, substitui o anterior)."""
    ct = (file.content_type or "").lower()
    if ct not in TIPOS_ARQUIVO_OK:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use PDF ou imagem (PNG/JPG/WEBP).")
    dados = await file.read()
    if len(dados) > MAX_ARQUIVO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo muito grande (máx. 8 MB).")
    if not dados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo vazio.")

    await db.execute(
        text("""
            INSERT INTO public.cardapio_arquivo (pizzaria_id, filename, content_type, tamanho, dados, updated_at)
            VALUES (:pid, :fn, :ct, :sz, :dados, now())
            ON CONFLICT (pizzaria_id) DO UPDATE SET
                filename = EXCLUDED.filename, content_type = EXCLUDED.content_type,
                tamanho = EXCLUDED.tamanho, dados = EXCLUDED.dados, updated_at = now()
        """),
        {"pid": str(pizzaria_id), "fn": file.filename or "cardapio",
         "ct": ct, "sz": len(dados), "dados": dados},
    )
    await db.commit()
    return {"ok": True, "filename": file.filename, "content_type": ct,
            "tamanho": len(dados), "url": _arquivo_url(pizzaria_id)}


@router.get("/arquivo/info")
async def info_arquivo(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Metadados do arquivo de cardápio (para o painel)."""
    row = (await db.execute(
        text("SELECT filename, content_type, tamanho, updated_at FROM public.cardapio_arquivo WHERE pizzaria_id = :pid"),
        {"pid": str(pizzaria_id)},
    )).first()
    if not row:
        return {"existe": False}
    return {
        "existe": True, "filename": row[0], "content_type": row[1],
        "tamanho": row[2], "atualizado_em": row[3].isoformat() if row[3] else None,
        "url": _arquivo_url(pizzaria_id),
    }


@router.get("/arquivo")
async def serve_arquivo(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Serve o arquivo (público — para o WhatsApp/Evolution baixar e o cliente baixar)."""
    row = (await db.execute(
        text("SELECT filename, content_type, dados FROM public.cardapio_arquivo WHERE pizzaria_id = :pid"),
        {"pid": str(pizzaria_id)},
    )).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sem arquivo de cardápio")
    filename, ct, dados = row[0] or "cardapio", row[1] or "application/octet-stream", row[2]
    return Response(
        content=bytes(dados),
        media_type=ct,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


class ImportarTextoIn(BaseModel):
    texto: str | None = None


class ProdutoImport(BaseModel):
    nome: str
    categoria: str | None = "outro"
    descricao: str | None = ""
    preco: Decimal = Decimal("0")
    tamanhos: list[dict[str, Any]] | None = None


class ConfirmarImportIn(BaseModel):
    produtos: list[ProdutoImport]


@router.post("/importar/extrair")
async def importar_extrair(
    pizzaria_id: uuid.UUID,
    file: UploadFile | None = File(default=None),
    texto: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """
    Extrai produtos de uma imagem/PDF (multipart 'file') ou de 'texto' (form),
    usando a IA configurada. NÃO salva — devolve a lista para revisão.
    """
    from app.services.import_cardapio import extrair_produtos, pdf_para_imagens

    imagens: list[bytes] = []
    if file is not None:
        ct = (file.content_type or "").lower()
        dados = await file.read()
        if len(dados) > 12 * 1024 * 1024:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo muito grande (máx. 12 MB).")
        if ct == "application/pdf":
            try:
                imagens = pdf_para_imagens(dados)
            except Exception as e:  # noqa: BLE001
                log.exception("Falha ao converter PDF")
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Não consegui ler o PDF: {e}") from e
        elif ct.startswith("image/"):
            imagens = [dados]
        else:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Envie uma imagem (PNG/JPG) ou PDF.")

    if not imagens and not (texto and texto.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Envie uma imagem/PDF ou cole o texto do cardápio.")

    try:
        produtos = await extrair_produtos(db, texto=texto, imagens=imagens)
    except RuntimeError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        log.exception("Falha na extração do cardápio")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Erro na IA: {e}") from e

    return {"produtos": produtos, "total": len(produtos)}


@router.post("/importar/confirmar")
async def importar_confirmar(
    pizzaria_id: uuid.UUID,
    body: ConfirmarImportIn,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> dict:
    """Cadastra em lote os produtos revisados pelo dono."""
    criados = 0
    # Continua a numeração de ordem a partir do que já existe.
    max_ordem = (await db.execute(
        text("SELECT COALESCE(MAX(ordem), 0) FROM public.produtos WHERE pizzaria_id = :pid"),
        {"pid": str(pizzaria_id)},
    )).scalar() or 0

    for i, p in enumerate(body.produtos, start=1):
        nome = (p.nome or "").strip()
        tamanhos_list = p.tamanhos
        preco_calculado = Decimal(p.preco)

        if tamanhos_list and preco_calculado <= 0:
            try:
                precos_tamanhos = [Decimal(str(t.get("preco") or 0)) for t in tamanhos_list if t.get("preco")]
                if precos_tamanhos:
                    preco_calculado = min(precos_tamanhos)
            except Exception:
                pass

        if not nome or (preco_calculado <= 0 and not p.tamanhos):
            continue

        db.add(Produto(
            pizzaria_id=pizzaria_id,
            nome=nome[:120],
            categoria=(p.categoria or "outro").strip().lower() or "outro",
            descricao=(p.descricao or "").strip() or None,
            preco=preco_calculado,
            tamanhos=tamanhos_list,
            disponivel=True,
            ordem=max_ordem + i,
        ))
        criados += 1

    await db.commit()
    _invalidar_catalogo(pizzaria_id)
    return {"ok": True, "criados": criados}


@router.delete("/arquivo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_arquivo(
    pizzaria_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(membership),
) -> None:
    await db.execute(
        text("DELETE FROM public.cardapio_arquivo WHERE pizzaria_id = :pid"),
        {"pid": str(pizzaria_id)},
    )
    await db.commit()
