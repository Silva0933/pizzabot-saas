"""
Teste de carga do agente — descobre o TETO de vazão antes de abrir pras pizzarias.

O que ele faz
-------------
Dispara N conversas simultâneas contra o MESMO caminho que o worker Celery usa
em produção (`process_and_reply` -> pipeline FSM -> NLU + engine + voz + banco),
variando a concorrência, e mede latência (p50/p95/p99), vazão (msg/s) e erros.

O Evolution (WhatsApp) e o broadcaster (WebSocket) são STUBADOS: NENHUMA mensagem
é enviada pra cliente real e nada é publicado no painel. O que roda de verdade é
o caro: as chamadas de LLM e as queries no Postgres.

Dois modos de LLM
-----------------
  --mode real   (padrão) Usa o provedor de LLM configurado no painel admin.
                Mede a latência REAL. ATENÇÃO: consome tokens e conta na cota
                da pizzaria de teste. Comece com pouca concorrência.

  --mode infra  Substitui as chamadas de LLM por um atraso simulado (--llm-delay).
                NÃO gasta token e não bate no rate limit do provedor. Serve pra
                estressar a infra (banco/pool/framework) em alta concorrência e
                ver se algo trava por baixo da LLM.

Como ler o resultado (o "teto")
-------------------------------
Em produção o worker roda com `--concurrency=4` por container. Logo:
    concorrência do teste  ≈  (nº de réplicas de worker) × 4
Faça um sweep (ex.: --sweep 4,8,16,32) e ache o nível onde o p95 cruza seu SLA
(ex.: 8-10s) ou onde começam erros. Esse é o teto daquela configuração. Para
suportar mais, suba réplicas de worker no Coolify (ou a --concurrency do worker).

Exemplos
--------
  # Smoke test barato (sem token), achando o teto de infra:
  python scripts/load_test.py --pizzaria "Palazio" --mode infra --sweep 4,8,16,32,64 --yes

  # Latência real com o provedor configurado (gasta token!), começando devagar:
  python scripts/load_test.py --pizzaria "Palazio" --mode real --sweep 2,4,8 --conversations 40 --yes

  # Limpar dados sintéticos deixados por execuções anteriores:
  python scripts/load_test.py --pizzaria "Palazio" --cleanup-only

Rodar dentro do container do backend (tem acesso ao Postgres/Redis e às envs):
  docker compose exec backend python scripts/load_test.py --pizzaria "Palazio" --mode infra --sweep 4,8,16 --yes

Fidelidade / limitações (honestas)
----------------------------------
* O teste roda num ÚNICO processo, então todas as conversas compartilham o pool
  de conexões (pool_size=10 + max_overflow=20 = 30). Em produção cada task é um
  PROCESSO separado. Por isso, ao testar concorrência > 30, parte do tempo será
  espera por conexão do pool — o que é informativo, mas não idêntico ao prod.
  Pra testar acima disso fielmente, suba `pool_size` ou rode várias instâncias
  do script em paralelo.
* Por padrão NÃO cria linha em `conversas` (o agente roda completo mesmo sem ela;
  só não grava a Mensagem/!broadcast). Use --create-conversa pra fidelidade total
  (e --cleanup pra remover depois).
* Não exercita webhook dedup / debounce / lock do Celery — esses são mecanismos de
  CORREÇÃO, já cobertos por testes unitários (test_robustez_falhas.py), e não são o
  gargalo de capacidade.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
import uuid
from dataclasses import dataclass, field

# Bootstrap de path: rodando como `python scripts/load_test.py`, o Python só põe
# `.../scripts` no sys.path — não o diretório `/app` que contém o pacote `app`.
# Inserimos o pai de `scripts/` pra que `import app...` funcione sem PYTHONPATH.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ------------------------------------------------------------------ #
# Stubs de saída (aplicados ANTES de qualquer disparo)
# ------------------------------------------------------------------ #

async def _anoop(*args, **kwargs):  # no-op assíncrono genérico
    return None


def aplicar_stubs_saida() -> None:
    """Neutraliza tudo que sai pra fora (WhatsApp + painel). Idempotente."""
    import app.services.broadcaster as _b
    import app.services.evolution as _e

    _e.evolution.send_text = _anoop
    _e.evolution.send_media = _anoop
    _e.evolution.send_presence = _anoop
    _e.evolution.get_media_base64 = _anoop
    _e.evolution.close = _anoop
    _b.broadcaster.publish = _anoop


# ------------------------------------------------------------------ #
# Stub de LLM (modo infra) — NLU + voz com atraso simulado, sem token
# ------------------------------------------------------------------ #

def _fake_nlu_para(user_input: str, produto: str) -> dict:
    """Mapeia a mensagem pra uma intenção plausível, pra o engine progredir e
    exercitar o banco (busca de cardápio etc.) sem chamar a LLM de verdade."""
    t = (user_input or "").lower()
    dados: dict = {}
    if any(p in t for p in ("oi", "ola", "olá", "bom dia", "boa tarde", "boa noite")):
        intencao = "saudacao"
    elif any(p in t for p in ("cardapio", "cardápio", "menu")):
        intencao = "pedir_cardapio"; dados = {"quer_cardapio": True}
    elif any(p in t for p in ("quero", "vou querer", "manda", "pizza", produto.lower())):
        intencao = "adicionar_item"
        dados = {"produtos": [{"nome": produto, "qtd": 1,
                               "tamanho": "G" if "grande" in t else None,
                               "sabores_meia": [], "adicionais": []}]}
    elif any(p in t for p in ("retirada", "buscar", "retirar")):
        intencao = "informar_entrega_retirada"; dados = {"tipo_entrega": "retirada"}
    elif "entrega" in t or "delivery" in t:
        intencao = "informar_entrega_retirada"; dados = {"tipo_entrega": "delivery"}
    elif any(p in t for p in ("dinheiro", "pix", "cartao", "cartão")):
        forma = "dinheiro" if "dinheiro" in t else ("pix" if "pix" in t else "cartao")
        intencao = "informar_pagamento"; dados = {"forma_pagamento": forma, "pagar_agora": False}
    elif any(p in t for p in ("pode", "sim", "isso", "fechar", "fechado", "confirma")):
        intencao = "confirmar_resumo"
    else:
        intencao = "duvida_geral"
    return {"intencao": intencao, "confianca": 0.95, "dados": dados, "_usage": {}}


def aplicar_stub_llm(llm_delay: float, produto: str) -> None:
    """Substitui NLU e voz por versões com sleep (modo infra)."""
    import app.agent.fsm.nlu as _nlu
    import app.agent.fsm.voice as _voice

    async def fake_nlu(**kwargs):
        await asyncio.sleep(llm_delay * random.uniform(0.7, 1.3))
        return _fake_nlu_para(kwargs.get("user_input", ""), produto)

    async def fake_voz(**kwargs):
        await asyncio.sleep(llm_delay * random.uniform(0.7, 1.3))
        return ("Resposta simulada do bot 😊", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})

    _nlu.nlu_extract = fake_nlu
    _voice.gerar_voz = fake_voz


# ------------------------------------------------------------------ #
# Métricas
# ------------------------------------------------------------------ #
@dataclass
class Stats:
    latencias: list[float] = field(default_factory=list)
    ok: int = 0
    erros: int = 0
    pulados: int = 0  # ex.: limite de IA do plano atingido
    motivos: dict[str, int] = field(default_factory=dict)

    def pct(self, p: float) -> float:
        if not self.latencias:
            return 0.0
        s = sorted(self.latencias)
        k = max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))
        return s[k]


def _pizz_resumo(pizz) -> str:
    return (f"{getattr(pizz, 'nome', '?')} | pipeline_fsm={getattr(pizz, 'pipeline_fsm', False)} "
            f"| plano={getattr(pizz, 'plano', '?')} | bot_global={getattr(pizz, 'bot_ativo_global', True)} "
            f"| suspensa={getattr(pizz, 'suspensa', False)}")


# ------------------------------------------------------------------ #
# Resolução da pizzaria de teste
# ------------------------------------------------------------------ #
async def resolver_pizzaria(db, ident: str):
    from sqlalchemy import select, or_, func
    from app.models import Pizzaria

    pizz = None
    try:
        pid = uuid.UUID(ident)
        pizz = (await db.execute(select(Pizzaria).where(Pizzaria.id == pid))).scalar_one_or_none()
    except (ValueError, AttributeError):
        pass
    if pizz is None:
        pizz = (await db.execute(
            select(Pizzaria).where(func.lower(Pizzaria.nome).like(f"%{ident.lower()}%"))
        )).scalars().first()
    return pizz


# ------------------------------------------------------------------ #
# Uma conversa = vários turnos, cada turno com sessão própria (igual worker)
# ------------------------------------------------------------------ #
async def rodar_conversa(pizzaria_id, telefone: str, turns: list[str], sem: asyncio.Semaphore,
                         stats: Stats, think_time: float, create_conversa: bool = False) -> None:
    from app.agent.runner import process_and_reply
    from app.db import AsyncSessionLocal

    if create_conversa:
        # Fidelidade total: garante a linha em `conversas` (como o webhook faria),
        # pra exercitar também as gravações de Mensagem do agente.
        from app.routes.webhook import _get_or_create_conversa
        try:
            async with AsyncSessionLocal() as db:
                await _get_or_create_conversa(db, pizzaria_id, telefone, "LOADTEST")
                await db.commit()
        except Exception:  # noqa: BLE001
            pass

    for msg in turns:
        async with sem:
            t0 = time.perf_counter()
            try:
                async with AsyncSessionLocal() as db:
                    res = await process_and_reply(db, pizzaria_id, telefone, msg)
                dt = time.perf_counter() - t0
                stats.latencias.append(dt)
                if isinstance(res, dict) and res.get("ok"):
                    stats.ok += 1
                else:
                    motivo = (res or {}).get("motivo") or (res or {}).get("erro") or "desconhecido"
                    stats.motivos[motivo] = stats.motivos.get(motivo, 0) + 1
                    # motivos "esperados" (não são erro de carga): plano/humano/etc.
                    if motivo in ("limite_ia_atingido", "humano_assumiu", "bot_global_desligado",
                                  "pizzaria_suspensa", "sem_texto"):
                        stats.pulados += 1
                    else:
                        stats.erros += 1
            except Exception as e:  # noqa: BLE001
                stats.erros += 1
                stats.motivos[f"EXC:{type(e).__name__}"] = stats.motivos.get(f"EXC:{type(e).__name__}", 0) + 1
        if think_time:
            await asyncio.sleep(think_time)


async def rodar_batch(pizzaria_id, concorrencia: int, n_conversas: int, turns_tmpl: list[str],
                      phone_prefix: str, think_time: float, create_conversa: bool = False) -> tuple[Stats, float]:
    sem = asyncio.Semaphore(concorrencia)
    stats = Stats()
    tasks = []
    for i in range(n_conversas):
        telefone = f"{phone_prefix}{i:06d}"
        tasks.append(rodar_conversa(pizzaria_id, telefone, list(turns_tmpl), sem, stats, think_time,
                                    create_conversa))
    t0 = time.perf_counter()
    await asyncio.gather(*tasks)
    wall = time.perf_counter() - t0
    return stats, wall


# ------------------------------------------------------------------ #
# Limpeza dos dados sintéticos
# ------------------------------------------------------------------ #
async def limpar(db, pizzaria_id, phone_prefix: str) -> dict:
    from sqlalchemy import text
    pref = f"{phone_prefix}%"
    apagados = {}
    for tabela, col_tel in (("agente_memoria", "telefone"), ("atendimento_estado", "telefone")):
        try:
            r = await db.execute(
                text(f"DELETE FROM public.{tabela} WHERE pizzaria_id = :pid AND {col_tel} LIKE :pref"),
                {"pid": str(pizzaria_id), "pref": pref},
            )
            apagados[tabela] = r.rowcount
        except Exception as e:  # noqa: BLE001
            apagados[tabela] = f"erro: {e}"
    # Conversas/mensagens só existem se rodou com --create-conversa
    try:
        r = await db.execute(text("""
            DELETE FROM public.mensagens WHERE pizzaria_id = :pid AND conversa_id IN (
                SELECT id FROM public.conversas WHERE pizzaria_id = :pid AND cliente_telefone LIKE :pref
            )"""), {"pid": str(pizzaria_id), "pref": pref})
        apagados["mensagens"] = r.rowcount
        r = await db.execute(text(
            "DELETE FROM public.conversas WHERE pizzaria_id = :pid AND cliente_telefone LIKE :pref"),
            {"pid": str(pizzaria_id), "pref": pref})
        apagados["conversas"] = r.rowcount
    except Exception as e:  # noqa: BLE001
        apagados["conversas"] = f"erro: {e}"
    await db.commit()
    return apagados


# ------------------------------------------------------------------ #
# Main
# ------------------------------------------------------------------ #
async def amain() -> int:
    ap = argparse.ArgumentParser(description="Teste de carga do agente PizzaBot.")
    ap.add_argument("--pizzaria", required=True, help="UUID ou nome (parcial) da pizzaria de teste.")
    ap.add_argument("--mode", choices=["real", "infra"], default="real",
                    help="real=LLM de verdade (gasta token); infra=LLM simulada (sem token).")
    ap.add_argument("--sweep", default=None, help="Lista de concorrências, ex.: 4,8,16,32.")
    ap.add_argument("--concurrency", type=int, default=8, help="Concorrência (se não usar --sweep).")
    ap.add_argument("--conversations", type=int, default=40, help="Nº de conversas por nível.")
    ap.add_argument("--turns", type=int, default=5, help="Mensagens por conversa (do roteiro padrão).")
    ap.add_argument("--think-time", type=float, default=0.0, help="Pausa (s) entre turnos da mesma conversa.")
    ap.add_argument("--llm-delay", type=float, default=1.5, help="[infra] atraso simulado por chamada de LLM (s).")
    ap.add_argument("--fake-produto", default="Calabresa", help="[infra] nome de produto usado no roteiro.")
    ap.add_argument("--phone-prefix", default="5500000", help="Prefixo dos telefones sintéticos.")
    ap.add_argument("--create-conversa", action="store_true", help="Cria linha em conversas (fidelidade total).")
    ap.add_argument("--cleanup", action="store_true", help="Limpa os dados sintéticos ao final.")
    ap.add_argument("--cleanup-only", action="store_true", help="Só limpa e sai.")
    ap.add_argument("--yes", action="store_true", help="Confirma execução (necessário pra rodar de fato).")
    args = ap.parse_args()

    aplicar_stubs_saida()

    from app.db import AsyncSessionLocal, engine

    # Resolve pizzaria
    async with AsyncSessionLocal() as db:
        pizz = await resolver_pizzaria(db, args.pizzaria)
        if pizz is None:
            print(f"❌ Pizzaria não encontrada: {args.pizzaria!r}")
            return 2
        pizzaria_id = pizz.id
        print(f"🍕 Pizzaria: {_pizz_resumo(pizz)}")

        if args.cleanup_only:
            apagados = await limpar(db, pizzaria_id, args.phone_prefix)
            print(f"🧹 Limpeza: {apagados}")
            await engine.dispose()
            return 0

    # Roteiro de conversa
    prod = args.fake_produto
    roteiro_base = [
        "Oi",
        f"quero uma {prod} grande",
        "vai ser retirada",
        "vou pagar em dinheiro",
        "pode fechar o pedido",
    ]
    turns = (roteiro_base * ((args.turns // len(roteiro_base)) + 1))[: args.turns]

    if args.mode == "infra":
        aplicar_stub_llm(args.llm_delay, prod)
        print(f"⚙️  Modo INFRA: LLM simulada (~{args.llm_delay}s/chamada), SEM custo de token.")
    else:
        print("💸 Modo REAL: usa o provedor configurado e CONSOME TOKEN da pizzaria de teste.")
        if not getattr(pizz, "pipeline_fsm", False):
            print("⚠️  pipeline_fsm=False → vai rodar o AGENTE LEGADO (mais lento, mais iterações).")

    niveis = [int(x) for x in args.sweep.split(",")] if args.sweep else [args.concurrency]
    print(f"📋 Plano: níveis={niveis} | conversas/nível={args.conversations} | "
          f"turnos/conversa={len(turns)} | total msgs/nível={args.conversations * len(turns)}")
    print(f"    Telefones sintéticos: {args.phone_prefix}000000..{args.phone_prefix}{args.conversations-1:06d}")

    if not args.yes:
        print("\n🚫 Faltou --yes. Reveja o plano acima e rode de novo com --yes pra executar de verdade.")
        await engine.dispose()
        return 0

    # Aviso de tokens no modo real
    if args.mode == "real":
        total_msgs = sum(args.conversations * len(turns) for _ in niveis)
        print(f"\n⏳ Iniciando em modo REAL — estimadas ~{total_msgs} mensagens × ~2 chamadas LLM cada. "
              "Ctrl+C pra abortar.\n")

    # ------- Sweep -------
    print("\n" + "=" * 92)
    print(f"{'conc':>5} | {'msgs':>6} | {'ok':>5} | {'pul':>4} | {'err':>4} | "
          f"{'vazão/s':>8} | {'p50':>7} | {'p95':>7} | {'p99':>7} | {'max':>7}")
    print("-" * 92)

    resultados = []
    try:
        for conc in niveis:
            stats, wall = await rodar_batch(
                pizzaria_id, conc, args.conversations, turns, args.phone_prefix, args.think_time,
                args.create_conversa,
            )
            n = len(stats.latencias)
            vazao = (n / wall) if wall > 0 else 0.0
            print(f"{conc:>5} | {n:>6} | {stats.ok:>5} | {stats.pulados:>4} | {stats.erros:>4} | "
                  f"{vazao:>8.2f} | {stats.pct(50):>6.2f}s | {stats.pct(95):>6.2f}s | "
                  f"{stats.pct(99):>6.2f}s | {(max(stats.latencias) if stats.latencias else 0):>6.2f}s")
            resultados.append((conc, vazao, stats))
            if stats.motivos:
                print(f"        motivos: {stats.motivos}")
    finally:
        print("=" * 92)
        if args.cleanup or args.cleanup_only:
            async with AsyncSessionLocal() as db:
                apagados = await limpar(db, pizzaria_id, args.phone_prefix)
                print(f"🧹 Limpeza: {apagados}")
        else:
            print("ℹ️  Dados sintéticos (agente_memoria/atendimento_estado) ficaram no banco. "
                  "Rode com --cleanup-only pra remover.")
        await engine.dispose()

    # Dica de leitura
    if resultados:
        melhor = max(resultados, key=lambda r: r[1])
        print(f"\n📈 Pico de vazão: ~{melhor[1]:.2f} msg/s @ concorrência {melhor[0]} "
              f"(p95={melhor[2].pct(95):.2f}s).")
        print("   Lembrete: cada worker em prod = ~4 slots. Réplicas necessárias ≈ "
              "(msg/s do seu pico) ÷ (vazão por 4 slots).")
    return 0


def main() -> None:
    try:
        sys.exit(asyncio.run(amain()))
    except KeyboardInterrupt:
        print("\n⛔ Abortado pelo usuário.")
        sys.exit(130)


if __name__ == "__main__":
    main()
