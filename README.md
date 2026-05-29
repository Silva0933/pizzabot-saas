# PizzaBot

Plataforma **SaaS multi-tenant** de atendimento automatizado para pizzarias/lanchonetes via **WhatsApp**: uma atendente de IA que conversa, lê o cardápio, registra pedidos, gera cobrança (Pix/cartão) e acompanha o status — tudo num painel web por pizzaria, com um painel de administração da plataforma.

> Esta é a versão atual (backend Python próprio). A stack antiga baseada em **n8n + Supabase** foi descontinuada e removida do repositório.

---

## Arquitetura

```
WhatsApp ──> Evolution API ──(webhook)──> Backend (FastAPI)
                                              │   ├─ persiste msg + WebSocket pro painel
                                              │   └─ enfileira (Redis, debounce ~10s)
                                              ▼
                                        Worker (Celery) ──> Agente IA (LLM + tools)
                                              │                 ├─ buscar_cardapio
                                              │                 ├─ registrar_pedido
                                              │                 ├─ gerar_pagamento (MP/Asaas)
                                              │                 └─ ...
                                              ▼
                                        Evolution API ──> resposta no WhatsApp

Painel React (PWA) ──HTTP/JWT + WebSocket──> Backend
```

Três serviços usam a **mesma imagem** do backend (variável `APP_ROLE`):

- **backend** — API FastAPI (`uvicorn`), webhooks, WebSocket do painel.
- **worker** — Celery, consome a fila e roda o agente.
- **painel** — frontend React servido estático (Nginx).

Infra de apoio: **Postgres** (com `pgvector`) e **Redis**.

---

## Stack

**Backend** (`backend/`)
- FastAPI + Uvicorn
- SQLAlchemy 2.0 async + asyncpg (Postgres) + pgvector
- Celery + Redis (fila com debounce)
- LLM multi-provider: **Gemini** (google-genai), **OpenAI** e **OpenRouter** (compatível) — escolhido no painel admin
- Evolution API (WhatsApp), Mercado Pago e Asaas (pagamentos)
- ffmpeg (transcrição de áudios de voz)

**Frontend** (`src/`)
- React 19 + Vite + TypeScript
- Tailwind CSS + lucide-react + recharts + motion
- PWA (manifest + service worker)
- Conversa com o backend via `src/lib/api.ts` (JWT) + WebSocket ao vivo

---

## Estrutura

```
backend/            API + worker (FastAPI/Celery)
  app/
    routes/         auth, pizzarias, conversas, cardapio, pedidos,
                    agente, admin, webhook, webhook_pagamento, ws, metricas
    agent/          runner, llm, providers, tools, prompt, memory
    services/       evolution, pagamentos, status_messages, business_hours,
                    transcricao, app_config (config de IA), broadcaster, plans
    workers/        celery_app, tasks
    models.py db.py config.py deps.py schemas.py
  migrations/       001_initial.sql
  Dockerfile docker-compose.yml
src/                painel React
  components/v2/     telas atuais (Início, Conversas, Pedidos, Cardápio,
                     Meu Negócio, PlatformAdminView, AppShell, Sidebar, Topbar...)
  lib/api.ts         cliente HTTP do backend
public/             PWA (manifest, sw, ícones)
docs/               documentação das fases
```

---

## Rodando localmente

**Backend + Postgres + Redis** (via Docker):

```bash
cd backend
cp .env.example .env   # preencha as variáveis (ver abaixo)
docker compose up -d
docker compose exec backend python migrations/apply.py
docker compose logs -f backend worker
```

**Frontend**:

```bash
npm install
echo "VITE_PIZZABOT_API_URL=http://localhost:8000" > .env.local
npm run dev      # http://localhost:5173
npm run build    # build de produção
npm run lint     # checagem de tipos (tsc --noEmit)
```

---

## Variáveis de ambiente

**Frontend**
- `VITE_PIZZABOT_API_URL` — URL do backend (ex.: `https://api.seu-dominio.com`).

**Backend** (`backend/.env`)
- `DATABASE_URL` / `DATABASE_URL_SYNC` — Postgres (async/sync)
- `REDIS_URL` — Redis (fila Celery + pub/sub)
- `APP_SECRET_KEY` — segredo do JWT
- `EVOLUTION_BASE_URL` / `EVOLUTION_API_KEY` — Evolution API (WhatsApp)
- `GEMINI_API_KEY` — chave Gemini (fallback; também configurável no painel)
- `PUBLIC_BASE_URL` — URL pública do backend (webhooks e arquivos)
- `APP_ROLE` — `worker` no serviço de fila; vazio/`api` no backend
- `APP_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`

As **chaves de LLM** (Gemini/OpenAI/OpenRouter), o **provedor** e o **modelo** são definidos no **painel admin → Configuração de IA** (guardados na tabela `app_config`). As chaves de **pagamento** (Mercado Pago/Asaas) são por pizzaria, configuradas em **Meu Negócio**.

---

## Provedor de IA

No **painel de administração** (Configuração de IA) você escolhe:

- **Provedor**: Gemini, OpenAI ou OpenRouter
- **Modelo** (ex.: `google/gemini-2.5-flash` via OpenRouter)
- **Chaves de API** por provedor (mascaradas, nunca reexibidas)

Há também **teste de conexão** e **consumo de tokens** (total e por pizzaria, com opção de zerar). O agente usa o provedor/modelo configurado em todas as pizzarias.

> A busca do cardápio do bot usa SQL (não depende de embeddings). O reindex semântico (opcional) usa Gemini.

---

## Onboarding de uma pizzaria

1. Entrar como **admin da plataforma** e criar a pizzaria (com o login do dono).
2. Conectar o **WhatsApp** via QR Code (cria a instância na Evolution já com webhook).
3. Cadastrar o **cardápio** com descrições (o bot responde "tem cebola?" a partir daí). Opcional: subir o **cardápio em PDF/imagem**.
4. Definir **horário de funcionamento** e a mensagem de fora do horário.
5. Personalizar a **atendente** (nome, estilo, tom).
6. (Opcional) Configurar **Mercado Pago/Asaas** para cobrança online.
7. Testar de ponta a ponta no WhatsApp (texto e áudio).

---

## Pagamentos

- **Mercado Pago** (Pix com QR + copia-e-cola, ou link de checkout) e **Asaas** (Pix).
- A cobrança só é gerada quando o cliente escolhe **pagar agora**; "na entrega" não gera.
- A confirmação chega pelo **webhook** (`/webhook/mercadopago` ou `/webhook/asaas`) e dispara o aviso "Pagamento confirmado".
- Use chave `TEST-...` (MP) em testes e `APP_USR-...` em produção.

---

## Deploy

Os três serviços (backend, worker, painel) são implantados via **Coolify** a partir deste repositório:

- **backend** e **worker**: build pelo `backend/Dockerfile`. O worker recebe `APP_ROLE=worker` (o Dockerfile decide entre `uvicorn` e `celery`).
- **painel**: build Vite servido por Nginx (`nginx.conf`).
- **Postgres** (pgvector) e **Redis** como serviços.

Aplicar migrações: `python migrations/apply.py` no container do backend.

---

## Documentação

Roteiros de implantação e histórico das fases estão em [`docs/`](docs/).
