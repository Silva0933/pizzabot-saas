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
Telas atuais em src/components/v2/: Início, Conversas, Pedidos, Cardápio, Meu Negócio, PlatformAdminView
Componentes do agente IA (backend/app/agent/)
runner, llm, providers, tools, prompt, memory, context. O agente é orientado por uma FSM (máquina de estados) — foco recente do desenvolvimento (ver commits). Tools: buscar_cardapio, registrar_pedido, gerar_pagamento, etc. A busca do cardápio usa SQL (não depende de embeddings); reindex semântico é opcional via Gemini.

Serviços principais (backend/app/services/)
evolution, pagamentos, status_messages, business_hours, transcricao, app_config, broadcaster, plans, price_check, response_guard, customer_memory, geocoding, humanized_delivery, embeddings, import_cardapio, alertas.

Estado atual (foco recente)
Os últimos commits giram em torno de blindagem anti-falha da FSM (6 pilares), correções de timeout, JSON mode fallback, validação de preço, extração de entrega, suporte nativo ao Gemini, e reestruturação relacional do cardápio (tamanhos múltiplos + complementos por produto). Migrations já vão até 010_cardapio_relacional.sql.

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
Chaves de pagamento (Mercado Pago/Asaas): por pizzaria, em Meu Negócio. Cobrança só é gerada quando o cliente escolhe "pagar agora"; confirmação chega via webhook.
Deploy
Via Coolify a partir do repositório: backend e worker pelo backend/Dockerfile (worker com APP_ROLE=worker), painel via build Vite + Nginx, mais Postgres (pgvector) e Redis. Docs das fases em docs/.

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
*   [pagamentos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/pagamentos.py): Cliente de integração com gateways Mercado Pago e Asaas (geração de Pix QR Code, cópia e cola, e checkout de cartão).
*   [status_messages.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/services/status_messages.py): Dispara mensagens automáticas no WhatsApp do cliente quando o status do pedido muda no painel (ex: "Saiu para entrega", "Confirmado").
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
*   [ws.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/ws.py): Gerenciador de WebSockets (envia notificações de novas mensagens e novos pedidos para o painel em tempo real).
*   [pedidos.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pedidos.py) / [conversas.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/conversas.py) / [cardapio.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/cardapio.py) / [pizzarias.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/pizzarias.py): APIs rest que alimentam o painel administrativo da pizzaria.
*   [admin.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/routes/admin.py): Rotas para a administração global da plataforma SaaS (SuperAdmin).

### 3.4. Modelos e Banco de Dados
*   [models.py](file:///e:/Tops%20Ferramentas/PizzaBot/backend/app/models.py): Modelos SQLAlchemy contendo o esquema relacional:
    - `Pizzaria`: Configurações de IA, horário, taxas de entrega e tokens de gateways.
    - `Cliente`: Registro de clientes, histórico de gastos e preferências.
    - `Pedido`: Itens, status (`novo`, `confirmado`, `no_forno`, `a_caminho`, `entregue`, `cancelado`), forma de pagamento e status da transação.
    - `Mensagem`: Histórico de mensagens trafegadas (cliente, bot ou sistema).
    - `Conversa`: Estado de controle do chat no painel (bot ativo/inativo, status de atendimento).

---

## 4. Mapeamento de Arquivos do Frontend (`src/components/v2/`)

Os componentes e telas do painel React (PWA) estão concentrados em `src/components/v2/`:
*   [InicioDashboard.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/InicioDashboard.tsx): Tela inicial (métricas rápidas do dia: faturamento, pedidos ativos, ticket médio, gráficos de vendas).
*   [PedidosViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/PedidosViewV2.tsx): Kanban de pedidos em tempo real. Permite mudar o status arrastando os cards (dispara avisos no WhatsApp) e visualizar os detalhes dos pedidos.
*   [ConversasViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/ConversasViewV2.tsx): Central de atendimento (chat multicanal). Permite ao operador assumir conversas pausando o bot (`bot_ativo = False`), ler o histórico e enviar mensagens manuais.
*   [CardapioViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/CardapioViewV2.tsx): Gerenciador do cardápio relacional (categorias, produtos, múltiplos tamanhos, complementos, e upload de PDF/imagem).
*   [MeuNegocioViewV2.tsx](file:///e:/Tops%20Ferramentas/PizzaBot/src/components/v2/MeuNegocioViewV2.tsx): Tela de configurações da pizzaria (dados básicos, horários de funcionamento, regras de taxas de entrega por bairro ou fixa, e chaves de pagamento).
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
*   **Resolver bugs ao enviar mensagens ou áudios**: Verifique `services/evolution.py` ou `routes/webhook.py`.
*   **Ajustar taxas de entrega por bairro ou geolocalização**: Procure em `agent/tools.py` (`_taxa_para_bairro`) ou `services/geocoding.py`.
*   **Modificar o cálculo de preços (meia-meia, adicionais, etc.)**: Ajuste a lógica de cálculo na função `_calcular_pedido` em `agent/tools.py`.
*   **Corrigir problemas no painel Kanban do frontend**: Modifique `components/v2/PedidosViewV2.tsx`.
*   **Ajustar chat no frontend**: Modifique `components/v2/ConversasViewV2.tsx`.
