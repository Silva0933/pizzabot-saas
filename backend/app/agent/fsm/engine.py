"""
Camada 2 — Engine/FSM determinística.

Recebe a saída da NLU + o estado da conversa e DECIDE tudo no backend, sem deixar
a LLM no controle: monta o carrinho, resolve preços reais (reaproveitando os
serviços de pedido já testados), calcula taxa, avança a etapa do funil e registra
o pedido quando confirmado. Devolve uma "decisão" estruturada para a camada de voz.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.context import AgentContext

log = logging.getLogger(__name__)

ETAPAS = ("SAUDACAO", "COLETA_ITENS", "ENTREGA", "ENDERECO", "PAGAMENTO", "AGUARDANDO_CONFIRMACAO", "FINALIZADO")


def estado_inicial() -> dict[str, Any]:
    return {
        "pipeline": "fsm", "etapa": "SAUDACAO", "carrinho": [],
        "tipo": None, "endereco": None, "pagamento": None, "pagar_agora": None,
        "cardapio_enviado": False, "apresentou": False,
    }


def resumo_estado(estado: dict[str, Any]) -> str:
    """Texto curto do estado pra dar contexto à NLU."""
    c = estado.get("carrinho") or []
    itens = "; ".join(
        f"{i.get('qtd',1)}x {i.get('nome') or ' / '.join(i.get('sabores') or [])}"
        + (f" ({i.get('tamanho')})" if i.get("tamanho") else "")
        for i in c
    ) or "(vazio)"
    return (
        f"etapa={estado.get('etapa')}; carrinho={itens}; tipo={estado.get('tipo')}; "
        f"endereco={'sim' if estado.get('endereco') else 'nao'}; pagamento={estado.get('pagamento')}; "
        f"pagar_agora={estado.get('pagar_agora')}"
    )


def _chave_item(nome: str | None, sabores: list[str]) -> str:
    import unicodedata
    base = (nome or " ".join(sorted(sabores or []))).strip().lower()
    return "".join(c for c in unicodedata.normalize("NFD", base) if unicodedata.category(c) != "Mn")


def _aplicar_nlu(estado: dict[str, Any], dados: dict[str, Any]) -> None:
    """Funde os dados extraídos pela NLU no estado (carrinho e campos)."""
    # Adicionar produtos — com MERGE: se já existe item com o mesmo nome/sabores,
    # NÃO duplica; só completa o que faltava (tamanho/adicionais). Isso evita o
    # bug de "the pizza" + "quero a GG" virar 2 pizzas.
    for p in (dados.get("produtos") or []):
        if not isinstance(p, dict):
            continue
        nome = (p.get("nome") or "").strip()
        sabores = [s for s in (p.get("sabores_meia") or []) if s]
        if not nome and not sabores:
            continue
        tamanho = (p.get("tamanho") or None)
        adicionais = [a for a in (p.get("adicionais") or []) if a]
        chave = _chave_item(nome, sabores)

        existente = next(
            (it for it in estado["carrinho"] if _chave_item(it.get("nome"), it.get("sabores") or []) == chave),
            None,
        )
        if existente is not None:
            # Esclarecimento do mesmo item: atualiza tamanho/adicionais, não duplica.
            if tamanho:
                existente["tamanho"] = tamanho
            if adicionais:
                existente["adicionais"] = list({*(existente.get("adicionais") or []), *adicionais})
            continue

        estado["carrinho"].append({
            "nome": nome or None,
            "sabores": sabores,
            "tamanho": tamanho,
            "qtd": int(p.get("qtd") or 1),
            "adicionais": adicionais,
        })
    # Remover produtos (por nome aproximado)
    for rem in (dados.get("remover") or []):
        alvo = (rem or "").strip().lower()
        if not alvo:
            continue
        estado["carrinho"] = [
            it for it in estado["carrinho"]
            if alvo not in ((it.get("nome") or "") + " " + " ".join(it.get("sabores") or [])).lower()
        ]
    # Se o último item está sem tamanho e a NLU trouxe um tamanho avulso, aplica nele.
    tam_avulso = dados.get("tamanho") if isinstance(dados.get("tamanho"), str) else None
    if tam_avulso and estado["carrinho"]:
        for it in reversed(estado["carrinho"]):
            if not it.get("tamanho"):
                it["tamanho"] = tam_avulso
                break

    if dados.get("tipo_entrega") in ("delivery", "retirada"):
        estado["tipo"] = dados["tipo_entrega"]
    end = dados.get("endereco")
    if isinstance(end, dict) and any(end.get(k) for k in ("rua", "numero", "bairro")):
        partes = [end.get("rua"), end.get("numero"), end.get("bairro"), end.get("referencia")]
        estado["endereco"] = ", ".join(str(x) for x in partes if x)
    if dados.get("forma_pagamento") in ("pix", "cartao", "dinheiro"):
        estado["pagamento"] = dados["forma_pagamento"]
    if isinstance(dados.get("pagar_agora"), bool):
        estado["pagar_agora"] = dados["pagar_agora"]


def _online(pagamento: str | None) -> bool:
    return (pagamento or "") in ("pix", "cartao")


import re as _re

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


def _eh_grosseria(texto: str) -> bool:
    # Detecta ofensa explícita (não inclui pedido educado de atendente, que tem
    # intenção própria 'falar_humano' na NLU).
    t = (texto or "").lower()
    palavroes = ("merda", "porra", "caralho", "vai se", "vsf", "fdp", "filho da",
                 "idiota", "imbecil", "otario", "otária", "nojento")
    return any(p in t for p in palavroes)


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


async def processar(
    db: AsyncSession,
    ctx: AgentContext,
    estado: dict[str, Any],
    nlu: dict[str, Any],
    user_input: str = "",
) -> dict[str, Any]:
    """Executa um passo da FSM. Retorna a 'decisão' para a voz + estado atualizado."""
    from app.agent.tools import (
        _calcular_pedido, atualizar_pedido, cancelar_pedido, enviar_cardapio_arquivo,
        escalar_humano, registrar_avaliacao, registrar_pedido,
    )

    intencao = nlu.get("intencao")
    dados = nlu.get("dados") or {}

    decisao: dict[str, Any] = {
        "acao": "conversar", "fatos": [], "proxima_pergunta": None,
        "enviar_cardapio": False, "dados": {},
    }

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
        try:
            n = int(nota) if isinstance(nota, int) else 10
            r = await registrar_avaliacao(ctx, db, nota=n, comentario=user_input[:300])
            decisao["fatos"].append(f"Avaliação registrada: nota {n}.")
            if r.get("alerta"):
                decisao["fatos"].append(r["alerta"])
        except Exception:  # noqa: BLE001
            pass
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
        try:
            r = await atualizar_pedido(ctx, db, novo_endereco=novo_end, nova_forma_pagamento=nova_forma)
            decisao["fatos"].append(
                "Pedido atualizado." if r.get("ok") else f"Não consegui atualizar: {r.get('erro')}"
            )
        except Exception:  # noqa: BLE001
            pass
        decisao["acao"] = "pedido_atualizado"
        decisao["proxima_pergunta"] = "Confirme a alteração feita de forma curta."
        return {"decisao": decisao, "estado": estado}

    # Cancelar
    if intencao == "cancelar":
        # Se já existe um pedido REGISTRADO, cancela de verdade no sistema.
        if estado.get("etapa") == "FINALIZADO":
            try:
                r = await cancelar_pedido(ctx, db, motivo_cancelamento="Cancelado pelo cliente")
                decisao["fatos"].append(
                    f"Pedido #{r.get('numero_pedido')} cancelado." if r.get("ok") else f"Não consegui cancelar: {r.get('erro')}"
                )
            except Exception:  # noqa: BLE001
                pass
        else:
            decisao["fatos"].append("Pedido (rascunho) limpo.")
        estado.update(estado_inicial())
        estado["apresentou"] = True
        decisao["acao"] = "cancelado"
        decisao["proxima_pergunta"] = "Confirme o cancelamento e pergunte se quer começar um novo pedido."
        return {"decisao": decisao, "estado": estado}

    # Cardápio em arquivo — detectado por intenção OU por heurística (a mensagem
    # pode pedir pizza E cardápio ao mesmo tempo; a NLU só traz 1 intenção).
    if _quer_cardapio(intencao, user_input, dados):
        enviou_agora = False
        if not estado.get("cardapio_enviado"):
            try:
                r = await enviar_cardapio_arquivo(ctx, db)
                if r.get("ok"):
                    estado["cardapio_enviado"] = True
                    enviou_agora = True
                elif r.get("motivo") == "sem_arquivo":
                    # Não há arquivo: a voz deve listar via buscar_cardapio.
                    decisao["fatos"].append("Não há arquivo de cardápio; liste os sabores em texto (use o que souber do cardápio).")
            except Exception:  # noqa: BLE001
                pass
        decisao["acao"] = "cardapio"
        if estado.get("cardapio_enviado"):
            decisao["fatos"].append("O cardápio (arquivo) JÁ foi enviado ao cliente acima.")
            decisao["proxima_pergunta"] = "Diga curtinho que mandou o cardápio aí em cima e pergunte qual sabor ele quer."

    # Funde dados extraídos no estado
    _aplicar_nlu(estado, dados)

    # Resolve o carrinho (preços reais) sempre que houver itens
    calc = None
    if estado["carrinho"]:
        calc = await _calcular_pedido(
            ctx, db,
            itens=estado["carrinho"],
            tipo=estado.get("tipo") or "retirada",
            forma_pagamento=estado.get("pagamento") or "dinheiro",
            pagar_agora=bool(estado.get("pagar_agora")),
            endereco_entrega=estado.get("endereco"),
        )
        if not calc.get("ok"):
            # Pendência: item não encontrado / falta tamanho / taxa não cadastrada.
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(f"O sistema precisa resolver: {calc.get('erro')}")
            decisao["proxima_pergunta"] = "Resolva a pendência acima com o cliente (ex.: peça o tamanho, ou avise que não temos o item)."
            estado["etapa"] = "COLETA_ITENS"
            return {"decisao": decisao, "estado": estado}

    # Sem itens ainda → coleta
    if not estado["carrinho"]:
        estado["etapa"] = "SAUDACAO" if not estado.get("apresentou") else "COLETA_ITENS"
        if decisao["acao"] == "conversar":
            decisao["acao"] = "saudacao" if not estado.get("apresentou") else "coletar_item"
            decisao["proxima_pergunta"] = "Pergunte qual sabor de pizza ele quer (sem repetir saudação se já cumprimentou)."
        estado["apresentou"] = True
        return {"decisao": decisao, "estado": estado}

    # Tem itens resolvidos → segue o funil
    estado["apresentou"] = True
    itens_fmt = [f"{i['quantidade']}x {i['nome']} (R$ {i['preco_unit']:.2f})" for i in calc["itens"]]
    resumo_dados = {
        "itens": itens_fmt,
        "taxa_entrega": round(float(calc["taxa_entrega"]), 2),
        "total": round(float(calc["valor_total"]), 2),
    }

    falta_pagar_agora = _online(estado.get("pagamento")) and estado.get("pagar_agora") is None
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
            confirmado=True,  # FSM já validou a confirmação
        )
        if not reg.get("ok"):
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(f"Falha ao registrar: {reg.get('erro')}")
            return {"decisao": decisao, "estado": estado}
        estado["etapa"] = "FINALIZADO"
        decisao["acao"] = "pedido_registrado"
        pix_enviado = bool((reg.get("pagamento") or {}).get("ok"))
        decisao["dados"] = {"numero_pedido": reg.get("numero_pedido"),
                            "tempo_estimado": reg.get("tempo_estimado")}
        decisao["fatos"].append(
            f"Pedido REGISTRADO (#{reg.get('numero_pedido')}), tempo {reg.get('tempo_estimado')}. "
            + ("Pix/QR JÁ foi enviado ao cliente em mensagem separada." if pix_enviado else "")
        )
        decisao["proxima_pergunta"] = (
            "Confirme que o pedido foi fechado, dizendo o número e o tempo estimado. NÃO repita o resumo. "
            + ("Avise que o Pix está aí em cima e que você confirma assim que cair." if pix_enviado else "")
        )
        return {"decisao": decisao, "estado": estado}

    # 1) tipo de entrega
    if not estado.get("tipo"):
        estado["etapa"] = "ENTREGA"
        decisao["acao"] = "pedir_info"
        decisao["fatos"].append("Anotei: " + "; ".join(itens_fmt))
        decisao["proxima_pergunta"] = "Pergunte SÓ se vai ser ENTREGA ou RETIRADA (não repita o total)."
        return {"decisao": decisao, "estado": estado}

    # 2) endereço (se delivery)
    if estado["tipo"] == "delivery" and not estado.get("endereco"):
        estado["etapa"] = "ENDERECO"
        decisao["acao"] = "pedir_info"
        decisao["proxima_pergunta"] = "Peça SÓ o endereço completo (rua, número, bairro, referência). Não repita o total."
        return {"decisao": decisao, "estado": estado}

    # 3) forma de pagamento
    if not estado.get("pagamento"):
        estado["etapa"] = "PAGAMENTO"
        decisao["acao"] = "pedir_info"
        decisao["proxima_pergunta"] = "Pergunte SÓ a forma de pagamento (pix, cartão ou dinheiro). Não repita o total."
        return {"decisao": decisao, "estado": estado}

    # 4) pagar agora ou na entrega (se online)
    if falta_pagar_agora:
        estado["etapa"] = "PAGAMENTO"
        decisao["acao"] = "pedir_info"
        decisao["proxima_pergunta"] = "Pergunte SÓ se quer pagar AGORA pela conversa ou NA ENTREGA. Não repita o total."
        return {"decisao": decisao, "estado": estado}

    # tudo coletado, mas ainda não confirmado → mostra o resumo UMA vez e pede confirmação
    estado["etapa"] = "AGUARDANDO_CONFIRMACAO"
    decisao["acao"] = "resumo_confirmar"
    decisao["dados"] = resumo_dados
    decisao["dados"]["tipo"] = estado["tipo"]
    decisao["dados"]["endereco"] = estado.get("endereco")
    decisao["proxima_pergunta"] = "Mostre o resumo (itens, entrega/retirada, total) UMA vez e pergunte 'Posso fechar o pedido?'. Não repita se já perguntou."
    return {"decisao": decisao, "estado": estado}
