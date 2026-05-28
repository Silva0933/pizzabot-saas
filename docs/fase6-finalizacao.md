# Fase 6 — Pagamentos, métricas e fim do n8n

## O que entrou

### Backend
| Arquivo | Função |
|---|---|
| `app/services/pagamentos.py` | Clientes MercadoPago + Asaas (criar cobrança, validar webhook) |
| `app/services/status_messages.py` | Envia template WhatsApp quando status do pedido muda |
| `app/routes/pedidos.py` | CRUD + `PATCH /status` com efeito colateral de mensagem |
| `app/routes/webhook_pagamento.py` | `POST /webhook/mercadopago` + `POST /webhook/asaas` |
| `app/routes/metricas.py` | `GET /pizzarias/{id}/metricas?days=30` — agregações p/ dashboard |

### Frontend
| Arquivo | Função |
|---|---|
| `src/components/v2/MetricasView.tsx` | KPIs + gráfico de linhas (vendas/dia) + bar (horários) + top produtos |
| `src/lib/api.ts` (update) | `metricasApi.get(pizzariaId, days)` |
| `src/components/v2/MeuNegocioView.tsx` (update) | Nova tab "Análise" |

---

## O que ele faz

### 1. Pagamentos (MP + Asaas)

```
Cliente confirma pedido no WhatsApp
   ↓
Agente chama registrar_pedido (tool da Fase 3)
   ↓
Backend cria pedido + cobrança no gateway (MP ou Asaas)
   ↓
Cliente paga
   ↓
Gateway → POST /webhook/mercadopago (ou /asaas)
   ↓
Backend valida assinatura → atualiza pedido → status='confirmado'
   ↓
status_messages dispara: "Pagamento aprovado! Seu pedido entrou na fila."
   ↓
Broadcaster avisa o painel via WebSocket
```

Validação MP: HMAC SHA256 com `MP_WEBHOOK_SECRET` no .env.
Validação Asaas: external_reference = pedido_id (UUID).

### 2. Mensagens automáticas de status

Quando o operador arrasta o pedido no Kanban de "Confirmado" → "No forno":

```
PATCH /pizzarias/{id}/pedidos/{pid}/status { status: "no_forno" }
   ↓
status muda no DB
   ↓
status_messages.enviar_mensagem_status() é chamada
   ↓
Lê pizzaria.mensagens_status['no_forno'] (template configurável)
   ↓
Substitui {numero_pedido}, {nome_cliente}, {valor_total}, {tempo_entrega}
   ↓
Envia via Evolution + salva como mensagem 'sistema' na conversa
   ↓
Broadcast WS → painel mostra a msg na conversa
```

Placeholders suportados: `{numero_pedido}`, `{nome_cliente}`, `{valor_total}`, `{tempo_entrega}`.

### 3. Métricas históricas

`GET /pizzarias/{id}/metricas?days=30` retorna:

```json
{
  "periodo_dias": 30,
  "resumo": {
    "pedidos": 142,
    "vendido": 7842.50,
    "ticket_medio": 55.23,
    "cancelados": 8,
    "taxa_cancelamento": 5.6
  },
  "comparativo": {
    "pct_pedidos": 12.3,
    "pct_vendido": 18.7
  },
  "serie_diaria": [{ "dia": "2026-04-15", "pedidos": 6, "vendido": 312.50 }, ...],
  "top_produtos": [{ "nome": "Calabresa G", "qtd_vendida": 42 }, ...],
  "horarios_pico": [{ "hora": 20, "pedidos": 38 }, ...]
}
```

Tudo agregado em SQL puro (sem N+1, sem ORM no loop).

---

## Como o painel mostra (tab Análise)

```
┌─ Meu Negócio ───────────────────────────────────────────────┐
│  [Atendente]  [Análise ✓]  [Geral]                          │
├─────────────────────────────────────────────────────────────┤
│  Análise do seu negócio                  [7 dias][30✓][90]  │
│  Como você está indo nos últimos 30 dias.                   │
│                                                             │
│  [📦 Pedidos: 142 +12%]  [💰 R$ 7.842 +19%]                 │
│  [📈 Ticket: R$ 55,23]  [❌ Cancel: 5,6%]                   │
│                                                             │
│  ┌─ Vendas por dia ─────────────────────────────────────┐   │
│  │     ╭╮      ╭───╮                                    │   │
│  │  ╭──╯╰╮  ╭──╯   ╰─╮  ╭─╮                             │   │
│  │ ─╯    ╰──╯        ╰──╯ ╰─                            │   │
│  │ 15/04  20/04  25/04  30/04  05/05                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Horários de pico ──┐  ┌─ Top 5 produtos ────────────┐   │
│  │   ▓▓                │  │ 🥇 Calabresa G       42x    │   │
│  │  ▓▓▓                │  │ 🥈 Margherita M      38x    │   │
│  │ ▓▓▓▓▓               │  │ 🥉 Coca-Cola 2L      36x    │   │
│  │ 18h 20h 22h         │  │ 4. Portuguesa G      28x    │   │
│  └─────────────────────┘  │ 5. Borda Catupiry    24x    │   │
│                           └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Endpoints novos da Fase 6

```
# Pagamentos (webhooks recebem do gateway)
POST /webhook/mercadopago        Evento MP de pagamento
POST /webhook/asaas              Evento Asaas

# Pedidos (painel usa)
GET    /pizzarias/{id}/pedidos                lista
GET    /pizzarias/{id}/pedidos/{pid}          detalhe
PATCH  /pizzarias/{id}/pedidos/{pid}/status   muda status (+ mensagem auto)

# Métricas
GET    /pizzarias/{id}/metricas?days=30       agregações p/ dashboard
```

---

## Checklist de migração para fora do n8n

Quando você quiser desligar o n8n de vez:

### 1. Configurar webhooks no Evolution API

Para cada pizzaria, troque a URL do webhook no Evolution:
```
ANTES:  https://n8nai.secretariaai.eu.cc/webhook/evolution
DEPOIS: https://api.seu-dominio.com/webhook/evolution
```

### 2. Configurar webhooks no Mercado Pago

Painel do MP → suas integrações → notificações:
```
URL: https://api.seu-dominio.com/webhook/mercadopago
Eventos: payment.updated, payment.created
```

### 3. Configurar webhooks no Asaas

Asaas → Integrações → Webhooks:
```
URL: https://api.seu-dominio.com/webhook/asaas
Eventos: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_DELETED
```

### 4. Validar comportamento por 1 semana

Roda os DOIS sistemas em paralelo (n8n + backend novo) numa pizzaria de teste.
Compare:
- [ ] Mensagens chegando no painel
- [ ] Bot respondendo coerente
- [ ] Pedidos criados certo
- [ ] Pagamento aprovando e disparando mensagem
- [ ] Status do pedido fluindo no kanban
- [ ] Métricas batendo com a realidade

### 5. Desligar o n8n

Quando confiar:
```bash
# No servidor n8n
docker stop n8n
# Não delete ainda — só desligue. Caso precise voltar, é instantâneo.
```

Aguarde 1 mês com o n8n desligado. Se ninguém precisou voltar, pode apagar o container e o backup.

### 6. Limpeza no repo

```bash
# Move pasta n8n pra arquivo (não apaga, só arquiva)
git mv n8n n8n.legacy
git commit -m "n8n aposentado, mantido como referência histórica"
```

Os scripts em `n8n/fix_*.py` ficam como documentação de pegadinhas que resolvemos no caminho. Útil pra debug futuro.

---

## Onde o agente cria a cobrança

A tool `registrar_pedido` (Fase 3) atualmente só cria o pedido no DB.
Para gerar cobrança automaticamente, edite `app/agent/tools.py:registrar_pedido`:

```python
# Depois de db.add(ped) e db.flush():
if pizz.gateway_pagamento != "manual":
    from app.services.pagamentos import gateway_for
    gw = gateway_for(pizz)
    if gw:
        try:
            cobranca = await gw.criar_cobranca(
                valor=ped.valor_total,
                descricao=f"Pedido #{ped.numero_pedido} - {pizz.nome}",
                nome_cliente=cli.nome or "Cliente",
                telefone=ctx.telefone,
                external_reference=str(ped.id),
                notification_url=f"https://api.seu-dominio.com/webhook/mercadopago",
            )
            ped.payment_id = cobranca.payment_id
            ped.link_pagamento = cobranca.link_pagamento
        except Exception as e:
            log.warning("Cobrança falhou (segue sem): %s", e)
```

Vou deixar como toggle opcional — algumas pizzarias preferem pagamento manual (combinado no Whatsapp e validado pelo operador).

---

## Resumo dos arquivos das 6 fases

```
backend/                                  Backend Python (FastAPI)
├── app/
│   ├── main.py                           Entry FastAPI
│   ├── config.py / db.py / auth.py       Setup base
│   ├── models.py / schemas.py            Persistência
│   ├── deps.py                           Auth dependencies
│   ├── redis_client.py
│   ├── agent/                            ⭐ Fase 3 — IA
│   │   ├── llm.py / prompt.py / memory.py
│   │   ├── context.py / runner.py / tools.py
│   ├── services/
│   │   ├── evolution.py                  WhatsApp client
│   │   ├── queue.py                      Debounce Redis
│   │   ├── broadcaster.py                WS pub/sub
│   │   ├── embeddings.py                 Gemini embeddings
│   │   ├── pagamentos.py                 ⭐ Fase 6 — MP + Asaas
│   │   └── status_messages.py            ⭐ Fase 6
│   ├── routes/
│   │   ├── health.py / auth.py
│   │   ├── pizzarias.py
│   │   ├── conversas.py
│   │   ├── cardapio.py
│   │   ├── agente.py
│   │   ├── pedidos.py                    ⭐ Fase 6
│   │   ├── metricas.py                   ⭐ Fase 6
│   │   ├── webhook.py                    Evolution
│   │   ├── webhook_pagamento.py          ⭐ Fase 6 — MP + Asaas
│   │   └── ws.py                         WebSocket
│   └── workers/
│       ├── celery_app.py / tasks.py      Worker debounce + agente
├── migrations/                           Schema versionado
└── ...

src/                                      Frontend React
├── lib/
│   ├── api.ts                            Cliente do novo backend
│   ├── supabase.ts                       (legacy, sai junto com migração)
│   └── ...
├── components/
│   ├── PersonalityBuilder.tsx            Fase 4
│   ├── AgentTestPanel.tsx                Fase 4
│   ├── AttendantPage.tsx                 Fase 4
│   ├── v2/                               Fase 5 + 6
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx / Topbar.tsx
│   │   ├── Tooltip.tsx
│   │   ├── InicioDashboard.tsx
│   │   ├── OnboardingChecklist.tsx
│   │   ├── MeuNegocioView.tsx
│   │   └── MetricasView.tsx              ⭐ Fase 6
│   └── (existentes mantidos: Kanban, Conversations, Menu, Settings, etc)
└── ...

n8n/                                      🪦 Aposentar após validação
docs/                                     Documentação das fases
```

## Status final

- ✅ Fase 1 — Fundação Python + Postgres + Coolify
- ✅ Fase 2 — Webhook Evolution + Fila Redis + WebSocket
- ✅ Fase 3 — Agente IA Gemini com 6 tools
- ✅ Fase 4 — Builder visual de personalidade
- ✅ Fase 5 — Painel reorganizado (5 itens + Meu Negócio)
- ✅ Fase 6 — Pagamentos + métricas + roteiro de desligamento do n8n

**Migração completa do n8n para Python.**
