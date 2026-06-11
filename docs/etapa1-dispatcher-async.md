# Etapa 1 — Dispatcher assíncrono (Redis Streams)

> Doc de design para revisão **antes** de codar. Status: proposta.
> Contexto e roteiro: ver memória `project-escalabilidade` e a Etapa 0 (commit `96753b2`).

## 1. Objetivo e não-objetivos

**Objetivo:** trocar o modelo de concorrência da ingestão de mensagens de
`Celery prefork (1 task = 1 processo bloqueado)` para um **dispatcher assíncrono**:
um event loop por processo + `asyncio.Semaphore(N)` com N alto, consumindo um
**Redis Stream** com consumer group. Resultado: uma réplica passa a segurar
**dezenas/centenas** de conversas I/O-bound em voo (esperando LLM/Evolution/DB),
em vez de 8.

**Não-objetivos (NÃO mudam nesta etapa):**
- O "cérebro": `process_and_reply` (runner), o pipeline FSM, as tools, a memória.
- O debounce em si (mesma janela de 7s / typing / teto 45s).
- A durabilidade do lote (`pending`/`inflight` em `services/queue.py`).
- O painel, pagamentos, billing, beat.

A regra de ouro: **trocar só o "sistema nervoso" (ingestão + concorrência),
reaproveitando as primitivas atuais** (`drain_pending`, `confirm_processed`,
`process_and_reply`). Isso de-risca a migração e mantém o comportamento idêntico.

## 2. Como é hoje (ingestão atual)

```
webhook.py:
  dedup (SET NX) → enqueue_message(pending list + flush_at + batch_start)
                 → flush_conversation.apply_async(countdown=DEBOUNCE)
tasks.py _flush_async:
  should_flush_now → lock Redis (lock:flush:{pid}:{tel}, TTL 90s)
                   → drain_pending (move p/ inflight) → process_and_reply
                   → confirm_processed (limpa inflight) → solta lock
```

O gargalo: cada flush ocupa **um processo prefork inteiro** durante a chamada do
LLM (2–15s). 8 processos = no máx. 8 conversas em voo por réplica.

## 3. Arquitetura proposta

```
webhook.py (flag por pizzaria):
  dedup → enqueue_message (IGUAL: pending list + flush_at + batch_start)
        → ZADD due:zset  member="{pid}:{tel}"  score=flush_at   (GT)
        (presence/typing: ZADD GT com o novo flush_at, em vez de apply_async)

dispatcher (novo APP_ROLE=dispatcher, 1+ réplicas, event loop persistente):
  [scheduler task]  a cada ~250ms: Lua atômico move membros vencidos
                    (score<=now) do due:zset → XADD ready stream
  [N consumer tasks] XREADGROUP group=disp ready > (BLOCK):
       p/ cada entrada {pid,tel}, sob asyncio.Semaphore(N):
         - lock Redis lock:flush:{pid}:{tel} (TTL 90s)  [reusa o atual]
             - se NÃO pegou o lock → XACK + re-ZADD(now+2s) (re-tenta depois)
         - drain_pending → process_and_reply → confirm_processed   [reusa]
         - XACK
  [reclaim task]    a cada ~30s: XAUTOCLAIM ready min-idle=60s
                    (recupera entradas de consumer morto)
```

Celery continua existindo só para o **beat** (jobs periódicos) e para as
pizzarias ainda NÃO migradas (coexistência — ver §8).

## 4. Esquema de chaves Redis

Reaproveitadas (sem mudança): `pending:{pid}:{tel}`, `flush_at:{pid}:{tel}`,
`batch_start:{pid}:{tel}`, `inflight:{pid}:{tel}`, `lock:flush:{pid}:{tel}`,
`wh:seen:{instance}:{id}` (dedup).

Novas:
| Chave | Tipo | Papel |
|---|---|---|
| `disp:due` | ZSET | membro `"{pid}:{tel}"`, score = `flush_at` (epoch). Fila de prazos do debounce. |
| `disp:ready` | STREAM | conversas prontas pra processar. Consumer group `disp`. |
| `disp:tenant:{pid}` | STRING (INCR) | contador de conversas em voo por pizzaria (cap de justiça, §6). TTL curto. |

## 5. O scheduler (debounce → ready), atômico e multi-réplica

O passo crítico é mover um membro vencido do `disp:due` para o `disp:ready`
**exatamente uma vez**, mesmo com várias réplicas do dispatcher rodando o
scheduler. Como o Redis é single-thread, um script Lua resolve sem leader
election:

```lua
-- KEYS[1]=disp:due  KEYS[2]=disp:ready  ARGV[1]=now  ARGV[2]=max_batch
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, member in ipairs(due) do
  redis.call('ZREM', KEYS[1], member)
  redis.call('XADD', KEYS[2], '*', 'conv', member)
end
return #due
```

Qualquer réplica chama o script; quem chegar primeiro no Redis remove+publica o
membro, as outras veem o zset já sem ele. Zero janela de corrida e zero
double-dispatch. (Se duas entradas `ready` para a mesma conversa existirem por
re-arme, o lock + `drain_pending` idempotente absorvem — §7.)

## 6. Controle de concorrência (os "botões de vazão")

- **Cap global:** `asyncio.Semaphore(DISPATCHER_CONCURRENCY)` (env, **default 40**).
  Limita `process_and_reply` simultâneos. **LIMITADO pelas conexões do Postgres:**
  a sessão fica aberta durante a chamada do LLM (2–15s), então cada conversa em
  voo segura 1 conexão. Pra ir além de ~dezenas, use **PgBouncer** (multiplexa
  muitas sessões em poucas conexões reais) e/ou eleve `max_connections`. Ainda
  assim é ~5× o prefork de 8, com reuso de conexão e flow-control, e escala por
  réplica.
- **Cap por pizzaria (justiça):** antes de processar, `INCR disp:tenant:{pid}`
  (com `DECR` no finally). Se passar de `DISPATCHER_TENANT_CAP` (env, default ~25),
  re-ZADD a conversa com `score=now+1.5s` e XACK (backpressure) — assim uma
  pizzaria com 50 clientes no pico **não monopoliza** o semáforo global.
- **Lock por conversa:** o `lock:flush` atual já serializa mensagens da mesma
  pessoa. Reusado tal qual.
- **Backpressure natural:** o webhook só ZADDa (barato); se o sistema satura, o
  `disp:due`/`disp:ready` crescem e o scheduler drena na taxa possível. `ZCARD`
  e `XLEN` viram o sinal de autoscaling (Etapa 2).

## 7. Corretude sob corrida (reusa as garantias atuais)

- **Mensagem nova durante o processamento:** vai pro `pending` + ZADD de novo →
  scheduler re-dispatcha → 2º consumer tenta o lock (preso) → XACK + re-ZADD.
  Quando o 1º terminar, `drain_pending` já terá lido a msg nova (lote atômico);
  se o 2º rodar depois com `pending` vazio, retorna `empty`. Nada é processado 2x.
- **Crash do consumer no meio:** a entrada fica no PEL do consumer group; o
  `XAUTOCLAIM` (min-idle 60s) reentrega. O lote segue durável no `inflight` até o
  `confirm_processed`. Semântica permanece *at-least-once* + drain idempotente.
- **Re-checagem humano×bot, cota, timeouts:** já estão DENTRO de
  `process_and_reply` — herdadas sem mudança.

## 8. Coexistência e rollout (flag por pizzaria)

- **Migration `015_dispatcher_async.sql`:** coluna `pizzarias.usar_dispatcher`
  BOOLEAN default `false`.
- **webhook.py:** no ponto onde hoje chama `apply_async`, ramifica:
  `usar_dispatcher` → ZADD `disp:due`; senão → caminho Celery atual (intacto).
  Idem no `_handle_presence`.
- **Novo serviço Coolify `pizzabot-dispatcher`** (`APP_ROLE=dispatcher`, mesma
  imagem). Pode rodar junto com o worker Celery: pizzarias migradas são servidas
  pelo dispatcher, as demais pelo worker. Migração gradual, 1 pizzaria por vez.
- **Rollback instantâneo:** `usar_dispatcher=false` na pizzaria → volta pro Celery
  no próximo webhook, sem deploy. Mensagens já no `disp:due`/`ready` terminam pelo
  dispatcher (drené antes de desligar o serviço).
- **Fim da migração:** quando todas estiverem no dispatcher, o `pizzabot-worker`
  Celery pode escalar a 0 (beat continua). `flush_conversation`/`_flush_async`
  ficam no código como fallback até a limpeza final.

## 9. Ciclo de vida de conexões (o ganho real)

No dispatcher o loop é **persistente** → diferente do worker, **NÃO** chamamos
`engine.dispose()` nem `reset_client()` por mensagem. O pool do SQLAlchemy e o
client do LLM são **reaproveitados** entre conversas. Menos latência, menos
churn de conexão.
- `db.py`: `APP_ROLE=dispatcher` usa pool dimensionado pela concorrência —
  `pool_size = DISPATCHER_CONCURRENCY`, `max_overflow = max(10, conc/4)` — porque
  cada conversa em voo segura 1 conexão durante a chamada do LLM. Tunável por env.
  **Atenção à conta de `max_connections` do Postgres** (mesmo alerta da Etapa 0):
  durante a coexistência (worker Celery + dispatcher), somar os dois; com
  concorrência alta, PgBouncer + dimensionar Postgres juntos.

## 10. Arquivos a criar / tocar

Criar:
- `backend/app/dispatcher/__init__.py`
- `backend/app/dispatcher/runner.py` — loop principal (scheduler + consumers +
  reclaim + semáforos). Ponto de entrada `APP_ROLE=dispatcher`.
- `backend/app/dispatcher/streams.py` — wrappers Redis (Lua scheduler, XADD,
  XREADGROUP, XACK, XAUTOCLAIM, ensure group).
- `backend/migrations/015_dispatcher_async.sql`
- `backend/tests/test_dispatcher.py`

Tocar:
- `backend/app/services/queue.py` — `enqueue_message` aceita modo dispatcher
  (ZADD due) OU função nova `arm_dispatcher(pid, tel, flush_at)`; `touch_typing`
  idem (ZADD GT). Sem quebrar o caminho Celery.
- `backend/app/routes/webhook.py` — ramificação pela flag `usar_dispatcher`.
- `backend/app/db.py` — pool para `APP_ROLE=dispatcher`.
- `backend/Dockerfile` — branch `APP_ROLE=dispatcher` no CMD/healthcheck.
- `backend/app/models.py` — campo `usar_dispatcher`.

## 11. Pseudo-código do loop principal

```python
async def run_dispatcher():
    await ensure_group("disp:ready", "disp")
    sem = asyncio.Semaphore(DISPATCHER_CONCURRENCY)
    tasks = [scheduler_loop(), reclaim_loop()]
    tasks += [consumer_loop(f"c{i}", sem) for i in range(NUM_CONSUMERS)]
    await asyncio.gather(*tasks)

async def scheduler_loop():
    while True:
        await run_due_script(now=time.time(), max_batch=200)  # Lua §5
        await asyncio.sleep(0.25)

async def consumer_loop(name, sem):
    while True:
        entries = await xreadgroup("disp", name, "disp:ready", count=10, block=1000)
        for entry_id, data in entries:
            asyncio.create_task(handle(entry_id, data["conv"], name, sem))

async def handle(entry_id, conv, name, sem):
    pid, tel = parse(conv)
    async with sem:
        if not await tenant_admit(pid):            # cap por tenant §6
            await rearm(pid, tel, delay=1.5); await xack(entry_id, name); return
        try:
            if not await acquire_lock(pid, tel):    # lock:flush atual
                await rearm(pid, tel, delay=2.0);  await xack(entry_id, name); return
            try:
                pending = await drain_pending(pid, tel)        # reusa
                if pending:
                    conteudo = "\n".join(p["conteudo"] for p in pending if p.get("conteudo"))
                    async with AsyncSessionLocal() as db:       # pool REUSADO
                        await process_and_reply(db, pid, tel, conteudo)  # reusa
                await confirm_processed(pid, tel)               # reusa
            finally:
                await release_lock(pid, tel)
        finally:
            await tenant_release(pid)
            await xack(entry_id, name)
```

## 12. Observabilidade

- Logar (e expor): `ZCARD disp:due`, `XLEN disp:ready`, tamanho do PEL
  (`XPENDING`), latência p50/p95 do `handle`, semáforo livre, `disp:tenant:{pid}`.
- Reusar Sentry (`init_sentry("dispatcher")`).
- Etapa 2 usa esses números pra autoscaling no Coolify.

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `max_connections` do Postgres com concorrência alta | dimensionar pool/Postgres juntos; PgBouncer se preciso; começar com N moderado. |
| Cliente LLM compartilhado no loop persistente | é por-provider/api-key, sem estado de conversa; thread-safe no asyncio (1 loop). |
| Entrada `ready` duplicada por re-arme | lock + `drain_pending` idempotente (§7). |
| Bug no dispatcher afeta produção | flag por pizzaria + rollback instantâneo (§8); validar com 1 pizzaria de teste. |
| Scheduler rodando em N réplicas | Lua atômico (§5) — sem double-dispatch. |

## 14. Plano de validação

1. `test_dispatcher.py`: Lua do scheduler (vencidos viram ready; não-vencidos
   ficam), re-arme sob lock, cap por tenant, idempotência do drain duplicado,
   recuperação via autoclaim (simulada).
2. Smoke local: subir 1 dispatcher + Redis, disparar N webhooks concorrentes de
   telefones distintos numa pizzaria de teste, conferir respostas e métricas.
3. Produção: ligar `usar_dispatcher` em 1 pizzaria piloto; observar latência e
   fila por alguns dias; depois migrar o resto.

---

### Decisões abertas para você revisar
- **D1.** Cap global default (`DISPATCHER_CONCURRENCY`): **40** (limitado por
  conexões do Postgres — ver §6/§9; PgBouncer destrava ir além). OK?
- **D2.** Cap por pizzaria (`DISPATCHER_TENANT_CAP`): proponho **25**. OK?
- **D2.** Cap por pizzaria (`DISPATCHER_TENANT_CAP`): proponho **25**. OK?
- **D3.** ✅ DECIDIDO: coluna `pizzarias.usar_dispatcher` (migration 015).
- **D4.** ✅ DECIDIDO: validar local primeiro; criar o `pizzabot-dispatcher` no
  Coolify só quando os testes estiverem verdes.

### Status da implementação (2026-06-11)
Código da Etapa 1 implementado e testado (254 testes verdes, 12 novos do
dispatcher + smoke de Redis que pula sem Redis). Falta: smoke contra um Redis
real e criar o serviço `pizzabot-dispatcher` no Coolify. **Nenhuma pizzaria usa o
dispatcher ainda** (`usar_dispatcher` default false) — zero impacto em produção.
