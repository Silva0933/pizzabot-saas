# Auditoria dos workflows n8n - PizzaBot

Data da auditoria: 2026-05-22

## Resultado

Os workflows ativos do PizzaBot foram verificados via API do n8n. Depois da correcao aplicada no workflow de status, os workflows ativos ficaram sem problemas estruturais detectados.

## Workflows ativos

| Workflow | Status | Webhook | Resultado |
| --- | --- | --- | --- |
| PizzaBot - Secretaria IA v3 (Fila + audio + TTS) | Ativo | `POST /webhook/pizzabot-secretaria` | OK |
| PizzaBot - Pagamentos (Gerar + Webhook) | Ativo | `POST /webhook/pizzabot-pagamento` e `POST /webhook/pizzabot-pagamento-confirmacao` | OK |
| PizzaBot - Notificar Status Pedido | Ativo | `POST /webhook/pizzabot-status` | OK apos correcao |
| PizzaBot - RAG Clientes (Atualizacao Historico) | Ativo | `POST /webhook/pizzabot-rag-finalizar` | OK |
| PizzaBot - Mensagem de Agradecimento (status=entregue) | Ativo | `POST /webhook/pizzabot-agradecimento` | OK |
| PizzaBot - Util Atualizar Presence (digitando/gravando) | Ativo | `POST /webhook/e56e25c6-d00e-40aa-83b6-4985aea910f1` | OK |
| PizzaBot - Util Baixar e Enviar Arquivo Drive | Ativo | Sem webhook direto | OK |

## Correcao aplicada

O workflow `PizzaBot - Notificar Status Pedido` usava expressoes com `$env.EVOLUTION_API_URL` e `$env.EVOLUTION_API_KEY` no node `Enviar WhatsApp`.

Como o servidor n8n ja apresentou bloqueio de acesso a variaveis de ambiente em nodes, essa configuracao poderia falhar em producao.

Foi alterado via API:

- URL do node `Enviar WhatsApp` passou a usar o endpoint da Evolution diretamente.
- Header `apikey` passou a usar valor estatico dentro do workflow.
- Workflow permaneceu ativo.
- Nova verificacao confirmou `envExpressionsRemaining: false`.

## Historico recente

Observacoes da API:

- `Secretaria IA`: ultimas execucoes recentes em sucesso.
- `Pagamentos`: historico antigo contem erros durante ajustes, mas as execucoes mais recentes verificadas estavam em sucesso.
- `Status Pedido`: ultima execucao registrada estava em sucesso e o risco de `$env` foi removido.
- `Presence`: ultimas execucoes em sucesso.
- `RAG` e `Agradecimento`: ultimas execucoes registradas em sucesso.

## Workflows inativos

Existem dois workflows inativos com nome `PizzaBot - Agente Principal`.

Eles parecem ser versoes antigas/legadas. Como estao inativos, nao afetam o fluxo atual. A auditoria detectou neles node Postgres sem query no node `Enfileirar mensagem.`, mas isso nao impacta o MVP enquanto continuarem inativos.

## Limites da auditoria

Esta checagem valida estrutura e configuracao via API do n8n:

- workflow ativo/inativo;
- nodes sem credenciais;
- conexoes quebradas;
- webhooks;
- uso de `$env` bloqueavel;
- historico recente de execucoes.

Ela nao substitui o teste operacional real com WhatsApp e pagamento, porque disparar webhooks de producao pode enviar mensagens, criar pedidos ou gerar cobrancas.

## Teste final recomendado

Antes de cadastrar o primeiro cliente pago:

1. Criar uma pizzaria nova.
2. Conectar WhatsApp.
3. Cadastrar produtos reais.
4. Configurar Mercado Pago ou Asaas.
5. Fazer pedido teste pequeno.
6. Confirmar que o link chega no WhatsApp.
7. Confirmar que o pedido aparece no Kanban.
8. Confirmar que a Central Chat atualiza.
