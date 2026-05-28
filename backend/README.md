# PizzaBot Backend (Python)

Backend que substitui o n8n + Supabase. Fica todo no Coolify.

## Stack

- **FastAPI** — webhooks, API admin, WebSocket
- **PostgreSQL 16 + pgvector** — banco de dados (todas as tabelas + busca semântica)
- **Redis 7** — fila de mensagens, cache, debounce
- **SQLAlchemy 2.0 (async)** — ORM
- **Celery** — workers (Fase 2)
- **LangGraph + Gemini** — agente IA (Fase 3)

## Estrutura

```
backend/
├── app/                     Código da API
│   ├── main.py              Entry FastAPI
│   ├── config.py            Settings via env
│   ├── db.py                Pool Postgres
│   ├── auth.py              JWT + bcrypt
│   ├── deps.py              Dependencies de auth/tenant
│   ├── models.py            SQLAlchemy models
│   └── routes/
│       ├── health.py
│       └── auth.py
├── migrations/              SQL versionado
│   ├── 001_initial.sql
│   └── apply.py             Runner sem Alembic
├── scripts/
│   └── create_admin.py      Bootstrap primeiro admin
├── pyproject.toml
├── Dockerfile               Imagem de produção
└── docker-compose.yml       Dev local (postgres+redis+backend)
```

---

## Rodar localmente (dev)

```bash
# 1. Copie .env.example pra .env e ajuste senha do banco e secret key
cp .env.example .env

# 2. Suba tudo
docker compose up -d

# 3. Aplique as migrations
docker compose exec backend python migrations/apply.py

# 4. Crie o primeiro admin
docker compose exec backend python scripts/create_admin.py \
    seu@email.com SenhaForte123 "Seu Nome"

# 5. Teste
curl http://localhost:8000/health
curl http://localhost:8000/health/db
```

A documentação OpenAPI fica em http://localhost:8000/docs.

### Testando login

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","senha":"SenhaForte123"}'
```

---

## Deploy no Coolify

### Pré-requisitos
- Acesso ao painel Coolify (https://...)
- Repo Git conectado (já tem)

### Passo 1: criar serviço Postgres no Coolify
1. **+ Add → Database → PostgreSQL 16**
2. Use a imagem `pgvector/pgvector:pg16` (custom image)
3. Crie usuário `pizzabot`, senha forte, DB `pizzabot`
4. Anote a URL interna (algo como `postgresql://pizzabot:senha@postgres-xxx:5432/pizzabot`)

### Passo 2: criar serviço Redis no Coolify
1. **+ Add → Database → Redis**
2. Versão 7
3. Anote a URL interna (`redis://redis-xxx:6379/0`)

### Passo 3: criar aplicação backend
1. **+ Add → Application → Public/Private Repository**
2. Aponte para o repo, branch `main`
3. **Build pack:** Dockerfile
4. **Base directory:** `backend`
5. **Dockerfile location:** `backend/Dockerfile`
6. **Port:** 8000
7. **Variáveis de ambiente:** colar tudo do `.env.example` com valores reais
   - `DATABASE_URL=postgresql+asyncpg://pizzabot:senha@postgres-xxx:5432/pizzabot`
   - `DATABASE_URL_SYNC=postgresql://pizzabot:senha@postgres-xxx:5432/pizzabot`
   - `REDIS_URL=redis://redis-xxx:6379/0`
   - `APP_SECRET_KEY=` (gere com `openssl rand -hex 32`)
   - `CORS_ORIGINS=https://painel.seu-dominio.com`
   - …
8. **Deploy**

### Passo 4: aplicar migrations
No terminal do container (botão "Terminal" na app Coolify):
```bash
python migrations/apply.py
python scripts/create_admin.py seu@email.com SenhaForte123 "Seu Nome"
```

### Passo 5: configurar domínio
Coolify gera um subdomínio automático (`backend-xxx.coolify.seu-dominio.com`).
Aponte um CNAME (ex: `api.seu-dominio.com`) ou edite no Coolify.

---

## Migrations

Sistema simples baseado em arquivos `.sql` numerados:

- Arquivos vão em `migrations/`
- Nomes: `NNN_descricao.sql` (ordem alfabética)
- Histórico em `public.schema_migrations`
- Aplica-se com `python migrations/apply.py`

Para criar uma nova migration, basta adicionar `migrations/002_novo_recurso.sql`.

---

## Variáveis de ambiente

Veja `.env.example`. Críticas:

| Variável | Descrição |
|---|---|
| `APP_SECRET_KEY` | Chave de 32+ chars para JWT. Gerar com `openssl rand -hex 32` |
| `DATABASE_URL` | URL asyncpg do Postgres |
| `DATABASE_URL_SYNC` | Mesma URL mas formato sync (para migrations) |
| `REDIS_URL` | URL do Redis |
| `CORS_ORIGINS` | CSV de origens permitidas (URL do painel) |
| `EVOLUTION_BASE_URL` | URL da Evolution API |
| `EVOLUTION_API_KEY` | Chave da Evolution |
| `GEMINI_API_KEY` | Chave do Gemini (Fase 3) |

---

## O que está nestas fases

### Fase 1 — Fundação
✅ Setup Docker (Postgres + Redis + Backend)
✅ Schema limpo (sem dependência Supabase)
✅ Auth JWT própria (`/auth/login`, `/auth/refresh`, `/auth/me`)
✅ Healthchecks
✅ Bootstrap de admin via script
✅ Migrations versionadas

### Fase 2 — Webhook + fila + WebSocket
✅ Webhook Evolution (`POST /webhook/evolution`)
✅ Fila Redis com debounce 3s (junta msgs rápidas em batch)
✅ Worker Celery (`flush_conversation` — Fase 3 plugará a IA aqui)
✅ WebSocket pro painel (`/ws?token=...&pizzaria_id=...`)
✅ API de conversas (lista, mensagens, envio manual, pausa bot, marcar lida)
✅ Cliente Evolution para envio/reação/marcar-lida
✅ Broadcaster via Redis pub/sub (escala horizontalmente)

### Endpoints novos

```
# Webhook (a Evolution chama isso)
POST /webhook/evolution

# Painel — pizzarias
GET    /pizzarias                              lista
POST   /pizzarias                              cria (platform admin)
GET    /pizzarias/{id}                         detalhe

# Painel — conversas
GET    /pizzarias/{id}/conversas                          lista
GET    /pizzarias/{id}/conversas/{cid}/mensagens          histórico
POST   /pizzarias/{id}/conversas/{cid}/enviar             envia manualmente
PATCH  /pizzarias/{id}/conversas/{cid}/bot                pausa/retoma bot
POST   /pizzarias/{id}/conversas/{cid}/lida               marca lida

# WebSocket
WS     /ws?token=JWT&pizzaria_id=UUID

# Eventos emitidos por WS
- mensagem.nova          msg do cliente OU resposta humana
- conversa.atualizada    metadata mudou
- bot.toggled            bot pausado/retomado
- pedido.novo            (Fase 3+)
- pedido.atualizado      (Fase 3+)
```

### Como testar a Fase 2 ponta-a-ponta

```bash
# 1. Suba tudo (postgres, redis, backend, worker)
docker compose up -d

# 2. Migrations + admin
docker compose exec backend python migrations/apply.py
docker compose exec backend python scripts/create_admin.py admin@teste.com Senha12345 "Admin"

# 3. Login (anote o access_token)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@teste.com","senha":"Senha12345"}'

# 4. Crie pizzaria (use o access_token)
TOKEN="<seu-token>"
curl -X POST http://localhost:8000/pizzarias \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Pizzaria Teste","instancia":"pizzabot-teste"}'

# 5. Simule webhook Evolution (mensagem do cliente)
curl -X POST http://localhost:8000/webhook/evolution \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "pizzabot-teste",
    "data": {
      "key": {"remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "ABCDEF"},
      "pushName": "Joao",
      "message": {"conversation": "Oi, boa noite"}
    }
  }'

# 6. Veja os logs do worker — vai mostrar "Aguardando 3s" e depois "Flush"
docker compose logs -f worker
```

### Fase 3 — Agente IA
✅ Loop async com Gemini 2.0 Flash + tool calling nativo
✅ System prompt montado dinamicamente da `personalidade_atendente`
✅ Memória persistente (`agente_memoria`) — sobrevive a restarts
✅ 6 tools: buscar_cardapio, registrar_pedido, atualizar_pedido, cancelar_pedido, escalar_humano, lembrar_cliente
✅ Limite de iterações (max 6) pra evitar loop infinito
✅ Embeddings text-embedding-004 prontos (768 dim) — busca semântica
✅ CRUD de cardápio + reindex de embeddings
✅ CRUD de personalidade (`GET/PUT /pizzarias/{id}/agente/personalidade`)
✅ Endpoint de teste do agente sem WhatsApp (`POST /pizzarias/{id}/agente/testar`)
✅ Endpoint para preview do prompt montado (`GET /pizzarias/{id}/agente/prompt`)

### Endpoints novos da Fase 3

```
# Cardápio
GET    /pizzarias/{id}/cardapio
POST   /pizzarias/{id}/cardapio
PATCH  /pizzarias/{id}/cardapio/{produto_id}
DELETE /pizzarias/{id}/cardapio/{produto_id}
POST   /pizzarias/{id}/cardapio/reindex      Recalcula embeddings

# Agente
POST   /pizzarias/{id}/agente/testar         Roda sem WhatsApp (debug)
GET    /pizzarias/{id}/agente/prompt         Mostra o prompt final montado
GET    /pizzarias/{id}/agente/personalidade  Pega config atual
PUT    /pizzarias/{id}/agente/personalidade  Salva config (estilo, emojis, diferenciais...)
```

### Como testar a Fase 3

```bash
# 1. Configure GEMINI_API_KEY no .env
# 2. Crie pizzaria e cardápio
TOKEN="<seu-token>"
PID="<pizzaria-id>"

# Crie alguns produtos
curl -X POST http://localhost:8000/pizzarias/$PID/cardapio \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Calabresa","categoria":"Pizzas Salgadas","descricao":"Mussarela, calabresa, cebola","preco":49.90}'

# Configure a personalidade
curl -X PUT http://localhost:8000/pizzarias/$PID/agente/personalidade \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Camila","estilo":"casual","nivel_emoji":"moderado","diferenciais":["Massa fermentada 48h"]}'

# Teste o agente!
curl -X POST http://localhost:8000/pizzarias/$PID/agente/testar \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"telefone":"5511988887777","mensagem":"oi, vcs tão abertos? me manda o cardápio"}'
```

## Próximas fases

- **Fase 4:** Construtor visual de personalidade do atendente (UI)
- **Fase 5:** Reorganização do painel React
- **Fase 6:** Pagamentos (MP/Asaas) + métricas + desativação do n8n
