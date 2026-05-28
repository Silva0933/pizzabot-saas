# PizzaBot - Operacao do MVP

Este documento e o roteiro para colocar os primeiros clientes no ar sem depender de configuracao tecnica por parte da pizzaria.

## Objetivo do MVP

Permitir que uma pizzaria:

- conecte o WhatsApp;
- cadastre produtos;
- configure atendimento por IA;
- receba pedidos no painel;
- gere link de pagamento por Asaas ou Mercado Pago;
- acompanhe pedidos no Kanban;
- responda manualmente quando precisar.

## Criterio de "pronto para cliente"

Uma pizzaria so deve receber uso real quando estes pontos estiverem OK na tela "Configuracao Rapida":

- WhatsApp preparado para conectar;
- cardapio inicial publicado;
- prompt de atendimento salvo;
- bot global ativo;
- pagamento online configurado;
- webhooks principais configurados;
- telefone de suporte/admin salvo.

## Roteiro de onboarding com cliente

1. Criar a pizzaria no painel SaaS.
2. Confirmar o email do dono.
3. Pedir para o dono acessar o painel.
4. Abrir "Configuracao Rapida".
5. Conectar WhatsApp com QR Code.
6. Cadastrar pelo menos os produtos mais vendidos.
7. Escolher Asaas ou Mercado Pago.
8. Orientar o cliente a copiar a chave da propria conta.
9. Colar a chave no painel e salvar.
10. Fazer um pedido teste de baixo valor.

## Suporte para Mercado Pago

Instrua o cliente:

1. Entrar na conta Mercado Pago da pizzaria.
2. Acessar a area de desenvolvedores/credenciais.
3. Copiar o Access Token.
4. Usar `TEST-...` apenas para teste.
5. Usar `APP_USR-...` para receber pagamento real.

## Suporte para Asaas

Instrua o cliente:

1. Entrar na conta Asaas da pizzaria.
2. Acessar a area de integracoes/API.
3. Copiar a API Key.
4. Colar no painel.
5. Fazer uma cobranca teste de baixo valor.

## Teste obrigatorio antes de vender como ativo

Use este roteiro sempre:

1. Enviar mensagem real para o WhatsApp conectado.
2. Conferir se a conversa entrou na Central Chat.
3. Pedir um produto cadastrado.
4. Confirmar endereco, forma de entrega e pagamento.
5. Confirmar se pedido entrou no Kanban.
6. Gerar link de pagamento.
7. Confirmar se o link chegou no WhatsApp.
8. Confirmar se o pedido atualiza apos pagamento.
9. Responder manualmente pela Central Chat.
10. Pausar e reativar o bot em uma conversa.

## Problemas comuns

### Link de pagamento nao chegou

- Verificar se a pizzaria tem chave Asaas/Mercado Pago salva.
- Conferir se o workflow de pagamento no n8n esta ativo.
- Conferir se a mensagem de link aparece na conversa no banco.
- Fazer novo pedido teste com valor baixo.

### WhatsApp nao conecta

- Gerar novo QR Code.
- Conferir se o celular esta com internet.
- Conferir se a instancia da pizzaria esta correta.
- Se precisar, excluir/recriar a conexao da instancia.

### Mensagens nao aparecem no painel

- Conferir workflow secretaria no n8n.
- Conferir webhook da instancia WhatsApp.
- Atualizar a pagina do painel.
- Confirmar se a conversa foi criada no Supabase.

### Bot nao responde

- Conferir se bot global esta ativo.
- Conferir se a conversa nao foi pausada para atendimento humano.
- Conferir se existe prompt salvo.
- Conferir se o cardapio tem produtos disponiveis.

## Comandos uteis

```bash
npm run mvp:check
npm run lint
npm run build
npm run dev
```

## O que fica para depois do MVP

- mover chamadas sensiveis para backend/proxy;
- criptografar chaves das pizzarias;
- adicionar logs detalhados por tenant;
- criar cobranca recorrente da assinatura do SaaS;
- alertas automaticos quando n8n, Evolution ou pagamentos falharem.
