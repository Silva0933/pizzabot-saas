"""
Teste de estresse do atendimento: roda conversas roteirizadas contra o agente REAL.

Por que existe: os problemas do atendimento (loop, perder o fio, reenviar o
cardápio) só aparecem em conversa de várias trocas, com estado acumulado. Teste
unitário não pega isso, e testar pelo WhatsApp é lento, polui o histórico do
cliente e não é repetível.

Como funciona: usa o mesmo caminho do playground (`simulation=True`), que roda o
pipeline de verdade — NLU, FSM, ferramentas e geração de texto — mas bloqueia
efeito externo: não manda WhatsApp, não cria pedido, não cobra. Cada roteiro usa
uma sessão isolada (telefone sintético), limpa antes de começar.

Uso (dentro do container):
    python scripts/stress_atendimento.py                 # todos os roteiros
    python scripts/stress_atendimento.py --roteiro pedido_simples
    python scripts/stress_atendimento.py --repeticoes 3  # mede instabilidade
    python scripts/stress_atendimento.py --verbose       # mostra cada turno

Saída: por turno, a intenção detectada, a decisão do FSM, as ferramentas
chamadas e as falhas encontradas. No fim, um resumo por roteiro.

As checagens são deliberadamente grosseiras — procuram sintoma observável pelo
cliente (resposta repetida, estado que não anda, ferramenta que não foi usada),
não a "resposta certa". Julgar texto de LLM com regex daria falso alerta demais.
"""
from __future__ import annotations

import argparse
import asyncio
import time
import sys
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Acima disto o cliente já está esperando demais, e o FSM tem teto de 15s antes de
# cair no agente legado (que não conhece o estado do pedido).
LIMITE_SEGUNDOS = 8.0

# Pedaços do prompt interno que NUNCA podem chegar ao cliente. Vazou em produção:
# "use EXATAMENTE esse nome de bairro".
VAZAMENTOS = ["exatamente esse", "nunca repita", "sua tarefa", "[quebra]",
              "backend", "o sistema fez", "dados calculados"]


def _norm(s: str | None) -> str:
    """Minúsculas, sem acento — para comparar texto sem falso negativo."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


@dataclass
class Turno:
    diz: str
    # Falha se a resposta NÃO contiver nenhum destes trechos (normalizados).
    espera_algum: list[str] = field(default_factory=list)
    # Falha se a resposta contiver qualquer um destes.
    nao_pode: list[str] = field(default_factory=list)
    # Falha se nenhuma tool cujo nome contenha um destes for chamada.
    espera_tool: list[str] = field(default_factory=list)
    # Falha se a intenção detectada não for uma destas.
    espera_intencao: list[str] = field(default_factory=list)


@dataclass
class Roteiro:
    nome: str
    descricao: str
    turnos: list[Turno]


# ---------------------------------------------------------------------------
# Roteiros. Cobrem o caminho feliz e os desvios que mais quebram na prática.
# ---------------------------------------------------------------------------
ROTEIROS: list[Roteiro] = [
    Roteiro(
        "pedido_simples",
        "Saudação → cardápio → escolhe item → tamanho → retirada → confirma",
        [
            Turno("oi boa noite", espera_intencao=["saudacao"]),
            Turno("quero ver o cardapio", espera_intencao=["pedir_cardapio"],
                  espera_tool=["cardapio", "menu"]),
            Turno("vou querer uma calabresa", espera_intencao=["adicionar_item"],
                  nao_pode=["cardapio enviado"]),
            Turno("tamanho grande", espera_intencao=["adicionar_item", "informar_tamanho"],
                  nao_pode=["cardapio enviado"]),
            Turno("vou retirar no local", espera_intencao=["informar_entrega_retirada"],
                  nao_pode=["cardapio enviado"]),
            Turno("pode fechar", espera_intencao=["confirmar_resumo", "informar_pagamento"],
                  nao_pode=["cardapio enviado"]),
        ],
    ),
    Roteiro(
        "escolha_direta",
        "Cliente já pede o item pelo nome e tamanho, sem ver cardápio (o caso que travou)",
        [
            Turno("oi", espera_intencao=["saudacao"]),
            Turno("Eu vou querer uma the pizza tamanho M",
                  espera_intencao=["adicionar_item"],
                  nao_pode=["cardapio enviado"]),
            Turno("é isso mesmo", nao_pode=["cardapio enviado"]),
        ],
    ),
    Roteiro(
        "item_indisponivel",
        "Pede um item que não existe/está desligado — deve avisar, não ignorar",
        [
            Turno("boa noite"),
            Turno("quero uma pizza de jaca com sardinha tamanho G",
                  nao_pode=["cardapio enviado"]),
        ],
    ),
    Roteiro(
        "muda_de_ideia",
        "Adiciona, remove e troca — testa se o carrinho acompanha",
        [
            Turno("oi"),
            Turno("manda uma calabresa grande", espera_intencao=["adicionar_item"]),
            Turno("na verdade tira a calabresa", espera_intencao=["remover_item", "alterar_pedido"]),
            Turno("quero uma margherita media no lugar",
                  espera_intencao=["adicionar_item", "alterar_pedido"]),
        ],
    ),
    Roteiro(
        "entrega_endereco",
        "Fluxo de entrega: endereço e taxa",
        [
            Turno("oi"),
            Turno("quero uma calabresa grande"),
            Turno("é pra entrega", espera_intencao=["informar_entrega_retirada"]),
            Turno("rua das flores 123, centro", espera_intencao=["informar_endereco"],
                  espera_algum=["r$", "gratis"]),
        ],
    ),
    Roteiro(
        "falar_humano",
        "Pedido de atendente humano deve ser reconhecido de imediato",
        [
            Turno("oi"),
            Turno("quero falar com um atendente de verdade",
                  espera_intencao=["falar_humano"]),
        ],
    ),
    Roteiro(
        "ruido",
        "Mensagens fora do roteiro não podem derrubar o atendimento",
        [
            Turno("oi"),
            Turno("vcs abrem que horas?", espera_intencao=["duvida_geral", "conversa_fiada"]),
            Turno("kkkkk blz"),
            Turno("entao me ve uma calabresa grande", espera_intencao=["adicionar_item"]),
        ],
    ),
    Roteiro(
        "aceita_oferta",
        "Lado POSITIVO do 'sim': logo após a oferta, 'sim' TEM que mandar o cardápio",
        [
            Turno("oi", espera_intencao=["saudacao"]),
            Turno("sim", espera_intencao=["pedir_cardapio"], espera_tool=["cardapio"]),
        ],
    ),
    Roteiro(
        "pergunta_no_meio",
        "Dúvida no meio do pedido não pode virar 'cardápio enviado' (bug de produção)",
        [
            Turno("oi"),
            Turno("sim"),
            Turno("quero uma calabresa grande", espera_intencao=["adicionar_item"]),
            Turno("bebidas tem disponivel", nao_pode=["cardapio enviado"]),
            Turno("essa calabresa tem cebola?", nao_pode=["cardapio enviado"]),
        ],
    ),
]


async def _reset(db, pizzaria_id, telefone: str) -> None:
    from sqlalchemy import text
    for tabela in ("agente_memoria", "atendimento_estado"):
        await db.execute(
            text(f"DELETE FROM public.{tabela} WHERE pizzaria_id = :pid AND telefone = :tel"),
            {"pid": str(pizzaria_id), "tel": telefone},
        )
    await db.commit()


async def roda_roteiro(pizzaria_id, roteiro: Roteiro, *, verbose: bool) -> dict:
    from app.agent.fsm.pipeline import run_fsm_agent
    from app.db import AsyncSessionLocal

    sessao = uuid.uuid4()
    telefone = f"sim:{pizzaria_id.hex[:10]}:{sessao.hex}"
    falhas: list[str] = []
    anteriores: list[str] = []
    estados: list[str] = []

    async with AsyncSessionLocal() as db:
        await _reset(db, pizzaria_id, telefone)

        for i, turno in enumerate(roteiro.turnos, 1):
            try:
                t0 = time.perf_counter()
                res = await run_fsm_agent(db, pizzaria_id, telefone, turno.diz, simulation=True)
                dt = time.perf_counter() - t0
            except Exception as e:  # noqa: BLE001
                falhas.append(f"turno {i} ({turno.diz[:28]!r}): EXCEÇÃO {type(e).__name__}: {e}")
                break
            if res is None:
                falhas.append(f"turno {i}: pipeline FSM devolveu None (caiu no agente legado)")
                break

            texto = res.texto or ""
            tr = res.trace or {}
            intencao = tr.get("intent")
            estado = tr.get("state_after") or ""
            estados.append(estado)

            if verbose:
                print(f"    {i}. cliente: {turno.diz}")
                print(f"       intent={intencao} decisao={tr.get('decision')} tools={res.tool_calls} ({dt:.1f}s)")
                print(f"       bot: {texto[:100]!r}")

            n = _norm(texto)

            # 1) Resposta idêntica à anterior = loop percebido pelo cliente.
            if anteriores and n and n == anteriores[-1]:
                falhas.append(f"turno {i}: repetiu LITERALMENTE a resposta anterior ({texto[:45]!r})")
            anteriores.append(n)

            if dt > LIMITE_SEGUNDOS:
                falhas.append(f"turno {i}: LENTO {dt:.1f}s (limite {LIMITE_SEGUNDOS:.0f}s)")
            for v in VAZAMENTOS:
                if v in n:
                    falhas.append(f"turno {i}: VAZOU instrução interna ({v!r})")
            if tr.get("pipeline") == "legacy":
                falhas.append(f"turno {i}: caiu no agente LEGADO (perde o estado do pedido)")

            # 2) Resposta vazia.
            if not n.strip():
                falhas.append(f"turno {i}: resposta VAZIA")

            for proibido in turno.nao_pode:
                if _norm(proibido) in n:
                    falhas.append(f"turno {i}: disse {proibido!r} quando não devia")

            if turno.espera_algum and not any(_norm(e) in n for e in turno.espera_algum):
                falhas.append(f"turno {i}: não mencionou nenhum de {turno.espera_algum}")

            if turno.espera_tool:
                chamadas = " ".join(res.tool_calls or [])
                if not any(t in chamadas for t in turno.espera_tool):
                    falhas.append(f"turno {i}: nenhuma tool {turno.espera_tool} (chamou {res.tool_calls})")

            if turno.espera_intencao and intencao not in turno.espera_intencao:
                falhas.append(f"turno {i}: intent={intencao}, esperado um de {turno.espera_intencao}")

        # 3) Estado que nunca muda ao longo do roteiro = não está progredindo.
        if len(set(estados)) == 1 and len(estados) > 2:
            falhas.append(f"estado NUNCA mudou em {len(estados)} turnos: {estados[0][:70]}")

        await _reset(db, pizzaria_id, telefone)

    return {"roteiro": roteiro.nome, "turnos": len(roteiro.turnos), "falhas": falhas}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pizzaria", help="UUID (default: a primeira com pipeline_fsm)")
    ap.add_argument("--roteiro", help="roda só este roteiro")
    ap.add_argument("--repeticoes", type=int, default=1, help="repete para medir instabilidade")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    from sqlalchemy import text

    from app.db import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        if args.pizzaria:
            pid = uuid.UUID(args.pizzaria)
            nome = (await db.execute(
                text("SELECT nome FROM public.pizzarias WHERE id = :p"), {"p": str(pid)}
            )).scalar_one()
        else:
            row = (await db.execute(text(
                "SELECT id, nome FROM public.pizzarias WHERE pipeline_fsm = true "
                "ORDER BY created_at LIMIT 1"
            ))).first()
            if not row:
                print("Nenhuma pizzaria com pipeline_fsm=true.")
                return 2
            pid, nome = row[0], row[1]

    escolhidos = [r for r in ROTEIROS if not args.roteiro or r.nome == args.roteiro]
    if not escolhidos:
        print(f"Roteiro {args.roteiro!r} não existe. Disponíveis: {[r.nome for r in ROTEIROS]}")
        return 2

    print(f"Pizzaria: {nome} ({pid})")
    print(f"Roteiros: {len(escolhidos)} | repetições: {args.repeticoes} | modo simulação (sem efeito externo)\n")

    total_falhas = 0
    for rep in range(1, args.repeticoes + 1):
        if args.repeticoes > 1:
            print(f"--- rodada {rep}/{args.repeticoes} ---")
        for r in escolhidos:
            print(f"  [{r.nome}] {r.descricao}")
            res = await roda_roteiro(pid, r, verbose=args.verbose)
            if res["falhas"]:
                total_falhas += len(res["falhas"])
                for f in res["falhas"]:
                    print(f"      ✗ {f}")
            else:
                print(f"      ✓ {res['turnos']} turnos sem falha")
        print()

    print(f"TOTAL DE FALHAS: {total_falhas}")
    return 1 if total_falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
