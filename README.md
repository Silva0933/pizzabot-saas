# PizzaBot

Painel SaaS para atendimento automatizado de pizzarias via WhatsApp, com cardapio, pedidos, Central Chat, Kanban operacional e pagamentos por Asaas ou Mercado Pago.

## Status do MVP

O MVP esta preparado para operar os primeiros clientes em ambiente controlado. Antes de entregar uma pizzaria nova, rode a checagem local e faca um pedido de ponta a ponta.

```bash
npm install
npm run mvp:check
npm run lint
npm run build
npm run dev
```

## Fluxo para cadastrar o primeiro cliente

1. Entrar como administrador da plataforma.
2. Criar a pizzaria em "Nova pizzaria".
3. Informar o email do dono da pizzaria.
4. O dono acessa o painel e abre "Configuracao Rapida".
5. Conectar WhatsApp pelo QR Code.
6. Cadastrar produtos reais do cardapio.
7. Configurar Asaas ou Mercado Pago com a chave da propria pizzaria.
8. Salvar o prompt de atendimento.
9. Enviar uma mensagem teste pelo WhatsApp.
10. Fechar um pedido pequeno e confirmar que:
    - conversa aparece na Central Chat;
    - pedido aparece no Kanban;
    - link de pagamento chega no WhatsApp;
    - pagamento atualiza o pedido;
    - atendente consegue responder manualmente.

## Variaveis de ambiente

Use `.env.example` como base. As variaveis principais sao:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_N8N_SECRETARIA_WEBHOOK_URL`
- `VITE_N8N_STATUS_WEBHOOK_URL`
- `VITE_N8N_PAYMENT_WEBHOOK_URL`
- `VITE_N8N_RAG_WEBHOOK_URL`
- `VITE_N8N_THANKS_WEBHOOK_URL`
- `VITE_EVOLUTION_API_URL`
- `VITE_EVOLUTION_API_KEY`

Observacao: as variaveis `VITE_*` ficam disponiveis no frontend. Para escala maior, mova chamadas sensiveis para n8n/backend. Para os primeiros clientes, mantenha o painel em ambiente controlado.

## Pagamentos

O MVP suporta:

- Asaas
- Mercado Pago

O cliente deve criar a chave na propria conta e cadastrar na tela "Configuracao Rapida". Para Mercado Pago, use `TEST-...` em testes e `APP_USR-...` para pagamento real.

## Documentacao operacional

Veja [docs/MVP_OPERACIONAL.md](docs/MVP_OPERACIONAL.md) para o roteiro de implantacao e suporte dos primeiros clientes.
