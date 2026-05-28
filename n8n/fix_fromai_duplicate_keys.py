"""
Corrige erro 'Duplicate key X found with different description or type'.

CAUSA: O n8n exige que TODA chave $fromAI() usada em qualquer tool conectado
ao mesmo agente tenha descricao + tipo identicos em TODOS os tools.

Os tools novos (Atualizar_pedido, Cancelar_pedido, Enviar_alerta_cancelamento)
reusavam chaves como 'itens', 'valor_total', 'forma_pagamento', 'observacoes',
'motivo' com descricoes diferentes do Registrar_Pedido.

FIX: renomeia chaves duplicadas para nomes unicos:
- Atualizar_pedido: novos_itens, novo_endereco, nova_forma_pagamento,
  novas_observacoes, novo_valor_total, pedido_id_alterar
- Cancelar_pedido: pedido_id_cancelar, motivo_cancelamento
- Enviar_alerta_cancelamento: alerta_numero_pedido, alerta_nome_cliente,
  alerta_itens_resumo, alerta_motivo
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'
url     = f'https://n8nai.secretariaai.eu.cc/api/v1/workflows/{WF_ID}'
ALLOWED = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

# =============================================================
# Atualizar_pedido (n29) - todas as chaves com prefixo "novo_"
# =============================================================
NEW_DESC_UPD = (
    "Altera um pedido ja registrado, APENAS se ainda nao saiu para entrega. "
    "Use quando o cliente quiser trocar itens, mudar endereco, forma de pagamento ou adicionar observacoes. "
    "Parametros: pedido_id_alterar (UUID do pedido), "
    "novos_itens (json opcional - array novo de itens), "
    "novo_endereco (string opcional - novo endereco de entrega), "
    "nova_forma_pagamento (string opcional - pix/cartao/dinheiro), "
    "novas_observacoes (string opcional - observacoes adicionais), "
    "novo_valor_total (number opcional - novo valor se mudou itens)."
)

NEW_QUERY_UPD = (
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

NEW_REPL_UPD = (
    "={{ $fromAI('novos_itens','Array novo de itens [{nome,qtd,preco_unit}] - opcional, vazio mantem original','json') ? "
    "JSON.stringify($fromAI('novos_itens','Array novo de itens [{nome,qtd,preco_unit}] - opcional, vazio mantem original','json')) : '' }},"
    "{{ $fromAI('novo_endereco','Novo endereco de entrega - opcional','string') }},"
    "{{ $fromAI('nova_forma_pagamento','Nova forma de pagamento (pix/cartao/dinheiro) - opcional','string') }},"
    "{{ $fromAI('novas_observacoes','Novas observacoes do cliente - opcional','string') }},"
    "{{ $fromAI('novo_valor_total','Novo valor total em R$ - opcional','string') }},"
    "{{ $fromAI('pedido_id_alterar','UUID do pedido que sera alterado','string') }}"
)

for n in wf['nodes']:
    if n.get('id') == 'n29':
        p = n['parameters']
        if p.get('toolDescription') != NEW_DESC_UPD:
            p['toolDescription'] = NEW_DESC_UPD
            changes.append('[Atualizar_pedido] toolDescription atualizada (chaves unicas)')
        if p.get('query') != NEW_QUERY_UPD:
            p['query'] = NEW_QUERY_UPD
            changes.append('[Atualizar_pedido] query mantida')
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != NEW_REPL_UPD:
            opts['queryReplacement'] = NEW_REPL_UPD
            changes.append('[Atualizar_pedido] queryReplacement com chaves novos_*/pedido_id_alterar')
        break

# =============================================================
# Cancelar_pedido (n_cancel) - chaves prefixadas cancelar_*
# =============================================================
NEW_DESC_CANCEL = (
    "Cancela um pedido. APENAS funciona se o pedido ainda nao saiu para entrega. "
    "Apos cancelar com sucesso, OBRIGATORIAMENTE chame Enviar_alerta_cancelamento. "
    "Parametros: pedido_id_cancelar (UUID do pedido), "
    "motivo_cancelamento (string - motivo do cancelamento informado pelo cliente)."
)

NEW_REPL_CANCEL = (
    "={{ $fromAI('motivo_cancelamento','Motivo do cancelamento informado pelo cliente','string') }},"
    "{{ $fromAI('pedido_id_cancelar','UUID do pedido que sera cancelado','string') }}"
)

for n in wf['nodes']:
    if n.get('id') == 'n_cancel':
        p = n['parameters']
        if p.get('toolDescription') != NEW_DESC_CANCEL:
            p['toolDescription'] = NEW_DESC_CANCEL
            changes.append('[Cancelar_pedido] toolDescription atualizada')
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != NEW_REPL_CANCEL:
            opts['queryReplacement'] = NEW_REPL_CANCEL
            changes.append('[Cancelar_pedido] queryReplacement com chaves prefixadas')
        break

# =============================================================
# Enviar_alerta_cancelamento (n_alert) - prefixo alerta_*
# =============================================================
NEW_DESC_ALERT = (
    "Envia alerta no WhatsApp da equipe interna (telefone admin da pizzaria) avisando "
    "sobre cancelamento de pedido. Use SEMPRE depois de Cancelar_pedido. "
    "Parametros: alerta_numero_pedido (number), alerta_nome_cliente (string), "
    "alerta_itens_resumo (string - resumo breve dos itens cancelados), "
    "alerta_motivo (string - motivo do cancelamento)."
)

NEW_BODY_ALERT = (
    "={\n"
    '  "number": "{{ $(\'Carregar Pizzaria\').item.json.telefone_admin }}",\n'
    '  "text": "[CANCELAMENTO]\\n\\nPedido #{{ $fromAI(\'alerta_numero_pedido\',\'Numero do pedido cancelado\',\'number\') }} cancelado.'
    '\\nCliente: {{ $fromAI(\'alerta_nome_cliente\',\'Nome do cliente\',\'string\') }}'
    '\\nItens: {{ $fromAI(\'alerta_itens_resumo\',\'Resumo breve dos itens cancelados\',\'string\') }}'
    '\\nMotivo: {{ $fromAI(\'alerta_motivo\',\'Motivo do cancelamento informado\',\'string\') }}'
    '\\nHorario: {{ $now.toFormat(\'HH:mm dd/MM/yyyy\') }}"\n'
    "}"
)

for n in wf['nodes']:
    if n.get('id') == 'n_alert':
        p = n['parameters']
        if p.get('toolDescription') != NEW_DESC_ALERT:
            p['toolDescription'] = NEW_DESC_ALERT
            changes.append('[Enviar_alerta_cancelamento] toolDescription atualizada')
        if p.get('jsonBody') != NEW_BODY_ALERT:
            p['jsonBody'] = NEW_BODY_ALERT
            changes.append('[Enviar_alerta_cancelamento] body com chaves alerta_*')
        break

# =============================================================
# Reagir_mensagem (n_react_tool) - chave unica emoji_reacao
# =============================================================
NEW_DESC_REACT = (
    "Reage com um emoji a ULTIMA mensagem recebida do cliente. Use em momentos oportunos: "
    "cliente agradece -> coracao; pedido registrado com sucesso -> check verde; "
    "cliente confirma algo -> joinha. Use com moderacao, so quando for natural. "
    "Parametro: emoji_reacao (string - o emoji em si, ex: '❤️', '✅', '👍')."
)

NEW_BODY_REACT = (
    "={\n"
    '  "key": {\n'
    '    "remoteJid": "{{ $(\'Info\').first().json.remoteJid }}",\n'
    '    "fromMe": false,\n'
    '    "id": "{{ $(\'Info\').first().json.id_mensagem }}"\n'
    "  },\n"
    '  "reaction": "{{ $fromAI(\'emoji_reacao\',\'Emoji para reagir a mensagem (ex: ❤️, ✅, 👍)\',\'string\') }}"\n'
    "}"
)

for n in wf['nodes']:
    if n.get('id') == 'n_react_tool':
        p = n['parameters']
        if p.get('toolDescription') != NEW_DESC_REACT:
            p['toolDescription'] = NEW_DESC_REACT
            changes.append('[Reagir_mensagem] toolDescription atualizada')
        if p.get('jsonBody') != NEW_BODY_REACT:
            p['jsonBody'] = NEW_BODY_REACT
            changes.append('[Reagir_mensagem] body com chave emoji_reacao')
        break

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
        print(f'\nOK active={result.get("active")}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
