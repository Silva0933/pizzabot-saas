Resumo Geral — PizzaBot
O que é
Plataforma SaaS multi-tenant de atendimento automatizado para pizzarias/lanchonetes via WhatsApp. Uma atendente de IA conversa com o cliente, lê o cardápio, registra pedidos, gera cobrança (Pix/cartão) e acompanha o status — tudo num painel web por pizzaria, mais um painel de administração da plataforma.

Local: E:\Tops Ferramentas\PizzaBot

Arquitetura
WhatsApp → Evolution API → (webhook) → Backend FastAPI
                                          ├─ persiste msg + WebSocket pro painel
                                          └─ enfileira no Redis (debounce ~10s)
                                                  ↓
                                          Worker Celery → Agente IA (LLM + tools)
                                                  ↓
                                          Evolution API → resposta no WhatsApp
Painel React (PWA) ──HTTP/JWT + WebSocket──> Backend
Três serviços usam a mesma imagem Docker, diferenciados por APP_ROLE:

backend — API FastAPI (uvicorn), webhooks, WebSocket
worker — Celery, consome a fila e roda o agente IA
painel — frontend React servido por Nginx
Infra de apoio: Postgres (com pgvector) + Redis.

Stack
Backend (backend/)

FastAPI + Uvicorn
SQLAlchemy 2.0 async + asyncpg + pgvector
Celery + Redis (fila com debounce)
LLM multi-provider: Gemini, OpenAI e OpenRouter (escolhido no painel admin)
Evolution API (WhatsApp), Mercado Pago e Asaas (pagamentos)
ffmpeg (transcrição de áudios)
Frontend (src/)

React 19 + Vite + TypeScript
Tailwind CSS + lucide-react + recharts + motion
PWA (manifest + service worker)
Telas atuais em src/components/v2/: Início, Conversas, Pedidos, Cardápio, Meu Negócio, Assinatura (plano/faturas), Ajuda (guia rápido), PlatformAdminView — mais SignupScreen (cadastro público com trial) no App.tsx
Componentes do agente IA (backend/app/agent/)
runner, llm, providers, tools, prompt, memory, context. O agente é orientado por uma FSM (máquina de estados) — foco recente do desenvolvimento (ver commits). Tools: buscar_cardapio, registrar_pedido, gerar_pagamento, etc. A busca do cardápio usa SQL (não depende de embeddings); reindex semântico é opcional via Gemini.

Serviços principais (backend/app/services/)
evolution, pagamentos, status_messages, business_hours, transcricao, app_config, broadcaster, plans, price_check, response_guard, customer_memory, geocoding, humanized_delivery, embeddings, import_cardapio, alertas.

Estado atual (foco recente)
Os últimos commits giram em torno do controle robusto de falhas de IA, transição amigável e silenciosa para o suporte humano, persistência de avisos de sistema no histórico da conversa no painel, contadores de falhas consecutivas FSM (NLU e pendências do pedido), logs técnicos descritivos com stack trace e contexto (carrinho, etapa FSM), além de correções de taxa de entrega por bairro/geral e blindagem anti-alucinação no prompt. Migrations vão até 012_pagamento_manual.sql.

Blindagem de produção (commit 3f39629): rodada de hardening de prova-de-falhas no agente, cobrindo race conditions, perda de mensagens e falhas silenciosas — ver a seção "6. Controle de Falhas e Prova de Produção" abaixo. Sem migrations nem variáveis de ambiente novas. Checklist de validação em docs/smoke-test-blindagem.md.

Mudanças recentes (sessão de pagamentos/cota/upsell — ver seção "7" no fim)
- Pix Mercado Pago expira em 30 min (PIX_EXPIRATION_MINUTES em services/pagamentos.py): o aviso de "pagamento não confirmado" deixou de chegar 1 dia depois.
- Pagamento na conversa configurável por pizzaria: modo_pagamento_online = 'automatico' (gateway MP/Asaas), 'manual' (Pix copia-e-cola próprio + conferência do comprovante) ou 'desativado' (só na entrega/retirada). Novo estado pedidos.payment_status='em_analise' e endpoints de confirmar/rejeitar pagamento manual. Migration 012.
- Upsell mais confiável: a atendente só oferece bebida/borda/adicional que existe de verdade, nomeia as opções reais (não inventa marca/sabor) e, se o cliente aceita sem dizer o quê, lista as opções; bebida inexistente nomeia a real com clareza.
- Cota dos planos por ATENDIMENTO (1 conversa/cliente por mês): Básico 100, Pro 300, Premium 500. Bloqueia conversa nova além da cota (deixa as em andamento terminarem) e mostra contador + aviso ao dono na aba Pedidos.
- Nova aba "Ajuda" no painel (src/components/v2/AjudaView.tsx): guia rápido e sequencial de cada funcionalidade.

Mudanças recentes (sessão SaaS de produção — ver seção "8" no fim)
- Celery Beat (3º papel da mesma imagem: APP_ROLE=beat) com jobs periódicos: monitor de conexão WhatsApp (5/5 min) e dunning diário de assinaturas. O Coolify precisa do 4º serviço (beat) — 1 réplica só.
- Monitor de WhatsApp desconectado: evento CONNECTION_UPDATE + poll do Beat → pizzarias.whatsapp_estado (migration 013), indicador no Topbar, banner vermelho e alerta no admin.
- Monetização: assinatura mensal das pizzarias via Asaas DA PLATAFORMA (Pix/boleto/cartão), tabela faturas (migration 014), webhook /webhook/asaas-plataforma, dunning (suspensão automática após 5 dias de atraso, reativação automática ao pagar), aba "Assinatura" no painel, plano trial (14 dias, 20 atendimentos) com signup público.
- Economia de LLM: NLU determinística (mensagens triviais sem LLM), modelo barato dedicado pra NLU (nlu_model), failover de provedor (fallback_provider/model), margem por tenant no admin.
- Fluidez: resgate de carrinho abandonado (~25 min, 1x por conversa), "o de sempre" no pipeline FSM, reação ✅ ao comprovante do Pix manual, voz com balões múltiplos ([QUEBRA]).
- Produção: Sentry opcional (SENTRY_DSN), rate limit no login (5/min/IP) e signup (3/h/IP), CI no GitHub Actions (pytest + tsc). Migrations vão até 014_billing_plataforma.sql.

Mudanças recentes (lapidação da conversa + endereço por localização — ver seção "9" no fim)
- Endereço por LOCALIZAÇÃO do WhatsApp: o cliente manda a localização (clipe 📎) e o sistema converte em endereço via reverse geocoding (Nominatim), sem LLM; sem número/rua no GPS, a atendente pergunta só o que falta.
- Upsell de ITEM ÚNICO: "quero" depois de "Quer uma Coca Cola 2L?" adiciona o item direto (antes listava a única opção e perguntava "qual?").
- Aceite da oferta do cardápio: "quero"/"sim"/"pode mandar" após "Gostaria de ver o cardápio?" envia o cardápio (antes: "Quero o quê?").
- Endereço não perde o bairro: atualização parcial (rua/número depois da localização) preserva o bairro confirmado (estado.endereco_bairro); taxa de entrega prioriza bairro CADASTRADO citado no texto do endereço sobre o geocoding.
- Falas críticas viraram verbatim/instrução reforçada: pergunta de endereço (sempre oferece a localização), confirmação do item aceito pelo nome, bairro exato ao informar a taxa.

Como rodar
Backend (Docker):

cd backend && cp .env.example .env   # preencher variáveis
docker compose up -d
docker compose exec backend python migrations/apply.py
Frontend:

npm install
echo "VITE_PIZZABOT_API_URL=http://localhost:8000" > .env.local
npm run dev      # http://localhost:5173
npm run lint     # tsc --noEmit (checagem de tipos)
Configuração de IA e pagamentos
Chaves de LLM / provedor / modelo: definidos no painel admin → Configuração de IA (tabela app_config), com teste de conexão e consumo de tokens.
Pagamento na conversa: por pizzaria, em Meu Negócio → Geral. Campo modo_pagamento_online com 3 modos — Automático (Mercado Pago/Asaas; cobrança gerada ao "pagar agora", confirmação via webhook, Pix expira em 30 min), Manual (envia o copia-e-cola próprio da pizzaria, pede o comprovante, dono confere/aprova no card de Pedidos) e Desativado (só na entrega/retirada). Chaves do gateway continuam por pizzaria.
Deploy (estado REAL de produção — configurado em 2026-06-10)
Coolify (https://coolify.secretariaai.eu.cc) com 4 serviços a partir do repositório github.com/Silva0933/pizzabot-saas (branch main, deploy key):
- pizzabot-backend (API) — https://api.pizzabot.secretariaai.eu.cc — migrations rodam no boot
- pizzabot-worker (APP_ROLE=worker) — roda o agente IA
- pizzabot-beat (APP_ROLE=beat) — agendador dos jobs periódicos; SEMPRE 1 réplica
- pizzabot-painel — https://pizzabot.secretariaai.eu.cc (build Vite + Nginx)
Mais Postgres (pgvector) e Redis. Deploy via API do Coolify: POST /api/v1/deploy?uuid=<app> (backend primeiro).
Cobrança da plataforma JÁ ATIVA: envs ASAAS_PLATFORM_* preenchidas nos 3 serviços Python e webhook criado na conta Asaas de produção apontando para /webhook/asaas-plataforma (autenticado por token). Docs das fases em docs/.

# Guia de Arquitetura e Estrutura de Arquivos — PizzaBot

Este documento serve como um mapa esqueleto do projeto **PizzaBot**. Ele foi projetado para que qualquer LLM (ou desenvolvedor) compreenda rapidamente a arquitetura, as funcionalidades e a localização exata de cada componente do sistema sem precisar ler todos os arquivos da base de código.

---

## 1. Visão Geral da Arquitetura
O PizzaBot é uma plataforma SaaS multi-tenant para pizzarias e lanchonetes. Ele realiza atendimento automatizado no WhatsApp integrado com IA, controle de cardápio relacional, checkout de pagamentos (Pix/Cartão) e um painel de gerenciamento web (Kanban, conversas e configurações).

### Fluxo de Comunicação
```
WhatsApp ──> Evolution API ──> Webhook FastAPI ──> Redis (Debounce ~3s)
                                                      │
                                                      ▼
Evolution API <── Envia msg WhatsApp <── Worker Celery (Agente IA / FSM)
```

---

## 2. Tecnologias Utilizadas (Stack)
- **Backend**: FastAPI (Python), SQLAlchemy 2.0 (Async), PostgreSQL (pgvector para busca semântica), Redis (debounce de mensagens), Celery (processamento assíncrono do agente).
- **IA**: Gemini (nativo) / OpenAI / OpenRouter (definidos via banco), orientados por uma FSM (Máquina de Estados Finita) determinística.
- **Integrações**: Evolution API (WhatsApp), Mercado Pago e Asaas (pagamentos), Nominatim (geocodificação de endereços).
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, WebSockets para atualizações em tempo real (Kanban de pedidos e chat).

---

## 3. Mapeamento de Arquivos do Backend (`backend/`)

A lógica do backend está organizada dentro de `backend/app/` nas seguintes subpastas:

### 3.1. Agente de IA e FSM (`backend/app/agent/`)
Controla o raciocínio conversacional do robô.
*   [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py): Orquestrador FSM (NLU ➔ Engine ➔ Voz). É o ponto de entrada principal do agente de IA atual.
*   [fsm/nlu.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/nlu.py): Camada NLU. Usa LLM para ler a mensagem do cliente e extrair intenções (`adicionar_item`, `informar_endereco`, etc.) e entidades em formato JSON.
*   [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py): Camada de Decisão determinística (FSM). Controla as etapas (`SAUDACAO`, `COLETA_ITENS`, `ENTREGA`, `ENDERECO`, `PAGAMENTO`, `AGUARDANDO_CONFIRMACAO`, `FINALIZADO`), monta o carrinho e decide a ação lógica.
*   [fsm/voice.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/voice.py): Camada de Geração de Voz. Pega a decisão lógica e instrui a LLM a formular a resposta conversacional para o cliente seguindo a persona.
*   [fsm/guard.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/guard.py): Sanitizador/blindagem do texto gerado pela LLM (remove saudações duplicadas e neutraliza preços alucinados).
*   [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py): Runner do agente (contém o processador legado por tool-calling livre e o executor geral `process_and_reply` acionado pelo Celery).
*   [tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py): Implementação física de todas as ferramentas da IA (`buscar_cardapio`, `preparar_resumo_pedido`, `registrar_pedido`, `consultar_taxa_entrega`, `gerar_pagamento`).
*   [prompt.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/prompt.py): Construtor do prompt do sistema para o agente de IA legado.
*   [memory.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/memory.py): Persistência de turnos do chat na memória.
*   [llm.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/llm.py) / [providers.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/providers.py): Wrappers de conexão com APIs do Gemini e modelos OpenAI/OpenRouter.

### 3.2. Serviços do Sistema (`backend/app/services/`)
Encapsulam regras de negócio, integrações externas e operações auxiliares.
*   [conversation_state.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/conversation_state.py): Persiste e recupera o estado curto estruturado do cliente (carrinho, etapa, endereço, tipo de entrega) na tabela `atendimento_estado`.
*   [evolution.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/evolution.py): Cliente de integração com a Evolution API (envio de texto, mídias, áudios, presença "digitando").
*   [pagamentos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/pagamentos.py): Cliente de integração com gateways Mercado Pago e Asaas (geração de Pix QR Code, cópia e cola, e checkout de cartão). Constante `PIX_EXPIRATION_MINUTES=30` define a validade do Pix do Mercado Pago (campo `date_of_expiration`).
*   [status_messages.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/status_messages.py): Dispara mensagens automáticas no WhatsApp do cliente quando o status do pedido muda no painel (ex: "Saiu para entrega", "Confirmado"). Inclui os triggers `pagamento_aprovado` e `pagamento_falhou` (reaproveitados pela conferência do Pix manual).
*   [plans.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/plans.py): Catálogo de planos (preços + limites). A cota enforçada é `conversas_mes` (atendimentos/mês): Básico 100, Pro 300, Premium 500.
*   [app_config.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/app_config.py): Config de LLM + medição de uso. `conversas_atendidas_mes` / `conversa_ja_atendida_mes` / `conversas_atendidas_mes_todas` contam os atendimentos (conversas distintas com resposta do bot) que alimentam a cota dos planos.
*   [geocoding.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/geocoding.py): Validador e extrator de bairros a partir de endereços digitados (via API Nominatim).
*   [humanized_delivery.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/humanized_delivery.py): Simula digitação humana (delay de envio baseado no tamanho da resposta do bot).
*   [business_hours.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/business_hours.py): Checagem de funcionamento (abre/fecha) baseado nos horários configurados.
*   [transcricao.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/transcricao.py): Converte áudios ogg enviados pelo cliente no WhatsApp para texto usando o Whisper ou Gemini.
*   [price_check.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/price_check.py) / [response_guard.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/response_guard.py): Validação determinística de preços para evitar alucinações de valores pela LLM.
*   [queue.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/queue.py): Fila de debounce baseada no Redis (agrupa mensagens enviadas pelo cliente num intervalo de 3s).
*   [import_cardapio.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/import_cardapio.py): Importador de cardápio via TXT/JSON ou via análise semântica da LLM.

### 3.3. Rotas de API (`backend/app/routes/`)
*   [webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py): Recebe eventos do WhatsApp da Evolution API (mensagens recebidas, arquivos, presença).
*   [webhook_pagamento.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook_pagamento.py): Recebe webhooks de confirmação de pagamento do Mercado Pago e Asaas.
*   [pedidos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pedidos.py): além do CRUD/status, expõe `POST .../pedidos/{id}/pagamento/confirmar` e `.../rejeitar` (conferência manual do comprovante do Pix manual).
*   [pizzarias.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pizzarias.py): inclui `GET .../uso` — atendimentos do mês vs. cota do plano (alimenta o contador/aviso na aba Pedidos).
*   [ws.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/ws.py): Gerenciador de WebSockets (envia notificações de novas mensagens e novos pedidos para o painel em tempo real).
*   [pedidos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pedidos.py) / [conversas.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/conversas.py) / [cardapio.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/cardapio.py) / [pizzarias.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pizzarias.py): APIs rest que alimentam o painel administrativo da pizzaria.
*   [admin.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/admin.py): Rotas para a administração global da plataforma SaaS (SuperAdmin).

### 3.4. Modelos e Banco de Dados
*   [models.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/models.py): Modelos SQLAlchemy contendo o esquema relacional:
    - `Pizzaria`: Configurações de IA, horário, taxas de entrega e tokens de gateways. Campos de pagamento na conversa: `modo_pagamento_online` ('automatico'|'manual'|'desativado'), `pix_manual_copia_cola` e `pix_manual_titular` (modo manual).
    - `Cliente`: Registro de clientes, histórico de gastos e preferências.
    - `Pedido`: Itens, status (`novo`, `confirmado`, `no_forno`, `a_caminho`, `entregue`, `cancelado`), forma de pagamento e status da transação. `payment_status` ∈ (`pending`,`approved`,`rejected`,`expired`,`em_analise`) — `em_analise` = Pix manual aguardando conferência do dono.
    - `Mensagem`: Histórico de mensagens trafegadas (cliente, bot ou sistema).
    - `Conversa`: Estado de controle do chat no painel (bot ativo/inativo, status de atendimento).

---

## 4. Mapeamento de Arquivos do Frontend (`src/components/v2/`)

Os componentes e telas do painel React (PWA) estão concentrados em `src/components/v2/`:
*   [InicioDashboard.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/InicioDashboard.tsx): Tela inicial (métricas rápidas do dia: faturamento, pedidos ativos, ticket médio, gráficos de vendas).
*   [PedidosViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/PedidosViewV2.tsx): Kanban de pedidos em tempo real. Permite mudar o status arrastando os cards (dispara avisos no WhatsApp) e visualizar os detalhes dos pedidos. Inclui os botões Confirmar/Rejeitar do Pix manual (card destacado quando há comprovante) e o contador discreto de atendimentos do mês + aviso de cota (perto/atingido).
*   [ConversasViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/ConversasViewV2.tsx): Central de atendimento (chat multicanal). Permite ao operador assumir conversas pausando o bot (`bot_ativo = False`), ler o histórico e enviar mensagens manuais.
*   [CardapioViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/CardapioViewV2.tsx): Gerenciador do cardápio relacional (categorias, produtos, múltiplos tamanhos, complementos, e upload de PDF/imagem).
*   [MeuNegocioViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/MeuNegocioViewV2.tsx): Tela de configurações da pizzaria (dados básicos, horários de funcionamento, regras de taxas de entrega por bairro ou fixa, e pagamento). O card "Pagamentos" tem o seletor de 3 modos (Automático/Manual/Desativado) com campos condicionais (gateway+token, ou Pix copia-e-cola próprio).
*   [AjudaView.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/AjudaView.tsx): Aba "Ajuda" — acordeão sequencial com explicação simples de cada parte do painel e de como a atendente monta o pedido. Conteúdo estático (sem API).
*   [PlatformAdminView.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/PlatformAdminView.tsx): Painel do administrador da plataforma SaaS (gestão de tenants, planos, cotas de uso de tokens, logs de requisições de IA e faturamento global).
*   [Sidebar.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/Sidebar.tsx) / [Topbar.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/Topbar.tsx) / [AppShell.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/AppShell.tsx): Layout estrutural do painel.

---

## 5. Guias de Implementação Rápidos

### Onde ir para resolver um problema?
*   **Adicionar uma nova ferramenta para a IA**: Adicione a declaração e a função executora em `agent/tools.py`.
*   **Ajustar prompts ou comportamento conversacional básico**: Edite `agent/fsm/voice.py` (para FSM) ou `agent/prompt.py` (para legado).
*   **Modificar regras de transição de estado da IA**: Modifique a lógica em `agent/fsm/engine.py`.
*   **Corrigir falhas de perda de carrinho ou estado do bot**: Ajuste o compactador em `services/conversation_state.py`.
*   **Alterar mensagens automáticas de alteração de pedido**: Edite `services/status_messages.py`.
*   **Mudar modos/fluxo de pagamento na conversa (automático/manual/desativado)**: lógica no `agent/fsm/engine.py` (oferta da forma de pagamento) e `agent/tools.py` (`registrar_pedido`, `_enviar_pix_manual`, `_gerar_cobranca`). Validade do Pix do MP em `services/pagamentos.py` (`PIX_EXPIRATION_MINUTES`). Detecção do comprovante em `agent/fsm/pipeline.py` (`_checar_comprovante_manual`). Confirmar/Rejeitar em `routes/pedidos.py`.
*   **Ajustar a oferta de bebida/borda/adicional (upsell)**: `agent/fsm/engine.py` — `_opcoes_upsell` (o que existe de verdade), bloco de oferta e o handler `aguardando_upsell`; bebida inexistente no bloco de pendência do cálculo.
*   **Alterar limites/cota dos planos (atendimentos/mês)**: valores em `services/plans.py` (`conversas_mes`); contagem em `services/app_config.py`; bloqueio em `agent/runner.py` (`process_and_reply`); contador/aviso no frontend em `components/v2/PedidosViewV2.tsx` (via `GET /pizzarias/{id}/uso`).
*   **Resolver bugs ao enviar mensagens ou áudios**: Verifique `services/evolution.py` ou `routes/webhook.py`.
*   **Ajustar taxas de entrega por bairro ou geolocalização**: Procure em `agent/tools.py` (`_taxa_para_bairro`) ou `services/geocoding.py`.
*   **Modificar o cálculo de preços (meia-meia, adicionais, etc.)**: Ajuste a lógica de cálculo na função `_calcular_pedido` em `agent/tools.py`.
*   **Corrigir falhas de IA, mensagens de fallback ou logs de exceções**: Ajuste a captura de erros em [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py).
*   **Alterar o comportamento ou motivo de transição para humano**: Ajuste a lógica de [escalar_humano](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py#L1475) em [tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py).
*   **Configurar contadores de erros ou loops de pendências/NLU**: Ajuste a regra de contadores em [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py).
*   **Corrigir problemas no painel Kanban do frontend**: Modifique `components/v2/PedidosViewV2.tsx`.
*   **Ajustar chat no frontend**: Modifique `components/v2/ConversasViewV2.tsx`.

---

## 6. Controle de Falhas e Prova de Produção

Rodada de hardening (commit `3f39629`) que torna o agente resistente a race conditions, perda de mensagens e falhas silenciosas. **Sem migrations e sem variáveis de ambiente novas.** Validação em [docs/smoke-test-blindagem.md](file:///e:/Tops%20Ferramentas/PizzaBot/docs/smoke-test-blindagem.md). Testes em `backend/tests/test_robustez_falhas.py`.

### 6.1. Críticos
*   **Race `bot_ativo` (humano × bot)**: `process_and_reply` em [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) re-checa `suspensa` / `bot_ativo_global` / `bot_ativo` **antes de responder**. O webhook só enfileira com o bot ligado, mas durante o debounce (7–45s) um atendente pode assumir a conversa; sem a re-checagem o bot responderia por cima do humano.
*   **Agente sem texto não deixa o cliente no vácuo**: se o agente conclui sem gerar resposta, [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) envia fallback amigável, registra alerta `falha_ia` e escala para humano (mesmo tratamento da exceção crítica).
*   **Timeouts coerentes**: constantes `FSM_TIMEOUT_SECONDS=15` e `LEGACY_TIMEOUT_SECONDS=40` em [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) (o agente legado passou a ter teto), `rollback` defensivo no `except`, e `FLUSH_LOCK_TTL=90` em [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py) — sempre acima do pior caso de processamento, evitando flush duplicado por dois workers.

### 6.2. Médios
*   **Idempotência do webhook (dedup)**: [routes/webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py) marca o `evolution_id` no Redis via `SET NX` (TTL 10 min). Reentregas da Evolution são ignoradas (`{"ignored":"duplicate"}`) — evita persistir/processar a mesma mensagem 2x.
*   **Inflight durável (não perde mensagem)**: [services/queue.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/queue.py) — `drain_pending` move o lote para `inflight:{pid}:{phone}` e só limpa via `confirm_processed` após o flush concluir (chamado no `finally` de [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py)). Com `task_acks_late=True`, um crash do worker antes de responder não perde a mensagem: o lote órfão é recuperado e reprocessado. Semântica passa a ser *at-least-once*.
*   **Fim das falhas silenciosas no engine**: em [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py), `cancelar`/`alterar pedido` que falham (exceção ou `ok=False`) **escalam para humano e NÃO confirmam "feito"** ao cliente; avaliação (baixo risco) loga em vez de engolir o erro.

### 6.3. Menores
*   **Log DIAGNOSTIC removido** de [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py) (rodava um `COUNT(*)` de produtos a cada mensagem).
*   **NLU cacheia modelos sem JSON Mode** em [fsm/nlu.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/nlu.py) (`_SEM_JSON_MODE`) — evita 2 chamadas de NLU por mensagem em modelos sem `response_format`.

### Onde mexer (controle de falhas)
*   **Re-checagem de bot ligado / fallback de erro / timeouts**: [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) (`process_and_reply`).
*   **TTL do lock / liberação do inflight**: [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py).
*   **Dedup / inflight da fila**: [routes/webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py) e [services/queue.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/queue.py).
*   **Escalonamento ao falhar cancelar/alterar**: [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py).

---

## 7. Pagamentos, Cota de Planos e Upsell (sessão recente)

Conjunto de mudanças focadas em receita/custo e na qualidade do atendimento. **Migration nova: `012_pagamento_manual.sql`** (aplicada automaticamente no boot do backend). Testes em `backend/tests/test_pagamento_manual.py`, `test_upsell.py` e `test_cota_atendimentos.py`.

### 7.1. Expiração do Pix (Mercado Pago)
O Pix do MP não definia validade → usava o padrão de 24h, e o aviso de "pagamento não confirmado" (`pagamento_falhou`, disparado pelo webhook `expired`) só chegava no dia seguinte. Agora `services/pagamentos.py` envia `date_of_expiration = agora + PIX_EXPIRATION_MINUTES (30)`. (Asaas: a expiração do QR depende de config da conta — não alterado.)

### 7.2. Pagamento na conversa configurável (3 modos)
Campo `pizzarias.modo_pagamento_online`:
*   **automatico**: comportamento histórico — cobrança via gateway (MP/Asaas), confirmação por webhook.
*   **manual**: a pizzaria cadastra `pix_manual_copia_cola` (+ `pix_manual_titular`) em Meu Negócio → Geral. A atendente envia o código na hora ([tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py) `_enviar_pix_manual`), marca o pedido como `payment_status='em_analise'` e notifica o painel. O cliente manda o comprovante → [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py) `_checar_comprovante_manual` dá um ack e avisa o painel **sem reabrir o funil**. O dono confere no card de Pedidos: **Confirmar** (`pagamento_aprovado` + avança) ou **Rejeitar** (`pagamento_falhou`) — endpoints em [routes/pedidos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pedidos.py). Salvaguarda: modo manual sem copia-e-cola cadastrado vira pagamento na entrega (nunca promete um Pix que não envia).
*   **desativado**: a atendente não oferece pagamento online; só dinheiro/cartão na entrega/retirada ([fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py)).

### 7.3. Upsell confiável (bebida/borda/adicional)
Em [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py):
*   `_opcoes_upsell(ctx, db)` verifica o que existe DE VERDADE — bebidas (cardápio, por categoria) e bordas/adicionais (cadastro da casa). Se não há nada, pula o upsell.
*   A oferta passa os **nomes reais** e proíbe a voz de inventar marca/sabor (bug: oferecia "coca ou guaraná" sem ter guaraná).
*   Handler `aguardando_upsell`: se o cliente aceita sem dizer o quê (só "quero"), **lista as opções reais** e pergunta qual (antes fechava o pedido sem o item).
*   Bebida inexistente: nomeia a bebida real com clareza (quando só há uma, deixa claro que é a única — sem "outras opções" vago). Detecção de bebida agora ignora acento.

### 7.4. Cota dos planos por ATENDIMENTO
A cota enforçada passou de "rodadas de IA" para **atendimentos = conversas distintas com resposta do bot no mês** (1 por cliente/mês). Limites em [services/plans.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/plans.py): **Básico 100, Pro 300, Premium 500** (`conversas_mes`). Contagem em [services/app_config.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/app_config.py). Bloqueio em [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) `process_and_reply`: conversa NOVA além da cota não é respondida (silêncio + evento `limite.ia` pro painel); conversas JÁ atendidas no mês continuam (não corta pedido no meio). O dono vê na aba Pedidos um contador discreto "X/Y atendimentos" e um aviso âmbar (≥80%) / vermelho (atingido), alimentados por `GET /pizzarias/{id}/uso`.

### Onde mexer (seção 7)
*   **Validade do Pix MP**: [services/pagamentos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/pagamentos.py) (`PIX_EXPIRATION_MINUTES`).
*   **Modos de pagamento / Pix manual / comprovante**: [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py), [agent/tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py), [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py), [routes/pedidos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pedidos.py).
*   **Upsell / bebidas**: [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py) (`_opcoes_upsell`, `aguardando_upsell`).
*   **Cota dos planos**: [services/plans.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/plans.py), [services/app_config.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/app_config.py), [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py), [components/v2/PedidosViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/PedidosViewV2.tsx).
*   **Aba de Ajuda**: [components/v2/AjudaView.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/AjudaView.tsx) (+ registro em `Sidebar.tsx`, `AppShell.tsx`, `App.tsx`).

---

## 8. SaaS de Produção (sessão atual): monetização, economia, fluidez e robustez

Quatro fases que transformam a ferramenta em SaaS pronto para produção. **Migrations novas: `013_whatsapp_status.sql` e `014_billing_plataforma.sql`** (aplicadas no boot). **Env vars novas (`.env.example`)**: `SENTRY_DSN`, `ASAAS_PLATFORM_API_KEY`, `ASAAS_PLATFORM_WEBHOOK_TOKEN`, `ASAAS_PLATFORM_BASE_URL` (sandbox: `https://api-sandbox.asaas.com/v3`). Testes: `test_billing_plataforma.py`, `test_signup_trial.py`, `test_nlu_deterministica.py`, `test_resgate_carrinho.py`.

### 8.1. Fundação (profissional / à prova de falhas)
*   **Celery Beat**: 3º papel da mesma imagem Docker (`APP_ROLE=beat` → `celery beat`). Agendamentos em [workers/celery_app.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/celery_app.py) (`beat_schedule`); jobs em [workers/periodic.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/periodic.py). **No Coolify é preciso criar o 4º serviço (beat) — sempre 1 réplica.**
*   **Monitor de conexão WhatsApp**: evento `CONNECTION_UPDATE` no webhook ([routes/webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py) `_handle_connection_update`) + poll 5/5 min do Beat. Estado em `pizzarias.whatsapp_estado`; lógica compartilhada em [services/whatsapp_status.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/whatsapp_status.py) (broadcast `whatsapp.status` + alerta `whatsapp_desconectado` na transição). Painel: indicador no Topbar + banner vermelho "Reconectar agora" (AppShell).
*   **Sentry**: [app/observability.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/observability.py) (`init_sentry`), chamado na API e no worker/beat. No-op sem `SENTRY_DSN`.
*   **Rate limiting**: [services/rate_limit.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/rate_limit.py) (Redis INCR, fail-open) — login 5/min/IP, signup 3/h/IP.
*   **Failover de LLM**: [agent/failover.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/failover.py) (`com_failover`) — em falha do primário tenta 1x o reserva (`fallback_provider`/`fallback_model`, card de IA no admin). Usado na NLU e voz do FSM.
*   **CI**: [.github/workflows/ci.yml](file:///e:/Tops%20Ferramentas/PizzaBot/.github/workflows/ci.yml) — pytest (backend) + tsc (frontend) em todo push/PR.

### 8.2. Monetização (cobrança da plataforma via Asaas)
*   **Assinatura recorrente**: [services/billing_plataforma.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/billing_plataforma.py) — `PlatformAsaasClient` (customers/subscriptions, `billingType=UNDEFINED` = Pix/boleto/cartão), `ativar_assinatura` (dono contrata na aba Assinatura), `aplicar_pagamento_plataforma` (webhook). O plano contratado viaja no `externalReference` (`{pizzaria_id}|{plano}`) e **só vira oficial quando o pagamento confirma**.
*   **Webhook**: `POST /webhook/asaas-plataforma` em [routes/webhook_pagamento.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook_pagamento.py), autenticado pelo header `asaas-access-token`. Pagamento confirmado → fatura paga + `plano_vence_em` +30d + reativa suspensa + converte trial.
*   **Dunning**: job diário `verificar_assinaturas` em [workers/periodic.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/periodic.py) — alertas D-3/D-1/D0 e suspensão automática após `GRACE_DAYS=5` de atraso (`suspensa_motivo='inadimplencia'`); trial vencido suspende (`trial_expirado`).
*   **Aba Assinatura**: [components/v2/AssinaturaView.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/AssinaturaView.tsx) + endpoints `GET/POST /pizzarias/{id}/assinatura` em [routes/pizzarias.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pizzarias.py). Contratação exige e-mail + CPF/CNPJ de cobrança.
*   **Trial + signup público**: plano `trial` (R$0, 20 atendimentos, fora do catálogo de venda) em [services/plans.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/plans.py); `POST /auth/signup` em [routes/auth.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/auth.py) (`TRIAL_DIAS=14`) cria dono+pizzaria e loga; tela de cadastro em App.tsx (`SignupScreen`, link na LoginScreen).
*   **Admin**: `GET /admin/faturas` + card "Faturas da plataforma" no PlatformAdminView.

### 8.3. Economia de LLM
*   **NLU determinística (custo zero)**: `_nlu_deterministica` em [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py) — mensagens PURAS ("sim" na confirmação, "não/quero" no upsell, "oi" na abertura) viram intenção sintética sem chamar LLM (fullmatch sobre os regex do próprio engine). Conteúdo extra ("sim, mas sem cebola") segue pra NLU LLM.
*   **Modelo barato pra NLU**: `nlu_model` na config de IA (card do admin). NLU extrai JSON num flash-lite; voz continua no modelo principal/por plano. Uso registrado separado por camada.
*   **Prompt caching**: `cached_tokens` logado em [agent/providers.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/providers.py) quando o provider reporta (OpenAI/Gemini cacheiam o prefixo estável automaticamente).
*   **Margem por tenant**: `custo_por_atendimento` e `margem` em `GET /admin/assinaturas` + exibição no card de Assinaturas do admin.

### 8.4. Fluidez / humanização
*   **Resgate de carrinho abandonado**: task `pizzabot.resgatar_carrinho` em [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py) (`RESGATE_CARRINHO_SECONDS=25min`), agendada pelo [runner.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/runner.py) após cada resposta com carrinho no meio do funil. Guardas: estado frio (updated_at), 1x por conversa (`resgate_enviado`), humano assumiu não interfere. Template fixo (sem LLM).
*   **"O de sempre" no FSM**: oferta na saudação do [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py) quando `ctx.ultimo_pedido_resumo` existe (flag `ofereceu_de_sempre`); aceite injeta o item em `dados["produtos"]` antes do `_aplicar_nlu` (preço atual via `_calcular_pedido`).
*   **Reação ✅ ao comprovante**: em [routes/webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py), mensagem que parece comprovante + pedido `em_analise` → `evolution.send_reaction` ✅ (best-effort).
*   **Balões múltiplos**: prompt da voz ([fsm/voice.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/voice.py)) incentiva `[QUEBRA]` entre conteúdos diferentes (máx. 2); a infra `split_balloons`/`send_humanized_text` já existia.

### Onde mexer (seção 8)
*   **Jobs periódicos / horários**: [workers/celery_app.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/celery_app.py) (`beat_schedule`) e [workers/periodic.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/periodic.py).
*   **Carência/dunning**: `GRACE_DAYS` em [services/billing_plataforma.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/billing_plataforma.py); duração do trial em [routes/auth.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/auth.py) (`TRIAL_DIAS`); cota do trial em [services/plans.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/plans.py).
*   **Casos da NLU determinística**: `_nlu_deterministica` em [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py).
*   **Janela/template do resgate de carrinho**: [workers/tasks.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/workers/tasks.py) (`RESGATE_CARRINHO_SECONDS`, `_resgatar_carrinho_async`).
*   **Failover/modelos (NLU, fallback, transcrição, por plano)**: card "Configuração de IA" do admin ([PlatformAdminView.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/PlatformAdminView.tsx) `LLMConfigCard`) + [services/app_config.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/app_config.py).

---

## 9. Endereço por Localização + Lapidação da Conversa (sessão atual)

Correções vindas de conversas REAIS de teste em produção (prints do dono). Sem migrations novas. Testes: `test_localizacao.py` (20 casos), casos novos em `test_upsell.py` e `test_nlu_deterministica.py`.

### 9.1. Endereço pela LOCALIZAÇÃO do WhatsApp (clipe 📎 → Localização)
Fluxo completo, determinístico (sem LLM):
1.  **Webhook** ([routes/webhook.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/webhook.py) `_extract_content`): `locationMessage` vira o texto `[localizacao lat=.. lon=..]` (metadata enxuto — sem o thumbnail base64).
2.  **Reverse geocoding** ([services/geocoding.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/geocoding.py) `reverse_geocode`): Nominatim `/reverse` (zoom 18) → rua, número, bairro, cidade.
3.  **Pipeline** ([fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py) `_nlu_localizacao`, roda ANTES da NLU): sintetiza `informar_endereco` com `tipo_entrega=delivery` implícito. Flags `_localizacao_sem_numero` / `_localizacao_sem_rua` quando o GPS não traz esses campos (comum). Geocoding fora do ar → cai na NLU LLM sem travar.
4.  **Engine** ([fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py)): confirma SÓ o que o mapa achou e pergunta o que falta (rua e/ou número) UMA vez (`estado.aguardando_numero`); a resposta ("123", "Número 3, rua 2") é entendida sem LLM (caso 5 da `_nlu_deterministica`) e ANEXADA ao endereço.

### 9.2. Endereço robusto (bugs reais corrigidos)
*   **Bairro preservado**: o bairro confirmado fica em `estado.endereco_bairro`; atualização parcial (cliente manda "rua 2, número 3" depois da localização) NÃO apaga o bairro — `_aplicar_nlu` faz merge (antes o card mostrava só "rua 2, 3").
*   **Resposta só com número ANEXA** (não substitui a rua/bairro inteiros).
*   **Taxa de entrega — prioridade de detecção** ([agent/tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py) `_calcular_pedido`): 1º bairro CADASTRADO na tabela de taxas citado no texto do endereço (match normalizado, offline); **1.5º bairro CONFIRMADO pelo funil** (`bairro_confirmado`, vindo de `estado.endereco_bairro` — o bairro que o reverse geocoding da localização achou); 2º geocoding Nominatim; 3º último trecho do endereço. (Antes "rua 2, 3" geocodificava para um bairro errado de outra cidade.)
*   **Bug real (print do dono): bairro do GPS sumia na taxa.** GPS achou "Santa Bárbara"; o cliente respondeu "Número 3, na rua 2" e o endereço virou `Santa Bárbara, …, nº 3 (na rua 2)`. Como o `_calcular_pedido` não recebia o bairro confirmado, o fallback pegava o ÚLTIMO trecho (`nº 3 (na rua 2)`) e a voz falava *"A taxa pro bairro nº 3 (na rua 2)…"*. Agora o engine passa `bairro_confirmado=estado.endereco_bairro` para `_calcular_pedido`/`preparar_resumo_pedido`/`registrar_pedido`, e o nome exibido na taxa fica "Santa Bárbara". Regressão em `test_localizacao.py` (`TestTaxaUsaBairroConfirmado`).

### 9.3. Lapidação da conversa (motor, não prompt)
*   **Upsell de ITEM ÚNICO**: quando a oferta tem UMA opção no total (ex.: só a Coca Cola 2L), o engine guarda `estado.upsell_item_unico`; o aceite seco ("quero") injeta ESSE item antes do `_aplicar_nlu` (preço real no mesmo turno). Com várias opções, continua listando e perguntando qual.
*   **Aceite da oferta do cardápio**: "quero/sim/pode mandar" após "Gostaria de ver o cardápio?" → envia o cardápio. Determinístico no pipeline (caso 4) + `confirmou_ver_cardapio` ampliado no engine (`_eh_confirmacao` OU `_afirmou_upsell`, bloqueado se a mensagem já traz produtos).
*   **Falas garantidas** (a LLM da voz vinha omitindo instruções):
    - Pergunta de endereço é `mensagem_pronta` (verbatim, 2 balões): pede o endereço E oferece a localização — sempre.
    - Após aceitar o upsell, a voz é obrigada a confirmar o item pelo nome ("Coca anotada!"), não um "Beleza!" seco.
    - Ao informar a taxa, usa EXATAMENTE o `bairro_detectado` (a voz repetia a última mensagem do cliente como nome do lugar).

### Onde mexer (seção 9)
*   **Conversão da localização / flags sem rua-número**: [fsm/pipeline.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/pipeline.py) (`_nlu_localizacao`, `_LOCALIZACAO_RE`).
*   **Reverse geocoding**: [services/geocoding.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/geocoding.py) (`reverse_geocode`).
*   **Merge/anexo do endereço e bairro preservado**: [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py) (`_aplicar_nlu`).
*   **Pergunta pós-localização (rua/número)**: bloco `_localizacao_sem_numero` em [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py).
*   **Prioridade da detecção de bairro na taxa**: [agent/tools.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/tools.py) (`_calcular_pedido`, seção 2).
*   **Upsell item único**: [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py) (`upsell_item_unico` — oferta no bloco 0b, aceite antes do `_aplicar_nlu`).
*   **Texto verbatim da pergunta de endereço**: funil etapa 2 em [fsm/engine.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/agent/fsm/engine.py).
