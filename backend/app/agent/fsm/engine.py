"""
Camada 2 — Engine/FSM determinística.

Recebe a saída da NLU + o estado da conversa e DECIDE tudo no backend, sem deixar
a LLM no controle: monta o carrinho, resolve preços reais (reaproveitando os
serviços de pedido já testados), calcula taxa, avança a etapa do funil e registra
o pedido quando confirmado. Devolve uma "decisão" estruturada para a camada de voz.
"""
from __future__ import annotations

import logging
import re as _re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import AgentContext

log = logging.getLogger(__name__)

# Acima disto, quantidade de um mesmo item vai pra equipe confirmar.
LIMITE_QTD_ITEM = 20

ETAPAS = ("SAUDACAO", "COLETA_ITENS", "ENTREGA", "ENDERECO", "PAGAMENTO", "AGUARDANDO_CONFIRMACAO", "FINALIZADO")


def estado_inicial() -> dict[str, Any]:
    return {
        "pipeline": "fsm", "etapa": "SAUDACAO", "carrinho": [],
        "tipo": None, "endereco": None, "pagamento": None, "pagar_agora": None,
        "cardapio_enviado": False, "cardapio_ofertado": False,
        "apresentou": False, "upsell_feito": False,
        "upsell_ofertas": 0, "upsell_ultimo_tamanho": 0,
        "observacoes": None,
    }


def resumo_estado(estado: dict[str, Any]) -> str:
    """Texto curto do estado pra dar contexto à NLU."""
    c = estado.get("carrinho") or []
    itens = "; ".join(
        f"{i.get('qtd',1)}x {i.get('nome') or ' / '.join(i.get('sabores') or [])}"
        + (f" ({i.get('tamanho')})" if i.get("tamanho") else "")
        for i in c
    ) or "(vazio)"
    obs = f"; observacoes={estado.get('observacoes')}" if estado.get("observacoes") else ""
    return (
        f"etapa={estado.get('etapa')}; carrinho={itens}; tipo={estado.get('tipo')}; "
        f"endereco={'sim' if estado.get('endereco') else 'nao'}; pagamento={estado.get('pagamento')}; "
        f"pagar_agora={estado.get('pagar_agora')}{obs}"
    )


def _chave_item(nome: str | None, sabores: list[str]) -> str:
    """Identidade do item no carrinho. Os sabores entram SEMPRE: a NLU manda meio
    a meio com nome genérico ("pizza") + sabores, e só o nome fazia duas meias
    diferentes no mesmo pedido virarem uma pizza só."""
    import unicodedata
    base = " ".join([nome or "", *sorted(s.strip() for s in (sabores or []))]).strip().lower()
    return "".join(c for c in unicodedata.normalize("NFD", base) if unicodedata.category(c) != "Mn")


def _normalizar_txt(s: Any) -> str:
    """Minúsculas, sem acento e espaço simples — para casar nomes digitados."""
    import unicodedata
    base = "".join(
        c for c in unicodedata.normalize("NFD", str(s or "").strip().lower())
        if unicodedata.category(c) != "Mn"
    )
    return _re.sub(r"\s+", " ", base)


def _descongelar(item: dict[str, Any]) -> None:
    """Remove o preço congelado de um item (força re-resolução no próximo cálculo)."""
    item.pop("preco_congelado", None)
    item.pop("nome_congelado", None)


def _congelar_precos(estado: dict[str, Any], calc: dict[str, Any]) -> None:
    """BLINDAGEM (Pilar 1): grava no carrinho o preço/nome JÁ resolvido pelo backend,
    pra que os próximos turnos reutilizem o MESMO valor (preço estável)."""
    itens = calc.get("itens") or []
    carrinho = estado.get("carrinho") or []
    for i, ci in enumerate(carrinho):
        if i >= len(itens) or not isinstance(itens[i], dict):
            continue
        pu = itens[i].get("preco_unit")
        nm = itens[i].get("nome")
        if isinstance(pu, (int, float)) and not isinstance(pu, bool) and pu > 0 and nm:
            ci["preco_congelado"] = round(float(pu), 2)
            ci["nome_congelado"] = nm


def _fmt_brl(v: float) -> str:
    """Formata em Real no padrão BR (vírgula decimal)."""
    return ("R$ %0.2f" % float(v)).replace(".", ",")


def _montar_resumo_msg(itens_norm: list[dict[str, Any]], taxa: float, total: float,
                       tipo: str | None, endereco: str | None,
                       pagamento: str | None, pagar_agora: bool | None,
                       observacoes: str | None) -> str:
    """BLINDAGEM (Pilar 2): texto do RESUMO montado 100% pelo backend (verbatim).
    A LLM não toca nesses números."""
    linhas = ["Fechando seu pedido 📝", ""]
    for it in itens_norm:
        linhas.append(f"• {it['quantidade']}x {it['nome']} — {_fmt_brl(it['preco_unit'])}")
    if tipo == "delivery" and taxa and taxa > 0:
        linhas.append(f"Entrega: {_fmt_brl(taxa)}")
    linhas.append(f"*Total: {_fmt_brl(total)}*")
    linhas.append("")
    if tipo == "delivery":
        linhas.append(f"📍 Entrega: {endereco or '(endereço a confirmar)'}")
    elif tipo == "retirada":
        linhas.append("🏪 Retirada no balcão")
    if pagamento:
        nomes = {"pix": "Pix", "cartao": "Cartão", "dinheiro": "Dinheiro"}
        quando = ""
        if pagamento in ("pix", "cartao"):
            if pagar_agora:
                quando = " (agora pela conversa)"
            else:
                quando = " (na retirada)" if tipo == "retirada" else " (na entrega)"
        linhas.append(f"💳 Pagamento: {nomes.get(pagamento, pagamento)}{quando}")
    if observacoes:
        linhas.append(f"📝 Obs: {observacoes}")
    linhas.append("")
    linhas.append("Posso fechar o pedido? 😊")
    return "\n".join(linhas)


def _montar_registro_msg(numero: Any, tempo: str | None, metodo_cobr: str | None,
                         cobr_ok: bool) -> str:
    """BLINDAGEM (Pilar 2): texto do FECHAMENTO montado pelo backend (verbatim)."""
    linhas = [f"Pedido #{numero} fechado! 🍕"]
    if tempo:
        linhas.append(f"Fica pronto em aproximadamente {tempo}.")
    if cobr_ok and metodo_cobr == "pix":
        linhas.append("O QR e o código Pix estão aí em cima — assim que o pagamento cair, eu confirmo pra você! 😊")
    elif cobr_ok and metodo_cobr == "pix_manual":
        linhas.append("O código Pix está aí em cima — é só pagar e me mandar o comprovante que a equipe confirma! 😊")
    elif cobr_ok and metodo_cobr:
        linhas.append("O link de pagamento está aí em cima — é só finalizar por lá. 😊")
    else:
        linhas.append("Qualquer coisa, é só me chamar. 😊")
    return "\n".join(linhas)


import re as _re_rem

# Termos genéricos de bebida — o cliente raramente diz o nome exato ("Coca Cola 2L"),
# fala "o refrigerante", "a bebida", "o refri". Usado pra casar remoção por categoria.
_BEBIDA_KW = (
    "refrigerante", "refri", "bebida", "suco", "agua", "água", "coca", "guarana",
    "guaraná", "fanta", "sprite", "soda", "cerveja", "chopp", "lata", "garrafa",
    "tubaina", "tubaína", "pepsi", "schweppes", "h2o",
)


def _termo_de_bebida(s: str) -> bool:
    s = (s or "").lower()
    return any(k in s for k in _BEBIDA_KW)


def _item_texto(it: dict[str, Any]) -> str:
    return ((it.get("nome") or "") + " " + " ".join(it.get("sabores") or [])).lower().strip()


def _inferir_remocao(user_input: str, carrinho: list[dict[str, Any]]) -> list[str]:
    """Quando o cliente quer remover mas a NLU não especificou O QUÊ: descobre do
    texto qual item do carrinho ele quer tirar (cita um pedaço do nome, ou fala
    genérico de bebida e o item é bebida)."""
    t = (user_input or "").lower()
    if not t or not carrinho:
        return []
    fala_bebida = _termo_de_bebida(t)
    alvos: list[str] = []
    for it in carrinho:
        nome_full = _item_texto(it)
        if not nome_full:
            continue
        palavras = [w for w in _re_rem.split(r"\W+", nome_full) if len(w) >= 3]
        cita_nome = any(w in t for w in palavras)
        if cita_nome or (fala_bebida and _termo_de_bebida(nome_full)):
            alvos.append(it.get("nome") or nome_full)
    return alvos


_QTD_NO_NOME_RE = _re.compile(
    r"(\d{1,2})\s*x?\s+(?!(?:queijos?|sabores?|litros?|l|ml|carnes?|cortes?|peda[cç]os?|fatias?)\b)(.+)",
    _re.IGNORECASE,
)


_PECHINCHA_RE = _re.compile(
    r"\b(faz|faria|deixa|fecha|sai|consegue|pode ser)\b[^0-9]{0,20}\b(por|em|a)\s*(r\$\s*)?\d+"
    r"|\bdesconto\b|\babatimento\b|mais barat|\babaixa\b|\bbaixar? o (preco|valor)\b|\bchorinho\b"
)
_SO_ISSO_RE = _re.compile(r"(e |eh )?(so|somente|apenas) isso( mesmo| msm| por enquanto)?|nada mais|mais nada|e isso|eh isso")


def _novo_iid(estado: dict[str, Any]) -> str:
    seq = int(estado.get("seq_item") or 0) + 1
    estado["seq_item"] = seq
    return f"I{seq}"


def _aplicar_ops_itens(estado: dict[str, Any], ops: list[dict[str, Any]]) -> None:
    """Operações da NLU de comandos sobre itens JÁ no carrinho, pelo ID do item.

    Determinístico e sem adivinhação por nome: "na verdade são 3" chega como
    definir_qtd(I1, 3); "tira a coca", como remover(I2). Antes o engine deduzia a
    intenção a partir de "produtos: [...]" e errava (quantidade ignorada, remoção
    que casava dois itens pelo pedaço do nome)."""
    for op in ops or []:
        if not isinstance(op, dict):
            continue
        item = next(
            (it for it in estado.get("carrinho") or [] if isinstance(it, dict) and it.get("iid") == op.get("iid")),
            None,
        )
        if item is None:
            continue
        acao = op.get("op")
        qtd = op.get("qtd")
        if acao == "remover" or (acao == "definir_qtd" and qtd == 0):
            estado["carrinho"] = [it for it in estado["carrinho"] if it is not item]
        elif acao == "definir_qtd" and isinstance(qtd, int) and qtd > 0:
            item["qtd"] = qtd
        elif acao == "somar_qtd" and isinstance(qtd, int) and qtd > 0:
            item["qtd"] = int(item.get("qtd") or 1) + qtd
        elif acao == "trocar_tamanho" and op.get("tamanho"):
            item["tamanho"] = op["tamanho"]
            _descongelar(item)
        elif acao == "adicionar_adicional" and op.get("adicionais"):
            atuais = list(item.get("adicionais") or [])
            for a in op["adicionais"]:
                if _normalizar_txt(a) not in {_normalizar_txt(x) for x in atuais}:
                    atuais.append(a)
            item["adicionais"] = atuais
            _descongelar(item)
        elif acao == "remover_adicional" and op.get("adicionais"):
            tirar = {_normalizar_txt(a) for a in op["adicionais"]}
            item["adicionais"] = [a for a in (item.get("adicionais") or []) if _normalizar_txt(a) not in tirar]
            _descongelar(item)


def _aplicar_nlu(estado: dict[str, Any], dados: dict[str, Any]) -> None:
    """Funde os dados extraídos pela NLU no estado (carrinho e campos)."""
    _aplicar_ops_itens(estado, dados.get("_ops_itens") or [])
    # Adicionar produtos — com MERGE: se já existe item com o mesmo nome/sabores,
    # NÃO duplica; só completa o que faltava (tamanho/adicionais). Isso evita o
    # bug de "the pizza" + "quero a GG" virar 2 pizzas.
    for p in (dados.get("produtos") or []):
        if not isinstance(p, dict):
            continue
        nome = (p.get("nome") or "").strip()
        # "3 cheese classico" (sem "quero") vinha com a quantidade DENTRO do nome e
        # qtd 1: o carrinho ficava "1x 3 cheese classico" e cobrava um só. O número
        # que faz parte do nome ("4 queijos", "2 litros") fica onde está.
        m_qtd = _QTD_NO_NOME_RE.match(nome)
        # Nome vindo do catálogo (tem produto_id) é exato — "2 Hambúrgueres + Refri"
        # é o nome do combo, não quantidade.
        if m_qtd and not p.get("produto_id") and int(p.get("qtd") or 1) == 1:
            p = {**p, "qtd": int(m_qtd.group(1))}
            nome = m_qtd.group(2).strip()
        sabores = [s for s in (p.get("sabores_meia") or []) if s]
        # "Meio a meio" de UM sabor é a pizza inteira desse sabor. A NLU manda
        # "calabresa e frango" (2 pizzas) como duas meias de um sabor cada, e o
        # resumo saía "Pizza Meia Calabresa" para uma pizza inteira.
        if len(sabores) == 1:
            from app.agent.tools import eh_termo_generico
            if not nome or eh_termo_generico(nome):
                nome = sabores[0]
            sabores = []
        if not nome and not sabores:
            continue
        tamanho = (p.get("tamanho") or None)
        adicionais = [a for a in (p.get("adicionais") or []) if a]
        chave = _chave_item(nome, sabores)

        ids_p = [str(x) for x in (p.get("sabores_ids") or [])] or ([str(p["produto_id"])] if p.get("produto_id") else [])
        if ids_p:
            # Item do catálogo: identidade = produto(s) + tamanho. "2 calabresa G e
            # 1 calabresa M" são DOIS itens — pela chave só de nome viravam um
            # ("2x calabresa (M)") e "tira a M" apagava tudo. Esclarecer o tamanho
            # de um item é o comando trocar_tamanho, não um "adicionar" repetido.
            def _ids(it: dict[str, Any]) -> list[str]:
                return [str(x) for x in (it.get("sabores_ids") or [])] or (
                    [str(it["produto_id"])] if it.get("produto_id") else []
                )
            existente = next(
                (
                    it for it in estado["carrinho"]
                    if sorted(_ids(it)) == sorted(ids_p)
                    and (not tamanho or not it.get("tamanho") or _normalizar_txt(it.get("tamanho")) == _normalizar_txt(tamanho))
                ),
                None,
            )
        else:
            existente = next(
                (it for it in estado["carrinho"] if _chave_item(it.get("nome"), it.get("sabores") or []) == chave),
                None,
            )
        if existente is None and p.get("qtd_modo") in ("definir", "somar"):
            # Correção de quantidade cita o item pela metade ("muda pra 3 smash"):
            # casa pelo pedaço do nome, desde que só UM item do carrinho case —
            # senão viraria um item novo "smash" ao lado do "smash duplo".
            alvo = _normalizar_txt(nome or " ".join(sabores))
            casados = [
                it for it in estado["carrinho"]
                if alvo and (alvo in _normalizar_txt(_item_texto(it)) or _normalizar_txt(_item_texto(it)) in alvo)
            ]
            if len(casados) == 1:
                existente = casados[0]
        if existente is not None:
            # Esclarecimento do mesmo item: atualiza tamanho/adicionais, não duplica.
            mudou = False
            for k in ("produto_id", "sabores_ids"):
                if p.get(k) and existente.get(k) != p[k]:
                    existente[k] = p[k]
                    mudou = True
            if tamanho and existente.get("tamanho") != tamanho:
                existente["tamanho"] = tamanho
                mudou = True
            if adicionais:
                antes = set(existente.get("adicionais") or [])
                existente["adicionais"] = list({*antes, *adicionais})
                if set(existente["adicionais"]) != antes:
                    mudou = True
            # Quantidade só muda quando o cliente pede: "na verdade são 3" (definir)
            # ou "mais uma igual" (somar). Antes a qtd do item repetido era sempre
            # ignorada — a voz dizia "três" e o carrinho seguia com 2.
            try:
                qtd_nova = int(p.get("qtd") or 0)
            except (TypeError, ValueError):
                qtd_nova = 0
            if qtd_nova > 0 and p.get("qtd_modo") == "definir":
                existente["qtd"] = qtd_nova
            elif qtd_nova > 0 and p.get("qtd_modo") == "somar":
                existente["qtd"] = int(existente.get("qtd") or 1) + qtd_nova
            if mudou:
                _descongelar(existente)  # item mudou → re-resolver o preço
            continue

        novo = {
            "iid": _novo_iid(estado),
            "nome": nome or None,
            "sabores": sabores,
            "tamanho": tamanho,
            "qtd": int(p.get("qtd") or 1),
            "adicionais": adicionais,
        }
        # ID do catálogo (NLU de comandos): o preço sai por ID, sem busca por nome.
        if p.get("produto_id"):
            novo["produto_id"] = p["produto_id"]
        if p.get("sabores_ids"):
            novo["sabores_ids"] = list(p["sabores_ids"])
        estado["carrinho"].append(novo)
    # Remover produtos. Match flexível: substring em qualquer direção OU termo
    # genérico de bebida (ex.: "refrigerante", "refri") removendo o item que É uma
    # bebida — o cliente quase nunca diz o nome exato "Coca Cola 2L".
    for rem in (dados.get("remover") or []):
        alvo = (rem or "").strip().lower()
        if not alvo:
            continue
        alvo_eh_bebida = _termo_de_bebida(alvo)
        novo_carrinho = []
        for it in estado["carrinho"]:
            nome_full = _item_texto(it)
            casou = bool(nome_full) and (
                alvo in nome_full
                or nome_full in alvo
                or (alvo_eh_bebida and _termo_de_bebida(nome_full))
            )
            if not casou:
                novo_carrinho.append(it)
        estado["carrinho"] = novo_carrinho
    # Se o último item está sem tamanho e a NLU trouxe um tamanho avulso, aplica nele.
    tam_avulso = dados.get("tamanho") if isinstance(dados.get("tamanho"), str) else None
    if tam_avulso and estado["carrinho"]:
        for it in reversed(estado["carrinho"]):
            if not it.get("tamanho"):
                it["tamanho"] = tam_avulso
                _descongelar(it)  # ganhou tamanho → re-resolver o preço
                break

    if dados.get("tipo_entrega") in ("delivery", "retirada"):
        estado["tipo"] = dados["tipo_entrega"]
    end = dados.get("endereco")
    if isinstance(end, dict) and any(end.get(k) for k in ("rua", "numero", "bairro")):
        # Memoriza o bairro confirmado (ex.: veio do reverse geocoding da
        # localização) — atualizações parciais do endereço não podem perdê-lo.
        if end.get("bairro"):
            estado["endereco_bairro"] = str(end["bairro"]).strip()
        if (
            estado.get("endereco")
            and end.get("numero")
            and not end.get("rua")
            and not end.get("bairro")
        ):
            # Só o NÚMERO chegou (complemento do endereço já coletado — ex.:
            # localização do WhatsApp sem número): ANEXA em vez de substituir,
            # senão "123" apagaria a rua/bairro inteiros.
            num = str(end["numero"]).strip()
            if num and f"nº {num}" not in estado["endereco"]:
                estado["endereco"] = f"{estado['endereco']}, nº {num}"
                if end.get("referencia"):
                    estado["endereco"] += f" ({end['referencia']})"
        else:
            # Sem bairro novo, reusa o bairro já confirmado (ex.: cliente mandou
            # "rua 2, número 3" depois da localização → mantém "Santa Bárbara").
            bairro = end.get("bairro") or estado.get("endereco_bairro")
            partes = [end.get("rua"), end.get("numero"), bairro, end.get("referencia")]
            estado["endereco"] = ", ".join(str(x) for x in partes if x)
    if dados.get("forma_pagamento") in ("pix", "cartao", "dinheiro"):
        estado["pagamento"] = dados["forma_pagamento"]
    if isinstance(dados.get("pagar_agora"), bool):
        estado["pagar_agora"] = dados["pagar_agora"]
    if dados.get("observacoes") and isinstance(dados.get("observacoes"), str):
        obs = dados["observacoes"].strip()
        # "só isso" fecha a lista de itens, não é recado pra cozinha — a NLU às
        # vezes mandava pra observação e o pedido saía com "Obs: Só isso."
        if _SO_ISSO_RE.fullmatch(_normalizar_txt(obs).strip(" .!")):
            obs = ""
        if obs:
            if estado.get("observacoes"):
                if obs.lower() not in estado["observacoes"].lower():
                    estado["observacoes"] = f"{estado['observacoes']}, {obs}"
            else:
                estado["observacoes"] = obs


def _online(pagamento: str | None) -> bool:
    return (pagamento or "") in ("pix", "cartao")


def _modo_pagamento(pizz) -> str:
    """Modo de pagamento na conversa: 'automatico' | 'manual' | 'desativado'.
    Default 'automatico' (comportamento histórico)."""
    return getattr(pizz, "modo_pagamento_online", None) or "automatico"


# Recusa explícita ao upsell ("não", "só a pizza", "tá bom assim", "pode fechar").
_RECUSA_UPSELL_RE = _re.compile(
    r"\b(n[aã]o|nada|só (a|o|isso|essa|esse)|so (a|o|isso|essa|esse)|"
    r"t[aá] (bom|certo|ok|tranquilo)|deixa( pra)? (la|lá)|sem mais|"
    r"pode fechar|fechar o pedido|s[oó] (isso|essa|esse))\b",
    _re.IGNORECASE,
)
# Aceite ao upsell ("quero", "sim", "pode", "manda", "aceito", "também"...).
_ACEITA_UPSELL_RE = _re.compile(
    r"^\s*(quero|sim|claro|pode|pode ser|aceito|bora|manda|vou querer|quero sim|"
    r"isso|opa sim|tamb[eé]m|tambem|por que n[aã]o|adoraria|com certeza)\b",
    _re.IGNORECASE,
)


def _afirmou_upsell(intencao: str | None, texto: str) -> bool:
    """True quando o cliente ACEITOU o upsell (quer adicionar algo) — mesmo sem
    dizer o quê. Recusa explícita ('não', 'só a pizza') tem prioridade e vence."""
    t = (texto or "").strip().lower()
    if _RECUSA_UPSELL_RE.search(t):
        return False
    if intencao in ("confirmar_resumo", "adicionar_item"):
        return True
    return bool(_ACEITA_UPSELL_RE.match(t))


async def _opcoes_upsell(ctx: AgentContext, db: AsyncSession) -> dict[str, Any]:
    """Levanta o que a pizzaria REALMENTE tem pra oferecer no upsell: bebidas (do
    cardápio) e bordas/adicionais (cadastro da casa). Só oferecemos o que existe —
    assim a atendente nunca propõe algo que não há. Best-effort."""
    from app.agent.behavior import get_behavior
    vendas = get_behavior(ctx.personalidade).vendas
    bebidas: list[str] = []
    try:
        if not vendas.oferecer_bebida:
            raise LookupError("bebidas desabilitadas")
        from sqlalchemy import text as _text
        rows = (await db.execute(_text(
            "SELECT nome FROM public.produtos "
            "WHERE pizzaria_id = :pid AND disponivel = true "
            "AND (categoria ILIKE '%bebida%' OR categoria ILIKE '%refri%' "
            "     OR categoria ILIKE '%suco%' OR categoria ILIKE '%drink%') "
            "ORDER BY ordem, nome LIMIT 12"
        ), {"pid": str(ctx.pizzaria.id)})).fetchall()
        bebidas = [r[0] for r in rows if r[0]]
    except LookupError:
        pass
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao consultar bebidas p/ upsell: %s", e)

    bordas: list[str] = []
    adicionais: list[str] = []
    candidatos_adic: list[dict[str, Any]] = []
    adic_cfg = getattr(ctx.pizzaria, "adicionais", None)
    if isinstance(adic_cfg, list):
        candidatos_adic.extend([a for a in adic_cfg if isinstance(a, dict)])

    try:
        from sqlalchemy import text as _text
        rows_opc = (await db.execute(_text(
            "SELECT opcoes FROM public.produtos "
            "WHERE pizzaria_id = :pid AND disponivel = true"
        ), {"pid": str(ctx.pizzaria.id)})).fetchall()
        for r in rows_opc:
            if r[0] and isinstance(r[0], dict):
                p_ads = r[0].get("adicionais") or []
                if isinstance(p_ads, list):
                    for a in p_ads:
                        if isinstance(a, dict) and a.get("nome"):
                            candidatos_adic.append(a)
                        elif isinstance(a, str) and a.strip():
                            t = "borda" if "borda" in a.lower() else "adicional"
                            candidatos_adic.append({"nome": a.strip(), "tipo": t})
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao consultar opcoes de produtos p/ upsell: %s", e)

    bordas_vistas: set[str] = set()
    adic_vistos: set[str] = set()
    for a in candidatos_adic:
        if not isinstance(a, dict) or not a.get("nome"):
            continue
        nome = str(a["nome"]).strip()
        nome_lower = nome.lower()
        tipo = (a.get("tipo") or "adicional").lower()
        if ("borda" in tipo or "borda" in nome_lower) and vendas.oferecer_borda:
            if nome_lower not in bordas_vistas:
                bordas_vistas.add(nome_lower)
                bordas.append(nome)
        elif vendas.oferecer_adicional:
            if nome_lower not in adic_vistos:
                adic_vistos.add(nome_lower)
                adicionais.append(nome)

    sobremesas: list[str] = []
    if vendas.oferecer_sobremesa:
        try:
            from sqlalchemy import text as _text
            rows = (await db.execute(_text(
                "SELECT nome FROM public.produtos "
                "WHERE pizzaria_id = :pid AND disponivel = true "
                "AND (categoria ILIKE '%sobremesa%' OR categoria ILIKE '%doce%') "
                "ORDER BY ordem, nome LIMIT 12"
            ), {"pid": str(ctx.pizzaria.id)})).fetchall()
            sobremesas = [r[0] for r in rows if r[0]]
        except Exception as e:  # noqa: BLE001
            log.debug("Falha ao consultar sobremesas p/ upsell: %s", e)

    return {
        "bebidas": bebidas, "bordas": bordas,
        "adicionais": adicionais, "sobremesas": sobremesas,
    }


def _fatos_pizzaria(pizz) -> str:
    """Fatos reais da pizzaria pra voz responder dúvidas (sem inventar)."""
    partes = [f"Pizzaria: {getattr(pizz, 'nome', '') or ''}"]
    endereco = getattr(pizz, "endereco", None)
    maps_url = getattr(pizz, "endereco_maps_url", None)
    if endereco:
        partes.append(f"Endereço: {endereco}")
    if maps_url:
        partes.append(f"Link do endereço no mapa: {maps_url}")
    formas = getattr(pizz, "formas_pagamento_aceitas", None) or []
    if formas:
        partes.append("Pagamentos: " + ", ".join(formas))
    if getattr(pizz, "tempo_entrega_min", None):
        partes.append(f"Entrega ~{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min")
    if getattr(pizz, "tempo_retirada_min", None):
        partes.append(f"Retirada ~{pizz.tempo_retirada_min}-{pizz.tempo_retirada_max} min")
    # O horário vai POR EXTENSO: antes o fato era só "tem horário cadastrado
    # (consulte)" e a voz respondia "vou consultar pra te passar" sem nunca passar.
    hf = getattr(pizz, "horario_funcionamento", None) or {}
    if hf:
        from app.services.business_hours import esta_aberto, formatar_horario
        texto_hf = formatar_horario(hf)
        if texto_hf:
            partes.append("Horário de funcionamento: " + texto_hf.replace("\n", "; ").replace("• ", ""))
            try:
                aberto = esta_aberto(hf, override=getattr(pizz, "aberto_manual", None))
                partes.append("Agora a loja está " + ("ABERTA" if aberto else "FECHADA"))
            except Exception:  # noqa: BLE001
                pass
    base = "DADOS REAIS DA PIZZARIA (use só estes; não invente): " + " · ".join(partes)
    if endereco:
        instr = " | Se o cliente PERGUNTAR o endereço/localização, informe o endereço completo"
        instr += " e envie o link do mapa." if maps_url else "."
        base += instr
    return base


_TITULO_CATEGORIA = {
    "pizza": "Pizzas", "lanche": "Lanches", "bebida": "Bebidas",
    "sobremesa": "Sobremesas", "outro": "Outros",
}


_CATEGORIA_DO_TERMO = {
    "pizza": "pizza", "lanche": "lanche", "hamburguer": "lanche", "hamburger": "lanche",
    "burger": "lanche", "burguer": "lanche", "bebida": "bebida", "refri": "bebida",
    "refrigerante": "bebida", "suco": "bebida", "sobremesa": "sobremesa", "doce": "sobremesa",
}


async def _nomes_da_categoria(ctx: AgentContext, db: AsyncSession, termo: str | None) -> list[str]:
    """Até 8 produtos reais da categoria citada genericamente ("pizzas")."""
    base = _normalizar_txt(termo).rstrip("s")
    categoria = _CATEGORIA_DO_TERMO.get(base) or base
    try:
        from sqlalchemy import text as _text
        rows = (await db.execute(_text(
            "SELECT nome FROM public.produtos WHERE pizzaria_id = :pid AND disponivel = true "
            "AND categoria ILIKE :cat ORDER BY ordem, nome LIMIT 8"
        ), {"pid": str(ctx.pizzaria.id), "cat": f"%{categoria}%"})).fetchall()
        return [r[0] for r in rows if r[0]]
    except Exception:  # noqa: BLE001
        return []


def _link_cardapio(pizz) -> str:
    try:
        from app.config import get_settings
        return get_settings().url_cardapio(getattr(pizz, "slug", None))
    except Exception:  # noqa: BLE001
        return ""


async def _cardapio_em_texto(ctx: AgentContext, db: AsyncSession) -> str | None:
    """Cardápio REAL em texto (produtos disponíveis, por categoria, com o menor
    preço) + o link do cardápio digital. None se não houver produto."""
    from sqlalchemy import text as _text
    rows = (await db.execute(_text(
        "SELECT p.nome, p.categoria, p.preco, "
        "  (SELECT min(pt.preco) FROM public.produto_tamanhos pt "
        "   WHERE pt.produto_id = p.id AND pt.disponivel = true) AS preco_min "
        "FROM public.produtos p WHERE p.pizzaria_id = :pid AND p.disponivel = true "
        # Pratos principais primeiro: em ordem alfabética "Bebidas" abria a lista.
        "ORDER BY CASE lower(coalesce(p.categoria, '')) WHEN 'pizza' THEN 0 WHEN 'lanche' THEN 1 "
        "  WHEN 'bebida' THEN 3 WHEN 'sobremesa' THEN 4 ELSE 2 END, "
        "  p.categoria NULLS LAST, p.ordem, p.nome LIMIT 80"
    ), {"pid": str(ctx.pizzaria.id)})).fetchall()
    if not rows:
        return None
    blocos: list[str] = []
    atual: str | None = None
    for nome, categoria, preco, preco_min in rows:
        cat = (categoria or "outro").strip().lower()
        if cat != atual:
            atual = cat
            blocos.append(f"\n*{_TITULO_CATEGORIA.get(cat, cat.capitalize())}*")
        if preco_min is not None:
            blocos.append(f"• {nome} — a partir de {_fmt_brl(float(preco_min))}")
        else:
            blocos.append(f"• {nome} — {_fmt_brl(float(preco or 0))}")
    texto = "Aqui está o nosso cardápio 🍕\n" + "\n".join(blocos)
    link = _link_cardapio(ctx.pizzaria)
    if link:
        texto += f"\n\n📲 Com fotos e pedido direto: {link}"
    return texto + "\n\nO que vai querer hoje? 😊"


def _fatos_promocoes(pizz) -> tuple[str, list[float]]:
    """Cupons e campanhas REAIS (cadastrados no cardápio digital). Sem nenhum,
    o fato proíbe inventar — perguntado se tinha cupom, a voz criou um "10% na
    primeira compra" que não existia."""
    from datetime import date
    tema = getattr(pizz, "tema_cardapio", None) or {}
    hoje = date.today().isoformat()
    cupons = [
        c for c in (tema.get("cupons") or [])
        if isinstance(c, dict) and c.get("ativo") and c.get("codigo")
        and not (c.get("validade") and str(c["validade"])[:10] < hoje)
    ]
    campanhas = [c for c in (tema.get("campanhas") or []) if isinstance(c, dict) and c.get("ativa") and c.get("titulo")]
    valores: list[float] = []
    if not cupons and not campanhas:
        return ("Promoções/cupons: NÃO há nenhum cadastrado. Se perguntarem, diga que no momento não "
                "temos cupom nem promoção — NUNCA invente desconto.", valores)
    partes: list[str] = []
    for c in cupons:
        try:
            valor = float(c.get("valor") or 0)
            minimo = float(c.get("pedido_minimo") or 0)
        except (TypeError, ValueError):
            continue
        desc = f"{valor:g}% OFF" if c.get("tipo") == "percentual" else f"{_fmt_brl(valor)} OFF"
        if c.get("tipo") != "percentual":
            valores.append(valor)
        if minimo > 0:
            desc += f" em pedidos acima de {_fmt_brl(minimo)}"
            valores.append(minimo)
        partes.append(f"cupom {str(c['codigo']).upper()} ({desc})")
    for c in campanhas:
        partes.append(f"campanha '{c['titulo']}'" + (f": {c['subtitulo']}" if c.get("subtitulo") else ""))
    link = _link_cardapio(pizz)
    onde = f" pelo cardápio digital ({link})" if link else " pelo cardápio digital"
    return ("Promoções REAIS (só estas, não invente outras): " + "; ".join(partes)
            + f". Os cupons valem para pedidos feitos{onde}; pelo WhatsApp não dá para aplicar cupom.",
            valores)


# "Borda de cheddar", "borda recheada com catupiry" (sabor = adicional pago).
# Não casa "borda fina/grossa" (preparo, fica na observação).
_BORDA_RECHEADA_RE = _re.compile(
    r"borda\s+(?:recheada\s+)?(?:de|com)\s+[a-zà-ÿ]+(?:\s+[a-zà-ÿ]+)?",
    _re.IGNORECASE,
)


# "Observação" que na verdade é a resposta de QUANDO pagar ("na hora de pegar",
# "quando chegar", "pago na entrega"). Texto já normalizado (sem acento).
_OBS_E_MOMENTO_DE_PAGAR_RE = _re.compile(
    r"\b(pag\w*|agora|entrega|retira\w*|pegar|buscar|busco|chegar|chegada|hora|depois|maquin\w*)\b"
)


def _fatos_taxa_entrega(pizz, user_input: str) -> tuple[str | None, list[float]]:
    """Taxas de entrega reais para responder dúvida: a do bairro citado (se estiver
    cadastrado) ou a tabela resumida. Devolve (fato, valores válidos pro guard)."""
    tabela: list[tuple[str, float]] = []
    for b in (getattr(pizz, "taxas_bairro", None) or []):
        if isinstance(b, dict) and b.get("bairro") and b.get("taxa") is not None:
            try:
                tabela.append((str(b["bairro"]).strip(), float(b["taxa"])))
            except (TypeError, ValueError):
                continue
    fixa = getattr(pizz, "taxa_entrega_fixa", None)
    try:
        fixa = float(fixa) if fixa is not None else None
    except (TypeError, ValueError):
        fixa = None

    texto = _normalizar_txt(user_input)
    citado = next(((n, v) for n, v in tabela if _normalizar_txt(n) and _normalizar_txt(n) in texto), None)
    if citado:
        return (f"Taxa de entrega para o bairro {citado[0]}: {_fmt_brl(citado[1])}.", [citado[1]])
    if tabela:
        lista = "; ".join(f"{n}: {_fmt_brl(v)}" for n, v in tabela[:15])
        extra = f" Demais bairros: {_fmt_brl(fixa)}." if fixa else " Bairro fora da lista: diga que a equipe confirma a taxa."
        return (f"Taxas de entrega cadastradas por bairro — {lista}.{extra} Se o cliente citou um bairro "
                "que não está aqui, NÃO invente valor.", [v for _, v in tabela] + ([fixa] if fixa else []))
    if fixa:
        return (f"Taxa de entrega (qualquer bairro): {_fmt_brl(fixa)}.", [fixa])
    return (None, [])


import re as _re
from datetime import UTC

_CONFIRMA_RE = _re.compile(
    r"^\s*(sim|claro|isso|isso ai|ok|okay|blz|beleza|pode|pode ser|pode fechar|"
    r"pode mandar|fechar|fechou|fechado|confirma|confirmo|confirmado|bora|"
    r"manda|vai|perfeito|exato|certo|positivo|pode sim|ta bom|tá bom|tudo certo)\b",
    _re.IGNORECASE,
)


def _eh_confirmacao(intencao: str | None, texto: str) -> bool:
    if intencao == "confirmar_resumo":
        return True
    t = (texto or "").strip().lower()
    return bool(_CONFIRMA_RE.match(t)) and len(t) <= 25


def _item_de_sempre(ctx) -> str | None:
    """Nome do 'pedido de sempre' do cliente — só string real não-vazia."""
    from app.agent.behavior import get_behavior
    if not get_behavior(ctx.personalidade).memoria.usar_pedido_habitual:
        return None
    v = getattr(ctx, "ultimo_pedido_resumo", None)
    return v.strip() if isinstance(v, str) and v.strip() else None


def _eh_grosseria(texto: str) -> bool:
    # Detecta ofensa explícita (não inclui pedido educado de atendente, que tem
    # intenção própria 'falar_humano' na NLU).
    t = (texto or "").lower()
    palavroes = r"\b(merda|porra|caralho|vai se|vsf|fdp|filho da|idiota|imbecil|otario|otária|nojento)\b"
    return bool(_re.search(palavroes, t))


_CARDAPIO_RE = _re.compile(
    r"(card[aá]pio|menu|me manda|o que (voc|vc|tu).*tem|quais.*(sabor|op[cç])|"
    r"que sabores|op[cç][oõ]es|lista de)",
    _re.IGNORECASE,
)


def _quer_cardapio(intencao: str | None, texto: str, dados: dict[str, Any]) -> bool:
    if intencao == "pedir_cardapio":
        return True
    if dados.get("quer_cardapio") is True:
        return True
    return bool(_CARDAPIO_RE.search(texto or ""))


async def _sincronizar_rascunho(db: AsyncSession, ctx: AgentContext, estado: dict[str, Any], calc: dict[str, Any]) -> None:
    """Espelha o pedido EM CONSTRUÇÃO no rascunho (card do Kanban "Novos"), pra o
    painel mostrar itens/total/entrega/pagamento em tempo real — sem esperar o
    registro final. Atualiza o MESMO rascunho que o registrar_pedido reaproveita,
    então não cria pedido duplicado. Best-effort: nunca derruba o atendimento.
    """
    try:
        from datetime import datetime
        from decimal import Decimal

        from sqlalchemy import select

        from app.models import Cliente, Pedido

        cli = ctx.cliente
        if not cli:
            cli = (await db.execute(select(Cliente).where(
                Cliente.pizzaria_id == ctx.pizzaria.id,
                Cliente.telefone == ctx.telefone,
            ))).scalar_one_or_none()
        if not cli:
            return

        # Só atualiza um rascunho ABERTO (status 'novo', ainda não pago). Não cria
        # um novo aqui — se não houver rascunho, o registro final cuida disso.
        ped = (await db.execute(select(Pedido).where(
            Pedido.pizzaria_id == ctx.pizzaria.id,
            Pedido.cliente_id == cli.id,
            Pedido.status == "novo",
            Pedido.payment_status != "approved",
        ).order_by(Pedido.created_at.desc()))).scalars().first()
        if not ped:
            return

        ped.itens = calc.get("itens") or []
        ped.valor_total = Decimal(str(calc.get("valor_total") or 0))
        if estado.get("tipo"):
            ped.tipo = estado["tipo"]
        if estado.get("endereco"):
            ped.endereco_entrega = estado["endereco"]
        if estado.get("pagamento"):
            ped.forma_pagamento = estado["pagamento"]
        if estado.get("observacoes"):
            ped.observacoes = estado["observacoes"]
        ped.updated_at = datetime.now(UTC)
        await db.flush()

        from app.services.broadcaster import broadcaster
        await broadcaster.publish(ctx.pizzaria.id, {
            "tipo": "pedido.atualizado",
            "pizzaria_id": str(ctx.pizzaria.id),
            "payload": {
                "pedido_id": str(ped.id),
                "numero_pedido": ped.numero_pedido,
                "status_novo": ped.status,
                "em_construcao": True,
            },
        })
    except Exception as e:  # noqa: BLE001
        log.debug("Falha ao sincronizar rascunho de pedido: %s", e)


async def processar(
    db: AsyncSession,
    ctx: AgentContext,
    estado: dict[str, Any],
    nlu: dict[str, Any],
    user_input: str = "",
) -> dict[str, Any]:
    """Executa um passo da FSM. Retorna a 'decisão' para a voz + estado atualizado."""
    from app.agent.tools import (
        _calcular_pedido,
        atualizar_pedido,
        cancelar_pedido,
        enviar_cardapio_arquivo,
        escalar_humano,
        registrar_avaliacao,
        registrar_pedido,
    )

    intencao = nlu.get("intencao")
    dados = nlu.get("dados") or {}

    # A oferta do cardápio vale SÓ para a resposta imediatamente seguinte. Antes o
    # flag ligava na saudação e nunca desligava: um "é isso mesmo" dez mensagens
    # depois, com o carrinho vazio, era lido como "sim, manda o cardápio". Aqui ele
    # é consumido; o pipeline o religa no fim do turno se a mensagem que o cliente
    # acabou de receber perguntou de novo sobre o cardápio.
    oferta_cardapio_aberta = bool(estado.get("cardapio_ofertado"))
    estado["cardapio_ofertado"] = False

    decisao: dict[str, Any] = {
        "acao": "conversar", "fatos": [], "proxima_pergunta": None,
        "enviar_cardapio": False, "dados": {},
    }

    # Pedido REAL já feito fora deste estado: pelo cardápio digital (que nunca
    # passa pelo FSM) ou pelo WhatsApp com o estado já expirado (TTL de 2h). Sem
    # isto, "quero cancelar" caía no ramo de rascunho e a atendente CONFIRMAVA o
    # cancelamento sem cancelar nada, e "já saiu?" ficava sem resposta.
    if estado.get("etapa") != "FINALIZADO" and not estado.get("carrinho"):
        try:
            from app.agent.tools import ROTULO_STATUS_PEDIDO, pedido_ativo_do_cliente
            ativo = await pedido_ativo_do_cliente(ctx, db)
        except Exception as e_ativo:  # noqa: BLE001
            log.debug("Consulta de pedido ativo falhou (segue sem): %s", e_ativo)
            ativo = None
        if ativo is not None and getattr(ativo, "numero_pedido", None):
            origem = (
                "pelo cardápio digital" if getattr(ativo, "origem", None) == "cardapio_digital"
                else "pelo WhatsApp"
            )
            status_txt = ROTULO_STATUS_PEDIDO.get(ativo.status, ativo.status)
            decisao["fatos"].append(
                f"O cliente JÁ TEM o pedido #{ativo.numero_pedido} feito {origem}, status atual: {status_txt}. "
                "Se ele perguntar do pedido, responda com esse status. Não diga que ele não tem pedido."
            )
            if intencao in ("cancelar", "alterar_pedido"):
                # Cai nos ramos de pós-venda abaixo, que agem no pedido de verdade
                # (e escalam pro humano se não der, sem fingir que deu).
                estado["etapa"] = "FINALIZADO"
                estado["apresentou"] = True

    # Se a conversa anterior já foi finalizada com sucesso e o cliente está iniciando um novo
    # contato (intenção não é de pós-venda ou pós-entrega), resetamos o estado FSM.
    # Se for apenas cortesia/agradecimento pós-venda, respondemos com simpatia sem resetar o estado.
    if estado.get("etapa") == "FINALIZADO":
        if intencao == "conversa_fiada":
            decisao["proxima_pergunta"] = (
                "Responda de forma curta e simpática ao agradecimento ou cortesia do cliente "
                "(ex.: 'Imagina!', 'De nada, bom apetite!', 'Qualquer coisa só chamar'). Não ofereça mais pizzas."
            )
            return {"decisao": decisao, "estado": estado}
        elif intencao == "informar_pagamento" or any(k in user_input.lower() for k in ("link", "pix", "pagar", "pagamento", "copia e cola")):
            from app.agent.tools import gerar_pagamento
            try:
                metodo_pag = estado.get("pagamento") or "pix"
                r = await gerar_pagamento(ctx, db, metodo=metodo_pag)
                if r.get("ok"):
                    decisao["acao"] = "conversar"
                    pag = r.get("pagamento") or {}
                    metodo_cobr = pag.get("metodo") or metodo_pag
                    if metodo_cobr == "pix":
                        decisao["proxima_pergunta"] = "Avise o cliente que você acabou de reenviar o código Pix e o QR Code acima."
                    else:
                        decisao["proxima_pergunta"] = "Avise o cliente que você acabou de reenviar o link de pagamento do cartão acima."
                    return {"decisao": decisao, "estado": estado}
                else:
                    decisao["proxima_pergunta"] = f"Avise o cliente que não foi possível gerar o pagamento: {r.get('motivo') or 'erro'}"
                    return {"decisao": decisao, "estado": estado}
            except Exception as e_pag:
                log.warning("Falha ao re-gerar pagamento na FSM: %s", e_pag)
        elif intencao not in ("alterar_pedido", "avaliar", "cancelar", "reclamar", "falar_humano"):
            estado.update(estado_inicial())

    # Reclamação / pedir atendente humano → escala (desliga o bot na conversa).
    if intencao in ("reclamar", "falar_humano") or _eh_grosseria(user_input):
        motivo = "reclamação" if intencao == "reclamar" else ("ofensa" if _eh_grosseria(user_input) else "cliente pediu atendente")
        try:
            await escalar_humano(ctx, db, motivo_escalonamento=f"FSM: {motivo} — '{user_input[:120]}'")
        except Exception:  # noqa: BLE001
            pass
        decisao["acao"] = "escalado"
        decisao["fatos"].append("Atendimento escalado para um humano da equipe.")
        decisao["proxima_pergunta"] = (
            "Acolha com empatia (peça desculpas se for reclamação) e avise que já chamou alguém "
            "da equipe pra continuar. NÃO peça mais dados do pedido."
        )
        return {"decisao": decisao, "estado": estado}

    # Avaliação (NPS) pós-entrega
    nota = dados.get("nota")
    if intencao == "avaliar" or (isinstance(nota, int) and 0 <= nota <= 10 and estado.get("etapa") == "FINALIZADO"):
        # Avaliação é de baixo risco: se falhar ao gravar, ainda agradecemos o
        # cliente (não há prejuízo pra ele), mas logamos pra não passar batido.
        try:
            n = int(nota) if isinstance(nota, int) else 10
            r = await registrar_avaliacao(ctx, db, nota=n, comentario=user_input[:300])
            decisao["fatos"].append(f"Avaliação registrada: nota {n}.")
            if r.get("alerta"):
                decisao["fatos"].append(r["alerta"])
        except Exception as e_aval:  # noqa: BLE001
            log.warning("Falha ao registrar avaliação na FSM (segue agradecendo): %s", e_aval)
        decisao["acao"] = "avaliado"
        decisao["proxima_pergunta"] = "Agradeça a avaliação de coração, de forma curta."
        return {"decisao": decisao, "estado": estado}

    # Alterar pedido JÁ registrado (endereço/pagamento)
    if intencao == "alterar_pedido" and estado.get("etapa") == "FINALIZADO":
        end = dados.get("endereco")
        novo_end = None
        if isinstance(end, dict) and any(end.get(k) for k in ("rua", "numero", "bairro")):
            novo_end = ", ".join(str(end.get(k)) for k in ("rua", "numero", "bairro", "referencia") if end.get(k))
        nova_forma = dados.get("forma_pagamento") if dados.get("forma_pagamento") in ("pix", "cartao", "dinheiro") else None
        atualizou_ok = False
        erro_upd = None
        try:
            r = await atualizar_pedido(ctx, db, novo_endereco=novo_end, nova_forma_pagamento=nova_forma)
            atualizou_ok = bool(r.get("ok"))
            erro_upd = r.get("erro")
        except Exception as e_upd:  # noqa: BLE001
            log.exception("Falha ao alterar pedido na FSM: %s", e_upd)
            erro_upd = str(e_upd)
        if not atualizou_ok:
            # NÃO podemos dizer ao cliente que alteramos se o banco não mudou.
            # Escala pra um humano resolver e instrui a voz a NÃO confirmar.
            try:
                await escalar_humano(ctx, db, motivo_escalonamento=f"FSM: falha ao alterar pedido — {erro_upd or 'erro desconhecido'}")
            except Exception:  # noqa: BLE001
                pass
            decisao["acao"] = "escalado"
            decisao["fatos"].append("Não foi possível alterar o pedido automaticamente; a equipe foi acionada.")
            decisao["proxima_pergunta"] = (
                "Diga ao cliente, com empatia, que você está ajustando o pedido com a equipe e já retornam. "
                "NÃO afirme que a alteração foi concluída."
            )
            return {"decisao": decisao, "estado": estado}
        decisao["fatos"].append("Pedido atualizado.")
        decisao["acao"] = "pedido_atualizado"
        decisao["proxima_pergunta"] = "Confirme a alteração feita de forma curta."
        taxa_info = (r.get("taxa_entrega") if isinstance(r, dict) else None) or {}
        if taxa_info.get("a_confirmar"):
            decisao["fatos"].append(
                "O novo endereço fica num bairro sem taxa cadastrada: diga que a equipe confirma a taxa de entrega."
            )
        elif taxa_info.get("diferenca"):
            decisao["fatos"].append(
                f"A taxa de entrega mudou de {_fmt_brl(taxa_info['antes'])} para {_fmt_brl(taxa_info['depois'])}; "
                f"novo total do pedido: {_fmt_brl(taxa_info['novo_total'])}. Informe isso ao confirmar."
            )
            decisao["precos_validos"] = [taxa_info["antes"], taxa_info["depois"], taxa_info["novo_total"]]
        return {"decisao": decisao, "estado": estado}

    # Cancelar
    if intencao == "cancelar":
        # Se já existe um pedido REGISTRADO, cancela de verdade no sistema.
        if estado.get("etapa") == "FINALIZADO":
            cancelou_ok = False
            erro_cancel = None
            numero_cancel = None
            try:
                r = await cancelar_pedido(ctx, db, motivo_cancelamento="Cancelado pelo cliente")
                cancelou_ok = bool(r.get("ok"))
                erro_cancel = r.get("erro")
                numero_cancel = r.get("numero_pedido")
            except Exception as e_cancel:  # noqa: BLE001
                log.exception("Falha ao cancelar pedido na FSM: %s", e_cancel)
                erro_cancel = str(e_cancel)
            if not cancelou_ok:
                # Cancelamento real falhou (ex.: já está no forno / saiu pra entrega).
                # NÃO dizemos que cancelou nem limpamos o estado — escala pra humano.
                try:
                    await escalar_humano(ctx, db, motivo_escalonamento=f"FSM: falha ao cancelar pedido — {erro_cancel or 'erro desconhecido'}")
                except Exception:  # noqa: BLE001
                    pass
                decisao["acao"] = "escalado"
                decisao["fatos"].append("Não foi possível cancelar automaticamente; a equipe foi acionada.")
                decisao["proxima_pergunta"] = (
                    "Diga ao cliente, com empatia, que você está verificando o cancelamento com a equipe e já "
                    "retornam. NÃO afirme que o pedido foi cancelado."
                )
                return {"decisao": decisao, "estado": estado}
            decisao["fatos"].append(f"Pedido #{numero_cancel} cancelado.")
        else:
            decisao["fatos"].append("Pedido (rascunho) limpo.")
        estado.update(estado_inicial())
        estado["apresentou"] = True
        decisao["acao"] = "cancelado"
        decisao["proxima_pergunta"] = "Confirme o cancelamento e pergunte se quer começar um novo pedido."
        return {"decisao": decisao, "estado": estado}

    # Cardápio em arquivo — detectado por intenção OU por heurística (a mensagem
    # pode pedir pizza E cardápio ao mesmo tempo; a NLU só traz 1 intenção).
    # Também dispara quando ACABAMOS de oferecer o cardápio na saudação e o cliente
    # confirmou ("sim", "quero", "pode") — aí mandamos o arquivo na hora.
    confirmou_ver_cardapio = (
        oferta_cardapio_aberta
        and not estado.get("cardapio_enviado")
        and not estado["carrinho"]
        and not dados.get("produtos")  # "quero uma calabresa" NÃO é pedir o cardápio
        # "sim", "pode", "quero", "manda" — aceite em qualquer forma comum
        and (_eh_confirmacao(intencao, user_input) or _afirmou_upsell(intencao, user_input))
    )
    if _quer_cardapio(intencao, user_input, dados) or confirmou_ver_cardapio:
        texto_cardapio: str | None = None
        if not estado.get("cardapio_enviado"):
            try:
                r = await enviar_cardapio_arquivo(ctx, db)
                if r.get("ok"):
                    estado["cardapio_enviado"] = True
                    try:
                        from app.services.conversation_state import save_state
                        await save_state(db, ctx.pizzaria.id, ctx.telefone, estado)
                        await db.commit()
                    except Exception as e_commit:
                        log.debug("Falha no commit preventivo de cardapio_enviado: %s", e_commit)
                elif r.get("motivo") == "sem_arquivo":
                    # Sem arquivo, a voz era mandada "listar o que souber" e inventava
                    # sabores (listou Pepperoni e Mussarela numa casa que não tem).
                    # A lista sai do banco, verbatim.
                    texto_cardapio = await _cardapio_em_texto(ctx, db)
                    if not texto_cardapio:
                        decisao["fatos"].append(
                            "Não foi possível carregar o cardápio agora. NÃO cite nenhum sabor: peça "
                            "desculpas e pergunte o que o cliente procura."
                        )
            except Exception:  # noqa: BLE001
                pass
        decisao["acao"] = "cardapio"
        if texto_cardapio:
            estado["cardapio_enviado"] = True
            decisao["mensagem_pronta"] = texto_cardapio
            decisao["mensagem_pronta_acao"] = "cardapio"
        elif estado.get("cardapio_enviado"):
            decisao["fatos"].append("O cardápio (arquivo) JÁ foi enviado ao cliente acima.")
            # Mensagem verbatim (backend) — a LLM não improvisa "te mostro os sabores
            # em texto" nem pergunta o sabor. Curta e objetiva, como pedido.
            decisao["mensagem_pronta"] = "Cardápio enviado aí em cima 👆 Assim que escolher, é só me falar! 😊"
            # Carimba a ação dona desta mensagem: ramos seguintes podem trocar a ação
            # (ex.: vira pedir_info porque o carrinho já tem item) sem saber que isto
            # ficou aqui — e o cliente que perguntou "tem bebida?" ouvia "cardápio
            # enviado". O pipeline descarta a mensagem se a ação final for outra.
            decisao["mensagem_pronta_acao"] = "cardapio"

    # Sugestão pendente: no turno anterior o bot ofereceu um item alternativo (ex.:
    # Coca no lugar da Fanta indisponível). Se o cliente confirmou agora ("pode ser",
    # "sim"), adiciona esse item. Consumida sempre (pop): se ele não confirmou, expira.
    _sugestao = estado.pop("sugestao_item", None)
    if _sugestao and not dados.get("produtos") and not dados.get("remover") and _eh_confirmacao(intencao, user_input):
        dados["produtos"] = [{"nome": _sugestao, "qtd": 1}]
        if intencao in ("confirmar_resumo", "conversa_fiada", "duvida_geral"):
            intencao = "adicionar_item"

    # Robustez de remoção: o cliente quer remover (intent remover_item) mas a NLU não
    # disse O QUÊ → infere do texto qual item do carrinho tirar. Ex.: "não quero mais o
    # refrigerante, só a pizza" deve remover a Coca, mesmo a NLU não devolvendo 'remover'.
    if intencao == "remover_item" and not dados.get("remover") and not dados.get("_ops_itens"):
        alvos = _inferir_remocao(user_input, estado.get("carrinho") or [])
        if alvos:
            dados["remover"] = alvos

    # "O de sempre": no turno anterior oferecemos repetir o pedido padrão do
    # cliente recorrente. Se ele aceitou ("sim", "pode ser", "o de sempre") sem
    # pedir outra coisa, injeta o item como se a NLU o tivesse extraído — segue
    # o funil normal (preço atual via _calcular_pedido). Flag consumida aqui.
    if estado.pop("ofereceu_de_sempre", False):
        de_sempre = _item_de_sempre(ctx)
        pediu_de_sempre = bool(_re.search(
            r"\b(de sempre|o mesmo|de costume)\b", (user_input or "").lower()
        ))
        aceitou = pediu_de_sempre or _eh_confirmacao(intencao, user_input) or _afirmou_upsell(intencao, user_input)
        if (
            aceitou
            and not estado["carrinho"]
            and not dados.get("produtos")
            and de_sempre
        ):
            dados["produtos"] = [{"nome": de_sempre, "qtd": 1}]
            decisao["fatos"].append(
                f"Cliente aceitou repetir o pedido de sempre: {de_sempre}."
            )
    elif not estado["carrinho"] and _re.search(
        r"\b(de sempre|o mesmo de sempre|de costume)\b", (user_input or "").lower()
    ):
        # Pediu "o de sempre" sem a oferta. A NLU extraía "o de sempre" como
        # produto e a atendente respondia que "o de sempre não está no cardápio".
        dados["produtos"] = [
            p for p in (dados.get("produtos") or [])
            if isinstance(p, dict) and not _re.search(r"sempre|costume", (p.get("nome") or "").lower())
        ]
        de_sempre = _item_de_sempre(ctx)
        if de_sempre and not dados["produtos"]:
            dados["produtos"] = [{"nome": de_sempre, "qtd": 1}]
            decisao["fatos"].append(f"Cliente pediu o de sempre: {de_sempre}.")
        elif not de_sempre:
            decisao["fatos"].append(
                "O cliente pediu 'o de sempre', mas ainda não há pedidos anteriores dele registrados. "
                "Diga com simpatia que não encontrou um pedido anterior e pergunte o que ele vai querer "
                "hoje. NÃO trate 'o de sempre' como nome de produto."
            )

    # Aceite do upsell de ITEM ÚNICO: quando a oferta nomeou UM item específico
    # ("Quer uma Coca Cola 2L pra acompanhar?") e o cliente respondeu "quero"
    # sem dizer o quê, é ESSE item — adiciona direto, sem perguntar "qual?"
    # (bug real: a atendente listava a única opção e perguntava qual). Injeta
    # antes do _aplicar_nlu pra cair no cálculo de preço normal deste turno.
    if (
        estado.get("aguardando_upsell")
        and estado.get("upsell_item_unico")
        and not dados.get("produtos")
        and _afirmou_upsell(intencao, user_input)
    ):
        item = estado["upsell_item_unico"]
        dados["produtos"] = [{"nome": item, "qtd": 1}]
        decisao["fatos"].append(
            f"Cliente aceitou o item que você ofereceu ({item}) — já adicionado ao pedido."
        )

    # Pergunta não é pedido: "quanto é a pizza de frango grande?" e "a calabresa
    # é 10 reais né?" colocavam a pizza no carrinho. A NLU às vezes extrai o
    # produto citado mesmo classificando como dúvida.
    if intencao == "duvida_geral":
        # Nem vira item, nem observação ("Obs: perguntou o preço da quatro queijos").
        dados["produtos"] = []
        dados["observacoes"] = None

    # Borda recheada é ADICIONAL (tem preço), não observação. A NLU mandava
    # "borda de cheddar" nas observações: a atendente dizia "anotei com borda de
    # cheddar", a casa recebia uma borda que não vende — ou uma que vende, sem
    # cobrar. Movida para o item, passa pela validação de adicionais (existe →
    # cobra; não existe → sai e o cliente é avisado). "Borda fina" segue obs.
    # A NLU às vezes cola a borda no NOME ("pizza de frango com borda de
    # cheddar"): o produto não era achado e a pizza sumia do carrinho.
    for p in (dados.get("produtos") or []):
        if not isinstance(p, dict) or "borda" not in str(p.get("nome") or "").lower():
            continue
        nome_p = str(p["nome"])
        achadas_nome = [
            m for m in _BORDA_RECHEADA_RE.finditer(nome_p)
            if not _re.search(r"\bsem\s*$", nome_p[:m.start()].lower())
        ]
        if not achadas_nome:
            continue
        for m in reversed(achadas_nome):
            nome_p = nome_p[:m.start()] + nome_p[m.end():]
        p["nome"] = _re.sub(r"\s+(com|e)\s*$", "", _re.sub(r"\s{2,}", " ", nome_p)).strip(" ,")
        p["adicionais"] = [*(p.get("adicionais") or []), *[m.group(0).strip() for m in achadas_nome]]

    obs_bruta = dados.get("observacoes")
    if isinstance(obs_bruta, str) and "borda" in obs_bruta.lower():
        # "sem borda de catupiry" é pedido de NÃO ter borda: fica na observação.
        achadas = [
            m for m in _BORDA_RECHEADA_RE.finditer(obs_bruta)
            if not _re.search(r"\bsem\s*$", obs_bruta[:m.start()].lower())
        ]
        bordas = [m.group(0).strip() for m in achadas]
        alvo = next(
            (p for p in reversed(dados.get("produtos") or []) if isinstance(p, dict)),
            estado["carrinho"][-1] if estado["carrinho"] else None,
        )
        if bordas and alvo is not None:
            alvo["adicionais"] = [*(alvo.get("adicionais") or []), *bordas]
            if alvo in estado["carrinho"]:
                _descongelar(alvo)
            restante = obs_bruta
            for m in reversed(achadas):
                restante = restante[:m.start()] + restante[m.end():]
            restante = _re.sub(r"^[\s,;.e]+|[\s,;.]+$", "", _re.sub(r"\s*,\s*,\s*", ", ", restante)).strip()
            dados["observacoes"] = restante or None

    # Resposta à pergunta "pagar agora ou na entrega/retirada?" não é observação
    # do pedido. A NLU às vezes gravava "na hora de pegar" nos dois campos e o
    # resumo saía com "Obs: na hora de pegar". Observação de verdade ("sem
    # cebola") não fala de pagamento e passa.
    obs_turno = dados.get("observacoes")
    if (
        estado.get("etapa") == "PAGAMENTO"
        and isinstance(dados.get("pagar_agora"), bool)
        and isinstance(obs_turno, str)
        and len(obs_turno) <= 60
        and _OBS_E_MOMENTO_DE_PAGAR_RE.search(_normalizar_txt(obs_turno))
    ):
        dados["observacoes"] = None

    # "Quero 2 pizzas grandes": categoria sem sabor. Guarda quantidade/tamanho e
    # pergunta os sabores; a resposta ("calabresa e frango") herda o que faltou.
    # Antes "pizza" casava com a primeira pizza do cardápio (2 Pizzas Brasa) e a
    # resposta com os sabores entrava como MAIS 2 pizzas genéricas.
    from app.agent.tools import eh_termo_generico
    genericos = [
        p for p in (dados.get("produtos") or [])
        if isinstance(p, dict) and not p.get("sabores_meia")
        and (p.get("_generico") or eh_termo_generico(p.get("nome")))
    ]
    if genericos:
        dados["produtos"] = [p for p in dados["produtos"] if p not in genericos]
        g = genericos[0]
        qtd_g = int(g.get("qtd") or 1)
        estado["aguardando_sabores"] = {"qtd": qtd_g, "tamanho": g.get("tamanho")}
        if not dados["produtos"]:
            opcoes = await _nomes_da_categoria(ctx, db, g.get("nome"))
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(
                f"O cliente quer {qtd_g} {g.get('nome')}{' ' + g['tamanho'] if g.get('tamanho') else ''} "
                "mas NÃO disse o sabor." + (f" Opções reais: {', '.join(opcoes)}." if opcoes else "")
            )
            decisao["proxima_pergunta"] = (
                f"Pergunte QUAL sabor ele quer{' para cada uma das ' + str(qtd_g) if qtd_g > 1 else ''}, "
                "citando algumas opções reais. Não anote nada ainda e não invente sabores."
            )
            estado["apresentou"] = True
            return {"decisao": decisao, "estado": estado}
    elif estado.get("aguardando_sabores") and dados.get("produtos"):
        pend = estado.pop("aguardando_sabores")
        prods = [p for p in dados["produtos"] if isinstance(p, dict)]
        # "2 pizzas grandes" + "calabresa e frango": a NLU às vezes junta numa
        # meio a meio (com qtd 2). Sem o cliente falar em meia/metade, são N
        # pizzas inteiras, uma de cada sabor.
        sab = [x for x in (prods[0].get("sabores_meia") or []) if x] if len(prods) == 1 else []
        if (
            len(sab) >= 2 and len(sab) == int(pend.get("qtd") or 1)
            and not _re.search(r"\b(meia|meio|metade)\b", (user_input or "").lower())
        ):
            base = prods[0]
            ids_sab = list(base.get("sabores_ids") or [])
            prods = [
                {
                    "nome": x, "qtd": 1, "tamanho": base.get("tamanho"),
                    "adicionais": list(base.get("adicionais") or []),
                    **({"produto_id": ids_sab[i]} if len(ids_sab) == len(sab) else {}),
                }
                for i, x in enumerate(sab)
            ]
            dados["produtos"] = prods
        for p in prods:
            if not p.get("tamanho") and pend.get("tamanho"):
                p["tamanho"] = pend["tamanho"]
        # "2 pizzas" + "calabresa" = 2 calabresas; "2 pizzas" + "calabresa e frango" = 1 de cada.
        if len(prods) == 1 and pend.get("qtd", 1) > 1 and int(prods[0].get("qtd") or 1) == 1:
            prods[0]["qtd"] = pend["qtd"]

    # Itens que o cliente pediu NESTA mensagem — só eles podem ser confirmados
    # como "anotados" (ver a pergunta de entrega/retirada mais abaixo).
    itens_do_turno = [
        (p.get("nome") or " / ".join(s for s in (p.get("sabores_meia") or []) if s)).strip()
        for p in (dados.get("produtos") or []) if isinstance(p, dict)
    ]
    itens_do_turno = [n for n in itens_do_turno if n]

    # Funde dados extraídos no estado
    _aplicar_nlu(estado, dados)

    # Pedido grande (ex.: 60 pizzas) passa pela equipe: prazo e estoque não são
    # coisa pro bot prometer. Antes entrava calado, e o cálculo ainda cortava a
    # quantidade em silêncio (carrinho 60, preço de 50).
    grandes = [it for it in estado["carrinho"] if int(it.get("qtd") or 1) > LIMITE_QTD_ITEM]
    if grandes and not estado.get("pedido_grande_escalado"):
        estado["pedido_grande_escalado"] = True
        qtd_max = max(int(it.get("qtd") or 1) for it in grandes)
        try:
            await escalar_humano(ctx, db, motivo_escalonamento=f"FSM: pedido grande ({qtd_max} unidades de um item)")
        except Exception:  # noqa: BLE001
            pass
        decisao["acao"] = "escalado"
        decisao["fatos"].append(f"Pedido grande: {qtd_max} unidades de um mesmo item. Itens anotados.")
        decisao["proxima_pergunta"] = (
            "Agradeça o pedido e explique que, para pedidos grandes assim, a equipe confirma o prazo "
            "e a disponibilidade — já chamou alguém para continuar. NÃO confirme prazo nem total."
        )
        return {"decisao": decisao, "estado": estado}

    # Qualquer resposta após pedirmos o número da casa consome a flag (se o
    # cliente respondeu outra coisa, o funil segue normal sem insistir).
    estado.pop("aguardando_numero", None)

    # Localização do WhatsApp SEM número da casa (e às vezes sem rua mapeada):
    # confirma o que encontramos e pergunta SÓ o que falta — UMA vez.
    if dados.get("_localizacao_sem_numero") and estado.get("endereco"):
        estado["etapa"] = "ENDERECO"
        estado["aguardando_numero"] = True
        decisao["acao"] = "pedir_info"
        bairro_loc = estado.get("endereco_bairro")
        rua_loc = (dados.get("endereco") or {}).get("rua")
        partes_achou = [p for p in (rua_loc, f"bairro {bairro_loc}" if bairro_loc else None) if p]
        achou = ", ".join(str(p) for p in partes_achou) if partes_achou else estado["endereco"]
        decisao["fatos"].append(
            f"Localização recebida; o mapa identificou: {achou}."
        )
        if dados.get("_localizacao_sem_rua"):
            faltando = "a RUA e o NÚMERO da casa (e complemento, se tiver)"
        else:
            faltando = "o NÚMERO da casa (e complemento apto/bloco, se tiver)"
        decisao["proxima_pergunta"] = (
            f"Agradeça a localização e confirme o que o mapa achou ({achou} — não invente além disso). "
            f"Depois pergunte SÓ {faltando}."
        )
        return {"decisao": decisao, "estado": estado}

    if dados.get("observacoes"):
        decisao["fatos"].append(f"Observação anotada do cliente: '{dados.get('observacoes')}'")

    # Cliente acabou de escolher RETIRADA → informe o endereço de retirada (+ link
    # do mapa, se cadastrado). Dispara só no turno em que ele escolhe (a NLU só traz
    # tipo_entrega quando ele menciona), evitando repetir nas próximas mensagens.
    if dados.get("tipo_entrega") == "retirada" and getattr(ctx.pizzaria, "endereco", None):
        _end = ctx.pizzaria.endereco
        _maps = getattr(ctx.pizzaria, "endereco_maps_url", None)
        _fato = f"O cliente escolheu RETIRADA. Informe o endereço para retirada: {_end}"
        if _maps:
            _fato += f" e envie o link do mapa: {_maps}"
        decisao["fatos"].append(_fato)

    # Resolve o carrinho (preços reais) sempre que houver itens
    calc = None
    if estado["carrinho"]:
        # Delivery ainda SEM endereço: calcula os itens como retirada. Antes o
        # cálculo falhava ("endereco_entrega é obrigatório"), o turno virava
        # pendência e a voz improvisava "Prefere delivery? Se sim, qual o
        # endereço?" em vez do pedido de endereço fixo (com a opção de mandar a
        # localização). A taxa só entra no resumo, que exige o endereço.
        tipo_calc = estado.get("tipo") or "retirada"
        if tipo_calc == "delivery" and not estado.get("endereco"):
            tipo_calc = "retirada"
        calc = await _calcular_pedido(
            ctx, db,
            itens=estado["carrinho"],
            tipo=tipo_calc,
            forma_pagamento=estado.get("pagamento") or "dinheiro",
            pagar_agora=bool(estado.get("pagar_agora")),
            endereco_entrega=estado.get("endereco"),
            observacoes=estado.get("observacoes"),
            bairro_confirmado=estado.get("endereco_bairro"),
        )
        # Borda/adicional que a casa não tem: tira do item e segue com o pedido
        # (o item em si existe). Antes o item ficava preso ao adicional inválido,
        # cada turno repetia a mesma pendência e o atendimento ia pro humano.
        tentativas_adic = 0
        while not calc.get("ok") and calc.get("adicional_invalido") and tentativas_adic < 3:
            tentativas_adic += 1  # um item por volta; teto evita laço se algo não sair
            invalidos = {_normalizar_txt(a) for a in calc["adicional_invalido"]}
            for it in estado["carrinho"]:
                ads = it.get("adicionais") or []
                restantes = [a for a in ads if _normalizar_txt(a) not in invalidos]
                if len(restantes) != len(ads):
                    it["adicionais"] = restantes
                    _descongelar(it)
            validos = calc.get("adicionais_validos") or []
            fato = (
                f"A casa NÃO tem: {', '.join(calc['adicional_invalido'])}. O item foi anotado SEM isso — "
                "avise o cliente em uma frase curta"
            )
            fato += (
                f" e cite as opções que existem: {', '.join(validos[:6])}."
                if validos else " (não há bordas/adicionais cadastrados; não ofereça nenhum)."
            )
            decisao["fatos"].append(fato)
            calc = await _calcular_pedido(
                ctx, db,
                itens=estado["carrinho"],
                tipo=tipo_calc,
                forma_pagamento=estado.get("pagamento") or "dinheiro",
                pagar_agora=bool(estado.get("pagar_agora")),
                endereco_entrega=estado.get("endereco"),
                observacoes=estado.get("observacoes"),
                bairro_confirmado=estado.get("endereco_bairro"),
            )
        if not calc.get("ok"):
            # Se for erro de item/sabor não encontrado no cardápio, removemos do carrinho
            prod_inv = calc.get("produto_invalido") or calc.get("sabor_invalido")
            if prod_inv:
                import unicodedata
                def _norm(x):
                    x_clean = "".join(c for c in unicodedata.normalize("NFD", str(x).strip().lower()) if unicodedata.category(c) != "Mn")
                    import re as _re
                    return _re.sub(r"\s+", " ", x_clean)

                alvo = _norm(prod_inv)
                estado["carrinho"] = [
                    it for it in estado["carrinho"]
                    if (not it.get("nome") or _norm(it.get("nome")) != alvo) and
                       (not it.get("sabores") or all(_norm(s) != alvo for s in it["sabores"]))
                ]

            # Meio a meio recusado pela regra: tira a combinação do carrinho, senão
            # ela recalcula e falha em TODA mensagem seguinte e o pedido trava.
            meia_inv = calc.get("meia_invalida")
            if meia_inv:
                estado["carrinho"] = [it for it in estado["carrinho"] if (it.get("sabores") or []) != meia_inv]
                decisao["fatos"].append(
                    "Esse meio a meio NÃO pode ser feito e foi tirado do pedido. Explique o motivo "
                    "ao cliente e pergunte se ele quer os sabores como pizzas inteiras ou outra combinação."
                )

            # Pendência: item não encontrado / falta tamanho / taxa não cadastrada.
            decisao["acao"] = "pendencia"

            # "Não encontrei" e "está indisponível" dizem coisas opostas ao cliente:
            # a primeira sugere que ele errou o nome, a segunda que o item acabou.
            # TODA consulta ao catálogo filtra `disponivel = true`, então um sabor
            # desligado no painel chega aqui indistinguível de um que nunca existiu
            # — e o cliente que pediu exatamente aquele item ouve que não existe.
            # Uma busca extra SEM o filtro separa os dois casos.
            indisponivel: str | None = None
            if prod_inv:
                try:
                    import unicodedata as _ud_ind

                    from sqlalchemy import text as _text_ind

                    def _norm_ind(x: object) -> str:
                        s = "".join(
                            c for c in _ud_ind.normalize("NFD", str(x).strip().lower())
                            if _ud_ind.category(c) != "Mn"
                        )
                        return _re.sub(r"\s+", " ", s)

                    rows_ind = (await db.execute(_text_ind(
                        "SELECT nome FROM public.produtos "
                        "WHERE pizzaria_id = :pid AND disponivel = false"
                    ), {"pid": str(ctx.pizzaria.id)})).fetchall()
                    alvo_ind = _norm_ind(prod_inv)
                    for (nome_ind,) in rows_ind:
                        if nome_ind and _norm_ind(nome_ind) == alvo_ind:
                            indisponivel = nome_ind
                            break
                except Exception:  # noqa: BLE001
                    # Best-effort: se a checagem falhar, cai na mensagem genérica.
                    indisponivel = None

            if indisponivel:
                decisao["fatos"].append(
                    f"'{indisponivel}' ESTÁ NO CARDÁPIO mas está INDISPONÍVEL agora. "
                    f"Avise que acabou/está fora no momento — NÃO diga que não existe "
                    f"nem que não encontrou — e ofereça alternativas."
                )
            else:
                decisao["fatos"].append(f"O sistema precisa resolver: {calc.get('erro')}")
            decisao["proxima_pergunta"] = "Resolva a pendência acima com o cliente (ex.: peça o tamanho, ou avise que não temos o item)."
            estado["etapa"] = "COLETA_ITENS"

            if prod_inv:
                import unicodedata as _ud
                # Normaliza (sem acento) pra casar 'guaraná'→'guarana', 'água'→'agua' etc.
                prod_inv_norm = "".join(
                    c for c in _ud.normalize("NFD", prod_inv.lower()) if _ud.category(c) != "Mn"
                )
                is_beverage = any(k in prod_inv_norm for k in ("bebida", "refrigerante", "refri", "suco", "agua", "coca", "fanta", "guarana", "sprite", "soda", "cerva", "cerveja", "chopp", "lata", "garrafa"))
                if is_beverage:
                    try:
                        # Usa a consulta por CATEGORIA (não query texto, que cai no
                        # cardápio inteiro): pega só as bebidas reais, pelos nomes.
                        opc = await _opcoes_upsell(ctx, db)
                        nomes_beb = opc.get("bebidas") or []
                        if len(nomes_beb) == 1:
                            decisao["fatos"].append(
                                "O cliente pediu uma bebida que NÃO existe no cardápio. Diga com clareza "
                                f"que não temos essa e ofereça PELO NOME a ÚNICA bebida que temos: {nomes_beb[0]}. "
                                f"NÃO diga 'outras opções' nem invente — temos só {nomes_beb[0]}. Pergunte se pode ser."
                            )
                            estado["sugestao_item"] = nomes_beb[0]
                        elif nomes_beb:
                            decisao["fatos"].append(
                                "O cliente pediu uma bebida que NÃO existe no cardápio. Diga que não temos essa "
                                f"e ofereça PELO NOME as bebidas que TEMOS: {', '.join(nomes_beb[:6])}. "
                                "Pergunte qual ele quer. NÃO invente bebidas fora dessa lista."
                            )
                            estado["sugestao_item"] = nomes_beb[0]
                        else:
                            decisao["fatos"].append(
                                "O cliente pediu uma bebida e a casa NÃO tem bebidas cadastradas. Diga com "
                                "clareza que não temos bebidas e siga com o pedido. NÃO invente nenhuma."
                            )
                    except Exception:
                        pass
                else:
                    try:
                        from app.agent.tools import buscar_cardapio
                        card_res = await buscar_cardapio(ctx, db, query=prod_inv, limit=5)
                        if card_res.get("items"):
                            alts = [f"{item['nome']} (R$ {item['preco']:.2f})" for item in card_res["items"] if "preco" in item]
                            if alts:
                                decisao["fatos"].append("Produtos semelhantes encontrados no cardápio: " + ", ".join(alts))
                    except Exception:
                        pass
            return {"decisao": decisao, "estado": estado}

        # Cálculo OK → CONGELA os preços resolvidos no carrinho (preço estável) e
        # publica os valores VÁLIDOS pro guard-rail conferir o texto da voz.
        if calc.get("ok"):
            _congelar_precos(estado, calc)
            pv = [round(float(i["preco_unit"]), 2) for i in (calc.get("itens") or [])]
            pv.append(round(float(calc.get("valor_total") or 0), 2))
            if calc.get("taxa_entrega"):
                pv.append(round(float(calc["taxa_entrega"]), 2))
            decisao["precos_validos"] = [v for v in pv if v > 0]
            # Espelha o pedido em construção no card do painel (Kanban "Novos") em
            # tempo real — itens/total/entrega/pagamento conforme vão sendo coletados.
            if getattr(ctx, "simulation", False) is not True:
                await _sincronizar_rascunho(db, ctx, estado, calc)

    # Dúvida geral / conversa fiada → RESPONDE de verdade (não força o funil).
    # IMPORTANTE: se o cliente JÁ tem itens no carrinho e só fez bate-papo ou recusou
    # adicionar mais ("só a pizza mesmo"), NÃO travamos aqui — deixamos cair no funil
    # (entrega/pagamento) pra não parar o fluxo. Só damos resposta dedicada de dúvida
    # quando ele REALMENTE perguntou algo (duvida_geral) ou ainda não tem nada pedido.
    responder_como_duvida = (
        intencao in ("duvida_geral", "conversa_fiada")
        and decisao["acao"] == "conversar"
        and (intencao == "duvida_geral" or not estado["carrinho"])
    )
    if responder_como_duvida:
        decisao["acao"] = "responder_duvida"
        decisao["fatos"].append(_fatos_pizzaria(ctx.pizzaria))
        # "Quanto é a entrega pro Cohatrac?" — sem a tabela de taxas nos fatos a voz
        # chutava um valor e o guard trocava por "(valor a confirmar)".
        if _re.search(r"\b(taxa|frete|entrega|entregam|delivery)\b", (user_input or "").lower()):
            fato_taxa, valores_taxa = _fatos_taxa_entrega(ctx.pizzaria, user_input)
            if fato_taxa:
                decisao["fatos"].append(fato_taxa)
                decisao["precos_validos"] = [*(decisao.get("precos_validos") or []), *valores_taxa]

        # Pechincha ("faz por 50 reais?", "tem desconto?"): a frase ia inteira pra
        # busca do cardápio, a busca semântica devolvia a calabresa e a voz
        # respondia com o preço de um produto que ninguém citou.
        pechincha = bool(_PECHINCHA_RE.search(_normalizar_txt(user_input)))
        if pechincha:
            decisao["fatos"].append(
                "O cliente está NEGOCIANDO o preço/pedindo desconto. Os preços são FIXOS: diga com "
                "simpatia que não consegue mudar o valor; só cite cupom/promoção se estiverem nos fatos. "
                "NÃO cite preço de nenhum produto."
            )
        if user_input and not pechincha:
            try:
                from app.agent.tools import buscar_cardapio
                clean_query = user_input.replace("?", "").replace("!", "").strip()
                if len(clean_query) >= 3:
                    card_res = await buscar_cardapio(ctx, db, query=clean_query, incluir_descricao=True, limit=5)
                    items = card_res.get("items") or []
                    if items:
                        fatos_prod = []
                        precos_prod: list[float] = []
                        for item in items:
                            desc = f" ({item['descricao']})" if item.get("descricao") else ""
                            # Com tamanhos, o preço base não é o de nenhum tamanho: a
                            # voz chutava o do G e o guard trocava por "valor a confirmar".
                            tams = [t for t in (item.get("tamanhos") or []) if isinstance(t, dict)]
                            if tams:
                                precos_txt = " · ".join(
                                    f"{t.get('tamanho')} {_fmt_brl(float(t.get('preco') or 0))}" for t in tams
                                )
                                precos_prod += [round(float(t.get("preco") or 0), 2) for t in tams]
                            else:
                                precos_txt = _fmt_brl(float(item.get("preco") or 0))
                                precos_prod.append(round(float(item.get("preco") or 0), 2))
                            fatos_prod.append(f"{item['nome']}: {precos_txt}{desc}")
                        decisao["fatos"].append("Produtos encontrados no cardápio para esclarecer a dúvida do cliente: " + "; ".join(fatos_prod))
                        decisao["precos_validos"] = [*(decisao.get("precos_validos") or []), *[p for p in precos_prod if p > 0]]
            except Exception:
                pass

        fato_promo, valores_promo = _fatos_promocoes(ctx.pizzaria)
        decisao["fatos"].append(fato_promo)
        if valores_promo:
            decisao["precos_validos"] = [*(decisao.get("precos_validos") or []), *valores_promo]
        fora_do_tema = (
            " Se a mensagem NÃO tiver relação com a pizzaria (pedido, cardápio, entrega, pagamento, "
            "horário, endereço), NÃO responda o conteúdo: diga com simpatia que por aqui você cuida "
            "dos pedidos e traga a conversa de volta ao pedido."
        )

        if estado["carrinho"]:
            decisao["proxima_pergunta"] = (
                "Responda com naturalidade ao que o cliente perguntou (use só os dados reais). "
                "Se ele perguntou se um item TEM um ingrediente (ex.: cebola): responda sim ou não e, se TIVER, "
                "pergunte se ele prefere pedir SEM esse ingrediente ou escolher outro sabor — NUNCA pule direto "
                "para confirmar o pedido. Caso contrário, responda e retome o pedido de leve, sem ser robótica."
                + fora_do_tema
            )
        else:
            oferta_cardapio = (
                "" if estado.get("cardapio_enviado")
                else " Se fizer sentido e ainda não enviou o cardápio, ofereça mostrá-lo."
            )
            if intencao == "conversa_fiada":
                # A regra genérica de "fora do tema" no fim da instrução era
                # ignorada ("a capital da França é Paris"); aqui ela é a instrução.
                decisao["proxima_pergunta"] = (
                    "O cliente puxou conversa. Se for cumprimento ou agradecimento, responda curto e simpático "
                    "e pergunte o que ele vai querer hoje. Se for pergunta sobre OUTRO assunto (geografia, "
                    "notícias, contas, conselhos...), NÃO responda o conteúdo, mesmo sabendo: diga com "
                    f"simpatia que por aqui você cuida dos pedidos da {ctx.pizzaria.nome} e ofereça o cardápio."
                )
                estado["apresentou"] = True
                return {"decisao": decisao, "estado": estado}
            decisao["proxima_pergunta"] = (
                "Responda com naturalidade EXATAMENTE ao que o cliente perguntou/disse, usando SÓ os dados reais. "
                "Se ele perguntou por um SABOR/PRODUTO específico: se ele aparece em 'Produtos encontrados no cardápio', "
                "confirme que TEMOS e diga o preço (se ele perguntou pelo preço); se NÃO aparecer ali, diga com gentileza "
                "que infelizmente não temos esse sabor." + oferta_cardapio +
                " Se ele só perguntou algo geral (ex.: se é a pizzaria X), responda direto. NÃO force 'qual sabor' "
                "se ele não pediu pizza." + fora_do_tema
            )
        estado["apresentou"] = True
        return {"decisao": decisao, "estado": estado}

    # Sem itens ainda → coleta. Em vez de perguntar "qual sabor", OFERECEMOS o
    # cardápio (a não ser que já tenha sido enviado), pra o cliente ver as opções.
    if not estado["carrinho"]:
        estado["etapa"] = "SAUDACAO" if not estado.get("apresentou") else "COLETA_ITENS"
        if decisao["acao"] == "conversar":
            ja_tem_cardapio = bool(estado.get("cardapio_enviado"))
            if not estado.get("apresentou"):
                decisao["acao"] = "saudacao"
                de_sempre = _item_de_sempre(ctx)
                if de_sempre:
                    # Cliente recorrente com padrão real (mesmo item nos últimos
                    # pedidos): oferece "o de sempre" — toque de casa que conhece
                    # o freguês. O aceite é tratado antes do _aplicar_nlu.
                    estado["ofereceu_de_sempre"] = True
                    decisao["fatos"].append(
                        f"Cliente recorrente; o pedido de sempre dele é: {de_sempre}."
                    )
                    decisao["proxima_pergunta"] = (
                        "Cumprimente pelo nome (nome + pizzaria, só na 1ª vez), com tom de quem "
                        f"reconhece o cliente, e pergunte se hoje vai ser o de sempre ({de_sempre}). "
                        "Ex.: 'Oi, que bom te ver de novo! 😊 Hoje vai ser o de sempre?'"
                    )
                elif ja_tem_cardapio:
                    decisao["proxima_pergunta"] = "Cumprimente (nome + pizzaria, só na 1ª vez) e pergunte o que ele vai querer hoje."
                else:
                    decisao["proxima_pergunta"] = (
                        "Cumprimente (nome + pizzaria, só na 1ª vez) e pergunte se ele gostaria de ver o cardápio. "
                        "Ex.: 'Olá, boa noite! Sou a Camila da Pizzaria Palazio 😊 Gostaria de ver o cardápio?'"
                    )
                    estado["cardapio_ofertado"] = True
            else:
                decisao["acao"] = "coletar_item"
                if ja_tem_cardapio:
                    decisao["proxima_pergunta"] = "Pergunte o que ele gostaria de pedir (não cumprimente nem diga seu nome, vá direto ao ponto)."
                else:
                    decisao["proxima_pergunta"] = (
                        "Pergunte se ele gostaria de ver o cardápio (não cumprimente nem diga seu nome, vá direto ao ponto). "
                        "Ex.: 'Quer que eu te mande o cardápio? 😊'"
                    )
                    estado["cardapio_ofertado"] = True
        estado["apresentou"] = True
        return {"decisao": decisao, "estado": estado}

    # Tem itens resolvidos → segue o funil
    estado["apresentou"] = True
    itens_fmt = [f"{i['quantidade']}x {i['nome']} (R$ {i['preco_unit']:.2f})" for i in calc["itens"]]
    resumo_dados = {
        "itens": itens_fmt,
        "taxa_entrega": round(float(calc["taxa_entrega"]), 2),
        "total": round(float(calc["valor_total"]), 2),
        "observacoes": estado.get("observacoes"),
    }

    # Modo de pagamento na conversa. Em 'desativado', nunca há "pagar agora pela
    # conversa": força pagar na entrega mesmo que o cliente tenha dito Pix.
    modo_pag = _modo_pagamento(ctx.pizzaria)
    if modo_pag == "desativado":
        estado["pagar_agora"] = False
    falta_pagar_agora = (
        modo_pag != "desativado"
        and _online(estado.get("pagamento"))
        and estado.get("pagar_agora") is None
    )
    tudo_coletado = (
        bool(estado.get("tipo"))
        and (estado["tipo"] != "delivery" or bool(estado.get("endereco")))
        and bool(estado.get("pagamento"))
        and not falta_pagar_agora
    )

    # CONFIRMAÇÃO (checada ANTES de reperguntar): se já mostramos o resumo e o
    # cliente confirmou ("sim/pode/ok/fechar"...), REGISTRA o pedido.
    if tudo_coletado and estado.get("etapa") == "AGUARDANDO_CONFIRMACAO" and _eh_confirmacao(intencao, user_input):
        reg = await registrar_pedido(
            ctx, db,
            itens=estado["carrinho"],
            valor_total=float(calc["valor_total"]),
            tipo=estado["tipo"],
            forma_pagamento=estado["pagamento"],
            pagar_agora=bool(estado.get("pagar_agora")),
            endereco_entrega=estado.get("endereco"),
            observacoes=estado.get("observacoes"),
            confirmado=True,  # FSM já validou a confirmação
            bairro_confirmado=estado.get("endereco_bairro"),
        )
        if not reg.get("ok"):
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(f"Falha ao registrar: {reg.get('erro')}")
            return {"decisao": decisao, "estado": estado}
        estado["etapa"] = "FINALIZADO"
        decisao["acao"] = "pedido_registrado"
        pag = reg.get("pagamento") or {}
        cobr_ok = bool(pag.get("ok"))
        metodo_cobr = pag.get("metodo")  # "pix" | "pix_manual" | "link" (cartão/checkout)
        decisao["dados"] = {"numero_pedido": reg.get("numero_pedido"),
                            "tempo_estimado": reg.get("tempo_estimado")}
        # Mensagem de pagamento adaptada ao MÉTODO real (não assume Pix).
        if cobr_ok and metodo_cobr == "pix":
            pag_fato = "O QR e o código Pix JÁ foram enviados ao cliente acima."
            pag_pergunta = "Avise que o Pix (QR + código) está aí em cima e que você confirma assim que o pagamento cair."
        elif cobr_ok and metodo_cobr == "pix_manual":
            pag_fato = "O código Pix (copia-e-cola) JÁ foi enviado ao cliente acima."
            pag_pergunta = "Avise que o Pix está aí em cima e que, assim que ele mandar o comprovante, a equipe confere e confirma."
        elif cobr_ok and metodo_cobr:  # link de cartão/checkout
            pag_fato = "O LINK de pagamento (cartão) JÁ foi enviado ao cliente acima."
            pag_pergunta = "Avise que o link de pagamento está aí em cima e que você confirma assim que o pagamento cair."
        else:
            # pagar na entrega/dinheiro, ou cobrança não gerada
            pag_fato = ""
            pag_pergunta = ""
        decisao["fatos"].append(
            f"Pedido REGISTRADO (#{reg.get('numero_pedido')}), tempo {reg.get('tempo_estimado')}. " + pag_fato
        )
        decisao["proxima_pergunta"] = (
            "Confirme que o pedido foi fechado, dizendo o número e o tempo estimado. NÃO repita o resumo "
            "nem invente forma de pagamento. " + pag_pergunta
        )
        # BLINDAGEM (Pilar 2): mensagem de fechamento escrita pelo backend (verbatim).
        decisao["mensagem_pronta"] = _montar_registro_msg(
            reg.get("numero_pedido"), reg.get("tempo_estimado"), metodo_cobr, cobr_ok
        )
        return {"decisao": decisao, "estado": estado}

    # 0a) RESPOSTA ao upsell: no turno anterior oferecemos bebida/borda/adicional e
    # estamos esperando o cliente responder. Se ele ACEITOU mas NÃO disse o quê
    # (ex.: só "quero"), LISTAMOS as opções reais e perguntamos qual — em vez de
    # seguir direto pro funil (bug: pedido fechava sem a bebida que o cliente quis).
    if estado.get("aguardando_upsell"):
        estado["aguardando_upsell"] = False
        estado.pop("upsell_item_unico", None)  # consumido no aceite ou descartado aqui
        adicionou_algo = bool(dados.get("produtos"))  # _aplicar_nlu já pôs no carrinho
        if not adicionou_algo and _afirmou_upsell(intencao, user_input):
            opc = await _opcoes_upsell(ctx, db)
            partes = []
            if opc["bebidas"]:
                partes.append("Bebidas: " + ", ".join(opc["bebidas"][:8]))
            if opc["bordas"]:
                partes.append("Bordas: " + ", ".join(opc["bordas"][:8]))
            if opc["adicionais"]:
                partes.append("Adicionais: " + ", ".join(opc["adicionais"][:8]))
            if opc.get("sobremesas"):
                partes.append("Sobremesas: " + ", ".join(opc["sobremesas"][:8]))
            if partes:
                estado["etapa"] = "COLETA_ITENS"
                decisao["acao"] = "coletar_item"
                decisao["fatos"].append(
                    "O cliente quer adicionar algo, mas não disse o quê. Base de conhecimento "
                    "para você (NÃO liste a menos que ele peça): " + " | ".join(partes)
                )
                decisao["proxima_pergunta"] = (
                    "Pergunte de forma curta se o cliente gostaria de ver as opções que temos "
                    "disponíveis ou se ele já tem alguma opção em mente. NÃO liste os itens "
                    "ainda, a não ser que ele tenha pedido para ver as opções."
                )
                return {"decisao": decisao, "estado": estado}
        # Recusou, mudou de assunto, ou já escolheu um item → segue o funil normal.

    # 0b) UPSELL sutil — uma única vez, logo após o 1º item entrar no carrinho.
    # Só oferece o que a casa REALMENTE tem (bebida/borda/adicional); se não há nada
    # pra oferecer, pula o upsell silenciosamente.
    from app.agent.behavior import get_behavior
    vendas_cfg = get_behavior(ctx.personalidade).vendas
    ofertas_feitas = int(estado.get("upsell_ofertas") or (1 if estado.get("upsell_feito") else 0))
    tamanho_carrinho = len(estado.get("carrinho") or [])
    pode_oferecer = (
        vendas_cfg.habilitado
        and vendas_cfg.max_ofertas > ofertas_feitas
        and tamanho_carrinho > int(estado.get("upsell_ultimo_tamanho") or 0)
    )
    if pode_oferecer:
        estado["upsell_feito"] = True
        estado["upsell_ofertas"] = ofertas_feitas + 1
        estado["upsell_ultimo_tamanho"] = tamanho_carrinho
        opc = await _opcoes_upsell(ctx, db)
        ofertas = []
        if opc["bordas"]:
            ofertas.append("uma borda recheada")
        if opc["adicionais"]:
            ofertas.append("um adicional")
        if opc["bebidas"]:
            ofertas.append("uma bebida")
        if opc.get("sobremesas"):
            ofertas.append("uma sobremesa")
        if ofertas:
            estado["etapa"] = "COLETA_ITENS"
            estado["aguardando_upsell"] = True
            # Uma ÚNICA opção no total (ex.: só a Coca Cola 2L)? Guarda o nome:
            # se o cliente aceitar com um "quero" seco, adicionamos ESSE item
            # direto — jamais "qual você quer?" com uma opção só.
            todas_opcoes = (
                opc["bebidas"] + opc["bordas"] + opc["adicionais"]
                + (opc.get("sobremesas") or [])
            )
            if len(todas_opcoes) == 1:
                estado["upsell_item_unico"] = todas_opcoes[0]
            decisao["acao"] = "upsell"
            # Só os NOMES no upsell (sem preço) — o valor só aparece no resumo verbatim.
            itens_nomes = [f"{i['quantidade']}x {i['nome']}" for i in calc["itens"]]
            decisao["fatos"].append("Anotei: " + "; ".join(itens_nomes))

            partes = []
            if opc["bebidas"]:
                partes.append("bebidas (" + ", ".join(opc["bebidas"][:6]) + ")")
            if opc["bordas"]:
                partes.append("bordas (" + ", ".join(opc["bordas"][:6]) + ")")
            if opc["adicionais"]:
                partes.append("adicionais (" + ", ".join(opc["adicionais"][:6]) + ")")
            if opc.get("sobremesas"):
                partes.append("sobremesas (" + ", ".join(opc["sobremesas"][:6]) + ")")
            decisao["fatos"].append(
                "Base de conhecimento para você (NÃO diga essas opções a não ser que ele peça): " + " · ".join(partes)
            )

            opcoes_txt = []
            if opc["bebidas"]:
                opcoes_txt.append("uma bebida")
            if opc["bordas"]:
                opcoes_txt.append("uma borda")
            if opc["adicionais"]:
                opcoes_txt.append("algum adicional")
            if opc.get("sobremesas"):
                opcoes_txt.append("uma sobremesa")
            opcoes_juntas = " ou ".join(opcoes_txt)

            decisao["proxima_pergunta"] = (
                f"De forma SUTIL e curta, pergunte APENAS se ele gostaria de adicionar {opcoes_juntas} "
                "para acompanhar. NÃO invente marcas ou sabores e não liste quais são os itens ou nomes agora, sob nenhuma hipótese! "
                "Faça só a pergunta genérica (ex.: 'Gostaria de alguma bebida para acompanhar?')."
            )
            return {"decisao": decisao, "estado": estado}
        # Nada pra oferecer → não faz upsell; cai direto no funil (entrega/pagamento).

    # 1) tipo de entrega
    if not estado.get("tipo"):
        estado["etapa"] = "ENTREGA"
        decisao["acao"] = "pedir_info"
        # A instrução antiga trazia o exemplo "Coca anotada!" em TODA mensagem e
        # pedia pra confirmar "se" houvesse item aceito: com o cliente recusando a
        # bebida ("não, só isso"), a voz copiava o exemplo e dizia "Coca anotada!".
        if itens_do_turno:
            decisao["proxima_pergunta"] = (
                f"Confirme em 2-3 palavras o que o cliente acabou de pedir ({', '.join(itens_do_turno)}) "
                "— não responda só 'Beleza'. Em seguida pergunte se vai ser ENTREGA ou RETIRADA "
                "(não repita o total)."
            )
        else:
            decisao["proxima_pergunta"] = (
                "Pergunte se vai ser ENTREGA ou RETIRADA (não repita o total). O cliente NÃO "
                "pediu nada novo nesta mensagem: NÃO diga que anotou ou adicionou algum item."
            )
        return {"decisao": decisao, "estado": estado}

    # 2) endereço (se delivery)
    if estado["tipo"] == "delivery" and not estado.get("endereco"):
        estado["etapa"] = "ENDERECO"
        decisao["acao"] = "pedir_info"
        decisao["proxima_pergunta"] = (
            "Peça o endereço completo e ofereça a opção de mandar a localização."
        )
        # Verbatim (a voz vinha OMITINDO a opção da localização — assim sempre sai).
        decisao["mensagem_pronta"] = (
            "Me passa seu endereço completo? (rua, número e bairro) [QUEBRA] "
            "Ou, se for mais fácil, é só me mandar sua localização aqui pelo WhatsApp 📍😉"
        )
        return {"decisao": decisao, "estado": estado}

    # 3) forma de pagamento
    if not estado.get("pagamento"):
        estado["etapa"] = "PAGAMENTO"
        decisao["acao"] = "pedir_info"
        # Se temos o cálculo com a taxa de entrega resolvida, instrui a IA a informá-la
        bairro = (calc.get("bairro_detectado") or "seu bairro") if calc else "seu bairro"
        taxa = float(calc.get("taxa_entrega") or 0.0) if calc else 0.0
        # Em 'desativado' não há pagamento online: ofereça só na entrega/retirada.
        local = "na retirada" if estado.get("tipo") == "retirada" else "na entrega"
        formas_txt = (
            f"a forma de pagamento (dinheiro ou cartão {local})"
            if modo_pag == "desativado"
            else "a forma de pagamento (pix, cartão ou dinheiro)"
        )
        if calc and calc.get("ok") and estado.get("tipo") == "delivery":
            # Valor e bairro saem PRONTOS do backend, como o resumo. Antes isto era
            # uma instrução para a LLM ("informe a taxa... use EXATAMENTE esse nome de
            # bairro, NUNCA repita...") e dava errado de dois jeitos em produção: o
            # modelo copiava a meta-instrução para o cliente, e cortava o "R$" porque
            # as regras gerais da voz proíbem citar valor. Valor é dado crítico.
            taxa_str = f"R$ {taxa:.2f}".replace(".", ",") if taxa > 0 else "grátis"
            opcoes = ("dinheiro ou cartão " + local) if modo_pag == "desativado" else "pix, cartão ou dinheiro"
            frase_taxa = (
                f"A entrega para *{bairro}* sai por {taxa_str} 🛵" if taxa > 0
                else f"A entrega para *{bairro}* é grátis 🛵"
            )
            decisao["mensagem_pronta"] = f"{frase_taxa} [QUEBRA] Como prefere pagar: {opcoes}?"
            decisao["mensagem_pronta_acao"] = decisao.get("acao")
        else:
            decisao["proxima_pergunta"] = f"Pergunte SÓ {formas_txt}. Não repita o total."
        return {"decisao": decisao, "estado": estado}

    # 4) pagar agora ou na entrega (se online)
    if falta_pagar_agora:
        estado["etapa"] = "PAGAMENTO"
        decisao["acao"] = "pedir_info"
        momento = "NA RETIRADA" if estado.get("tipo") == "retirada" else "NA ENTREGA"
        decisao["proxima_pergunta"] = f"Pergunte SÓ se quer pagar AGORA pela conversa ou {momento}. Não repita o total."
        return {"decisao": decisao, "estado": estado}

    # tudo coletado, mas ainda não confirmado → mostra o resumo UMA vez e pede confirmação
    estado["etapa"] = "AGUARDANDO_CONFIRMACAO"
    # Reseta o controle do lembrete: cada vez que (re)entramos no resumo, um novo
    # lembrete de confirmação pode ser enviado se o cliente sumir sem confirmar.
    estado["confirmacao_lembrada"] = False
    decisao["acao"] = "resumo_confirmar"
    decisao["dados"] = resumo_dados
    decisao["dados"]["tipo"] = estado["tipo"]
    decisao["dados"]["endereco"] = estado.get("endereco")
    decisao["proxima_pergunta"] = "Mostre o resumo (itens, entrega/retirada, total) UMA vez e pergunte 'Posso fechar o pedido?'. Não repita se já perguntou."
    # BLINDAGEM (Pilar 2): resumo com os VALORES escrito pelo backend (verbatim) —
    # a LLM nunca mais cita preço aqui, então nunca diverge.
    decisao["mensagem_pronta"] = _montar_resumo_msg(
        calc["itens"], float(calc["taxa_entrega"]), float(calc["valor_total"]),
        estado.get("tipo"), estado.get("endereco"),
        estado.get("pagamento"), estado.get("pagar_agora"), estado.get("observacoes"),
    )
    return {"decisao": decisao, "estado": estado}
