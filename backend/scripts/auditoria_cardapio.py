"""
Auditoria do atendimento contra o cardápio REAL de cada pizzaria.

O stress_atendimento.py confere sintomas no texto. Este confere o que importa
para o pedido sair certo: o CARRINHO depois de cada turno (sabores, tamanho,
adicionais, preço) contra a regra única do catálogo (`Catalogo.precificar`), e
se as respostas sobre o cardápio (tamanhos, meio a meio, preço, adicionais)
batem com o cadastro.

Duas partes:
  A) Regra (sem LLM): toda combinação de 2 sabores × tamanho passa por
     `precificar` e é conferida contra o que o cadastro diz (aceita meia, tamanho
     existe nos dois, maior valor/média, limite de sabores).
  B) Conversas (agente REAL, `simulation=True`: não envia WhatsApp, não cria
     pedido, não cobra): roteiros gerados do próprio cardápio de cada loja.

Uso (dentro do container do backend):
    python scripts/auditoria_cardapio.py                  # todas as lojas
    python scripts/auditoria_cardapio.py --loja palazio   # filtra pelo nome
    python scripts/auditoria_cardapio.py --so-regra       # só a parte A
    python scripts/auditoria_cardapio.py --repeticoes 2   # mede instabilidade
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import re
import sys
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _n(s: Any) -> str:
    base = unicodedata.normalize("NFKD", str(s or "").lower())
    return "".join(c for c in base if not unicodedata.combining(c))


def brl(v: Any) -> str:
    return f"{Decimal(str(v)):.2f}".replace(".", ",")


def curto(nome: str) -> str:
    """Como o cliente chama o sabor: sem "Pizza", sem complemento longo."""
    s = re.sub(r"^pizza\s+(de\s+)?", "", nome, flags=re.IGNORECASE).strip()
    return s.split(" com ")[0].strip() if len(s) > 18 else s


TAM_EXTENSO = {"p": "pequena", "m": "media", "g": "grande", "gg": "gigante"}


@dataclass
class Checagem:
    ok: bool
    descricao: str


@dataclass
class Turno:
    diz: str
    checar: list = field(default_factory=list)   # funções (res, estado, texto) -> Checagem | None


@dataclass
class Roteiro:
    nome: str
    turnos: list[Turno]


# ------------------------------------------------------------------ Parte A
def auditar_regra(cat) -> list[str]:
    from app.agent.fsm.catalogo import ErroItem
    falhas: list[str] = []
    pizzas = [p for p in cat.produtos if p.tamanhos]
    for a, b in itertools.permutations(pizzas, 2):
        tams = {t for t, _ in a.tamanhos} | {t for t, _ in b.tamanhos}
        for t in sorted(tams):
            esperado_ok = (
                _n(a.categoria) == _n(b.categoria) and a.aceita_meia() and b.aceita_meia()
                and a.tamanho(t) is not None and b.tamanho(t) is not None
            )
            try:
                pi = cat.precificar([a.id, b.id], t)
            except ErroItem as e:
                if esperado_ok:
                    falhas.append(f"meia {a.nome}/{b.nome} {t}: recusada ({e}) mas o cadastro permite")
                continue
            if not esperado_ok:
                falhas.append(f"meia {a.nome}/{b.nome} {t}: ACEITA mas o cadastro não permite")
                continue
            pa, pb = a.tamanho(t)[1], b.tamanho(t)[1]
            esp = max(pa, pb) if a.meia_calculo != "media" else (pa + pb) / 2
            if abs(Decimal(pi.preco_unit) - Decimal(esp)) > Decimal("0.01"):
                falhas.append(f"meia {a.nome}/{b.nome} {t}: preço {pi.preco_unit} ≠ esperado {esp}")
    # 3 sabores com limite 2
    aceitam = [p for p in pizzas if p.aceita_meia()]
    for trio in itertools.combinations(aceitam, 3):
        if min(p.meia_max_sabores for p in trio) >= 3:
            continue
        comum = set.intersection(*[{_n(t) for t, _ in p.tamanhos} for p in trio])
        if not comum:
            continue
        t = next(iter(comum))
        try:
            cat.precificar([p.id for p in trio], t)
            falhas.append(f"3 sabores {[p.nome for p in trio]} aceitos com limite 2")
        except ErroItem:
            pass
    return falhas


# ------------------------------------------------------------------ Parte C
# Porte fiel da regra de preço da TELA do cardápio (src/components/v2/CardapioPublico.tsx:
# aceitaMeia, precoDosSabores, candidatos e adicionais exibidos). O checkout
# recalcula no servidor; se a tela divergir, o cliente vê um valor e paga outro.
def _tela_regras(p) -> dict:
    r = (p.regras or {}).get("meia_meia") if isinstance(p.regras, dict) else None
    return r if isinstance(r, dict) else {}


def _tela_aceita_meia(p) -> bool:
    r = _tela_regras(p)
    if r.get("permitido") is False:
        return False
    return r.get("permitido") is True or "pizza" in (p.categoria or "").lower()


def _tela_preco_sabores(sabores, tamanho):
    precos = []
    for s in sabores:
        tams = s.tamanhos or []
        if tams:
            t = next((x for x in tams if x["tamanho"] == tamanho), None)
            if t is None:
                return None
            precos.append(Decimal(str(t["preco"])))
        else:
            precos.append(Decimal(str(s.preco)))
    if len(precos) == 1:
        return precos[0]
    if _tela_regras(sabores[0]).get("calculo") == "media":
        return (sum(precos) / len(precos)).quantize(Decimal("0.01"))
    return max(precos)


def _tela_adicionais(p, globais) -> list[dict]:
    proprios = [
        {"nome": str(a.get("nome") if isinstance(a, dict) else a).strip(),
         "preco": Decimal(str((a.get("preco") if isinstance(a, dict) else 0) or 0))}
        for a in ((p.opcoes or {}).get("adicionais") or [])
    ]
    proprios = [a for a in proprios if a["nome"]]
    if proprios:
        return proprios
    return [{"nome": str(a["nome"]).strip(), "preco": Decimal(str(a.get("preco") or 0))}
            for a in globais if isinstance(a, dict) and str(a.get("nome") or "").strip()]


def auditar_checkout(produtos_orm, globais) -> list[str]:
    from fastapi import HTTPException

    from app.routes.cardapio_publico import ItemPedidoIn, _recalcular_itens
    falhas: list[str] = []
    disp = [p for p in produtos_orm if p.disponivel]
    mapa = {str(p.id): p for p in disp}
    casos = 0

    def conferir(p, outros, tam, ads):
        nonlocal casos
        casos += 1
        tela = _tela_preco_sabores([p, *outros], tam)
        if tela is None:
            return
        tela += sum((a["preco"] for a in _tela_adicionais(p, globais) if a["nome"] in ads), Decimal("0"))
        item = ItemPedidoIn(produto_id=str(p.id), nome=p.nome, quantidade=1, tamanho=tam,
                            adicionais=ads, sabores_ids=[str(o.id) for o in outros])
        rotulo = " / ".join(x.nome for x in [p, *outros]) + f" {tam or ''} {ads or ''}"
        try:
            _itens, subtotal = _recalcular_itens([item], mapa, globais)
        except HTTPException as e:
            falhas.append(f"tela oferece {rotulo} (R$ {tela}) mas o checkout recusa: {e.detail}")
            return
        if abs(subtotal - tela) > Decimal("0.01"):
            falhas.append(f"{rotulo}: tela mostra R$ {tela}, checkout cobra R$ {subtotal}")

    for p in disp:
        tams = [t["tamanho"] for t in (p.tamanhos or [])] or [None]
        ads_tela = [a["nome"] for a in _tela_adicionais(p, globais)]
        for tam in tams:
            conferir(p, [], tam, [])
            for ad in ads_tela:
                conferir(p, [], tam, [ad])
        if not _tela_aceita_meia(p):
            continue
        candidatos = [
            o for o in disp
            if o.id != p.id and (o.categoria or "") == (p.categoria or "") and _tela_aceita_meia(o)
        ]
        for o in candidatos:
            for tam in tams:
                conferir(p, [o], tam, [])
                if ads_tela:
                    conferir(p, [o], tam, [ads_tela[0]])
    print(f"  [C] tela × checkout: {casos} combinações conferidas")
    return falhas


# ------------------------------------------------------------------ Parte B
def _carrinho(estado: dict) -> list[dict]:
    return [i for i in (estado.get("carrinho") or []) if isinstance(i, dict)]


def _ids(item: dict) -> list[str]:
    return [str(x) for x in (item.get("sabores_ids") or [])] or ([str(item["produto_id"])] if item.get("produto_id") else [])


def chk_item_meia(cat, a, b, tam):
    """Carrinho tem a meia A/B no tamanho, com o preço da regra."""
    def _f(res, estado, texto):
        esperado = cat.precificar([a.id, b.id], tam)
        for it in _carrinho(estado):
            if set(_ids(it)) == {a.id, b.id}:
                canon = a.tamanho(it.get("tamanho"))
                t_ok = canon is not None and _n(canon[0]) == _n(esperado.tamanho)
                preco = it.get("preco_congelado")
                p_ok = preco is None or abs(Decimal(str(preco)) - esperado.preco_unit) <= Decimal("0.01")
                return Checagem(t_ok and p_ok, f"meia {curto(a.nome)}/{curto(b.nome)} {tam} no carrinho "
                                f"(tam={it.get('tamanho')} preço={preco} esperado={esperado.preco_unit})")
        resumo = [(i.get("nome"), _ids(i), i.get("tamanho")) for i in _carrinho(estado)]
        return Checagem(False, f"meia {curto(a.nome)}/{curto(b.nome)} {tam} NÃO está no carrinho: {resumo}")
    return _f


def chk_sem_meia(res, estado, texto):
    meias = [i.get("nome") for i in _carrinho(estado) if len(_ids(i)) > 1]
    return Checagem(not meias, f"nenhuma meia no carrinho (achou: {meias})")


def _tam_canon(t):
    """"pequena"/"p" → "p"; "grande" → "g" (como o catálogo casa o tamanho)."""
    n = _n(t)
    return {"pequena": "p", "pequeno": "p", "media": "m", "medio": "m", "grande": "g",
            "gigante": "gg", "familia": "gg"}.get(n, n)


def chk_sem_tamanho(tam):
    def _f(res, estado, texto):
        ruins = [i.get("nome") for i in _carrinho(estado) if _tam_canon(i.get("tamanho")) == _tam_canon(tam)]
        return Checagem(not ruins, f"nenhum item no tamanho inexistente {tam} (achou: {ruins})")
    return _f


def chk_fala(*trechos, todos=False, desc=""):
    def _f(res, estado, texto):
        t = _n(texto)
        achou = [x for x in trechos if _n(x) in t]
        ok = len(achou) == len(trechos) if todos else bool(achou)
        return Checagem(ok, f"{desc or 'fala cita'} {list(trechos)} → {'ok' if ok else 'não citou'}")
    return _f


def chk_nao_fala(*trechos, desc=""):
    def _f(res, estado, texto):
        t = _n(texto)
        achou = [x for x in trechos if _n(x) in t]
        return Checagem(not achou, f"{desc or 'fala NÃO cita'} {list(trechos)} → {'ok' if not achou else f'citou {achou}'}")
    return _f


def chk_preco_na_fala(valor):
    return chk_fala(brl(valor), desc=f"cita o preço R$ {brl(valor)}")


def chk_adicional(cat, prod, tam, adicional):
    def _f(res, estado, texto):
        esperado = cat.precificar([prod.id], tam, [adicional])
        for it in _carrinho(estado):
            if _ids(it) == [prod.id] and any(_n(x) == _n(adicional) for x in (it.get("adicionais") or [])):
                preco = it.get("preco_congelado")
                p_ok = preco is None or abs(Decimal(str(preco)) - esperado.preco_unit) <= Decimal("0.01")
                return Checagem(p_ok, f"{curto(prod.nome)} {tam} + {adicional} (preço={preco} esperado={esperado.preco_unit})")
        resumo = [(i.get("nome"), i.get("adicionais")) for i in _carrinho(estado)]
        return Checagem(False, f"{curto(prod.nome)} {tam} + {adicional} NÃO está no carrinho: {resumo}")
    return _f


def chk_total_resumo(cat, itens):
    """O resumo mostra o total = soma da regra (retirada, sem taxa)."""
    total = sum((cat.precificar(ids, t, ads).preco_unit for ids, t, ads in itens), Decimal("0"))
    return chk_fala(brl(total), desc=f"resumo com total R$ {brl(total)}")


def chk_nao_registrou(res, estado, texto):
    acoes = [e.get("action") for e in ((res.trace or {}).get("events") or [])]
    return Checagem("registrar_pedido" not in acoes, f"NÃO fechou o pedido sem um sim (ações={acoes})")


def chk_pedido_registrado(res, estado, texto):
    eventos = (res.trace or {}).get("events") or []
    acoes = [e.get("action") for e in eventos]
    return Checagem("registrar_pedido" in acoes, f"registrou o pedido (simulado): ações={acoes}")


def roteiros_da_loja(cat, formas=None) -> list[Roteiro]:
    pizzas = [p for p in cat.produtos if p.tamanhos and "pizza" in _n(p.categoria)]
    if not pizzas:
        return []
    out: list[Roteiro] = []
    a = pizzas[0]
    tam_a = a.tamanhos[-1][0]          # maior tamanho
    preco_a = a.tamanhos[-1][1]

    # Perguntas sobre o cardápio
    out.append(Roteiro("pergunta_tamanhos", [
        Turno("oi"),
        Turno(f"quais tamanhos tem a pizza de {curto(a.nome)}?",
              [chk_fala(*[t for t, _ in a.tamanhos], todos=True, desc="cita todos os tamanhos")]),
    ]))
    out.append(Roteiro("pergunta_preco", [
        Turno("oi"),
        Turno(f"quanto custa a {curto(a.nome)} {TAM_EXTENSO.get(_n(tam_a), tam_a)}?", [chk_preco_na_fala(preco_a)]),
    ]))
    # Vários sabores na mesma conversa: cada preço tem que ser o do sabor certo
    outros = [p for p in pizzas[1:4]]
    if outros:
        turnos = [Turno("oi")]
        for p in outros:
            tp, vp = p.tamanhos[0]
            turnos.append(Turno(f"e a {curto(p.nome)} {TAM_EXTENSO.get(_n(tp), tp)}, quanto é?", [chk_preco_na_fala(vp)]))
        out.append(Roteiro("precos_varios_sabores", turnos))
    com_desc = next((p for p in pizzas if len((p.descricao or "").split()) >= 3), None)
    if com_desc:
        palavras = [w.strip(",.") for w in com_desc.descricao.split() if len(w.strip(",.")) >= 5][:3]
        out.append(Roteiro("pergunta_ingredientes", [
            Turno("oi"),
            Turno(f"o que vem na {curto(com_desc.nome)}?", [chk_fala(*palavras, desc="cita ingredientes do cadastro")]),
        ]))
    if len(pizzas) >= 2:
        p1, p2 = pizzas[0], pizzas[1]
        t1, t2 = p1.tamanhos[0][0], p2.tamanhos[-1][0]

        def _chk_duas(res, estado, texto, p1=p1, p2=p2, t1=t1, t2=t2):
            ok1 = any(_ids(i) == [p1.id] and _n(i.get("tamanho")) == _n(t1) for i in _carrinho(estado))
            ok2 = any(_ids(i) == [p2.id] and _n(i.get("tamanho")) == _n(t2) for i in _carrinho(estado))
            resumo = [(i.get("nome"), i.get("tamanho")) for i in _carrinho(estado)]
            return Checagem(ok1 and ok2, f"{curto(p1.nome)} {t1} + {curto(p2.nome)} {t2} inteiras: {resumo}")
        out.append(Roteiro("duas_inteiras_tamanhos_diferentes", [
            Turno("oi"),
            Turno(f"quero uma {curto(p1.nome)} {TAM_EXTENSO.get(_n(t1), t1)} e uma {curto(p2.nome)} "
                  f"{TAM_EXTENSO.get(_n(t2), t2)}", [_chk_duas]),
        ]))

    if a.aceita_meia():
        resp_meia = chk_fala("sim", "pode", "aceita", "da para", "dá pra", "meio a meio", "meia")
        nao_meia = chk_nao_fala("nao fazemos meia", "nao aceita meia", "nao trabalhamos com meia", "so inteira")
    else:
        resp_meia = chk_fala("nao", "não", "inteira", "infelizmente")
        nao_meia = chk_nao_fala("pode ser meia", "aceita meia", "fazemos meia")
    out.append(Roteiro("pergunta_meia", [
        Turno("oi"),
        Turno(f"a pizza de {curto(a.nome)} pode ser meio a meio?", [resp_meia, nao_meia]),
    ]))
    ads = cat.adicionais_de(a)
    if ads:
        out.append(Roteiro("pergunta_adicionais", [
            Turno("oi"),
            Turno(f"quais adicionais ou bordas tem pra pizza de {curto(a.nome)}?",
                  [chk_fala(*[x.nome for x in ads[:2]], desc="cita adicionais do cadastro")]),
        ]))
    else:
        out.append(Roteiro("pergunta_adicionais_sem_cadastro", [
            Turno("oi"),
            Turno("vocês têm borda recheada?",
                  [chk_nao_fala("catupiry r$", "cheddar r$", "borda recheada por r$", desc="não inventa borda com preço")]),
        ]))

    # Meio a meio
    pares_ok = [
        (x, y, t) for x, y in itertools.combinations(pizzas, 2)
        for t, _ in x.tamanhos
        if x.aceita_meia() and y.aceita_meia() and y.tamanho(t) is not None and _n(x.categoria) == _n(y.categoria)
    ]
    if pares_ok:
        x, y, t = pares_ok[-1]
        out.append(Roteiro("meia_direta", [
            Turno("oi"),
            Turno(f"quero uma pizza meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)}",
                  [chk_item_meia(cat, x, y, t)]),
        ]))
        x2, y2, t2 = pares_ok[0]
        out.append(Roteiro("meia_metade", [
            Turno("boa noite"),
            Turno(f"me vê uma {TAM_EXTENSO.get(_n(t2), t2)} metade {curto(x2.nome)} e metade {curto(y2.nome)}",
                  [chk_item_meia(cat, x2, y2, t2)]),
        ]))
        out.append(Roteiro("meia_fluxo_completo", [
            Turno("oi"),
            Turno(f"quero uma meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)}",
                  [chk_item_meia(cat, x, y, t)]),
            Turno("não, só isso"),
            Turno("vou retirar"),
            Turno("dinheiro", [chk_total_resumo(cat, [([x.id, y.id], t, [])])]),
            Turno("não preciso de troco", [chk_nao_registrou]),
            Turno("sim, pode fechar", [chk_pedido_registrado]),
        ]))
        # Preço da meia perguntado (sem pedir)
        preco_meia = cat.precificar([x.id, y.id], t).preco_unit
        out.append(Roteiro("meia_pergunta_preco", [
            Turno("oi"),
            Turno(f"quanto fica uma pizza meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)}?",
                  [chk_preco_na_fala(preco_meia)]),
        ]))
        # Pede E pergunta o preço na mesma frase: anota e responde o valor
        preco_x = x.tamanho(t)[1] if x.tamanho(t) else None
        if preco_x is not None:
            out.append(Roteiro("pede_e_pergunta_preco", [
                Turno("oi"),
                Turno(f"quero uma {curto(x.nome)} {TAM_EXTENSO.get(_n(t), t)}, quanto fica?",
                      [chk_preco_na_fala(preco_x), chk_nao_fala("pelo sistema", "o sistema informa", "aparece no sistema")]),
                Turno(f"e quanto fica se for meia {curto(x.nome)} meia {curto(y.nome)}?",
                      [chk_preco_na_fala(preco_meia)]),
            ]))
        # Troca de tamanho da meia já anotada: o carrinho acompanha e repreça
        tams_comuns = [tt for tt, _ in x.tamanhos if y.tamanho(tt) is not None]
        if len(tams_comuns) >= 2:
            t_ini, t_fim = tams_comuns[0], tams_comuns[-1]
            out.append(Roteiro("meia_troca_tamanho", [
                Turno("oi"),
                Turno(f"quero meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t_ini), t_ini)}",
                      [chk_item_meia(cat, x, y, t_ini)]),
                Turno(f"muda pra {TAM_EXTENSO.get(_n(t_fim), t_fim)}", [chk_item_meia(cat, x, y, t_fim)]),
            ]))
        # Meia + uma inteira na mesma mensagem
        z = next((p for p in pizzas if p.id not in (x.id, y.id) and p.tamanho(t) is not None), None)
        if z is not None:
            def _chk_inteira(res, estado, texto, z=z, t=t):
                ok = any(_ids(i) == [z.id] and _n(i.get("tamanho")) == _n(t) for i in _carrinho(estado))
                return Checagem(ok, f"também tem 1x {curto(z.nome)} {t} inteira")
            out.append(Roteiro("meia_mais_inteira", [
                Turno("oi"),
                Turno(f"quero uma meia {curto(x.nome)} meia {curto(y.nome)} e uma {curto(z.nome)}, as duas "
                      f"{TAM_EXTENSO.get(_n(t), t)}", [chk_item_meia(cat, x, y, t), _chk_inteira]),
            ]))
        # Jeito real de escrever: erro de digitação, abreviação, "mei a mei"
        out.append(Roteiro("meia_digitacao", [
            Turno("oii"),
            Turno(f"qro 1 pizza mei a mei {curto(x.nome).lower()} c {curto(y.nome).lower()} "
                  f"{'grandi' if _n(t) == 'g' else TAM_EXTENSO.get(_n(t), t)}",
                  [chk_item_meia(cat, x, y, t)]),
        ]))

        def _chk_qtd(qtd, x=x, y=y, t=t):
            def _f(res, estado, texto):
                it = next((i for i in _carrinho(estado) if set(_ids(i)) == {x.id, y.id}), None)
                n = int((it or {}).get("qtd") or 0)
                return Checagem(n == qtd, f"meia {curto(x.nome)}/{curto(y.nome)} com qtd {qtd} (achou {n})")
            return _f

        out.append(Roteiro("duas_meias_iguais", [
            Turno("oi"),
            Turno(f"quero 2 pizzas meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)}",
                  [_chk_qtd(2)]),
        ]))
        out.append(Roteiro("meia_remover", [
            Turno("oi"),
            Turno(f"quero meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)}",
                  [chk_item_meia(cat, x, y, t)]),
            Turno("pensando bem, tira essa pizza",
                  [lambda res, est, tx: Checagem(not _carrinho(est), f"carrinho vazio (achou {_carrinho(est)})")]),
        ]))
        ads_meia = cat.adicionais_de(x)
        if ads_meia:
            ad_m = next((a for a in ads_meia if a.preco > 0), ads_meia[0])

            def _chk_meia_ad(res, estado, texto, x=x, y=y, t=t, ad=ad_m.nome):
                esperado = cat.precificar([x.id, y.id], t, [ad])
                for it in _carrinho(estado):
                    if set(_ids(it)) == {x.id, y.id}:
                        tem = any(_n(a) == _n(ad) for a in (it.get("adicionais") or []))
                        pc = it.get("preco_congelado")
                        ok = tem and (pc is None or abs(Decimal(str(pc)) - esperado.preco_unit) <= Decimal("0.01"))
                        return Checagem(ok, f"meia + {ad} (tem={tem} preço={pc} esperado={esperado.preco_unit})")
                return Checagem(False, f"meia + {ad} não está no carrinho")
            out.append(Roteiro("meia_com_adicional", [
                Turno("oi"),
                Turno(f"quero meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)} "
                      f"com {ad_m.nome.lower()}", [_chk_meia_ad]),
            ]))
        out.append(Roteiro("meia_entrega", [
            Turno("oi"),
            Turno(f"quero meia {curto(x.nome)} meia {curto(y.nome)} {TAM_EXTENSO.get(_n(t), t)} pra entrega",
                  [chk_item_meia(cat, x, y, t)]),
            Turno("não, só isso"),
            Turno("rua das flores 120, centro"),
            Turno("pix na entrega", [chk_fala(brl(cat.precificar([x.id, y.id], t).preco_unit),
                                             desc="resumo com o preço da meia")]),
        ]))
        aceitam_nomes = [curto(p.nome) for p in pizzas if p.aceita_meia()]
        out.append(Roteiro("quais_sabores_meia", [
            Turno("oi"),
            Turno("quais sabores posso fazer meio a meio?",
                  [chk_fala(*aceitam_nomes[:2], todos=True, desc="cita sabores que aceitam meia")]),
        ]))
        # tamanho que não existe em um dos sabores
        for p, q in itertools.permutations(pizzas, 2):
            if not (p.aceita_meia() and q.aceita_meia()):
                continue
            so_em_q = [tq for tq, _ in q.tamanhos if p.tamanho(tq) is None]
            if so_em_q:
                tq = so_em_q[0]
                out.append(Roteiro("meia_tamanho_inexistente", [
                    Turno("oi"),
                    Turno(f"quero meia {curto(p.nome)} meia {curto(q.nome)} {TAM_EXTENSO.get(_n(tq), tq)}",
                          [chk_sem_tamanho(tq)]),
                ]))
                break
        trio = [p for p in pizzas if p.aceita_meia()][:3]
        if len(trio) == 3 and min(p.meia_max_sabores for p in trio) < 3:
            out.append(Roteiro("tres_sabores", [
                Turno("oi"),
                Turno(f"quero uma pizza grande com 3 sabores: {', '.join(curto(p.nome) for p in trio)}",
                      [lambda res, est, tx: Checagem(
                          not any(len(_ids(i)) >= 3 for i in _carrinho(est)),
                          "nenhuma pizza de 3 sabores no carrinho")]),
            ]))
    # Loja/sabor que não aceita meia
    nao = [p for p in pizzas if not p.aceita_meia()]
    if len(nao) >= 2 or (nao and pizzas):
        p1 = nao[0]
        p2 = next((p for p in pizzas if p.id != p1.id), None)
        if p2:
            t = next((tt for tt, _ in p1.tamanhos if p2.tamanho(tt) is not None), p1.tamanhos[-1][0])
            out.append(Roteiro("meia_nao_permitida", [
                Turno("oi"),
                Turno(f"quero meia {curto(p1.nome)} meia {curto(p2.nome)} {TAM_EXTENSO.get(_n(t), t)}",
                      [chk_sem_meia, chk_nao_fala("anotei: 1x pizza meia", desc="não anota meia")]),
            ]))

    # Adicional
    if ads:
        ad = next((x for x in ads if x.preco > 0), ads[0])
        out.append(Roteiro("pedido_com_adicional", [
            Turno("oi"),
            Turno(f"quero uma {curto(a.nome)} {TAM_EXTENSO.get(_n(tam_a), tam_a)} com {ad.nome.lower()}",
                  [chk_adicional(cat, a, tam_a, ad.nome)]),
        ]))

    # Pedido simples completo (e a pergunta de pagamento oferece o que a loja aceita)
    chk_pag = [chk_fala("pix", desc="oferece o Pix cadastrado")] if "pix" in [_n(f) for f in (formas or [])] else []
    out.append(Roteiro("inteira_fluxo_completo", [
        Turno("oi"),
        Turno(f"quero uma {curto(a.nome)} {TAM_EXTENSO.get(_n(tam_a), tam_a)}"),
        Turno("não, só isso"),
        Turno("vou retirar", chk_pag),
        Turno("dinheiro", [chk_total_resumo(cat, [([a.id], tam_a, [])])]),
        Turno("não preciso de troco", [chk_nao_registrou]),
        Turno("sim, pode fechar", [chk_pedido_registrado]),
    ]))
    return out


async def _reset(db, pid, tel):
    from sqlalchemy import text
    for tabela in ("agente_memoria", "atendimento_estado"):
        await db.execute(text(f"DELETE FROM public.{tabela} WHERE pizzaria_id = :pid AND telefone = :tel"),
                         {"pid": str(pid), "tel": tel})
    await db.commit()


async def rodar_roteiro(pizzaria_id, roteiro: Roteiro, verbose: bool) -> list[str]:
    from app.agent.fsm.pipeline import run_fsm_agent
    from app.db import AsyncSessionLocal
    from app.services.conversation_state import load_state

    tel = f"sim:audit:{uuid.uuid4().hex[:16]}"
    falhas: list[str] = []
    async with AsyncSessionLocal() as db:
        await _reset(db, pizzaria_id, tel)
        try:
            for i, turno in enumerate(roteiro.turnos, 1):
                t0 = time.perf_counter()
                try:
                    res = await run_fsm_agent(db, pizzaria_id, tel, turno.diz, simulation=True)
                except Exception as e:  # noqa: BLE001
                    falhas.append(f"turno {i} {turno.diz!r}: EXCEÇÃO {type(e).__name__}: {e}")
                    await db.rollback()
                    break
                dt = time.perf_counter() - t0
                texto = (res.texto or "") if res else ""
                estado = await load_state(db, pizzaria_id, tel)
                if verbose:
                    print(f"      {i}. {turno.diz}\n         → {texto[:300]!r} ({dt:.1f}s)")
                if dt > 12:
                    falhas.append(f"turno {i} {turno.diz!r}: lento ({dt:.1f}s)")
                for c in turno.checar:
                    r = c(res, estado, texto)
                    if r and not r.ok:
                        falhas.append(f"turno {i} {turno.diz!r}: {r.descricao} | resposta: {texto[:220]!r}")
        finally:
            await _reset(db, pizzaria_id, tel)
    return falhas


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loja", default="")
    ap.add_argument("--so-regra", action="store_true")
    ap.add_argument("--roteiro", default="")
    ap.add_argument("--repeticoes", type=int, default=1)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    from sqlalchemy import select

    from app.agent.fsm.catalogo import carregar_catalogo
    from app.db import AsyncSessionLocal
    from app.models import Pizzaria, Produto

    async with AsyncSessionLocal() as db:
        lojas = (await db.execute(select(Pizzaria))).scalars().all()
        lojas = [p for p in lojas if _n(args.loja) in _n(p.nome)]
        cats = {}
        for p in lojas:
            orm = (await db.execute(select(Produto).where(Produto.pizzaria_id == p.id))).scalars().all()
            cats[p.id] = (p.nome, await carregar_catalogo(db, p), list(orm), list(p.adicionais or []),
                          list(p.formas_pagamento_aceitas or []))

    total_falhas = 0
    total_checks = 0
    for pid, (nome, cat, orm, globais, formas) in cats.items():
        print(f"\n=== {nome} ({len(cat.produtos)} produtos)")
        regra = auditar_regra(cat)
        print(f"  [A] regra de meio a meio/preço: {'OK' if not regra else f'{len(regra)} FALHA(S)'}")
        for f in regra:
            print(f"      - {f}")
        total_falhas += len(regra)
        checkout = auditar_checkout(orm, globais)
        print(f"  [C] tela do cardápio × checkout: {'OK' if not checkout else f'{len(checkout)} FALHA(S)'}")
        for f in checkout[:15]:
            print(f"      - {f}")
        total_falhas += len(checkout)
        if args.so_regra:
            continue
        for rot in roteiros_da_loja(cat, formas):
            if args.roteiro and rot.nome != args.roteiro:
                continue
            for rep in range(args.repeticoes):
                falhas = await rodar_roteiro(pid, rot, args.verbose)
                total_checks += 1
                rot_id = rot.nome + (f" #{rep + 1}" if args.repeticoes > 1 else "")
                print(f"  [B] {rot_id}: {'OK' if not falhas else 'FALHA'}")
                for f in falhas:
                    print(f"      - {f}")
                total_falhas += len(falhas)
    print(f"\nRESUMO: {total_checks} conversas, {total_falhas} falha(s)")
    return 1 if total_falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
