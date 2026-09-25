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
  - `fsm/catalogo.py` — catálogo por pizzaria (do banco, cache 60 s, invalidado ao
    editar o cardápio). `precificar` é a **regra única** de preço/validação por ID
    (tamanho, meio a meio, adicionais do produto), usada pelo agente e pelo checkout.
  - `fsm/nlu_comandos.py` — NLU padrão: a IA só escolhe **códigos do catálogo**
    (P1.., A1.., tamanhos cadastrados) via Structured Outputs estrito e dá
    **comandos** sobre itens do carrinho pelo ID (`definir_qtd`, `remover`,
    `trocar_tamanho`...). `checar_escolhas` barra escolha que o pedido desmente.
    Falhou → NLU livre (`fsm/nlu.py`); `nlu_versao: livre` na config de IA desliga.
  - `fsm/validador.py` — porta do pedido: nada vira resumo/pedido sem passar
    (item no catálogo, preço = catálogo, total = itens + taxa, endereço, pagamento).
  - `fsm/confirmacao.py` — "✅ Anotei/Ajustei/Tirei" montado do carrinho real; a
    voz só escreve a continuação. `fsm/guard.py` barra preço e produto sem lastro.
  - `fsm/nlu.py` — NLU livre (reserva): extrai intenção + entidades em JSON.
  - `fsm/engine.py` — regras de negócio determinísticas (carrinho, upsell,
    endereço, taxa, pagamento). Decide a ação e pode fixar `mensagem_pronta`.
  - `fsm/voice.py` — LLM redige a fala; `fsm/guard.py` blinda o texto (preço, saudação, nome).
  - `providers.py`/`llm.py` — Gemini, OpenAI, OpenRouter; `failover.py` troca para o reserva.
    Nível de raciocínio por papel (`nlu_reasoning`/`voz_reasoning`, config de IA no admin).
    Em produção: `openai/gpt-6-luna` com raciocínio desligado (low deixava a NLU até 14 s).
  - Antes de decidir, o engine procura o pedido REAL ativo do cliente
    (`tools.pedido_ativo_do_cliente`): pós-venda funciona para pedido do cardápio
    digital e depois do TTL de 2h do estado.
  - `behavior.py` — as opções de comportamento configuráveis por pizzaria.
- `routes/` — API. Rotas de pizzaria usam `Depends(membership)` (deps.py), que
  também devolve **402** para pizzaria suspensa. Admin da plataforma usa `require_platform_admin`.
- `services/telefones.py` — o mesmo número chega com e sem o 9º dígito (cardápio ×
  JID do WhatsApp): busca de cliente/conversa/pedido sempre por `telefones_equivalentes`.
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
.venv/Scripts/python.exe -m pytest tests -q          # ~520 testes, usam mocks
.venv/Scripts/python.exe -m ruff check app            # B008 (Depends) e E402 são intencionais
docker compose up -d                                  # stack local completa

# Frontend (raiz)
npm run lint     # tsc --noEmit
npm run build
npm run dev      # precisa de VITE_PIZZABOT_API_URL no .env.local

# Teste de estresse do atendimento com conversas roteirizadas
backend/scripts/stress_atendimento.py
```

Testar o agente REAL sem efeito colateral: `POST /pizzarias/{id}/agente/testar`
(`{mensagem, sessao}`) roda o FSM em modo simulação — não envia WhatsApp, não cria
pedido, não cobra; `POST .../agente/testar/reset` limpa a sessão. Bug achado assim
vira teste em `backend/tests/test_bateria_atendimento.py`.

Antes de commitar: pytest + `npm run lint` passando.

## Deploy e produção

- Painel: https://pizzabot.secretariaai.eu.cc · API: https://api.pizzabot.secretariaai.eu.cc (`/health`)
- Coolify (coolify.secretariaai.eu.cc). **Push na `main` = deploy**: o CI
  (`.github/workflows/`) roda pytest + tsc e, se passar, o job `deploy`
  dispara os serviços no Coolify. Não há auto-deploy fora do CI — se o CI não
  rodar, a produção não atualiza.
- Migrations rodam sozinhas no boot do serviço `backend`.
- `/docs` e `/openapi.json` ficam desligados com `APP_ENV=production`.
- Link público do cardápio: `Settings.url_cardapio(slug)` (`PAINEL_URL` ou a 1ª
  origem https do CORS que não é a API).
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
- A voz só cita valor (R$) em dúvida/alteração e só os que estão nos fatos
  (`precos_validos`); o guard (`fsm/guard.py`) neutraliza o resto, exceto troco.
- Meio a meio: regra por produto em `regras.meia_meia` (permitido, max_sabores,
  maior_valor|media), a mesma no agente (`tools._calcular_pedido`) e no cardápio
  digital (`cardapio_publico._preco_dos_sabores`).
- Correção de bug do agente vem com teste em `backend/tests/` reproduzindo a conversa.
- Produto, tamanho e adicional no pedido são sempre **por ID do catálogo**
  (`produto_id`/`sabores_ids`); nunca adicionar busca por nome aproximado (ILIKE)
  no caminho de preço. Regra de cardápio nova entra em `catalogo.py`, não no prompt.
- Conferência humana é opção por pizzaria (`handoff.revisar_pedidos`): pedido da IA
  fica `novo` + `aguardando_revisao` até a loja aprovar; pagamento não pula isso.
