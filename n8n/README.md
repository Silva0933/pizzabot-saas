# Workflows n8n do PizzaBot

## 1. Secretaria

Importe `1. Secretaria.json` no n8n e configure o webhook da Evolution API para enviar as mensagens recebidas para:

```text
POST /webhook/pizzabot-secretaria
```

Variaveis de ambiente exigidas no n8n:

```text
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
EVOLUTION_API_URL=http://seu-servidor-evolution:8080
EVOLUTION_API_KEY=sua-chave-evolution
GEMINI_API_KEY=sua-chave-gemini
GEMINI_MODEL=gemini-1.5-flash
```

`GEMINI_MODEL` e opcional. O workflow usa `gemini-1.5-flash` quando essa variavel nao existir.

O workflow espera que o banco tenha as tabelas e constraints do schema atual da aplicacao, especialmente:

- `pizzarias.instancia`
- `clientes` com upsert por `(pizzaria_id, telefone)`
- `conversas` com upsert por `(pizzaria_id, cliente_telefone)`
- `produtos.disponivel`
- `pedidos`

Para bancos ja criados antes desta versao, aplique `supabase/upgrade_v1_1.sql`.

Fluxo principal:

1. Recebe a mensagem da Evolution API.
2. Identifica a pizzaria pela instancia.
3. Cria ou atualiza o cliente no Supabase.
4. Busca conversa anterior e cardapio disponivel.
5. Envia contexto para o Gemini.
6. Registra pedido confirmado.
7. Salva historico da conversa e memoria do cliente.
8. Responde o cliente pelo WhatsApp.
