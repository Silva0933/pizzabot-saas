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
        "cardapio_enviado": False, "cardapio_ofertado": False,
        "apresentou": False, "upsell_feito": False,
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
    import unicodedata
    base = (nome or " ".join(sorted(sabores or []))).strip().lower()
    return "".join(c for c in unicodedata.normalize("NFD", base) if unicodedata.category(c) != "Mn")


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
        linhas.append("🛵 Retirada no balcão")
    if pagamento:
        nomes = {"pix": "Pix", "cartao": "Cartão", "dinheiro": "Dinheiro"}
        quando = ""
        if pagamento in ("pix", "cartao"):
            quando = " (agora pela conversa)" if pagar_agora else " (na entrega/retirada)"
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
    elif cobr_ok and metodo_cobr:
        linhas.append("O link de pagamento está aí em cima — é só finalizar por lá. 😊")
    else:
        linhas.append("Qualquer coisa, é só me chamar. 😊")
    return "\n".join(linhas)


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
            mudou = False
            if tamanho and existente.get("tamanho") != tamanho:
                existente["tamanho"] = tamanho
                mudou = True
            if adicionais:
                antes = set(existente.get("adicionais") or [])
                existente["adicionais"] = list({*antes, *adicionais})
                if set(existente["adicionais"]) != antes:
                    mudou = True
            if mudou:
                _descongelar(existente)  # item mudou → re-resolver o preço
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
                _descongelar(it)  # ganhou tamanho → re-resolver o preço
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
    if dados.get("observacoes") and isinstance(dados.get("observacoes"), str):
        obs = dados["observacoes"].strip()
        if obs:
            if estado.get("observacoes"):
                if obs.lower() not in estado["observacoes"].lower():
                    estado["observacoes"] = f"{estado['observacoes']}, {obs}"
            else:
                estado["observacoes"] = obs


def _online(pagamento: str | None) -> bool:
    return (pagamento or "") in ("pix", "cartao")


def _fatos_pizzaria(pizz) -> str:
    """Fatos reais da pizzaria pra voz responder dúvidas (sem inventar)."""
    partes = [f"Pizzaria: {getattr(pizz, 'nome', '') or ''}"]
    if getattr(pizz, "endereco", None):
        partes.append(f"Endereço: {pizz.endereco}")
    formas = getattr(pizz, "formas_pagamento_aceitas", None) or []
    if formas:
        partes.append("Pagamentos: " + ", ".join(formas))
    if getattr(pizz, "tempo_entrega_min", None):
        partes.append(f"Entrega ~{pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min")
    hf = getattr(pizz, "horario_funcionamento", None) or {}
    if hf:
        partes.append("Tem horário de funcionamento cadastrado (consulte se perguntarem).")
    return "DADOS REAIS DA PIZZARIA (use só estes; não invente): " + " · ".join(partes)


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
        bool(estado.get("cardapio_ofertado"))
        and not estado.get("cardapio_enviado")
        and not estado["carrinho"]
        and _eh_confirmacao(intencao, user_input)
    )
    if _quer_cardapio(intencao, user_input, dados) or confirmou_ver_cardapio:
        enviou_agora = False
        if not estado.get("cardapio_enviado"):
            try:
                r = await enviar_cardapio_arquivo(ctx, db)
                if r.get("ok"):
                    estado["cardapio_enviado"] = True
                    enviou_agora = True
                    try:
                        from app.services.conversation_state import save_state
                        await save_state(db, ctx.pizzaria.id, ctx.telefone, estado)
                        await db.commit()
                    except Exception as e_commit:
                        log.debug("Falha no commit preventivo de cardapio_enviado: %s", e_commit)
                elif r.get("motivo") == "sem_arquivo":
                    # Não há arquivo: a voz deve listar via buscar_cardapio.
                    decisao["fatos"].append("Não há arquivo de cardápio; liste os sabores em texto (use o que souber do cardápio).")
            except Exception:  # noqa: BLE001
                pass
        decisao["acao"] = "cardapio"
        if estado.get("cardapio_enviado"):
            decisao["fatos"].append("O cardápio (arquivo) JÁ foi enviado ao cliente acima.")
            # Mensagem verbatim (backend) — a LLM não improvisa "te mostro os sabores
            # em texto" nem pergunta o sabor. Curta e objetiva, como pedido.
            decisao["mensagem_pronta"] = "Cardápio enviado aí em cima 👆 Assim que escolher, é só me falar! 😊"

    # Funde dados extraídos no estado
    _aplicar_nlu(estado, dados)

    if dados.get("observacoes"):
        decisao["fatos"].append(f"Observação anotada do cliente: '{dados.get('observacoes')}'")

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
            observacoes=estado.get("observacoes"),
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

            # Pendência: item não encontrado / falta tamanho / taxa não cadastrada.
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(f"O sistema precisa resolver: {calc.get('erro')}")
            decisao["proxima_pergunta"] = "Resolva a pendência acima com o cliente (ex.: peça o tamanho, ou avise que não temos o item)."
            estado["etapa"] = "COLETA_ITENS"

            if prod_inv:
                prod_inv_lower = prod_inv.lower()
                is_beverage = any(k in prod_inv_lower for k in ("bebida", "refrigerante", "refri", "suco", "agua", "coca", "fanta", "guarana", "sprite", "soda", "cerva", "cerveja", "chopp", "lata", "garrafa"))
                if is_beverage:
                    try:
                        from app.agent.tools import buscar_cardapio
                        card_res = await buscar_cardapio(ctx, db, query="bebida", limit=15)
                        bebidas = [f"{item['nome']} (R$ {item['preco']:.2f})" for item in card_res.get("items", []) if "preco" in item]
                        if bebidas:
                            decisao["fatos"].append("Bebidas reais disponíveis no cardápio: " + ", ".join(bebidas))
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

        if user_input:
            try:
                from app.agent.tools import buscar_cardapio
                clean_query = user_input.replace("?", "").replace("!", "").strip()
                if len(clean_query) >= 3:
                    card_res = await buscar_cardapio(ctx, db, query=clean_query, incluir_descricao=True, limit=5)
                    items = card_res.get("items") or []
                    if items:
                        fatos_prod = []
                        for item in items:
                            desc = f" ({item['descricao']})" if item.get("descricao") else ""
                            fatos_prod.append(f"{item['nome']}: R$ {item['preco']:.2f}{desc}")
                        decisao["fatos"].append("Produtos encontrados no cardápio para esclarecer a dúvida do cliente: " + "; ".join(fatos_prod))
            except Exception:
                pass

        if estado["carrinho"]:
            decisao["proxima_pergunta"] = (
                "Responda com naturalidade ao que o cliente perguntou (use só os dados reais). "
                "Se ele perguntou se um item TEM um ingrediente (ex.: cebola): responda sim ou não e, se TIVER, "
                "pergunte se ele prefere pedir SEM esse ingrediente ou escolher outro sabor — NUNCA pule direto "
                "para confirmar o pedido. Caso contrário, responda e retome o pedido de leve, sem ser robótica."
            )
        else:
            oferta_cardapio = (
                "" if estado.get("cardapio_enviado")
                else " Se fizer sentido e ainda não enviou o cardápio, ofereça mostrá-lo."
            )
            decisao["proxima_pergunta"] = (
                "Responda com naturalidade EXATAMENTE ao que o cliente perguntou/disse, usando SÓ os dados reais. "
                "Se ele perguntou por um SABOR/PRODUTO específico: se ele aparece em 'Produtos encontrados no cardápio', "
                "confirme que TEMOS e diga o preço (se ele perguntou pelo preço); se NÃO aparecer ali, diga com gentileza "
                "que infelizmente não temos esse sabor." + oferta_cardapio +
                " Se ele só perguntou algo geral (ex.: se é a pizzaria X), responda direto. NÃO force 'qual sabor' "
                "se ele não pediu pizza."
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
                if ja_tem_cardapio:
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
            observacoes=estado.get("observacoes"),
            confirmado=True,  # FSM já validou a confirmação
        )
        if not reg.get("ok"):
            decisao["acao"] = "pendencia"
            decisao["fatos"].append(f"Falha ao registrar: {reg.get('erro')}")
            return {"decisao": decisao, "estado": estado}
        estado["etapa"] = "FINALIZADO"
        decisao["acao"] = "pedido_registrado"
        pag = reg.get("pagamento") or {}
        cobr_ok = bool(pag.get("ok"))
        metodo_cobr = pag.get("metodo")  # "pix" | "link" (cartão/checkout)
        decisao["dados"] = {"numero_pedido": reg.get("numero_pedido"),
                            "tempo_estimado": reg.get("tempo_estimado")}
        # Mensagem de pagamento adaptada ao MÉTODO real (não assume Pix).
        if cobr_ok and metodo_cobr == "pix":
            pag_fato = "O QR e o código Pix JÁ foram enviados ao cliente acima."
            pag_pergunta = "Avise que o Pix (QR + código) está aí em cima e que você confirma assim que o pagamento cair."
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

    # 0) UPSELL sutil — uma única vez, logo após o 1º item entrar no carrinho.
    if not estado.get("upsell_feito"):
        estado["upsell_feito"] = True
        estado["etapa"] = "COLETA_ITENS"
        decisao["acao"] = "upsell"
        tem_borda = any(
            isinstance(a, dict) and (a.get("tipo") or "").lower() == "borda"
            for a in (getattr(ctx.pizzaria, "adicionais", None) or [])
        )
        # Só os NOMES no upsell (sem preço) — o valor só aparece no resumo verbatim.
        itens_nomes = [f"{i['quantidade']}x {i['nome']}" for i in calc["itens"]]
        decisao["fatos"].append("Anotei: " + "; ".join(itens_nomes))
        oferta = "uma borda recheada ou uma bebida" if tem_borda else "uma bebida"
        decisao["proxima_pergunta"] = (
            f"De forma SUTIL e curta, pergunte se ele quer adicionar mais alguma coisa ({oferta}). "
            "Só ofereça borda se eu citei que há borda. Uma vez só, sem insistir; se ele recusar, siga."
        )
        return {"decisao": decisao, "estado": estado}

    # 1) tipo de entrega
    if not estado.get("tipo"):
        estado["etapa"] = "ENTREGA"
        decisao["acao"] = "pedir_info"
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
        # Se temos o cálculo com a taxa de entrega resolvida, instrui a IA a informá-la
        bairro = (calc.get("bairro_detectado") or "seu bairro") if calc else "seu bairro"
        taxa = float(calc.get("taxa_entrega") or 0.0) if calc else 0.0
        if calc and calc.get("ok") and estado.get("tipo") == "delivery":
            taxa_str = f"de R$ {taxa:.2f}".replace(".", ",") if taxa > 0 else "grátis"
            decisao["proxima_pergunta"] = (
                f"Informe ao cliente que a taxa de entrega para {bairro} é {taxa_str}. "
                "Em seguida, pergunte SÓ a forma de pagamento (pix, cartão ou dinheiro). Não repita o total."
            )
        else:
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
    # BLINDAGEM (Pilar 2): resumo com os VALORES escrito pelo backend (verbatim) —
    # a LLM nunca mais cita preço aqui, então nunca diverge.
    decisao["mensagem_pronta"] = _montar_resumo_msg(
        calc["itens"], float(calc["taxa_entrega"]), float(calc["valor_total"]),
        estado.get("tipo"), estado.get("endereco"),
        estado.get("pagamento"), estado.get("pagar_agora"), estado.get("observacoes"),
    )
    return {"decisao": decisao, "estado": estado}
