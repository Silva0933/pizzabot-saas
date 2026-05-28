"""
Reforma estrutural do atendimento para padrao profissional multi-pizzaria.

MUDANCAS:
1. Montar Contexto (n22) - novo prompt padronizado com dados dinamicos
   da pizzaria (nome, endereco, telefone, instagram, horarios,
   formas de pagamento, tempos de entrega, taxa).
2. Renomeia 'Tool: Consultar_Cardapio' -> 'Tool: Buscar_cardapio'.
3. Generaliza 'Tool: Atualizar_Obs_Pedido' -> 'Tool: Atualizar_pedido'
   (aceita itens/endereco/observacoes/forma_pagamento, bloqueia se pedido
    ja saiu para entrega).
4. Cria 'Tool: Cancelar_pedido' (postgresTool) - cancela com auditoria.
5. Cria 'Tool: Enviar_alerta_cancelamento' (toolHttpRequest) -
   manda WhatsApp pra equipe avisando cancelamento.
6. Cria 'Tool: Reagir_mensagem' (toolHttpRequest) - IA decide quando/qual
   emoji usar (substitui a reacao automatica antiga).
7. Remove no automatico 'Reagir mensagem' e sua conexao (agora e tool).
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'
BASE    = 'https://n8nai.secretariaai.eu.cc/api/v1'
url     = f'{BASE}/workflows/{WF_ID}'
ALLOWED = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

# =============================================================
# 1. NOVO MONTAR CONTEXTO (n22)
# =============================================================
NEW_MONTAR_JS = r"""const produtos = $input.all().map(i => i.json);
const cliente = $('Upsert Cliente (RAG)').first().json;
const pizzaria = $('Carregar Pizzaria').first().json;
const info = $('Info').first().json;
const msg = $('Consolidar mensagens').first().json.mensagem_consolidada;

// --- Resumo do cardapio: categorias + contagem ---
const byCat = {};
for (const p of produtos) {
  const cat = p.categoria || 'outros';
  byCat[cat] = (byCat[cat] || 0) + 1;
}
const categoriasList = Object.keys(byCat).sort()
  .map(c => `${c} (${byCat[c]} ${byCat[c]===1?'item':'itens'})`).join(', ') || '(sem produtos cadastrados)';

// --- Horarios de funcionamento ---
const horario = pizzaria.horario_funcionamento || {};
const diasOrder = ['segunda','terca','quarta','quinta','sexta','sabado','domingo'];
const diasLabel = {
  segunda:'Segunda-feira', terca:'Terca-feira', quarta:'Quarta-feira',
  quinta:'Quinta-feira', sexta:'Sexta-feira', sabado:'Sabado', domingo:'Domingo'
};
let horarioStr = '';
for (const d of diasOrder) {
  const h = horario[d];
  if (!h) continue;
  if (h.aberto === false || !h.abre || !h.fecha) {
    horarioStr += `\n- ${diasLabel[d]}: Fechado`;
  } else {
    horarioStr += `\n- ${diasLabel[d]}: ${h.abre} as ${h.fecha}`;
  }
}
if (!horarioStr) horarioStr = '\n(horarios nao configurados - consulte a equipe)';

// --- Formas de pagamento aceitas ---
const formas = Array.isArray(pizzaria.formas_pagamento_aceitas)
  ? pizzaria.formas_pagamento_aceitas.join(', ')
  : 'PIX, dinheiro, cartao';

// --- Contato e localizacao ---
const nomePizz   = pizzaria.nome || 'a pizzaria';
const enderecoLj = pizzaria.endereco || '(consulte conosco)';
const telCliente = pizzaria.telefone_contato || pizzaria.telefone_admin || '(consulte conosco)';
const insta      = pizzaria.instagram ? `\nInstagram: @${String(pizzaria.instagram).replace(/^@/,'')}` : '';
const taxaInfo   = pizzaria.taxa_entrega_info || 'A taxa varia por bairro - confirme antes de finalizar.';
const tEntMin    = pizzaria.tempo_entrega_min || 40;
const tEntMax    = pizzaria.tempo_entrega_max || 60;
const tRetMin    = pizzaria.tempo_retirada_min || 20;
const tRetMax    = pizzaria.tempo_retirada_max || 30;

// --- RAG do cliente ---
let ragContext = '';
if (cliente && cliente.total_pedidos > 0) {
  ragContext = `\n\n# INFO DO CLIENTE\n`
    + `Nome: ${cliente.nome || 'sem nome'}\n`
    + `Endereco habitual: ${cliente.endereco_padrao || 'nao informado'}\n`
    + `Total de pedidos anteriores: ${cliente.total_pedidos}`;
  if (Array.isArray(cliente.historico_pedidos) && cliente.historico_pedidos.length) {
    const ult = cliente.historico_pedidos.slice(-2).map(h =>
      `${h.date||''}: ${h.items||''} (R$ ${Number(h.total||0).toFixed(2)})`).join(' | ');
    ragContext += `\nUltimos pedidos: ${ult}`;
  }
} else {
  ragContext = `\n\n# INFO DO CLIENTE\nCliente novo (primeiro contato pelo telefone ${info.telefone}).`;
}

const systemMessage = `# PAPEL
Voce e uma atendente de WhatsApp da ${nomePizz}. Seu papel e receber pedidos, tirar duvidas e ajudar os clientes da forma mais tranquila e eficiente possivel.

# PERSONALIDADE E TOM DE VOZ
- Simpatica, atenciosa e natural no jeito de falar.
- Tom acolhedor e respeitoso, sem forcar intimidade.
- Comunicacao clara, sem ser formal demais nem informal demais.

# OBJETIVO
- Receber e confirmar pedidos de forma agil.
- Responder duvidas sobre cardapio, horarios, formas de pagamento e entrega.
- Auxiliar em cancelamentos ou alteracoes de pedido.

# PROCEDIMENTO DE ATENDIMENTO
1. ABERTURA: cumprimente o cliente de forma acolhedora e pergunte como pode ajudar.
2. IDENTIFICAR O PEDIDO: pergunte o que o cliente deseja. Se for delivery, solicite (uma pergunta por vez):
   - Nome completo
   - Endereco de entrega
   - Forma de pagamento
3. VERIFICAR DISPONIBILIDADE: SEMPRE use a ferramenta Buscar_cardapio para confirmar nomes, precos e disponibilidade antes de prometer qualquer item.
4. REGISTRAR O PEDIDO: apos confirmacao do cliente, use Registrar_pedido com todos os dados.
5. CONFIRMAR COM O CLIENTE: confirme o pedido APENAS apos retorno de sucesso da ferramenta. Informe o tempo estimado de ${tEntMin} a ${tEntMax} minutos para entrega (ou ${tRetMin} a ${tRetMax} minutos para retirada).

# INSTRUCOES GERAIS
- Respostas claras e uteis: informe sobre sabores, tamanhos, bordas, adicionais, promocoes e tempos.
- Sem opinioes sobre saude ou dieta. Se cliente perguntar sobre alergias graves, oriente a contatar a loja por telefone (${telCliente}).
- Clientes insatisfeitos: mantenha a calma, demonstre empatia e use Escalar_humano imediatamente.
- Assuntos fora do escopo: responda "Desculpe, nao consigo ajudar com esse assunto. Para outras questoes, entre em contato pelo nosso telefone ${telCliente}." Em seguida, use Escalar_humano.
- NUNCA confirme pedido sem retorno de sucesso da ferramenta Registrar_pedido.
- Dupla verificacao: confirme itens, endereco e forma de pagamento antes de finalizar (resumo breve, fluido, NUNCA em lista numerada).
- Sem emojis em excesso. Use com moderacao, apenas quando natural.
- Use Reagir_mensagem em momentos oportunos (cliente agradece -> coracao, pedido registrado -> check verde).
- UMA PERGUNTA POR VEZ: nunca faca duas perguntas seguidas na mesma mensagem. Espere a resposta antes de seguir.

# HORARIOS DE FUNCIONAMENTO${horarioStr}

# LOCALIZACAO E CONTATO
Endereco: ${enderecoLj}
Telefone / WhatsApp: ${telCliente}${insta}

# CARDAPIO (categorias disponiveis hoje)
${categoriasList}
Use Buscar_cardapio passando o nome da categoria para obter itens, precos e descricoes. NUNCA invente produtos ou precos - sempre consulte.

Taxa de entrega: ${taxaInfo}
Retirada no local: sem taxa.

# FORMAS DE PAGAMENTO ACEITAS
${formas}

Se o cliente escolher PIX online (link de pagamento), use Gerar_Pagamento_PIX apos Registrar_pedido. Senao (pagamento na entrega/balcao), apenas registre.

# FERRAMENTAS DISPONIVEIS
- Buscar_cardapio: consulta itens, precos e disponibilidade por categoria. SEMPRE use antes de citar produto.
- Registrar_pedido: registra o pedido (nome, itens, endereco, forma de pagamento). Use APENAS apos confirmacao.
- Atualizar_pedido: altera pedido ja registrado, somente se ainda nao saiu para entrega.
- Cancelar_pedido: cancela um pedido (somente se nao saiu para entrega).
- Enviar_alerta_cancelamento: APOS cancelar, avise a equipe interna (nome do cliente, itens, motivo).
- Escalar_humano: situacoes de insatisfacao, urgencia, assuntos fora do escopo.
- Reagir_mensagem: reaja com emoji em momentos pontuais da conversa.
- Gerar_Pagamento_PIX: gera link de PIX online apos Registrar_pedido (so se cliente escolher pix online).
- Enviar_Cardapio_Arquivo: envia imagem do produto quando cliente pede.
- Lembrar_Cliente: salva nome/endereco/preferencias quando identificados.

# OBSERVACOES FINAIS
- Nunca invente informacoes. Sempre consulte ferramentas.
- Atualize ou cancele pedidos APENAS enquanto nao sairam para entrega. Em duvida, escale.
- Atendimento humano e natural, sem parecer robotico.${ragContext}`;

return [{
  json: {
    systemMessage,
    userMessage: msg || info.mensagem || '',
    sessionId: `${pizzaria.id}-${info.telefone}`,
    pizzaria_id: pizzaria.id,
    cliente_id: cliente.id,
    telefone: info.telefone,
    instancia: info.instancia,
    has_audio: info.has_audio
  }
}];"""

for n in wf['nodes']:
    if n.get('id') == 'n22':
        if n['parameters'].get('jsCode') != NEW_MONTAR_JS:
            n['parameters']['jsCode'] = NEW_MONTAR_JS
            changes.append('[Montar Contexto n22] Novo prompt profissional padronizado')
        break

# =============================================================
# 2. RENOMEAR Consultar_Cardapio -> Buscar_cardapio
# =============================================================
for n in wf['nodes']:
    if n.get('id') == 'n_consulta':
        if n.get('name') != 'Tool: Buscar_cardapio':
            old_name = n.get('name')
            n['name'] = 'Tool: Buscar_cardapio'
            changes.append(f'[Tool rename] "{old_name}" -> "Tool: Buscar_cardapio"')
            # Atualiza conexoes que referenciam o nome antigo
            conn = wf.get('connections', {})
            if old_name in conn:
                conn['Tool: Buscar_cardapio'] = conn.pop(old_name)
                changes.append(f'[Conexao] chave renomeada: {old_name} -> Tool: Buscar_cardapio')
        # Atualiza descricao
        p = n['parameters']
        new_desc = (
            "Consulta itens, precos e disponibilidade do cardapio por categoria. "
            "USE SEMPRE antes de citar qualquer produto ao cliente. "
            "Parametro: categoria (string) - nome da categoria (ex: Pizzas, Bebidas, Lanches)."
        )
        if p.get('toolDescription') != new_desc:
            p['toolDescription'] = new_desc
            changes.append('[Buscar_cardapio] toolDescription atualizada')
        break

# =============================================================
# 3. ATUALIZAR Atualizar_Obs_Pedido -> Atualizar_pedido (mais geral)
# =============================================================
for n in wf['nodes']:
    if n.get('id') == 'n29':
        if n.get('name') != 'Tool: Atualizar_pedido':
            old_name = n.get('name')
            n['name'] = 'Tool: Atualizar_pedido'
            conn = wf.get('connections', {})
            if old_name in conn:
                conn['Tool: Atualizar_pedido'] = conn.pop(old_name)
            changes.append('[Tool rename] Atualizar_Obs_Pedido -> Atualizar_pedido')

        p = n['parameters']
        new_desc = (
            "Altera um pedido ja registrado, APENAS se ainda nao saiu para entrega. "
            "Use quando o cliente quiser trocar itens, mudar endereco, forma de pagamento ou adicionar observacoes. "
            "Parametros: pedido_id (UUID do pedido), itens (json opcional - array novo de itens), "
            "endereco (string opcional - novo endereco de entrega), "
            "forma_pagamento (string opcional - pix/cartao/dinheiro), "
            "observacoes (string opcional - observacoes adicionais), "
            "valor_total (number opcional - novo valor se mudou itens)."
        )
        new_query = (
            "UPDATE public.pedidos\n"
            "SET\n"
            "  itens = COALESCE($1::jsonb, itens),\n"
            "  endereco_entrega = COALESCE(NULLIF($2,''), endereco_entrega),\n"
            "  forma_pagamento = COALESCE(NULLIF($3,''), forma_pagamento),\n"
            "  observacoes = COALESCE(NULLIF($4,''), observacoes),\n"
            "  valor_total = COALESCE(NULLIF($5::text,'')::numeric, valor_total),\n"
            "  updated_at = NOW()\n"
            "WHERE id = $6::uuid\n"
            "  AND pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid\n"
            "  AND status NOT IN ('saiu_entrega','entregue','cancelado')\n"
            "RETURNING id, numero_pedido, itens, valor_total, endereco_entrega, forma_pagamento, observacoes, status;"
        )
        new_repl = (
            "={{ $fromAI('itens','Array novo de itens [{nome,qtd,preco_unit}] - opcional','json') ? "
            "JSON.stringify($fromAI('itens','','json')) : '' }},"
            "{{ $fromAI('endereco','Novo endereco - opcional','string') }},"
            "{{ $fromAI('forma_pagamento','Nova forma: pix/cartao/dinheiro - opcional','string') }},"
            "{{ $fromAI('observacoes','Observacoes do cliente - opcional','string') }},"
            "{{ $fromAI('valor_total','Novo valor total - opcional','string') }},"
            "{{ $fromAI('pedido_id','UUID do pedido a alterar','string') }}"
        )
        if p.get('toolDescription') != new_desc:
            p['toolDescription'] = new_desc
            changes.append('[Atualizar_pedido] toolDescription atualizada')
        if p.get('query') != new_query:
            p['query'] = new_query
            changes.append('[Atualizar_pedido] query reescrita')
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != new_repl:
            opts['queryReplacement'] = new_repl
            changes.append('[Atualizar_pedido] queryReplacement atualizada')
        break

# =============================================================
# 4. NOVO TOOL: Cancelar_pedido (postgresTool)
# =============================================================
cancel_node_id = 'n_cancel'
cancel_exists = any(n.get('id') == cancel_node_id for n in wf['nodes'])
if not cancel_exists:
    cancel_node = {
        "id": cancel_node_id,
        "name": "Tool: Cancelar_pedido",
        "type": "n8n-nodes-base.postgresTool",
        "typeVersion": 2.5,
        "position": [2240, 480],
        "parameters": {
            "descriptionType": "manual",
            "toolDescription": (
                "Cancela um pedido. APENAS funciona se o pedido ainda nao saiu para entrega. "
                "Apos cancelar com sucesso, OBRIGATORIAMENTE chame Enviar_alerta_cancelamento "
                "passando os detalhes para avisar a equipe interna. "
                "Parametros: pedido_id (UUID do pedido), motivo (string - motivo do cancelamento, ex: 'cliente desistiu')."
            ),
            "operation": "executeQuery",
            "query": (
                "UPDATE public.pedidos\n"
                "SET status = 'cancelado',\n"
                "    cancelado_at = NOW(),\n"
                "    cancelamento_motivo = $1,\n"
                "    updated_at = NOW()\n"
                "WHERE id = $2::uuid\n"
                "  AND pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid\n"
                "  AND status NOT IN ('saiu_entrega','entregue','cancelado')\n"
                "RETURNING id, numero_pedido, itens, valor_total, endereco_entrega;"
            ),
            "options": {
                "queryReplacement": (
                    "={{ $fromAI('motivo','Motivo do cancelamento informado pelo cliente','string') }},"
                    "{{ $fromAI('pedido_id','UUID do pedido a cancelar','string') }}"
                )
            }
        },
        "credentials": {
            "postgres": {
                "id": "3gxY8xTADs50F07C",
                "name": "Postgres pizzabot"
            }
        }
    }
    wf['nodes'].append(cancel_node)
    changes.append('[Tool: Cancelar_pedido] criado')

# =============================================================
# 5. NOVO TOOL: Enviar_alerta_cancelamento (toolHttpRequest)
# =============================================================
alert_node_id = 'n_alert'
alert_exists = any(n.get('id') == alert_node_id for n in wf['nodes'])
if not alert_exists:
    alert_node = {
        "id": alert_node_id,
        "name": "Tool: Enviar_alerta_cancelamento",
        "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
        "typeVersion": 1.1,
        "position": [2400, 480],
        "parameters": {
            "toolDescription": (
                "Envia alerta para a equipe interna (telefone admin da pizzaria) avisando sobre cancelamento de pedido. "
                "Use SEMPRE depois de Cancelar_pedido. "
                "Parametros: numero_pedido (number), nome_cliente (string), itens_resumo (string - breve resumo dos itens), "
                "motivo (string)."
            ),
            "method": "POST",
            "url": "=http://evolution.secretariaai.eu.cc/message/sendText/{{ $('Montar Contexto').item.json.instancia }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "lSAG0e6P4B12JAgS00MIpJsDzYIRd80Q"}
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={\n"
                '  "number": "{{ $(\'Carregar Pizzaria\').item.json.telefone_admin }}",\n'
                '  "text": "[CANCELAMENTO]\\n\\nPedido #{{ $fromAI(\'numero_pedido\',\'Numero do pedido\',\'number\') }} '
                'cancelado.\\nCliente: {{ $fromAI(\'nome_cliente\',\'Nome do cliente\',\'string\') }}'
                '\\nItens: {{ $fromAI(\'itens_resumo\',\'Resumo dos itens\',\'string\') }}'
                '\\nMotivo: {{ $fromAI(\'motivo\',\'Motivo informado\',\'string\') }}'
                '\\nHorario: {{ $now.toFormat(\'HH:mm dd/MM/yyyy\') }}"\n'
                "}"
            ),
            "options": {"timeout": 8000}
        }
    }
    wf['nodes'].append(alert_node)
    changes.append('[Tool: Enviar_alerta_cancelamento] criado')

# =============================================================
# 6. NOVO TOOL: Reagir_mensagem (toolHttpRequest controlado pela IA)
# =============================================================
react_tool_id = 'n_react_tool'
react_tool_exists = any(n.get('id') == react_tool_id for n in wf['nodes'])
if not react_tool_exists:
    react_tool = {
        "id": react_tool_id,
        "name": "Tool: Reagir_mensagem",
        "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
        "typeVersion": 1.1,
        "position": [2560, 480],
        "parameters": {
            "toolDescription": (
                "Reage com um emoji a ULTIMA mensagem do cliente. Use em momentos oportunos: "
                "cliente agradece -> coracao; pedido registrado com sucesso -> check verde; "
                "cliente confirma -> joinha. Use com moderacao, so quando natural. "
                "Parametro: emoji (string - o emoji em si, ex: '❤️' '✅' '👍')."
            ),
            "method": "POST",
            "url": "=http://evolution.secretariaai.eu.cc/message/sendReaction/{{ $('Montar Contexto').item.json.instancia }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "lSAG0e6P4B12JAgS00MIpJsDzYIRd80Q"}
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={\n"
                '  "key": {\n'
                '    "remoteJid": "{{ $(\'Info\').first().json.remoteJid }}",\n'
                '    "fromMe": false,\n'
                '    "id": "{{ $(\'Info\').first().json.id_mensagem }}"\n'
                "  },\n"
                '  "reaction": "{{ $fromAI(\'emoji\',\'Emoji para reagir (ex: \\u2764\\ufe0f, \\u2705, \\ud83d\\udc4d)\',\'string\') }}"\n'
                "}"
            ),
            "options": {"timeout": 8000}
        }
    }
    wf['nodes'].append(react_tool)
    changes.append('[Tool: Reagir_mensagem] criado (IA-controlled)')

# =============================================================
# 7. CONECTAR NOVOS TOOLS AO Secretaria (ai_tool)
# =============================================================
conn = wf.setdefault('connections', {})
for tool_name in ['Tool: Cancelar_pedido', 'Tool: Enviar_alerta_cancelamento', 'Tool: Reagir_mensagem']:
    tool_conn = conn.setdefault(tool_name, {})
    ai_outs = tool_conn.setdefault('ai_tool', [[]])
    already = any(c.get('node') == 'Secretaria' for lst in ai_outs for c in lst)
    if not already:
        if ai_outs and len(ai_outs) > 0:
            ai_outs[0].append({"node":"Secretaria","type":"ai_tool","index":0})
        else:
            ai_outs[:] = [[{"node":"Secretaria","type":"ai_tool","index":0}]]
        changes.append(f'[Conexao] {tool_name} -> Secretaria (ai_tool)')

# =============================================================
# 8. REMOVE no automatico 'Reagir mensagem' (substituido pela tool)
#    e remove da lista de outputs do 'Marcar como lida'
# =============================================================
react_auto_idx = next((i for i,n in enumerate(wf['nodes']) if n.get('id') == 'n_react'), None)
if react_auto_idx is not None:
    wf['nodes'].pop(react_auto_idx)
    changes.append('[Reagir mensagem n_react] no automatico removido (substituido pela tool IA)')

# Remove referencia em connections
if 'Marcar como lida' in conn:
    outs = conn['Marcar como lida'].get('main', [])
    for lst in outs:
        for i in range(len(lst) - 1, -1, -1):
            if lst[i].get('node') == 'Reagir mensagem':
                lst.pop(i)
                changes.append('[Conexao] Marcar como lida -X Reagir mensagem removida')

# Remove o proprio bloco de conexoes do Reagir mensagem se houver
if 'Reagir mensagem' in conn:
    del conn['Reagir mensagem']

# =============================================================
# PUSH
# =============================================================
print('Mudancas:' if changes else 'Nada mudou.')
for c in changes: print(f'  - {c}')

if not changes:
    sys.exit(0)

payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ALLOWED}
}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        print(f'\nOK active={result.get("active")} nodes={len(result["nodes"])}')
        # Lista tools conectados
        print('\nTools conectados ao Secretaria:')
        for src, conns in result.get('connections', {}).items():
            for ctype, branches in conns.items():
                if ctype == 'ai_tool':
                    for b in branches:
                        for c in b:
                            if c.get('node') == 'Secretaria':
                                print(f'  - {src}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:1000]}')
