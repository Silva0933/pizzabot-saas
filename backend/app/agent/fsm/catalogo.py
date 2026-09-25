"""
Catálogo da pizzaria: a ÚNICA fonte do que existe e de quanto custa.

Por que existe: os erros do atendimento nasciam de o sistema ADIVINHAR o produto
a partir de texto livre (ILIKE no nome): "pizza brasa M" virava o lanche "Brasa
SupreMe", "GG" virava "G", "3 cheese classico" levava o 3 no nome. Aqui cada
pizzaria tem um catálogo montado do banco — produtos disponíveis, tamanhos
disponíveis, regras de meio a meio e adicionais válidos POR PRODUTO — e:

  - a NLU (nlu_comandos) só pode ESCOLHER códigos deste catálogo (P1, P2...);
  - o preço e a validação do item (`precificar`) saem daqui, por ID, sem busca
    por nome; as mesmas regras valem no agente e no cardápio digital.

Multi-tenant: tudo é por pizzaria_id e montado dos dados — nenhuma regra de
cardápio fica no código. Cache curto em memória (TTL) para não consultar o banco
a cada mensagem; edição no painel aparece em até `_TTL_SEGUNDOS`.
"""
from __future__ import annotations

import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

log = logging.getLogger(__name__)

_TTL_SEGUNDOS = 60.0
_cache: dict[str, tuple[float, Catalogo]] = {}


def normalizar(s: Any) -> str:
    """Minúsculas, sem acento, espaço simples."""
    base = unicodedata.normalize("NFD", str(s or "").strip().lower())
    return re.sub(r"\s+", " ", "".join(c for c in base if unicodedata.category(c) != "Mn"))


def _dec(v: Any) -> Decimal:
    try:
        return Decimal(str(v if v is not None else 0))
    except Exception:  # noqa: BLE001
        return Decimal("0")


def _centavos(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class Adicional:
    nome: str
    preco: Decimal
    tipo: str = "adicional"  # adicional | borda


@dataclass
class ProdutoCat:
    id: str
    codigo: str
    nome: str
    categoria: str
    preco: Decimal
    tamanhos: list[tuple[str, Decimal]] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    descricao: str = ""
    meia_permitido: bool | None = None  # None = não configurado
    meia_max_sabores: int = 2
    meia_calculo: str = "maior_valor"
    adicionais: list[Adicional] = field(default_factory=list)

    def tamanho(self, t: str | None) -> tuple[str, Decimal] | None:
        """Tamanho cadastrado que casa com `t` (igual primeiro; depois inicial)."""
        if not t or not self.tamanhos:
            return None
        tn = normalizar(t)
        for nome, preco in self.tamanhos:
            if normalizar(nome) == tn:
                return nome, preco
        for nome, preco in self.tamanhos:
            nn = normalizar(nome)
            if (len(tn) == 1 and nn.startswith(tn)) or (len(nn) == 1 and tn.startswith(nn)):
                return nome, preco
        return None

    def adicional(self, nome: str) -> Adicional | None:
        alvo = normalizar(nome)
        return next((a for a in self.adicionais if normalizar(a.nome) == alvo), None)

    def aceita_meia(self) -> bool:
        """Sem regra cadastrada, pizza aceita meio a meio (mesmo padrão do cardápio digital)."""
        if self.meia_permitido is not None:
            return self.meia_permitido
        return "pizza" in normalizar(self.categoria)


class ErroItem(ValueError):
    """Item que não pode entrar no pedido — `tipo` diz o que o cliente precisa resolver."""

    def __init__(self, tipo: str, mensagem: str, **extra: Any):
        super().__init__(mensagem)
        self.tipo = tipo  # produto_invalido | tamanho_faltando | tamanho_invalido | meia_invalida | adicional_invalido
        self.extra = extra


@dataclass
class ItemPrecificado:
    nome: str                 # nome de exibição ("Pizza Brasa (G) + Queijo extra")
    preco_unit: Decimal
    tamanho: str | None
    sabores: list[str]        # nomes dos sabores (meio a meio) — vazio se inteira
    adicionais: list[str]     # nomes EXATOS do cadastro


@dataclass
class Catalogo:
    pizzaria_id: str
    produtos: list[ProdutoCat]
    adicionais_globais: list[Adicional] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._por_id = {p.id: p for p in self.produtos}
        self._por_codigo = {p.codigo: p for p in self.produtos}

    # ---------- consulta ----------
    def por_id(self, pid: Any) -> ProdutoCat | None:
        return self._por_id.get(str(pid)) if pid else None

    def por_codigo(self, codigo: Any) -> ProdutoCat | None:
        return self._por_codigo.get(str(codigo or "").strip().upper())

    def categorias(self) -> list[str]:
        vistas: list[str] = []
        for p in self.produtos:
            if p.categoria and p.categoria not in vistas:
                vistas.append(p.categoria)
        return vistas

    def todos_tamanhos(self) -> list[str]:
        vistos: list[str] = []
        for p in self.produtos:
            for nome, _ in p.tamanhos:
                if nome not in vistos:
                    vistos.append(nome)
        return vistos

    def todos_adicionais(self) -> list[str]:
        """Nomes distintos de todos os adicionais (de produto e globais)."""
        vistos: dict[str, str] = {}
        for a in [*self.adicionais_globais, *(a for p in self.produtos for a in p.adicionais)]:
            vistos.setdefault(normalizar(a.nome), a.nome)
        return list(vistos.values())

    # ---------- regra única de preço/validação ----------
    def precificar(
        self,
        produto_ids: list[str],
        tamanho: str | None,
        adicionais: list[str] | None = None,
    ) -> ItemPrecificado:
        """Preço unitário e nome de um item (inteiro = 1 id; meio a meio = 2+).

        Regras (as mesmas no agente e no cardápio digital):
          - produto precisa existir e estar disponível;
          - produto com tamanhos exige um tamanho cadastrado (e disponível);
          - meio a meio: mesma categoria, todos aceitam meia, até o MENOR
            max_sabores, tamanho existente em todos; preço pelo maior valor
            ou pela média (regra do primeiro sabor);
          - adicional precisa pertencer ao produto (próprios; sem próprios, os
            globais da pizzaria).
        Levanta ErroItem com o motivo.
        """
        ids: list[str] = []
        for pid in produto_ids or []:
            if pid and str(pid) not in ids:
                ids.append(str(pid))
        if not ids:
            raise ErroItem("produto_invalido", "Item sem produto.")
        sabores: list[ProdutoCat] = []
        for pid in ids:
            p = self.por_id(pid)
            if p is None:
                raise ErroItem("produto_invalido", "Produto indisponível ou fora do cardápio.", produto_id=pid)
            sabores.append(p)
        principal = sabores[0]

        if len(sabores) > 1:
            if len({normalizar(s.categoria) for s in sabores}) > 1:
                raise ErroItem("meia_invalida", "Meio a meio só entre sabores da mesma categoria.")
            if not all(s.aceita_meia() for s in sabores):
                nao = [s.nome for s in sabores if not s.aceita_meia()]
                raise ErroItem("meia_invalida", f"Não aceita meio a meio: {', '.join(nao)}.")
            limite = min(s.meia_max_sabores or 2 for s in sabores)
            if len(sabores) > limite:
                raise ErroItem("meia_invalida", f"Esta pizza aceita no máximo {limite} sabores.")

        precos: list[Decimal] = []
        tam_final: str | None = None
        for s in sabores:
            if s.tamanhos:
                if not tamanho:
                    opcoes = ", ".join(n for n, _ in s.tamanhos)
                    raise ErroItem("tamanho_faltando", f"'{s.nome}' tem tamanhos: {opcoes}.", opcoes=opcoes, produto=s.nome)
                achado = s.tamanho(tamanho)
                if achado is None:
                    opcoes = ", ".join(n for n, _ in s.tamanhos)
                    raise ErroItem(
                        "tamanho_invalido", f"Tamanho '{tamanho}' não existe para '{s.nome}'. Opções: {opcoes}.",
                        opcoes=opcoes, produto=s.nome,
                    )
                tam_final = tam_final or achado[0]
                precos.append(achado[1])
            else:
                precos.append(s.preco)

        if len(precos) == 1:
            preco = precos[0]
        elif principal.meia_calculo == "media":
            preco = _centavos(sum(precos) / len(precos))
        else:
            preco = max(precos)

        if len(sabores) > 1:
            curtos = [re.sub(r"^pizza\s+(de\s+)?", "", s.nome, flags=re.IGNORECASE) or s.nome for s in sabores]
            nome = "Pizza Meia " + " / Meia ".join(curtos)
        else:
            nome = principal.nome
        if tam_final:
            nome += f" ({tam_final})"

        validos = self.adicionais_de(principal)
        nomes_ok: list[str] = []
        faltantes: list[str] = []
        for a in adicionais or []:
            ad = next((x for x in validos if normalizar(x.nome) == normalizar(a)), None)
            if ad is None:
                faltantes.append(a)
                continue
            nomes_ok.append(ad.nome)
            preco += ad.preco
        if faltantes:
            raise ErroItem(
                "adicional_invalido", f"Adicional não disponível para este item: {faltantes}.",
                faltantes=faltantes, validos=[x.nome for x in validos],
            )
        if nomes_ok:
            nome += " + " + " + ".join(nomes_ok)
        return ItemPrecificado(
            nome=nome, preco_unit=_centavos(preco), tamanho=tam_final,
            sabores=[s.nome for s in sabores] if len(sabores) > 1 else [],
            adicionais=nomes_ok,
        )

    def adicionais_de(self, p: ProdutoCat) -> list[Adicional]:
        """Adicionais válidos do produto: os dele; sem nenhum, os globais."""
        return p.adicionais or self.adicionais_globais

    # ---------- fatos para a voz (gatilho por produto citado) ----------
    def fatos_de(self, produtos: list[ProdutoCat]) -> tuple[str, list[float]]:
        """Dados REAIS dos produtos citados: preço (por tamanho), descrição e
        adicionais. Devolve (texto, preços válidos para o guard)."""
        linhas: list[str] = []
        precos: list[float] = []

        def brl(v: Decimal) -> str:
            return "R$ " + f"{v:.2f}".replace(".", ",")

        for p in produtos:
            if p.tamanhos:
                preco_txt = " · ".join(f"{n} {brl(v)}" for n, v in p.tamanhos)
                precos += [float(v) for _, v in p.tamanhos]
            else:
                preco_txt = brl(p.preco)
                precos.append(float(p.preco))
            partes = [f"{p.nome}: {preco_txt}"]
            if p.descricao:
                partes.append(f"({p.descricao[:160]})")
            ads = self.adicionais_de(p)
            if ads:
                partes.append("adicionais: " + ", ".join(f"{a.nome} +{brl(a.preco)}" for a in ads[:8]))
                precos += [float(a.preco) for a in ads[:8] if a.preco > 0]
            if p.aceita_meia():
                partes.append("aceita meio a meio")
            linhas.append(" ".join(partes))
        return "; ".join(linhas), precos

    def da_categoria(self, categoria: str) -> list[ProdutoCat]:
        alvo = normalizar(categoria)
        return [p for p in self.produtos if normalizar(p.categoria) == alvo]

    # ---------- texto para a NLU ----------
    def texto_para_nlu(self) -> str:
        """Uma linha por produto: código, nome, categoria, tamanhos, meia e adicionais.
        Sem preço — a NLU só identifica; preço é do `precificar`."""
        codigo_ad = {normalizar(n): f"A{i + 1}" for i, n in enumerate(self.todos_adicionais())}
        linhas = []
        for p in self.produtos:
            partes = [f"{p.codigo} | {p.nome} | categoria: {p.categoria or '-'}"]
            if p.tamanhos:
                partes.append("tamanhos: " + ", ".join(n for n, _ in p.tamanhos))
            if p.aliases:
                partes.append("também chamado: " + ", ".join(p.aliases[:5]))
            if p.aceita_meia():
                partes.append(f"meio a meio: sim (até {p.meia_max_sabores})")
            ads = self.adicionais_de(p)
            if ads:
                partes.append("adicionais: " + ", ".join(f"{codigo_ad[normalizar(a.nome)]} {a.nome}" for a in ads))
            linhas.append(" | ".join(partes))
        return "\n".join(linhas)

    def codigos_adicionais(self) -> dict[str, str]:
        """{"A1": "Bacon crocante", ...} — mesma numeração do texto_para_nlu."""
        return {f"A{i + 1}": n for i, n in enumerate(self.todos_adicionais())}


# ============================================
# Montagem a partir de objetos do cadastro (ORM ou equivalentes)
# ============================================
def _adicionais_de_lista(bruta: Any) -> list[Adicional]:
    out: list[Adicional] = []
    for a in bruta or []:
        if isinstance(a, dict) and str(a.get("nome") or "").strip():
            tipo = "borda" if a.get("tipo") == "borda" or "borda" in normalizar(a.get("nome")) else "adicional"
            out.append(Adicional(str(a["nome"]).strip(), _dec(a.get("preco")), tipo))
        elif isinstance(a, str) and a.strip():
            out.append(Adicional(a.strip(), Decimal("0"), "borda" if "borda" in normalizar(a) else "adicional"))
    return out


def _tamanhos_disponiveis(p: Any) -> list[tuple[str, Decimal]]:
    rel = getattr(p, "tamanhos_rel", None)
    if rel:
        return [(str(t.tamanho), _dec(t.preco)) for t in rel if getattr(t, "disponivel", True)]
    brutos = getattr(p, "tamanhos", None) or []
    return [
        (str(t.get("tamanho") or t.get("nome")), _dec(t.get("preco")))
        for t in brutos if isinstance(t, dict) and (t.get("tamanho") or t.get("nome"))
    ]


def produto_cat(p: Any, codigo: str) -> ProdutoCat:
    """ProdutoCat a partir de um Produto (ORM) ou objeto com os mesmos atributos."""
    regras = getattr(p, "regras", None) or {}
    meia = regras.get("meia_meia") if isinstance(regras, dict) else None
    meia = meia if isinstance(meia, dict) else {}
    opcoes = getattr(p, "opcoes", None) or {}
    proprios = _adicionais_de_lista(opcoes.get("adicionais") if isinstance(opcoes, dict) else None)
    # Complementos formais (grupos ligados ao produto) também são adicionais dele.
    for g in getattr(p, "grupos_complementos", None) or []:
        for c in getattr(g, "complementos", None) or []:
            if getattr(c, "disponivel", True) and getattr(c, "nome", None):
                proprios.append(Adicional(str(c.nome), _dec(c.preco)))
    permitido = meia.get("permitido")
    return ProdutoCat(
        id=str(p.id), codigo=codigo, nome=str(p.nome).strip(),
        categoria=str(getattr(p, "categoria", None) or "").strip(),
        preco=_dec(getattr(p, "preco", 0)),
        tamanhos=_tamanhos_disponiveis(p),
        aliases=[str(a) for a in (getattr(p, "aliases", None) or []) if a],
        descricao=str(getattr(p, "descricao", None) or ""),
        meia_permitido=permitido if isinstance(permitido, bool) else None,
        meia_max_sabores=int(meia.get("max_sabores") or 2),
        meia_calculo=str(meia.get("calculo") or "maior_valor"),
        adicionais=proprios,
    )


def montar_catalogo(pizzaria_id: Any, produtos: list[Any], adicionais_globais: Any) -> Catalogo:
    """Catálogo de uma lista de produtos (só os disponíveis entram)."""
    disp = [p for p in produtos if getattr(p, "disponivel", True)]
    disp.sort(key=lambda p: (normalizar(getattr(p, "categoria", "")), getattr(p, "ordem", 0) or 0, normalizar(p.nome)))
    return Catalogo(
        pizzaria_id=str(pizzaria_id),
        produtos=[produto_cat(p, f"P{i + 1}") for i, p in enumerate(disp)],
        adicionais_globais=_adicionais_de_lista(adicionais_globais),
    )


async def carregar_catalogo(db: Any, pizzaria: Any, *, usar_cache: bool = True) -> Catalogo:
    """Catálogo da pizzaria (cache por pizzaria com TTL curto)."""
    chave = str(pizzaria.id)
    agora = time.monotonic()
    if usar_cache:
        hit = _cache.get(chave)
        if hit and agora - hit[0] < _TTL_SEGUNDOS:
            return hit[1]
    from sqlalchemy import select

    from app.models import Produto
    produtos = list((await db.execute(
        select(Produto).where(Produto.pizzaria_id == pizzaria.id, Produto.disponivel == True)  # noqa: E712
    )).scalars().all())
    cat = montar_catalogo(pizzaria.id, produtos, getattr(pizzaria, "adicionais", None))
    _cache[chave] = (agora, cat)
    return cat


def invalidar_cache(pizzaria_id: Any = None) -> None:
    if pizzaria_id is None:
        _cache.clear()
    else:
        _cache.pop(str(pizzaria_id), None)
