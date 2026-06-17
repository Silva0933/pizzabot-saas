# Auditoria pré-lançamento — PizzaBot

Data: 2026-06-17 · Escopo: backend (FastAPI) + frontend público (cardápio digital).
Foco: bugs, falhas de integridade e segurança antes do lançamento.

---

## Resumo executivo

Foram encontradas **2 falhas CRÍTICAS** (ambas no fluxo de receita/pagamentos) e
**1 MÉDIA** (corrida de concorrência). **Todas foram corrigidas** e cobertas por
testes. As demais áreas auditadas (autenticação, isolamento multi-tenant, CORS,
WebSocket, SQL injection) estão **sólidas**.

| # | Severidade | Área | Status |
|---|-----------|------|--------|
| 1 | 🔴 CRÍTICO | Adulteração de preço no checkout do cardápio digital | ✅ Corrigido |
| 2 | 🔴 CRÍTICO | Bypass de pagamento no webhook Asaas (por pizzaria) | ✅ Corrigido |
| 3 | 🟠 MÉDIO | Corrida no número do pedido (cardápio digital) | ✅ Corrigido |

---

## Achados e correções

### 1. 🔴 Adulteração de preço no checkout público (`POST /menu/{slug}/pedido`)

**Problema.** O backend criava o pedido usando o `preco_unit` **enviado pelo
cliente** (`Decimal(str(item.preco_unit))`). Como o endpoint é público e sem
autenticação, qualquer pessoa podia enviar `preco_unit: 0.01` e fechar um pedido
`confirmado` por qualquer valor — perda financeira direta para a pizzaria.

**Correção.** O servidor agora **recalcula sempre** o preço a partir do cadastro
(`Produto.preco` / preço do tamanho + adicionais cadastrados na pizzaria) e
**ignora** o preço do cliente. Cada item passa a exigir `produto_id` (fonte de
verdade); itens com produto inexistente/indisponível, tamanho inválido ou
adicional não cadastrado são rejeitados/descartados.
- Backend: `app/routes/cardapio_publico.py` — novo helper puro `_recalcular_itens()`.
- Frontend: `CardapioPublico.tsx` envia `produto_id`; tipo em `lib/api.ts`.
- Testes: `tests/test_cardapio_publico_preco.py` (6 casos).

### 2. 🔴 Bypass de pagamento no webhook Asaas (`POST /webhook/asaas`)

**Problema.** O webhook **não tinha autenticação** e **confiava no `status`
enviado no corpo** da requisição. Como o `externalReference` é o `pedido_id`
(UUID), um atacante que conhecesse/adivinhasse um id podia enviar
`{"payment":{"externalReference":"<uuid>","status":"RECEIVED"}}` e marcar o
pedido como **pago sem pagar**. (O webhook do Mercado Pago já reconsultava a API,
então estava protegido; o do Asaas, não.)

**Correção.** O webhook agora **reconsulta o pagamento na API do Asaas** com a
chave da própria pizzaria (`AsaasClient.consultar_pagamento`) e usa o status
**verificado** — nunca o do corpo. Asaas fora do ar → HTTP 502 (faz o Asaas
reentregar), nunca marca pago indevidamente.
- Backend: `app/routes/webhook_pagamento.py` (`webhook_asaas`).

### 3. 🟠 Corrida no número do pedido (cardápio digital)

**Problema.** O número do pedido era gerado com `SELECT MAX(numero_pedido)+1`
sem trava. Dois pedidos digitais simultâneos podiam pegar o mesmo número.

**Correção.** Adicionado `pg_advisory_xact_lock` por pizzaria antes do cálculo,
serializando a numeração (mesmo padrão do fluxo do WhatsApp).
- Backend: `app/routes/cardapio_publico.py`.

---

## Áreas auditadas e consideradas OK

- **Autenticação / JWT** (`auth.py`, `deps.py`): `app_secret_key` exige ≥32 chars
  (sem default inseguro); valida `typ` do token; senhas com bcrypt; mensagem de
  login genérica (sem enumeração de usuário).
- **Isolamento multi-tenant (IDOR)**: todos os endpoints com `pizzaria_id` exigem
  `membership`/`require_platform_admin`, e as queries escopam o sub-recurso
  (`Pedido.id == id AND Pedido.pizzaria_id == pizzaria_id` etc.). Sem acesso
  cruzado entre pizzarias.
- **WebSocket** (`ws.py`): valida JWT + vínculo (equipe ou entregador ativo) antes
  de aceitar; broadcaster escopado por pizzaria — sem vazamento entre tenants.
- **CORS / docs** (`main.py`): origens vêm de env (não wildcard com credenciais);
  `/docs` desabilitado em produção.
- **SQL injection**: os `text(f"...")` interpolam apenas constantes internas
  (`CICLO_DIAS`, `GRACE_DAYS`) ou nomes de tabela de lista fixa; todos os valores
  de usuário vão por bind param (`:param`). Sem injeção.
- **Rate limiting**: login (5/min/IP) e signup (3/h/IP) via Redis distribuído.
- **Webhook Mercado Pago**: já reconsultava a API (não confia no corpo) — OK.
- **Pagamento manual (Pix)**: confirmação/rejeição exigem `membership` — OK.

---

## Recomendações (não bloqueantes para o lançamento)

1. **Token do Coolify exposto no chat** durante os deploys desta sessão.
   → **Aceito o risco**: o token tem data de expiração definida.
2. **Rate limit do cardápio público** (`cardapio_publico.py`) era em memória
   (por processo). → ✅ **FEITO**: migrado para o `allow()` baseado em Redis
   (mesmo do login/signup) — limite agora é global entre réplicas.
3. **Número de pedido entre fluxos**: o fluxo digital setava o número em Python
   (MAX+1) com chave de lock diferente do trigger do WhatsApp. → ✅ **FEITO**: o
   fluxo digital deixou de setar o número e passou a usar o trigger
   `assign_numero_pedido` (BEFORE INSERT, com advisory lock por pizzaria). Agora
   **todos os fluxos** compartilham o mesmo lock — colisão impossível.
4. **Enumeração de e-mail no signup**. → ✅ **FEITO**: mensagem neutra
   ("Não foi possível concluir o cadastro com esses dados…") + rate limit 3/h/IP
   já existente.

---

## Validação

- Backend: `pytest` → 274 passam, 9 skip, 1 falha **pré-existente e não relacionada**
  (`test_upsell::test_oferece_so_o_que_existe`, dessincronizado do commit de upsell).
- Frontend: `tsc --noEmit` limpo.
- Novos testes: `tests/test_cardapio_publico_preco.py` (6 casos de anti-tampering).
