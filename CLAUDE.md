# PizzaBot — guia para o Claude

SaaS multi-tenant de atendimento de pizzarias/lanchonetes pelo WhatsApp: uma
atendente de IA conversa, lê o cardápio, registra o pedido, gera a cobrança
(Pix/cartão) e acompanha o status. Cada pizzaria tem seu painel; a plataforma
tem um painel de administração e cobra assinatura mensal das pizzarias.

Responda ao usuário **em português (pt-BR)**.

> **O repositório é PÚBLICO** (github.com/Silva0933/pizzabot-saas). Nunca
> commite chave, token, senha ou `.env` — nem em `.env.example`, doc ou teste.
> Exemplos usam valores falsos (`sua_api_key_...`). Segredos de produção ficam
> nas variáveis do Coolify ou cifrados no banco (`services/secrets.py`, Fernet).

## Arquitetura

```
WhatsApp → Evolution API → webhook FastAPI (routes/webhook.py)
             ├─ persiste a mensagem + WebSocket pro painel
             └─ enfileira no Redis com debounce (services/queue.py)
                   → Celery (workers/tasks.py: flush_conversation)
                     ou dispatcher assíncrono (dispatcher/, se pizzarias.usar_dispatcher)
                   → agente (agent/runner.py) → resposta via Evolution
Painel React (PWA) ──HTTP/JWT + WebSocket──> backend
```

Uma única imagem Docker (`backend/Dockerfile`), papel escolhido por `APP_ROLE`:
`backend` (API; roda `migrations/apply.py` no boot), `worker` (Celery),
`beat` (jobs periódicos — **sempre 1 réplica**), `dispatcher` (Redis Streams).
O painel é outra imagem (`Dockerfile` da raiz: build Vite + Nginx).
Infra: Postgres com pgvector + Redis.

## Onde fica cada coisa

**Backend (`backend/app/`)**
- `agent/` — o cérebro. `runner.py` orquestra; `agent/fsm/` é o pipeline
  principal **NLU → Engine → Voz**:
  - `fsm/pipeline.py` — orquestrador; `_nlu_deterministica` resolve casos
    óbvios sem LLM; confiança < `CONFIANCA_MINIMA` cai no agente legado.
  - `fsm/nlu.py` — LLM só extrai intenção + entidades em JSON (modelo barato `nlu_model`).
  - `fsm/engine.py` — regras de negócio determinísticas (carrinho, upsell,
    endereço, taxa, pagamento). Decide a ação e pode fixar `mensagem_pronta`.
  - `fsm/voice.py` — LLM redige a fala; `fsm/guard.py` blinda o texto (preço, saudação, nome).
  - `providers.py`/`llm.py` — Gemini, OpenAI, OpenRouter; `failover.py` troca para o reserva.
  - `behavior.py` — as opções de comportamento configuráveis por pizzaria.
- `routes/` — API. Rotas de pizzaria usam `Depends(membership)` (deps.py), que
  também devolve **402** para pizzaria suspensa. Admin da plataforma usa `require_platform_admin`.
- `services/` — Evolution, pagamentos (Mercado Pago/Asaas), billing da
  plataforma, horário, geocoding, transcrição, alertas, `prontidao.py` (auditoria de config).
- `workers/` — Celery (`tasks.py`) e jobs do beat (`periodic.py`).
- `migrations/NNN_nome.sql` — SQL puro, numerado, aplicado em ordem por
  `apply.py`. Migration nova = próximo número; o model em `models.py` acompanha.

**Frontend (`src/`)** — React 19 + Vite + TS + Tailwind.
- `App.tsx` — roteamento, sessão, WebSocket, alertas sonoros.
- `components/v2/` — telas atuais (Início, Conversas, Pedidos, Cardápio, Meu
  Negócio, Assinatura, Ajuda, `PlatformAdminView`, `CardapioPublico`).
  `components/` fora do `v2` é legado.
- `lib/api.ts` — **todo** acesso ao backend e os tipos da API.

**Docs:** `Guia_Arquitetura_LLM.md` (mapa detalhado), `docs/auditoria-*.md`
(o que já foi auditado — não reauditar à toa), `docs/smoke-test-blindagem.md`.

## Comandos

```bash
# Backend (usar o venv do projeto; o Python global não tem as dependências)
cd backend
.venv/Scripts/python.exe -m pytest tests -q          # ~400 testes, usam mocks
.venv/Scripts/python.exe -m ruff check app            # B008 (Depends) e E402 são intencionais
docker compose up -d                                  # stack local completa

# Frontend (raiz)
npm run lint     # tsc --noEmit
npm run build
npm run dev      # precisa de VITE_PIZZABOT_API_URL no .env.local

# Teste de estresse do atendimento com conversas roteirizadas
backend/scripts/stress_atendimento.py
```

Antes de commitar: pytest + `npm run lint` passando.

## Deploy e produção

- Painel: https://pizzabot.secretariaai.eu.cc · API: https://api.pizzabot.secretariaai.eu.cc (`/health`)
- Coolify (coolify.secretariaai.eu.cc). **Push na `main` = deploy**: o CI
  (`.github/workflows/`) roda pytest + tsc e, se passar, o job `deploy`
  dispara os serviços no Coolify. Não há auto-deploy fora do CI — se o CI não
  rodar, a produção não atualiza.
- Migrations rodam sozinhas no boot do serviço `backend`.
- `/docs` e `/openapi.json` ficam desligados com `APP_ENV=production`.
- `GET /admin/prontidao` lista configurações fail-open (tokens de webhook vazios etc.).

## Convenções

- Código, comentários, mensagens de log e textos em **português**.
- Commits: `tipo(escopo): descrição` em português **sem acentos**
  (ex.: `fix(agente): ...`, `feat(assinaturas): ...`), corpo explicando o
  porquê. Commits pequenos e focados.
- Comentários explicam o **porquê** (qual bug/cenário motivou), no tom dos existentes.
- Falas críticas da atendente são texto fixo do backend (`mensagem_pronta`),
  não improviso da LLM. Preço, taxa e disponibilidade vêm sempre do banco —
  a LLM nunca inventa.
- Todo acesso a dado de pizzaria filtra por `pizzaria_id` (multi-tenant).
- Correção de bug do agente vem com teste em `backend/tests/` reproduzindo a conversa.
