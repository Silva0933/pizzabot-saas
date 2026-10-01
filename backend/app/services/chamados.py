"""
Chamado interno: a atendente pergunta à equipe em vez de transferir o cliente.

Ideia do dono da plataforma: quando a IA não tem a resposta (pergunta que
nenhum dado do sistema cobre) ou uma operação no pedido falha, ela abre um
chamado no painel, avisa o cliente com uma mensagem verdadeira ("vou confirmar
com a equipe") e segue atendendo o resto. A equipe responde no painel; a
resposta vira FATO para a voz e é entregue ao cliente. Com "salvar como
conhecimento", a próxima pergunta igual é respondida sozinha.

Sem resposta no prazo (`chamado_timeout_min`), o chamado expira: o cliente
recebe um aviso honesto e a conversa vira atendimento humano (alarme no painel)
— nunca fica esperando para sempre.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.fsm.catalogo import normalizar

log = logging.getLogger(__name__)

MSG_ESPERA = "Boa pergunta! Vou confirmar isso rapidinho com a equipe e já te respondo 😊"
MSG_AINDA_ESPERANDO = "Ainda estou confirmando aquilo com a equipe, já já te respondo 😊"
MSG_EXPIRADO = (
    "Desculpa a demora! 🙏 A equipe está com bastante movimento agora, "
    "mas já já alguém te responde por aqui."
)

_STOP = {
    "voces", "voce", "vcs", "tem", "tenho", "para", "pra", "pro", "pras", "pros", "com", "qual", "quais",
    "como", "onde", "quando", "pode", "posso", "isso", "essa", "esse", "aqui", "tambem", "mais", "muito",
    "sabe", "saber", "gostaria", "queria", "quero", "fazem", "faz", "sao", "sera", "seria",
    "que", "uma", "uns", "umas", "dos", "das", "nos", "nas", "por", "ele", "ela", "eles", "elas",
    "seu", "sua", "meu", "minha", "ate", "ola", "boa", "bom", "noite", "tarde", "favor", "obrigado", "obrigada",
}
# Negação muda a resposta ("com lactose" x "sem lactose"): nunca é descartada.
_NEGACAO = {"sem", "nao", "nunca", "nenhum", "nenhuma"}
# Abreviações comuns que a equipe e o cliente escrevem dos dois jeitos.
_SINONIMOS = {"vr": ("vale", "refeicao"), "va": ("vale", "alimentacao")}


def _tokens(texto: str) -> set[str]:
    """Palavras relevantes, por radical (5 primeiras letras: "aceita"/"aceitam",
    "refeição"/"refeições" caem no mesmo). Palavra curta conta inteira ("sul",
    "pix"), número conta sempre ("dia 24" x "dia 25") e negação também."""
    out: set[str] = set()
    for t in re.split(r"[^a-z0-9]+", normalizar(texto)):
        for p in _SINONIMOS.get(t, (t,)):
            if not p:
                continue
            if p in _NEGACAO:
                out.add("nao")
            elif p.isdigit():
                out.add(p)
            elif len(p) >= 3 and p not in _STOP:
                out.add(p[:5])
    return out


def casar_conhecimento(pergunta: str, itens: list[tuple[str, str]]) -> str | None:
    """Resposta salva para ESTA pergunta, ou None (a atendente pergunta à equipe).

    Casa só quando as palavras relevantes são as mesmas dos dois lados. Antes
    bastava 50% de sobreposição: a resposta de "Vocês entregam no Centro?" saía
    para "Vocês entregam no Centro Novo?" e "com lactose" casava com "sem
    lactose" (achado A10 da análise de 01/10). Errar para o lado de perguntar à
    equipe custa uma pergunta; errar para o outro é informação falsa ao cliente.
    Duas respostas salvas diferentes para a mesma pergunta = conflito → None.
    """
    alvo = _tokens(pergunta)
    if not alvo:
        return None
    respostas = {r.strip() for p, r in itens if _tokens(p) == alvo and (r or "").strip()}
    if len(respostas) != 1:
        return None
    return respostas.pop()


async def buscar_conhecimento(db: AsyncSession, pizzaria_id: Any, pergunta: str) -> str | None:
    from app.models import ConhecimentoLoja
    try:
        itens = (await db.execute(
            select(ConhecimentoLoja.pergunta, ConhecimentoLoja.resposta).where(
                ConhecimentoLoja.pizzaria_id == pizzaria_id, ConhecimentoLoja.ativo.is_(True),
            )
        )).all()
    except Exception as e:  # noqa: BLE001
        log.debug("Base de conhecimento indisponível: %s", e)
        return None
    return casar_conhecimento(pergunta, [(p, r) for p, r in itens])


def _contexto(estado: dict[str, Any]) -> dict[str, Any]:
    itens = []
    for it in estado.get("carrinho") or []:
        if isinstance(it, dict):
            nome = it.get("nome_congelado") or it.get("nome") or ""
            itens.append(f"{it.get('qtd', 1)}x {nome}")
    return {"etapa": estado.get("etapa"), "itens": itens, "tipo": estado.get("tipo"),
            "pagamento": estado.get("pagamento")}


async def abrir_chamado(
    db: AsyncSession, ctx: Any, *, pergunta: str, motivo: str, estado: dict[str, Any],
):
    """Cria o chamado, registra na conversa e avisa o painel. No playground só
    registra o evento simulado (devolve None)."""
    from app.models import ChamadoInterno, Conversa, Mensagem
    from app.services.broadcaster import broadcaster
    from app.services.telefones import mesmo_telefone, preferir_exato

    if getattr(ctx, "simulation", False) is True:
        ctx.simulation_events.append({"action": "abrir_chamado", "simulated": True, "motivo": motivo,
                                      "pergunta": pergunta[:200]})
        return None

    conv = (await db.execute(
        select(Conversa).where(
            Conversa.pizzaria_id == ctx.pizzaria.id,
            mesmo_telefone(Conversa.cliente_telefone, ctx.telefone),
        ).order_by(preferir_exato(Conversa.cliente_telefone, ctx.telefone))
    )).scalars().first()
    ch = ChamadoInterno(
        pizzaria_id=ctx.pizzaria.id, conversa_id=conv.id if conv else None, telefone=ctx.telefone,
        pergunta=pergunta[:1000], motivo=motivo, contexto=_contexto(estado),
    )
    db.add(ch)
    await db.flush()
    if conv is not None:
        db.add(Mensagem(
            conversa_id=conv.id, pizzaria_id=ctx.pizzaria.id, origem="sistema", tipo="texto",
            conteudo=f"🔔 Chamado para a equipe: {pergunta[:300]}",
            metadata_json={"trigger": "chamado_interno", "chamado_id": str(ch.id), "motivo": motivo},
        ))
    # Grava antes de avisar o painel (o painel busca o chamado ao receber o evento).
    await db.commit()
    await broadcaster.publish(ctx.pizzaria.id, {
        "tipo": "chamado.novo",
        "pizzaria_id": str(ctx.pizzaria.id),
        "payload": {
            "chamado_id": str(ch.id), "conversa_id": str(conv.id) if conv else None,
            "telefone": ctx.telefone, "cliente_nome": getattr(conv, "cliente_nome", None),
            "pergunta": pergunta[:300], "motivo": motivo,
        },
    })
    return ch


async def responder(
    db: AsyncSession, pizzaria_id: uuid.UUID, chamado_id: uuid.UUID, *,
    resposta: str, usuario_id: Any, salvar_conhecimento: bool,
):
    """Registra a resposta da equipe (rota do painel). Devolve o chamado ou None
    se ele não existe / já não está aberto."""
    from app.models import ChamadoInterno, ConhecimentoLoja

    ch = (await db.execute(
        select(ChamadoInterno).where(
            ChamadoInterno.id == chamado_id, ChamadoInterno.pizzaria_id == pizzaria_id,
        ).with_for_update()
    )).scalar_one_or_none()
    if ch is None or ch.status != "aberto":
        return None
    ch.status = "respondido"
    ch.resposta = resposta.strip()[:2000]
    ch.respondido_por = usuario_id
    ch.respondido_em = datetime.now(UTC)
    if salvar_conhecimento:
        db.add(ConhecimentoLoja(
            pizzaria_id=pizzaria_id, pergunta=ch.pergunta, resposta=ch.resposta, origem_chamado_id=ch.id,
        ))
    await db.commit()
    return ch


# Número seguido destas unidades não é dinheiro ("30 minutos", "2 km", "3 pizzas").
_UNIDADE_NAO_MONETARIA = re.compile(
    r"\s*(?:min\b|minutos?|h\b|hs\b|horas?|km|quil[oô]metros?|metros?|m\b|%|fatias?|peda[cç]os?|"
    r"pessoas?|unidades?|un\b|cm|litros?|l\b|ml|g\b|kg|anos?|dias?|pizzas?|sabores?|itens?|x\b)",
    re.IGNORECASE,
)
# Palavra de valor logo antes do número, na mesma frase ("a taxa pro Centro fica 8").
_PALAVRA_DE_VALOR = re.compile(
    r"(?:taxa|valor|pre[cç]o|custa|custo|cobr\w*|acr[eé]scimo|desconto|adicional|fica|sai por|total)"
    r"[^\d.!?\n]{0,40}$",
    re.IGNORECASE,
)


def _precos_da_resposta(resposta: str) -> list[float]:
    """Valores (R$) ditos pela equipe: são lastro válido para o guard de preço.

    Só conta número com cara de dinheiro: "R$ 8", "8 reais", "8,50", ou logo
    depois de taxa/valor/preço/custa/fica... Antes QUALQUER número virava preço
    autorizado: "Entregamos em 30 minutos no número 120" liberava a voz a falar
    "R$ 30" e "R$ 120" (achado A09 da análise de 01/10)."""
    from app.services.price_check import _parse_valor
    texto = resposta or ""
    out = []
    for m in re.finditer(r"(?<![\d.,])(\d{1,4}(?:[.,]\d{1,2})?)(?![\d])", texto):
        antes, depois = texto[: m.start()], texto[m.end():]
        com_rs = re.search(r"r\$\s*$", antes, re.IGNORECASE) is not None
        com_reais = re.match(r"\s*(?:reais|real)\b", depois, re.IGNORECASE) is not None
        if not (com_rs or com_reais):
            if _UNIDADE_NAO_MONETARIA.match(depois):
                continue
            centavos = re.search(r"[.,]\d{2}$", m.group(1)) is not None
            if not (centavos or _PALAVRA_DE_VALOR.search(antes)):
                continue
        v = _parse_valor(m.group(1))
        if v is not None:
            out.append(round(float(v), 2))
    return out


async def _limpar_pendente(db: AsyncSession, pizzaria_id: Any, telefone: str) -> None:
    from app.services.conversation_state import load_state, save_state
    try:
        estado = await load_state(db, pizzaria_id, telefone)
        if isinstance(estado, dict) and estado.get("chamado_pendente"):
            estado.pop("chamado_pendente", None)
            await save_state(db, pizzaria_id, telefone, estado)
    except Exception as e:  # noqa: BLE001
        log.debug("Não limpei o chamado pendente do estado: %s", e)


async def entregar_resposta(db: AsyncSession, chamado_id: uuid.UUID) -> dict[str, Any]:
    """Leva a resposta da equipe ao cliente pela voz da atendente (worker)."""
    from app.agent.failover import com_failover
    from app.agent.fsm import voice
    from app.agent.fsm.guard import blindar
    from app.agent.memory import append_turn
    from app.models import ChamadoInterno, Conversa, Mensagem, PersonalidadeAtendente, Pizzaria
    from app.services.app_config import get_llm_config, modelo_para_plano
    from app.services.broadcaster import broadcaster
    from app.services.evolution import evolution

    ch = (await db.execute(select(ChamadoInterno).where(ChamadoInterno.id == chamado_id))).scalar_one_or_none()
    if ch is None or ch.status != "respondido" or not ch.resposta:
        return {"ok": False, "motivo": "sem_resposta"}
    pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == ch.pizzaria_id))).scalar_one()
    conv = (await db.execute(select(Conversa).where(Conversa.id == ch.conversa_id))).scalar_one_or_none() \
        if ch.conversa_id else None
    await _limpar_pendente(db, pizz.id, ch.telefone)
    if conv is not None and not conv.bot_ativo:
        # Um humano assumiu a conversa: ele fala direto com o cliente.
        ch.contexto = {**(ch.contexto or {}), "mensagem_ao_cliente": None, "humano_assumiu": True}
        await db.commit()
        return {"ok": False, "motivo": "humano_assumiu"}
    personalidade = (await db.execute(
        select(PersonalidadeAtendente).where(PersonalidadeAtendente.pizzaria_id == pizz.id)
    )).scalar_one_or_none()

    validos = _precos_da_resposta(ch.resposta)
    decisao = {
        "acao": "responder_duvida",
        "fatos": [
            f"A EQUIPE DA LOJA respondeu à dúvida do cliente (\"{ch.pergunta[:200]}\"): \"{ch.resposta}\". "
            "Isso é verdade confirmada pela loja."
        ],
        "proxima_pergunta": (
            "Transmita a resposta da equipe ao cliente de forma natural e curta (ex.: 'Confirmei aqui: ...'). "
            "Se havia pedido em andamento, retome de leve com a próxima pergunta."
        ),
        "precos_validos": validos,
    }
    texto = ""
    try:
        cfg = await get_llm_config(db)
        model = modelo_para_plano(cfg, getattr(pizz, "plano", None))
        comando = voice.montar_comando(
            personalidade=personalidade, pizzaria_nome=pizz.nome, decisao=decisao,
            ja_apresentou=True, user_input=ch.pergunta,
        )

        async def _voz(prov: str, key: str, mdl: str):
            return await voice.gerar_voz(provider=prov, api_key=key, model=mdl, comando=comando,
                                         reasoning=cfg.get("voz_reasoning") or None)

        (texto, _u), _p, _m = await com_failover(_voz, cfg=cfg, model=model)
        texto, _c = blindar(texto, ja_apresentou=True, precos_validos=validos,
                            persona_nome=getattr(personalidade, "nome", None) or "Camila")
    except Exception as e:  # noqa: BLE001
        log.warning("Voz do chamado falhou (%s); mandando a resposta da equipe direto.", e)
    if not texto or "(valor a confirmar)" in texto:
        texto = f"Confirmei aqui com a equipe: {ch.resposta}"
    texto = texto.replace("[QUEBRA]", "\n\n")

    if pizz.instancia:
        await evolution.send_text(instancia=pizz.instancia, numero=ch.telefone, texto=texto)
    await append_turn(db, pizz.id, ch.telefone, role="assistant", content=texto)
    # O chat interno mostra o que a atendente disse ao cliente com a resposta da
    # equipe: o dono vê que ela resolveu (reatribui o dict: JSONB não rastreia mutação).
    ch.contexto = {**(ch.contexto or {}), "mensagem_ao_cliente": texto}
    msg = None
    if conv is not None:
        msg = Mensagem(conversa_id=conv.id, pizzaria_id=pizz.id, origem="bot", tipo="texto", conteudo=texto,
                       metadata_json={"trigger": "chamado_respondido", "chamado_id": str(ch.id)})
        db.add(msg)
        conv.last_message = texto
        conv.last_timestamp = datetime.now(UTC)
    await db.commit()
    if conv is not None and msg is not None:
        await broadcaster.publish(pizz.id, {
            "tipo": "mensagem.nova", "pizzaria_id": str(pizz.id),
            "payload": {"conversa_id": str(conv.id), "mensagem_id": str(msg.id), "telefone": ch.telefone,
                        "conteudo": texto, "origem": "bot",
                        "created_at": msg.created_at.isoformat() if msg.created_at else None},
        })
    await broadcaster.publish(pizz.id, {
        "tipo": "chamado.respondido", "pizzaria_id": str(pizz.id),
        "payload": {"chamado_id": str(ch.id), "conversa_id": str(conv.id) if conv else None},
    })
    return {"ok": True, "texto": texto}


async def expirar_vencidos(db: AsyncSession) -> int:
    """Beat: chamado aberto além do prazo vira atendimento humano (com alarme)."""
    from app.agent.behavior import get_behavior
    from app.models import ChamadoInterno, Conversa, Mensagem, PersonalidadeAtendente, Pizzaria
    from app.services.broadcaster import broadcaster
    from app.services.evolution import evolution

    abertos = (await db.execute(
        select(ChamadoInterno).where(
            ChamadoInterno.status == "aberto",
            ChamadoInterno.created_at < datetime.now(UTC) - timedelta(minutes=2),
        )
    )).scalars().all()
    expirados = 0
    prazo_cache: dict[Any, int] = {}
    for ch in abertos:
        if ch.pizzaria_id not in prazo_cache:
            pers = (await db.execute(select(PersonalidadeAtendente).where(
                PersonalidadeAtendente.pizzaria_id == ch.pizzaria_id))).scalar_one_or_none()
            prazo_cache[ch.pizzaria_id] = get_behavior(pers).handoff.chamado_timeout_min
        if ch.created_at > datetime.now(UTC) - timedelta(minutes=prazo_cache[ch.pizzaria_id]):
            continue
        ch.status = "expirado"
        pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == ch.pizzaria_id))).scalar_one()
        conv = (await db.execute(select(Conversa).where(Conversa.id == ch.conversa_id))).scalar_one_or_none() \
            if ch.conversa_id else None
        await _limpar_pendente(db, pizz.id, ch.telefone)
        if conv is not None and conv.bot_ativo:
            try:
                if pizz.instancia:
                    await evolution.send_text(instancia=pizz.instancia, numero=ch.telefone, texto=MSG_EXPIRADO)
            except Exception as e:  # noqa: BLE001
                log.warning("Aviso de chamado expirado não enviado: %s", e)
            conv.bot_ativo = False
            conv.status = "humano_necessario"
            db.add(Mensagem(
                conversa_id=conv.id, pizzaria_id=pizz.id, origem="sistema", tipo="texto",
                conteudo=f"⏰ Ninguém respondeu o chamado a tempo: \"{ch.pergunta[:200]}\". Atendimento transferido para humano.",
                metadata_json={"trigger": "chamado_expirado", "chamado_id": str(ch.id)},
            ))
        await db.commit()
        expirados += 1
        if conv is not None:
            await broadcaster.publish(pizz.id, {
                "tipo": "atendimento.humano", "pizzaria_id": str(pizz.id),
                "payload": {"conversa_id": str(conv.id), "telefone": ch.telefone,
                            "cliente_nome": conv.cliente_nome,
                            "motivo": f"Chamado sem resposta: {ch.pergunta[:120]}"},
            })
        await broadcaster.publish(pizz.id, {
            "tipo": "chamado.expirado", "pizzaria_id": str(pizz.id),
            "payload": {"chamado_id": str(ch.id), "conversa_id": str(conv.id) if conv else None},
        })
    return expirados
