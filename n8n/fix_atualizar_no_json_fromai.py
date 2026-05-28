"""
Corrige erro Gemini 'key cannot be empty' em function_declarations.

CAUSA: Atualizar_pedido tinha $fromAI('novos_itens',...,'json') chamado
DUAS vezes em uma ternaria. O n8n gerava duas declaracoes pra mesma key
e o Gemini reclamava de key vazia.

FIX: remove o parametro 'novos_itens' da Atualizar_pedido.
Se o cliente quiser trocar itens, o bot deve Cancelar_pedido e registrar
um novo. Atualizar_pedido fica responsavel apenas por:
- endereco
- forma de pagamento
- observacoes
- valor total
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

NEW_DESC = (
    "Altera dados de um pedido ja registrado, APENAS se ainda nao saiu para entrega. "
    "Use quando o cliente quiser alterar endereco, forma de pagamento, observacoes ou valor. "
    "Para trocar itens, prefira Cancelar_pedido e fazer um novo Registrar_Pedido. "
    "Parametros: pedido_id_alterar (UUID do pedido), "
    "novo_endereco (string opcional), nova_forma_pagamento (string opcional - pix/cartao/dinheiro), "
    "novas_observacoes (string opcional), novo_valor_total (number opcional)."
)

NEW_QUERY = (
    "UPDATE public.pedidos\n"
    "SET\n"
    "  endereco_entrega = COALESCE(NULLIF($1,''), endereco_entrega),\n"
    "  forma_pagamento = COALESCE(NULLIF($2,''), forma_pagamento),\n"
    "  observacoes = COALESCE(NULLIF($3,''), observacoes),\n"
    "  valor_total = COALESCE(NULLIF($4::text,'')::numeric, valor_total),\n"
    "  updated_at = NOW()\n"
    "WHERE id = $5::uuid\n"
    "  AND pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid\n"
    "  AND status NOT IN ('saiu_entrega','entregue','cancelado')\n"
    "RETURNING id, numero_pedido, itens, valor_total, endereco_entrega, forma_pagamento, observacoes, status;"
)

NEW_REPL = (
    "={{ $fromAI('novo_endereco','Novo endereco de entrega - opcional','string') }},"
    "{{ $fromAI('nova_forma_pagamento','Nova forma de pagamento (pix/cartao/dinheiro) - opcional','string') }},"
    "{{ $fromAI('novas_observacoes','Novas observacoes do cliente - opcional','string') }},"
    "{{ $fromAI('novo_valor_total','Novo valor total em R$ - opcional','string') }},"
    "{{ $fromAI('pedido_id_alterar','UUID do pedido que sera alterado','string') }}"
)

for n in wf['nodes']:
    if n.get('id') == 'n29':
        p = n['parameters']
        if p.get('toolDescription') != NEW_DESC:
            p['toolDescription'] = NEW_DESC
            changes.append('[Atualizar_pedido] toolDescription sem itens')
        if p.get('query') != NEW_QUERY:
            p['query'] = NEW_QUERY
            changes.append('[Atualizar_pedido] query sem update de itens')
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != NEW_REPL:
            opts['queryReplacement'] = NEW_REPL
            changes.append('[Atualizar_pedido] queryReplacement sem $fromAI(json) duplicado')
        break

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
        print(f'\nOK active={json.loads(resp.read()).get("active")}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:500]}')
