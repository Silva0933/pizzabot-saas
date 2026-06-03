# Smoke-test — Blindagem do Agente IA (commit 3f39629)

Checklist de validação **em produção** das correções de prova-de-falhas (críticos,
médios e menores). Feito para rodar via WhatsApp de uma pizzaria de teste + painel +
logs do Coolify, sem precisar de acesso ao banco (mas indico onde olhar se tiver).

> Marque cada item. Tempo estimado: ~20–30 min.

---

## 0. Pré-requisitos

- [ ] Uma **pizzaria de teste** com instância Evolation conectada e cardápio com ao
      menos 1 produto disponível.
- [ ] Acesso ao **painel** (Conversas + Pedidos/Kanban) dessa pizzaria.
- [ ] Acesso aos **logs do Coolify**: `pizzabot-worker` (agente/fila) e
      `pizzabot-backend` (webhook). Coolify → app → aba **Logs**.
- [ ] Um número de WhatsApp "cliente" para conversar com o bot.
- [ ] (Opcional) Acesso ao banco para conferir a tabela `alertas` e `conversas`.

### Mapa de observabilidade
| Onde | O que ver |
|---|---|
| WhatsApp (cliente) | Mensagens que o bot envia |
| Painel → Conversas | `bot_ativo` (ligado/pausado), status `humano_necessario`, mensagens com origem **sistema** |
| Painel → Pedidos (Kanban) | Status do pedido em tempo real |
| Logs `pizzabot-worker` | Fluxo do agente, escalonamentos, timeouts, fila |
| Logs `pizzabot-backend` | Webhook, dedup |
| Painel Admin / tabela `alertas` | `falha_ia`, `preco_suspeito`, `falha_pagamento` |

---

## 1. 🟢 Caminho feliz (sanity) — fazer primeiro

Garante que a base continua funcionando após o deploy.

- [ ] Cliente manda "oi" → bot se apresenta **uma vez** (nome + pizzaria).
- [ ] Pede uma pizza → bot coleta sabor/tamanho, faz upsell **uma vez**.
- [ ] Informa entrega + endereço + pagamento → bot mostra **resumo com total** e
      pergunta "Posso fechar o pedido?".
- [ ] Cliente confirma ("pode") → pedido aparece no **Kanban** e bot dá número + tempo.
- [ ] **Sem respostas duplicadas** em nenhuma etapa.
- [ ] Nos logs do worker: **NÃO** aparece mais a linha `DIAGNOSTIC: produtos
      disponiveis` (menor #1 — removido).

---

## 2. 🔴 #1 — Race `bot_ativo` (humano assume durante o debounce)

**O mais importante:** o bot não pode responder por cima do atendente.

- [ ] Cliente manda uma mensagem (ex.: "quero uma calabresa").
- [ ] **Imediatamente** (dentro de ~5s, durante o debounce), no painel → Conversas,
      clique em **assumir / pausar o bot** dessa conversa (`bot_ativo = false`).
- [ ] **Esperado:** o bot **NÃO** envia resposta automática. A conversa fica com o
      operador.
- [ ] Log do worker deve conter:
      `Conversa assumida por humano durante o debounce (... ) — bot não responde`
- [ ] Variante (opcional): desligar o **bot global** da pizzaria e mandar msg →
      log `Bot global desligado no flush ... — não respondendo`.

---

## 3. 🔴 #6 — Falha de cancelamento não confirma "feito" falso

Gatilho determinístico: pedido que **não pode** ser cancelado.

- [ ] Crie/leve um pedido do cliente até o Kanban e mova o card para **"A caminho"**.
- [ ] No WhatsApp, o cliente pede para **cancelar** ("quero cancelar o pedido").
- [ ] **Esperado:** o bot **NÃO** diz que cancelou. Ele responde algo como
      _"estou verificando o cancelamento com a equipe, já te retorno"_ e a conversa
      vai para atendimento humano.
- [ ] Painel → Conversas: status vira **`humano_necessario`**, `bot_ativo = false`,
      e há uma mensagem **sistema**: `Atendimento transferido para humano. Motivo:
      FSM: falha ao cancelar pedido — pedido #N já está 'a_caminho'...`.
- [ ] O pedido **continua** "A caminho" no Kanban (não foi cancelado de mentira).
- [ ] (Regressão) Repita com um pedido em **"Novo/Confirmado"** → aí o cancelamento
      **funciona** normalmente e o bot confirma.

> Mesmo padrão vale para **alterar pedido** (endereço/pagamento) que falhe: escala e
> não afirma que alterou.

---

## 4. 🔴 #2 — Agente sem texto não deixa o cliente no vácuo

Difícil de forçar de propósito (depende do modelo gastar as iterações sem responder).
Validar por **observação** ao longo dos testes:

- [ ] Se em algum momento o agente não gerar texto, o cliente recebe:
      _"Vou chamar um de nossos atendentes para finalizar o seu pedido. Só um
      instantinho que já vão te responder! 😊"_ e a conversa é escalada.
- [ ] Log do worker: `Agente terminou SEM texto (...) — escalando p/ humano`.
- [ ] Mensagem **sistema** na conversa: `⚠️ A IA terminou o processamento sem gerar
      resposta.` + alerta `falha_ia` na tabela de alertas.

---

## 5. 🔴 #3 — Timeouts e ausência de resposta duplicada sob carga

- [ ] Mande **várias mensagens rápidas** seguidas (ex.: 4–5 em poucos segundos) →
      o bot deve **agrupar** (debounce) e responder **uma vez só**, sem duplicar.
- [ ] Se a LLM estiver lenta e o FSM estourar 15s, o log mostra:
      `Pipeline FSM estourou o timeout de 15s, caindo p/ agente legado...` e o cliente
      ainda recebe resposta (ou escalonamento), nunca silêncio.
- [ ] **Sem respostas duplicadas** mesmo com latência alta (lock de flush = 90s cobre
      o pior caso de processamento).

---

## 6. 🟡 #4 — Dedup de webhook (reentrega)

A Evolution só reenvia quando não recebe o 200 a tempo — difícil de reproduzir à mão.
Validar por observação:

- [ ] Durante todos os testes acima, **nenhuma** mensagem do cliente apareceu
      **duplicada** na conversa do painel.
- [ ] Se houver reentrega, o log do **backend** mostra:
      `Webhook duplicado ignorado (evolution_id=...)` e a mensagem entra só uma vez.

---

## 7. 🟡 #5 — Inflight (mensagem sobrevive a crash do worker)

Teste opcional/avançado (requer reiniciar o worker no meio do processamento):

- [ ] Mande uma mensagem e, durante o processamento, **reinicie** o serviço
      `pizzabot-worker` no Coolify.
- [ ] **Esperado:** ao voltar, o lote é **recuperado** (reprocessado) e o cliente
      recebe resposta — a mensagem **não se perde**.
- [ ] (Aceitável) Em janela mínima de crash logo após o envio, pode haver uma
      resposta repetida — mas **nunca** silêncio. Pedido não é duplicado (reaproveita
      o pedido ativo).

---

## 8. 🟢 #3-menor — NLU não repete teste de JSON Mode

- [ ] Se o modelo configurado **não** suporta JSON Mode, o log do worker mostra
      `NLU: modelo <x> não suporta JSON Mode; desativando p/ próximas chamadas`
      **no máximo uma vez** — as mensagens seguintes não devem repetir esse log nem
      a chamada dupla.
- [ ] Se o modelo **suporta** JSON Mode, esse log **não** aparece.

---

## Resumo de aprovação

| # | Cenário | OK? |
|---|---|---|
| 1 | Caminho feliz + sem DIAGNOSTIC | ☐ |
| 2 | Race `bot_ativo` (não atropela humano) | ☐ |
| 3 | Cancelamento impossível → escala, não confirma | ☐ |
| 4 | Sem texto → fallback + escala | ☐ |
| 5 | Sem resposta duplicada sob carga | ☐ |
| 6 | Sem mensagem duplicada (dedup) | ☐ |
| 7 | Inflight recupera após crash | ☐ |
| 8 | NLU JSON Mode logado 1× | ☐ |

---

## Rollback (se algo crítico falhar)

O deploy não inclui migrations nem novas variáveis, então reverter é seguro:

```bash
git revert 3f39629      # cria commit revertendo a blindagem
git push origin main    # auto-deploy do Coolify aplica
```

Ou, no painel do Coolify, faça **Redeploy** do commit anterior (`1462ab8`) em
`pizzabot-backend` e `pizzabot-worker`.
