# Auditoria pré-produção

Varredura completa de assinaturas, integração e segurança. O que foi corrigido
está nos commits; este documento registra **o que verifiquei e estava certo**
(para não ser reauditado à toa) e **o que decidi não mexer sozinho**.

---

## 1. Ciclo de assinatura

### Corrigido

| Falha | Efeito | Commit |
|---|---|---|
| Pizzaria suspensa continuava operando pelo painel e pela API | Bastava não pagar para seguir usando | `2fbcee0` |
| Sem `ASAAS_PLATFORM_API_KEY`, o job suspendia todo mundo | Base inteira trancada sem conseguir pagar | `2fbcee0` |

A suspensão agora responde **402 Payment Required**, e o painel leva direto à
tela de pagamento. Ficam abertas de propósito: rotas de assinatura/fatura, o GET
do próprio cadastro e `/uso`. Sem essas exceções o bloqueio viraria armadilha.

### Verificado e correto

- **Trial**: criado no signup com 14 dias (`auth.py:217`), expira pelo job diário.
- **Beat**: `verificar-assinaturas` às 08:00 (America/Sao_Paulo).
- **Dunning**: avisos em D-3, D-1 e D0, sem duplicar no mesmo dia.
- **Carência**: suspende após `GRACE_DAYS = 5` de atraso.
- **Renovação**: `GREATEST(now(), plano_vence_em) + 30 dias`. Pagar adiantado
  estende a partir do vencimento; pagar atrasado, a partir de hoje. Não perde
  nem acumula dias.
- **Reativação**: automática no webhook de pagamento, junto com a promoção
  `trial → plano` contratado.
- **Cota por plano**: aplicada no agente (`runner.py:353`) e no cardápio digital
  (`cardapio_publico.py:545`).

### Pontos de bloqueio da suspensão

Bot não responde · webhook do WhatsApp ignora · cardápio público some · painel e
API retornam 402. Admin da plataforma passa por todos (suporte precisa entrar
justamente quando está suspensa).

---

## 2. Personalização do agente

**As 24 opções estão ligadas.** Rastreei cada campo de `config_atendimento` até
o ponto onde é lido:

| Grupo | Onde é aplicado |
|---|---|
| `comunicacao` (6 campos) | `fsm/voice.py` (tamanho, balões, uma pergunta), `behavior.delivery_options` → `runner.py:707` (ritmo de digitação), `behavior.py:215` (transparência de IA) |
| `vendas` (6) | `fsm/engine.py` — cada oferta e o teto de ofertas |
| `memoria` (4) | `prompt.py`, `runner.py`, `tools.py` |
| `handoff` (5) | `fsm/pipeline.py` (limites), `behavior.handoff_message()` (mensagem) |
| `followups` (4) | `workers/tasks.py` (horário), `runner.py` (atraso) |

Os 27 campos de configuração da pizzaria (horário, taxas, adicionais, formas de
pagamento, tempos, tema, modo de pagamento…) também têm leitura confirmada.

---

## 3. Segurança

### Corrigido

**Bypass de rate limit** (`715b2a5`) — `client_ip()` lia o primeiro valor de
`X-Forwarded-For`, que é escrito pelo cliente. Mandando um header diferente a
cada requisição, o atacante ganhava identidade nova e furava os limites de
login, cadastro, conta do cliente e cardápio. Agora lê a partir da direita,
contando `TRUSTED_PROXIES` (default 1).

**Auditoria de prontidão** (`715b2a5`) — `GET /admin/prontidao` e alerta no
startup para os pontos *fail-open*:

| Variável | Se vazia |
|---|---|
| `EVOLUTION_WEBHOOK_TOKEN` | Qualquer um POSTa mensagem falsa: o bot responde, consome cota e registra pedido |
| `ASAAS_PLATFORM_WEBHOOK_TOKEN` | Dá para forjar "pagamento confirmado" e renovar sem pagar |
| `ASAAS_PLATFORM_API_KEY` | Ninguém assina nem paga |
| `MP_WEBHOOK_SECRET` | Notificação do MP não é verificada (mitigado: o pedido é consultado na API antes de aplicar) |

### Verificado e correto

- **SQL injection**: nenhuma. O único f-string em SQL usa nomes de tabela literais.
- **Adulteração de preço**: o pedido público recalcula tudo no servidor a partir
  do `produto_id`; o preço enviado pelo cliente é ignorado.
- **WebSocket**: valida JWT + vínculo de equipe antes de aceitar.
- **Enumeração de usuário**: o login da conta do cliente responde igual para
  e-mail inexistente e senha errada.
- **Segredos**: tokens de gateway cifrados com Fernet e mascarados nas respostas.
- **JWT**: `APP_SECRET_KEY` obrigatório, mínimo 32 caracteres, HS256.
- **CORS**: lista explícita de origens, sem `*`.
- **`/docs`**: desativado em produção.

---

## 4. O que NÃO mexi (decisão sua)

### Retenção de dados

As tabelas `mensagens`, `eventos`, `pedido_eventos`, `llm_usage`,
`agente_memoria` e `plataforma_alertas` crescem **sem limite**. Há limpeza de
`atendimento_estado` e das chaves do Redis, mas nada apaga histórico.

Não implementei porque apagar conversa de cliente é decisão de produto e
possivelmente legal — e o histórico tem valor para a pizzaria. Quando quiser
definir, o caminho natural é um job no Beat com prazo por tabela.

O impacto aparece em disco, tamanho de backup e, mais tarde, em consulta. Não é
urgente no volume de lançamento.

### Erros engolidos em silêncio

89 blocos `except` sem log. A maior parte é *best-effort* deliberado (limpeza,
recurso opcional) ou exceção tipada e estreita (`ValueError`, `JSONDecodeError`),
onde engolir é o comportamento certo.

Não varri os 89 porque a maioria é intencional e mexer em todos traria mais
risco que benefício. Se algum sintoma aparecer em produção sem rastro no log,
vale revisitar o caminho específico.

---

## 5. Antes de abrir para clientes

1. Preencher as 4 variáveis da seção 3 e conferir em `GET /admin/prontidao`.
2. `CORS_ORIGINS` com o domínio real do painel, sem localhost.
3. Rodar `python scripts/backfill_mp_user_id.py` (confirmação de pagamento por cartão).
4. Fazer um ciclo completo em homologação: signup → trial → assinar → pagar →
   confirmar renovação → deixar vencer → checar suspensão e o 402 no painel.
