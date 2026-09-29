"""
Teste de carga do agente — descobre o TETO de vazão com segurança, em produção.

O que ele faz
-------------
Dispara N conversas simultâneas pelo pipeline FSM real (NLU + engine + voz +
banco) em MODO SIMULAÇÃO — o mesmo do "Testar agente" do painel:
  * NENHUM pedido é gravado, nenhuma cobrança é gerada, nada vai pro WhatsApp,
    nenhum alarme toca no painel (tools.py: _simulated bloqueia os efeitos);
  * Evolution e broadcaster ficam stubados por garantia.
Mede latência por mensagem (p50/p95/p99), vazão (msg/s) e erros.

Antes (até 29/09) o script chamava o caminho de produção sem simulação: o
roteiro "pode fechar o pedido" criava pedidos de verdade no quadro da pizzaria,
e o modo "infra" não interceptava a NLU de comandos (gastava token mesmo assim).

Dois modos de LLM
-----------------
  --mode infra  (padrão) NLU e voz trocadas por um atraso simulado (--llm-delay).
                Sem token. Estressa banco/pool/servidor em alta concorrência.
  --mode real   Provedor configurado no painel admin — latência REAL da IA.
                CONSOME TOKEN. Comece com pouca concorrência.

Proteção do banco de produção
-----------------------------
Cada conversa em voo segura 1 conexão durante a "chamada de LLM". O script
confere as conexões LIVRES do Postgres antes de cada nível e PULA o nível que
não cabe (deixando folga pro atendimento real). Rode fora do horário de pico.

Exemplos (dentro do container da API)
-------------------------------------
  # Infra, sem custo — o teto de banco/servidor:
  python scripts/load_test.py --pizzaria "Palazio" --sweep 10,20,40 --conversations 60 --yes --cleanup

  # Real, com a IA de verdade (gasta token!), devagar:
  python scripts/load_test.py --pizzaria "Palazio" --mode real --sweep 2,5,10 --conversations 10 --yes --cleanup

  # Limpar dados sintéticos de execuções anteriores:
  python scripts/load_test.py --pizzaria "Palazio" --cleanup-only

Limites (honestos)
------------------
* Não passa pelo webhook/fila/debounce/dispatcher: mede o custo de PROCESSAR a
  mensagem, que é o gargalo. Some ~7 s de debounce para a espera do cliente.
* Um único processo: a concorrência do teste ≈ DISPATCHER_CONCURRENCY de uma réplica.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
from dataclasses import dataclass, field

# Bootstrap de path: rodando como `python scripts/load_test.py`, o Python só põe
# `.../scripts` no sys.path — não o diretório `/app` que contém o pacote `app`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FOLGA_CONEXOES = 15  # conexões que o teste nunca toca (atendimento real + painel)


# ------------------------------------------------------------------ #
# Stubs de saída (aplicados ANTES de qualquer disparo)
# ------------------------------------------------------------------ #
async def _anoop(*args, **kwargs):
    return None


def aplicar_stubs_saida() -> None:
    """Neutraliza tudo que sai pra fora (WhatsApp + painel). Idempotente."""
    import app.services.broadcaster as _b
    import app.services.evolution as _e

    _e.evolution.send_text = _anoop
    _e.evolution.send_media = _anoop
    _e.evolution.send_presence = _anoop
    _e.evolution.get_media_base64 = _anoop
    _b.broadcaster.publish = _anoop


# ------------------------------------------------------------------ #
# Stub de LLM (modo infra) — NLU de comandos, NLU livre e voz
# ------------------------------------------------------------------ #
def _intencao_fake(user_input: str) -> tuple[str, dict]:
    t = (user_input or "").lower()
    if any(p in t for p in ("oi", "ola", "olá", "boa noite", "boa tarde")):
        return "saudacao", {}
    if "quero" in t or "pizza" in t:
        return "adicionar_item", {}
    if "retirada" in t or "retirar" in t:
        return "informar_entrega_retirada", {"tipo_entrega": "retirada"}
    if any(p in t for p in ("dinheiro", "pix", "cartao", "cartão")):
        return "informar_pagamento", {"forma_pagamento": "dinheiro", "pagar_agora": False}
    if any(p in t for p in ("pode", "sim", "fechar", "confirma")):
        return "confirmar_resumo", {}
    return "duvida_geral", {}


def aplicar_stub_llm(llm_delay: float) -> None:
    import app.agent.fsm.nlu as _nlu
    import app.agent.fsm.nlu_comandos as _nlu_cmd
    import app.agent.fsm.voice as _voice

    async def _atraso():
        await asyncio.sleep(llm_delay * random.uniform(0.7, 1.3))

    async def fake_nlu_comandos(*, cat, user_input, **_kw):
        await _atraso()
        intencao, dados = _intencao_fake(user_input)
        produtos = []
        if intencao == "adicionar_item" and cat.produtos:
            # Produto REAL do catálogo, por ID — exercita o preço pelo catalogo.py.
            p = next((x for x in cat.produtos if x.tamanhos), cat.produtos[0])
            tam = p.tamanhos[-1][0] if p.tamanhos else None  # (nome, preço)
            produtos = [{"nome": p.nome, "produto_id": p.id, "qtd": 1, "tamanho": tam,
                         "adicionais": [], "sabores_meia": []}]
        return {
            "intencao": intencao, "confianca": 0.95,
            "dados": {"produtos": produtos, "_ops_itens": [], "_nlu": "comandos", **dados},
            "_usage": {}, "_modo": "simulado",
        }

    async def fake_nlu_livre(*, user_input, **_kw):
        await _atraso()
        intencao, dados = _intencao_fake(user_input)
        return {"intencao": intencao, "confianca": 0.95, "dados": dados, "_usage": {}}

    async def fake_voz(**_kw):
        await _atraso()
        return ("Resposta simulada 😊", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})

    _nlu_cmd.nlu_comandos = fake_nlu_comandos
    _nlu.nlu_extract = fake_nlu_livre
    _voice.gerar_voz = fake_voz


# ------------------------------------------------------------------ #
# Métricas
# ------------------------------------------------------------------ #
@dataclass
class Stats:
    latencias: list[float] = field(default_factory=list)
    ok: int = 0
    erros: int = 0
    motivos: dict[str, int] = field(default_factory=dict)

    def pct(self, p: float) -> float:
        if not self.latencias:
            return 0.0
        s = sorted(self.latencias)
        return s[max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))]


async def resolver_pizzaria(db, ident: str):
    import uuid

    from sqlalchemy import func, select

    from app.models import Pizzaria
    try:
        pid = uuid.UUID(ident)
        return (await db.execute(select(Pizzaria).where(Pizzaria.id == pid))).scalar_one_or_none()
    except (ValueError, AttributeError):
        return (await db.execute(
            select(Pizzaria).where(func.lower(Pizzaria.nome).like(f"%{ident.lower()}%"))
        )).scalars().first()


async def conexoes_livres(db) -> tuple[int, int, int]:
    """(livres, max_connections, em uso) — o que o teste pode ocupar sem sufocar a produção."""
    from sqlalchemy import text
    max_conn = int((await db.execute(text("SHOW max_connections"))).scalar())
    reservadas = int((await db.execute(text("SHOW superuser_reserved_connections"))).scalar())
    em_uso = int((await db.execute(text("SELECT count(*) FROM pg_stat_activity"))).scalar())
    return max_conn - reservadas - em_uso - FOLGA_CONEXOES, max_conn, em_uso


# ------------------------------------------------------------------ #
# Uma conversa = vários turnos, cada turno com sessão própria (igual prod)
# ------------------------------------------------------------------ #
async def rodar_conversa(pizzaria_id, telefone: str, turns: list[str], sem: asyncio.Semaphore,
                         stats: Stats, think_time: float) -> None:
    from app.agent.fsm.pipeline import run_fsm_agent
    from app.db import AsyncSessionLocal

    for msg in turns:
        async with sem:
            t0 = time.perf_counter()
            try:
                async with AsyncSessionLocal() as db:
                    res = await run_fsm_agent(db, pizzaria_id, telefone, msg, simulation=True)
                stats.latencias.append(time.perf_counter() - t0)
                if res is not None and (res.texto or "").strip():
                    stats.ok += 1
                else:
                    stats.erros += 1
                    stats.motivos["sem_texto"] = stats.motivos.get("sem_texto", 0) + 1
            except Exception as e:  # noqa: BLE001
                stats.erros += 1
                chave = f"EXC:{type(e).__name__}"
                stats.motivos[chave] = stats.motivos.get(chave, 0) + 1
        if think_time:
            await asyncio.sleep(think_time)


async def rodar_nivel(pizzaria_id, conc: int, n_conversas: int, turns: list[str],
                      prefixo: str, think_time: float) -> tuple[Stats, float]:
    sem = asyncio.Semaphore(conc)
    stats = Stats()
    tarefas = [
        rodar_conversa(pizzaria_id, f"{prefixo}{i:06d}", list(turns), sem, stats, think_time)
        for i in range(n_conversas)
    ]
    t0 = time.perf_counter()
    await asyncio.gather(*tarefas)
    return stats, time.perf_counter() - t0


async def limpar(db, pizzaria_id, prefixo: str) -> dict:
    """Estado e memória das sessões sintéticas (o modo simulação não grava pedido,
    conversa nem mensagem)."""
    from sqlalchemy import text
    apagados = {}
    for tabela in ("agente_memoria", "atendimento_estado"):
        try:
            r = await db.execute(
                text(f"DELETE FROM public.{tabela} WHERE pizzaria_id = :pid AND telefone LIKE :pref"),
                {"pid": str(pizzaria_id), "pref": f"{prefixo}%"},
            )
            apagados[tabela] = r.rowcount
        except Exception as e:  # noqa: BLE001
            apagados[tabela] = f"erro: {e}"
    await db.commit()
    return apagados


# ------------------------------------------------------------------ #
# Main
# ------------------------------------------------------------------ #
async def amain() -> int:
    ap = argparse.ArgumentParser(description="Teste de carga do agente PizzaBot (modo simulação).")
    ap.add_argument("--pizzaria", required=True, help="UUID ou nome (parcial) da pizzaria.")
    ap.add_argument("--mode", choices=["infra", "real"], default="infra",
                    help="infra=LLM simulada (sem token, padrão); real=LLM de verdade (gasta token).")
    ap.add_argument("--sweep", default=None, help="Concorrências, ex.: 10,20,40.")
    ap.add_argument("--concurrency", type=int, default=10, help="Concorrência (sem --sweep).")
    ap.add_argument("--conversations", type=int, default=40, help="Conversas por nível.")
    ap.add_argument("--turns", type=int, default=5, help="Mensagens por conversa.")
    ap.add_argument("--think-time", type=float, default=0.0, help="Pausa (s) entre turnos.")
    ap.add_argument("--llm-delay", type=float, default=2.0, help="[infra] atraso por chamada de LLM (s).")
    ap.add_argument("--produto", default="Calabresa", help="Produto citado no roteiro.")
    ap.add_argument("--phone-prefix", default="5500000", help="Prefixo dos telefones sintéticos.")
    ap.add_argument("--cleanup", action="store_true", help="Limpa os dados sintéticos ao final.")
    ap.add_argument("--cleanup-only", action="store_true", help="Só limpa e sai.")
    ap.add_argument("--yes", action="store_true", help="Confirma a execução.")
    args = ap.parse_args()

    niveis = [int(x) for x in args.sweep.split(",")] if args.sweep else [args.concurrency]
    # Pool do PRÓPRIO teste do tamanho do maior nível (antes de importar app.db).
    os.environ["DB_POOL_SIZE"] = str(max(niveis) + 2)
    os.environ["DB_MAX_OVERFLOW"] = "3"

    aplicar_stubs_saida()
    from app.db import AsyncSessionLocal, engine

    async with AsyncSessionLocal() as db:
        pizz = await resolver_pizzaria(db, args.pizzaria)
        if pizz is None:
            print(f"❌ Pizzaria não encontrada: {args.pizzaria!r}")
            return 2
        pizzaria_id = pizz.id
        print(f"🍕 Pizzaria: {pizz.nome} (pipeline_fsm={getattr(pizz, 'pipeline_fsm', False)})")
        if args.cleanup_only:
            print(f"🧹 Limpeza: {await limpar(db, pizzaria_id, args.phone_prefix)}")
            await engine.dispose()
            return 0
        if not getattr(pizz, "pipeline_fsm", False):
            print("❌ Esta pizzaria não usa o pipeline FSM; o teste mede só o FSM.")
            return 2

    roteiro = ["Oi", f"quero uma pizza {args.produto} grande", "vai ser retirada",
               "vou pagar em dinheiro", "pode fechar o pedido"]
    turns = (roteiro * (args.turns // len(roteiro) + 1))[: args.turns]

    if args.mode == "infra":
        aplicar_stub_llm(args.llm_delay)
        print(f"⚙️  INFRA: LLM simulada (~{args.llm_delay}s por chamada, 2 por mensagem), sem token.")
    else:
        print("💸 REAL: usa o provedor configurado e CONSOME TOKEN.")
    print(f"📋 Níveis={niveis} | conversas/nível={args.conversations} | turnos={len(turns)} "
          f"| msgs/nível={args.conversations * len(turns)} | modo simulação (sem pedido/WhatsApp)")

    if not args.yes:
        print("\n🚫 Faltou --yes. Reveja o plano e rode de novo com --yes.")
        await engine.dispose()
        return 0

    print("\n" + "=" * 88)
    print(f"{'conc':>5} | {'msgs':>5} | {'ok':>5} | {'err':>4} | {'msg/s':>6} | "
          f"{'p50':>7} | {'p95':>7} | {'p99':>7} | {'max':>7}")
    print("-" * 88)
    resultados = []
    try:
        for conc in niveis:
            async with AsyncSessionLocal() as db:
                livres, max_conn, em_uso = await conexoes_livres(db)
            if conc > livres:
                print(f"{conc:>5} | PULADO: só {livres} conexões livres (max={max_conn}, em uso={em_uso}, "
                      f"folga={FOLGA_CONEXOES}) — não vou disputar conexão com o atendimento real.")
                continue
            stats, wall = await rodar_nivel(pizzaria_id, conc, args.conversations, turns,
                                            args.phone_prefix, args.think_time)
            n = len(stats.latencias)
            vazao = n / wall if wall > 0 else 0.0
            print(f"{conc:>5} | {n:>5} | {stats.ok:>5} | {stats.erros:>4} | {vazao:>6.2f} | "
                  f"{stats.pct(50):>6.2f}s | {stats.pct(95):>6.2f}s | {stats.pct(99):>6.2f}s | "
                  f"{(max(stats.latencias) if stats.latencias else 0):>6.2f}s")
            if stats.motivos:
                print(f"        motivos: {stats.motivos}")
            resultados.append((conc, vazao, stats))
    finally:
        print("=" * 88)
        async with AsyncSessionLocal() as db:
            if args.cleanup:
                print(f"🧹 Limpeza: {await limpar(db, pizzaria_id, args.phone_prefix)}")
            else:
                print("ℹ️  Estado sintético ficou no banco — rode com --cleanup-only para remover.")
        await engine.dispose()

    if resultados:
        conc, vazao, st = max(resultados, key=lambda r: r[1])
        print(f"\n📈 Pico: ~{vazao:.2f} msg/s com {conc} conversas simultâneas (p95={st.pct(95):.2f}s).")
        print("   Clientes simultâneos suportados ≈ msg/s × intervalo entre mensagens do cliente (~30 s).")
    return 0


def main() -> None:
    try:
        sys.exit(asyncio.run(amain()))
    except KeyboardInterrupt:
        print("\n⛔ Abortado.")
        sys.exit(130)


if __name__ == "__main__":
    main()
