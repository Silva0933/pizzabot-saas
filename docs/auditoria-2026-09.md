# Auditoria de 2026-09: falhas, erros e melhorias

Varredura do repositório inteiro. O foco foi o que as auditorias anteriores
(`auditoria-pre-lancamento.md`, `auditoria-producao.md`) não cobriram: webhooks,
fila, deploy e qualidade do código. O agente (FSM) já tem bateria própria e
ficou fora desta rodada.

Linha de base: **514 testes passando**, `tsc` limpo, ruff com 176 alertas
(166 deles falsos, de B008/E402).

---

## Corrigido nesta rodada

| # | Severidade | Falha | Commit |
|---|---|---|---|
| 1 | 🔴 Alta | **Fraude no webhook do Asaas (pedidos):** o pagamento era reconsultado, mas sem conferir se era do pedido do `externalReference`. Quem pagasse um pedido barato podia forjar o webhook com o `payment_id` dele apontando para outro pedido (caro), e o caro virava pago. | `fix(pagamentos)` |
| 2 | 🟠 Média | **Pagamento aprovado em pedido cancelado:** o cliente recebia "enviado pro preparo" de um pedido que ninguém ia preparar. Agora não avisa e gera o alerta `pagamento_pedido_cancelado` para a loja estornar. | `fix(pagamentos)` |
| 3 | 🟠 Média | **Mensagem do WhatsApp perdida:** a marca de dedup (`wh:seen`) era gravada antes de salvar a mensagem. Se o commit falhasse (ex.: as duas primeiras mensagens de um contato novo batendo no UNIQUE de `conversas`/`clientes`), a reentrega da Evolution era descartada como duplicada. | `fix(webhook)` |
| 4 | 🟠 Média | **Chave da Evolution no bundle público:** o `Dockerfile` do painel repassava `VITE_EVOLUTION_API_KEY` (e Supabase/n8n). Toda `VITE_*` vai em texto claro no JS. Os args legados e o código morto que os lia (`SettingsView`, `WhatsAppPanel`) foram removidos. **Recomendado:** apagar essas variáveis do Coolify e, se a chave já esteve setada lá, rotacioná-la. | `fix(painel)` |
| 5 | 🟢 Baixa | O ruff tinha 176 alertas, 166 deles falsos. Agora passa zerado e roda no CI. | `chore(lint)` |

Cada correção de bug veio com um teste que falha no código antigo.

---

## Em aberto (não mexi sozinho)

### Robustez e dados

- **`pedido.novo` é transmitido antes do commit** (`routes/webhook.py`, rascunho
  de pedido). Se o commit falhar, o painel recebe um pedido que não existe. E
  mesmo quando dá certo, o painel pode buscar o pedido antes de ele estar
  visível. O broadcast deveria ir para depois do `db.commit()`.
- **Busca por telefone exato fora do `telefones_equivalentes`.** Isso contraria a
  regra do CLAUDE.md. Aparece em: `status_messages.enviar_mensagem_status` e
  `enviar_pesquisa_nps` (a mensagem é enviada, mas não é gravada na conversa
  quando o número difere no 9º dígito), `workers/tasks.py` (resgate de carrinho,
  lembrete) e `cardapio_publico.acompanhar_pedido` (o cliente recebe 404 ao
  acompanhar com o número na outra forma).
- **`_aplicar_pagamento` roda sem trava de linha.** Duas notificações
  simultâneas do mesmo pagamento (o MP manda várias) passam as duas pela checagem
  de idempotência de `enviar_mensagem_status` antes de uma delas gravar. Resultado:
  "Pagamento confirmado" em dobro. Resolve com `SELECT ... FOR UPDATE` no pedido.
- **A transcrição de áudio roda dentro do webhook**, antes do 200. Um áudio longo
  faz a Evolution estourar o timeout e reentregar o evento. A transcrição poderia
  ir para o worker, junto com o flush.
- **`drain_pending` usa duas pipelines separadas** (`services/queue.py`). Se o
  processo cair entre elas, as pendentes já saíram de `pending` e ainda não
  entraram em `inflight`. A janela é pequena, e um script Lua ou `LMOVE`
  fecharia o buraco.
- **Card vazio em "Novos" para qualquer mensagem sem pedido ativo**: um
  "obrigado" depois da entrega também gera card. Isso polui o Kanban e as
  métricas de conversão. É uma decisão de produto.

### Segurança (baixa)

- **Os tokens de webhook são comparados com `!=` / `not in`** (Evolution e
  Asaas plataforma). O certo é `hmac.compare_digest`.
- **O refresh token dura 30 dias e não tem revogação nem rotação.** Trocar a
  senha ou remover o usuário da equipe não derruba sessões, e o `/auth/refresh`
  não tem rate limit.
- **O WebSocket recebe o JWT na query string** (vai parar em logs de proxy).
  Além disso, a conexão não é reavaliada: usuário removido ou pizzaria suspensa
  continuam recebendo eventos até reconectar.
- **`_liberada_com_suspensao` compara por substring** (`"/uso" in caminho`).
  Hoje nenhuma rota casa por acidente, mas uma rota futura como `/usos-...`
  passaria pelo bloqueio de suspensão. Comparar pelo último segmento seria o
  seguro.

### Frontend e performance

- **Bundle único de 1,39 MB** (382 kB gzip), sem `React.lazy`. O cardápio
  público, aberto pelo cliente final no celular, baixa o painel inteiro.
  Separar `CardapioPublico`, `PlatformAdminView` e as telas do painel em chunks
  é o maior ganho barato de tempo de carregamento.
- **Ainda há componentes legados fora de `v2/`** (`AttendantPage`,
  `PersonalityBuilder`, `AgentTestPanel`, usados por `MeuNegocioViewV2`).
  Convém migrá-los ou mover para `v2/`, para a regra "fora do v2 é legado"
  continuar verdadeira.

### Testes e ferramentas

- Os testes geram `RuntimeWarning: coroutine ... never awaited`
  (`runner.py:530/752`): o mock de `db.add` é `AsyncMock`, mas `add` é síncrono.
- `pytest-asyncio` avisa que `asyncio_default_fixture_loop_scope` não está
  definido; basta um `[tool.pytest.ini_options]` no `pyproject.toml`.
- Não há teste de concorrência real (Postgres) para os casos de UNIQUE no
  webhook. O CI já sobe Redis e poderia subir Postgres também.
