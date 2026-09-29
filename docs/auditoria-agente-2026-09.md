# Auditoria do agente de atendimento (2026-09-29)

A `auditoria-2026-09.md` deixou o agente (FSM) de fora. Esta rodada cobre só ele,
mais o que impede o lançamento. As evidências vêm de três fontes:

- **Leitura do pipeline:** `pipeline.py`, `runner.py`, `engine.py`, `voice.py`,
  `guard.py`, `validador.py`, `catalogo.py`, `nlu*.py`, `failover.py` e `memory.py`.
- **A única conversa real dos últimos 30 dias em produção** (Pizzaria Palazio,
  25/09) e os alertas `preco_suspeito` de 24/09.
- **Dados de produção**, lidos com consultas somente leitura.

Depois da leitura do código, os achados foram conferidos com o **agente real**:
10 roteiros e 38 turnos no playground (`POST /agente/testar`, modo simulação)
da Fornalha. O resultado está na seção 4, que tem prioridade sobre as seções
1 e 2 onde elas discordarem. O plano revisado está na seção 5.

Legenda: 🔴 bloqueia o lançamento · 🟠 prejudica o atendimento · 🟡 melhoria.

---

## 1. Falhas do agente (corrigíveis no código)

### 🔴 A1. Timeout no fechamento pode duplicar pedido e cobrança

`runner.process_and_reply` dá 15 s ao FSM. Se estourar, ou se o FSM lançar
exceção, o **agente legado** (LLM livre com ferramentas) assume o turno na
**mesma sessão de banco**.

O fechamento é o turno mais pesado. Quando o cliente confirma,
`registrar_pedido` faz tudo isto no mesmo turno:

1. grava o pedido com `flush`, sem commit;
2. avisa o painel com `pedido.novo`;
3. chama o gateway para criar a cobrança;
4. **envia o QR do Pix pelo WhatsApp**.

Se esse turno passar de 15 s (gateway lento), o `wait_for` cancela o FSM no
meio. O legado então roda sobre a sessão com o pedido pela metade. Ele não
conhece o estado do FSM e pode chamar `registrar_pedido` e gerar cobrança de
novo. Resultado: o cliente pode receber dois Pix, ou o painel pode mostrar um
pedido que não existe.

Mesmo sem timeout, ter **dois cérebros** (FSM e legado, com regras e memória
diferentes) é a maior fonte de resposta desconexa: o legado não sabe o que está
no carrinho do FSM.

**Correção proposta:**
- **Tirar o fallback para o legado.** Em falha do FSM: tentar uma vez com o
  provedor reserva; se ainda falhar, mandar uma mensagem de espera e acionar a
  equipe (ver a seção 3).
- **Fechamento idempotente:** gravar o pedido em transação própria e fazer o
  commit **antes** de chamar o gateway.
- **Cobrança idempotente por pedido:** se já existe cobrança pendente para
  aquele pedido, reenviar a mesma, sem criar outra.

### 🔴 A2. Failover de LLM não funciona na voz nem na NLU livre

`com_failover` só troca para o provedor reserva quando recebe uma exceção. Mas
`voice.gerar_voz` e `nlu.nlu_extract` **engolem qualquer erro** e devolvem
vazio ou `duvida_geral`.

Com o provedor principal fora do ar, isso acontece:
- a voz responde **"Pode repetir, por favor? 😊" em todas as mensagens**;
- a NLU livre cai no agente legado, que usa o mesmo provedor e também falha;
- a conversa termina transferida para humano.

**Correção:** propagar o erro para o failover e só depois usar a mensagem
segura. Incluir um teste com o provedor primário derrubado.

### 🟠 A3. Falha passageira desliga Structured Outputs até reiniciar

Em `nlu_comandos.py`, qualquer exceção na tentativa com `json_schema` põe o
modelo em `_SEM_SCHEMA`. Em `nlu.py`, o mesmo vale para `_SEM_JSON_MODE`. Um
soluço de rede (timeout, 5xx) passa a ser tratado como "o modelo não suporta",
e a NLU principal perde o modo estrito até o container reiniciar.

**Correção:** só marcar quando o erro for 400 ou "unsupported". Timeout e 5xx
não devem marcar nada.

### 🔴 A4. Pós-venda gera cobrança nova por palavra-chave

`engine.processar`, na etapa `FINALIZADO`: qualquer mensagem com "pix", "link",
"pagar" ou "pagamento" chama `gerar_pagamento`, que cria **outra cobrança** e
reenvia o QR. Exemplos que disparam: "já paguei o pix", "vou pagar na entrega",
"o motoboy aceita pix?". Com `estado["pagamento"] == "dinheiro"` ele ainda tenta
cobrar em dinheiro.

**Correção:**
- só reenviar a pedido explícito ("manda o pix de novo", "não chegou o link");
- reenviar a cobrança **existente** do pedido, nunca criar outra;
- "já paguei" responde com o status do pagamento.

### 🟠 A5. "Já saiu meu pedido?" logo depois de fechar fica sem resposta real

A consulta do pedido real (`pedido_ativo_do_cliente`) só roda quando a etapa
**não** é `FINALIZADO`. Nessa etapa, uma `duvida_geral` reseta o estado
(`estado.update(estado_inicial())`) **depois** do ponto em que a consulta teria
rodado. Então, nas 2 horas após o fechamento, "já saiu?" chega à voz sem nenhum
fato sobre o pedido, e ela improvisa.

Também não existe uma intenção própria para "status do pedido".

**Correção:** consultar o pedido real também na etapa `FINALIZADO`, antes do
reset, e responder o status com texto fixo do backend.

### 🟠 A6. A voz inventa preço, e o guard responde "(valor a confirmar)"

Em 24/09 houve 5 alertas `preco_suspeito` numa única sessão de teste. Exemplos:

| Pergunta | Valor válido | O que a voz disse |
|---|---|---|
| "quanto é a pizza de frango grande?" | R$ 66,90 | R$ 40,90 |
| "a calabresa grande é 10 reais né?" | R$ 59,90 | R$ 46,90 |
| taxa para o Cohatrac | nenhuma cadastrada | R$ 5,00 |

O guard neutraliza o valor, mas o cliente recebe literalmente **"(valor a
confirmar)"**, mesmo quando o sistema sabe o preço. Soa robótico e passa
insegurança.

**Correção:**
- **Pergunta direta de preço** de um produto do catálogo vira resposta do
  backend, com texto fixo ("A Frango (G) sai por R$ 66,90").
- Quando o guard achar um preço sem lastro, **refazer a voz uma vez**, como já é
  feito para produto sem lastro, antes de cair no marcador.

### 🟠 A7. Contradição de cardápio: "não temos Coca 2L", e depois "tem, sem preço"

Aconteceu na conversa real de 25/09, e o cliente percebeu ("Mas você tinha dito
que não tinha coca de 2l").

A causa está em `_opcoes_upsell`: ele lista bebidas com **SQL próprio**, que
ignora preço e tamanho. O catálogo (`catalogo.py`), por sua vez, é a fonte da
NLU e do preço. Se um produto está cadastrado sem preço, ou com tamanho
indisponível, as duas fontes discordam. E a voz chegou a dizer ao cliente
"sem preço informado".

**Correção:**
- upsell, listagens e fatos passam a sair **só** do catálogo;
- o catálogo exclui produto sem preço válido;
- a prontidão passa a acusar "produto sem preço no cardápio" para a loja
  corrigir.

### 🟠 A8. Handoff sem alarme e sem volta

- **O som do alerta de atendimento humano não toca.** Em
  `ConversasViewV2.tsx:156`, o `new Audio("data:audio/wav;base64,UklGRno…")` é
  um WAV de 40 bytes sem nenhuma amostra de áudio. O `play()` falha e o erro é
  engolido.
- **O alerta só existe na tela Conversas.** Em Pedidos, nada toca.
- **Depois do escalonamento o bot fica desligado para sempre** naquela conversa.
  Não há lembrete se ninguém responder e não há retorno automático. À noite, o
  cliente fica sem resposta nenhuma.

### 🟠 A9. O agente não sabe o que o humano disse

As mensagens do atendente (`routes/conversas.py`) não entram em
`agente_memoria`. As do cliente durante o atendimento humano também não. Quando
o bot é religado, ele volta sem o contexto e com o carrinho possivelmente velho.

Além disso, `agente_memoria` e `atendimento_estado` são buscados por telefone
**exato**, fora da regra de `mesmo_telefone`.

### 🟡 A10. Troco não é perguntado

Com dinheiro na entrega, o agente nunca pergunta "vai precisar de troco? pra
quanto?". O resumo também não mostra o troco, e o motoboy sai sem saber.

**Correção:** passo determinístico depois do pagamento em dinheiro, com o troco
aparecendo no resumo e no pedido.

### 🟡 A11. Confirmação repetida

Na conversa real: "✅ Anotei: 1x Fanta 1L" e logo em seguida "Fanta 1L
anotada." A voz repete o que o sistema já confirmou, mesmo com a instrução para
não repetir.

**Correção:** um guard determinístico que remove a primeira frase da voz quando
ela só repete o item confirmado.

### 🟡 A12. `pedido.novo` sai antes do commit em `registrar_pedido`

É o mesmo defeito já corrigido no webhook (`auditoria-2026-09.md`), só que aqui
no caminho do agente. Somado ao A1, o painel pode tocar e mostrar um pedido que
nunca foi gravado.

### 🟡 A13. Menores

- `pipeline.py`: `correcoes["produtos_sem_lastro"]` é sobrescrito pelo retorno
  de `blindar()`. O trace perde a informação.
- **Latência:** a conversa real teve cerca de 14 s por resposta (debounce de 7 s
  + NLU + voz + digitação simulada). Um debounce adaptativo (mensagem curta,
  pergunta ou "sim" → 2–3 s) reduz isso sem picotar mensagens.
- **Mensagem que chega enquanto o agente processa:** a resposta ao lote anterior
  sai mesmo assim, e a nova mensagem é respondida em seguida. Dá para detectar
  e juntar as duas.

---

## 2. Operação e configuração (depende do dono)

| # | Item | Situação |
|---|---|---|
| O1 | 🔴 **Nenhuma pizzaria atende sozinha hoje** | A Palazio está **suspensa**; a Fornalha está com o **bot global desligado**. Para o piloto é preciso uma loja ativa. |
| O2 | 🟠 `MP_WEBHOOK_SECRET` | Única pendência da prontidão (`auditar()`). |
| O3 | 🟠 Cadastro de bebidas da Palazio | Provável Coca-Cola 2L sem preço ou com tamanho indisponível (ver A7). Conferir no Cardápio. |
| O4 | 🟡 `EVOLUTION_API_KEY` de preview | Ainda com a chave antiga nas 4 aplicações. Não afeta produção. |
| O5 | 🟡 Retenção de dados, cards vazios no Kanban e botão "Sair de todos" | Decisões de produto herdadas das auditorias anteriores. |

---

## 3. Proposta: consulta interna à equipe ("chamado")

Ideia do dono: quando o agente não souber resolver, em vez de transferir, ele
abre um chamado interno. A equipe responde, e o agente continua o atendimento
sem anunciar transferência ao cliente.

**Parecer: vale fazer, e resolve de uma vez A1 (em parte), A8 e boa parte das
"mensagens desconexas".** Desenho sugerido:

1. **Gatilhos determinísticos, não escolha da LLM:**
   - pergunta sem fato disponível (produto ou serviço fora do catálogo);
   - bairro sem taxa cadastrada;
   - pedido especial que as ferramentas não fazem;
   - validador barrou duas vezes;
   - NLU com baixa confiança duas vezes;
   - falha ao cancelar ou alterar um pedido;
   - falha técnica do FSM (substitui o fallback legado do A1).
2. **Mensagem ao cliente, verdadeira e sem cara de transferência:** "Vou
   confirmar isso rapidinho com a cozinha e já te falo 😊". Enquanto isso, o
   agente segue atendendo o resto do pedido.
3. **Chamado interno dentro de Conversas:** mensagem com `origem="interno"`, que
   nunca vai para o WhatsApp. Leva a pergunta, o motivo e o resumo do carrinho.
4. **Alarme global,** no `App.tsx` e não só na tela Conversas: som em loop até
   alguém abrir, notificação do navegador e contador no menu.
5. **Tempo limite obrigatório,** por exemplo 3 minutos sem resposta:
   - o cliente recebe um aviso honesto ("a equipe está atendendo um pico, já te
     respondem");
   - a conversa vira handoff normal;
   - opcionalmente, o dono recebe um aviso no WhatsApp dele.

   Sem isso, o cliente espera para sempre.
6. **Resposta da equipe entra como fato no próximo turno da voz,** nunca como
   instrução. O que envolve dinheiro (desconto, item especial com preço) usa
   **botões estruturados** ("aprovar item X por R$ Y"), não texto livre. Assim
   o preço continua passando pelo validador.
7. **"Salvar como conhecimento":** transforma a resposta num fato permanente da
   pizzaria (FAQ). Na próxima vez, o agente responde sozinho. É aqui que o
   sistema aprende com a operação.

Esforço estimado: de 2 a 3 dias com testes. Inclui:
- **Backend:** estado de consulta pendente, job de tempo limite e rota de
  resposta.
- **Engine:** nova ação `consultar_equipe`.
- **Painel:** thread interna em Conversas e alarme global.

---

## 4. Verificação com o agente real (29/09)

Os testes foram feitos no playground da Fornalha. Tudo rodou pelo FSM: nenhum
turno caiu no legado e nenhum HTTP diferente de 200. Tempo por turno: 3,7 s de
mediana, 4,4 s no percentil 90 e 7 s no pior caso.

| Roteiro | Resultado |
|---|---|
| Pedido completo, entrega em dinheiro | ✅ Fluxo e resumo corretos. ❌ **Não pergunta o troco** (A10). ❌ "Fica **pronto** em 30-45 min" numa **entrega** (deveria ser "chega em"). |
| Preço direto e pechincha | ✅ R$ 66,90, R$ 54,90 e R$ 59,90 corretos; "é 40 reais né?" corrigido. O A6 caiu de gravidade: os gatilhos de contexto posteriores a 24/09 resolveram a maior parte. |
| Taxa para o Cohatrac | ✅ Usou a taxa fixa (R$ 6,90). ⚠️ Afirmou "Entregamos no Cohatrac" sem existir checagem de área atendida. |
| **Pós-venda com Pix** | ❌ **A4 confirmado e pior.** "já paguei o pix" → nova cobrança e *"Anotado, o Pix já foi pago. Acabei de reenviar o código Pix"*: afirma pagamento sem conferir e reenvia o QR. "vou pagar na hora de buscar" → **outra cobrança** e *"acabei de reenviar o código Pix"*, sem mudar a forma de pagamento. |
| **Status logo após fechar** | ❌ **A5 confirmado e grave.** "já ficou pronto meu pedido?" → **"✅ Tirei: Pizza Brasa (M)"** + "Não consigo verificar o status". O reset do estado esvazia o carrinho, e a confirmação automática anuncia a remoção da pizza do pedido recém-fechado. |
| Bebidas / item inexistente | ✅ Lista certa. ❌ **Negativa robótica:** "tem fanta?" → *"Não tenho essa informação no cardápio disponível agora"*; Coca 600 ml → *"não tenho informação sobre a versão de 600 ml"*. Deveria ser "Não temos Fanta; temos Coca 2L e Guaraná 2L". |
| Meio a meio, remoção, troca de tamanho | ✅ Carrinho e preços certos. ❌ Upsell de **"alguma bebida"** com a Coca já no carrinho. ❌ "✅ Tirei: Coca-Cola 2L" + "Tirei, sim." (A11). |
| Pechincha, fora do tema, cupom | ✅ Os três corretos. |
| Mensagem sem sentido | ✅ Pede esclarecimento sem inventar. |
| Pedir atendente | ✅ Escala. ⚠️ Repete a apresentação ("Oi! Sou a Camila…") no meio da conversa. |

**A7, causa real (confirmada no banco): erro de cadastro.** Na Palazio, a
"Coca Cola 2L" está indisponível (o "não temos" estava certo), mas a
**descrição da "Fanta 1L" é "Uma Coca-Cola de 2 l"**, copiada da Coca. A voz
recebe a descrição da Fanta como fato e conclui que "também há Coca-Cola de 2L".
Isso se reproduziu no teste de estresse do projeto (roteiro `pergunta_no_meio`).

- **Correção na loja:** arrumar a descrição da Fanta.
- **Correção no sistema:** a prontidão do cardápio deve acusar descrição que
  cita outro produto do cardápio, e produto sem preço.

### Teste de estresse do projeto (Palazio, `scripts/stress_atendimento.py`)

O script reportou **"TOTAL DE FALHAS: 0"**, mas as respostas mostram dois erros
que as checagens dele não pegam:

- 🔴 **A14. Item fantasma no pedido.** Roteiro `escolha_direta`: depois de "The
  Pizza (M)" e da pergunta genérica "alguma bebida?", o cliente responde "é isso
  mesmo" e recebe **"✅ Anotei: 1x Fanta 1L"**. O pedido ganha uma bebida que o
  cliente nunca pediu.
  - `_afirmou_upsell` trata a intenção `confirmar_resumo` como aceite do upsell.
  - Com só uma bebida disponível, o engine guarda a Fanta em
    `upsell_item_unico`, mesmo a oferta não tendo citado a Fanta.
  - **Correção:** aceite só por frase explícita; item único só quando a oferta
    **nomeou** o item; "é isso mesmo" e "é só isso" contam como recusa.
- A oferta de Coca indisponível foi explicada acima (cadastro da Fanta).
- **As checagens do script são fracas demais.** Precisam de asserts de
  carrinho (itens exatos por turno) e de "produto citado ∈ disponíveis".

**Não dá para testar no playground:** A1 (timeout no fechamento), A2 (provedor
fora do ar), A3, A8 e A9. Eles dependem de falha real ou do fluxo do WhatsApp.
Esses entram com teste automatizado reproduzindo a falha.

**Estado das lojas (painel):**
- **Fornalha:** WhatsApp desconectado, bot pausado, pagamento não configurado
  (Asaas selecionado, onboarding indica sem chave), atendente não personalizada,
  loja marcada como fechada.
- **Palazio:** suspensa (402 nas rotas de escrita).

## 4b. Arquitetura e custo: "um agente com ferramentas" vs. o FSM atual

Medido em produção em 29/09 (30 dias de `llm_usage` e tamanho real dos prompts
da Fornalha, 19 produtos):

- **FSM atual:** média de **1.469 tokens de entrada e 83 de saída por chamada**,
  com no máximo 2 chamadas por mensagem (NLU + voz). Fica em cerca de 3 mil
  tokens por mensagem, e zero nas mensagens triviais (NLU determinística e
  textos fixos). O prompt da NLU tem ~1.900 tokens, dos quais o cardápio ocupa
  ~680 (≈36 por produto).
- **Agente com ferramentas (o "legado"):** ~4.800 tokens de instruções e
  ~2.900 de 13 ferramentas, total **~7.700 por chamada sem o histórico**. Cada
  ferramenta chamada reenvia tudo. Um pedido típico dá de 3 a 6 chamadas, ou
  **20 a 40 mil tokens por mensagem**: de 7 a 13 vezes o custo atual.

Um agente livre com ferramentas também devolve à IA a decisão de **quando**
usar cada ferramenta. Ela pode pular a ferramenta e responder "de cabeça", e
essa é justamente a origem dos erros que levaram à criação do FSM. As falhas
deste relatório estão em **regras do engine** (upsell, pós-venda, reset de
estado), corrigíveis com teste. Nenhuma vem do formato do prompt.

**Direção recomendada:** manter "a IA entende → o sistema decide → a IA fala" e
aplicar a ideia de "uma ferramenta para cada coisa" **dentro** da NLU de
comandos:

1. **Cobrir com comandos tudo o que o cliente pode pedir.** Hoje os comandos
   cobrem itens do carrinho. Entram: consultar preço (produto/tamanho), status do
   pedido, alterar pagamento, reenviar cobrança, informar troco e pergunta sem
   resposta (vira chamado interno). A IA só escolhe o comando; o sistema executa
   e responde com dado do banco.
2. **Prompt caching:** ordenar o prompt da NLU com a parte fixa primeiro
   (instruções + cardápio) e a variável no fim (estado, histórico, mensagem).
   Provedores como a OpenAI cobram menos pelo prefixo repetido acima de ~1.024
   tokens.
3. **Cardápio recortado** para lojas grandes: mandar à NLU só as categorias ou
   produtos relevantes à mensagem, mais os do carrinho.
4. **Mais textos fixos,** menos voz: preço, negativa ("não temos X"),
   confirmações e status saem do backend sem chamar a IA.
5. **Remover o agente legado:** tira o prompt de 7,7 mil tokens do caminho de
   falha e elimina o "segundo cérebro" (A1).
6. **Modelo menor para a NLU,** validado pelo teste de estresse antes de trocar.

## 5. Plano revisado

**Etapa 1: bloqueadores confirmados (código + testes que reproduzem).**
0. **A14:** o item fantasma no aceite do upsell.
1. **A5:** consultar o pedido real também em `FINALIZADO`, antes do reset; não
   gerar "Tirei" quando o carrinho foi esvaziado por reset; responder o status
   com texto do backend.
2. **A4:** reenvio de cobrança só a pedido explícito e da cobrança existente.
   "Já paguei" responde com o status real do pagamento. "Vou pagar na
   entrega/retirada" altera a forma de pagamento pelo `atualizar_pedido`, sem
   cobrar.
3. **A1:** tirar o fallback para o legado; fechamento em transação própria
   commitada antes do gateway; cobrança idempotente por pedido.
4. **A2 e A3:** failover real na voz e na NLU livre; só marcar
   `_SEM_SCHEMA`/`_SEM_JSON_MODE` em erro 400/unsupported.
5. **A12:** `pedido.novo` depois do commit.

**Etapa 2: conversa natural e correta.**
1. **Negativas determinísticas:** produto fora do catálogo → "Não temos X",
   com até 3 alternativas reais da mesma categoria.
2. **Troco** no dinheiro na entrega (A10). "Chega em" para entrega, "fica pronto
   em" para retirada.
3. **Upsell** que não oferece a categoria já presente no carrinho.
4. **Guard anti-repetição** da confirmação ("Tirei, sim.", "Fanta anotada") e da
   apresentação fora da primeira mensagem.
5. **Preço:** refazer a voz uma vez antes do marcador "(valor a confirmar)" (A6).
6. **Área de entrega:** sem tabela de bairros nem raio cadastrado, não afirmar
   que entrega; usar "a taxa é R$ X" e a equipe confirma bairros fora do padrão.
7. **Fonte única de cardápio** para upsell e listagens (A7).

**Etapa 3: handoff e chamado interno.**
1. Alarme global que realmente toca (A8).
2. Memória do atendimento humano (A9).
3. O chamado interno da seção 3, com tempo limite e "salvar como conhecimento".

**Etapa 4: validação.**
1. Transformar os 10 roteiros deste teste em roteiros do
   `scripts/stress_atendimento.py` e em testes em `test_bateria_atendimento.py`.
   O script ganha asserts de carrinho por turno e de "produto citado está
   disponível".
2. Repetir o teste completo e fazer um piloto numa loja real.

**Em paralelo, com o dono:**
- corrigir a descrição da "Fanta 1L" na Palazio (hoje "Uma Coca-Cola de 2 l");
- ativar uma loja para o piloto: WhatsApp, bot, chave do Asaas, horário e
  personalização;
- configurar `MP_WEBHOOK_SECRET` se for usar o Mercado Pago.

## Pendências de verificação

- 30/09, depois das 06:33 UTC: confirmar que o traceback do worker e o falso
  alerta de Evolution fora do ar sumiram (commits `53a10bf` e `74cf822`).
