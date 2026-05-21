import json
import os
import urllib.error
import urllib.request

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    raw = resp.read()

# Fix encoding of node names with accented chars stored as '?'
fixed = raw.replace(b'Secret?ria', b'Secretaria').replace(b'Secret\xc3\xa1ria', b'Secretaria')
wf = json.loads(fixed)

for n in wf['nodes']:
    if n['id'] == 'n27':
        old_body = n['parameters'].get('jsonBody', '')
        print('OLD jsonBody:')
        print(old_body)
        print()

        # Fix: replace single-brace $fromAI with double-brace version
        # {$fromAI('pedido_id', ...)} -> {{ $fromAI('pedido_id', ...) }}
        new_body = (
            '={\n'
            '  "pedido_id": "{{ $fromAI(\'pedido_id\', \'UUID do pedido criado\', \'string\') }}",\n'
            '  "pizzaria_id": "{{ $(\'Montar Contexto\').item.json.pizzaria_id }}",\n'
            '  "telefone": "{{ $(\'Montar Contexto\').item.json.telefone }}",\n'
            '  "instancia": "{{ $(\'Montar Contexto\').item.json.instancia }}"\n'
            '}'
        )
        n['parameters']['jsonBody'] = new_body
        print('NEW jsonBody:')
        print(new_body)
        break

allowed_settings = ['executionOrder', 'saveManualExecutions', 'callerPolicy', 'errorWorkflow', 'timezone']
payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in allowed_settings}
}
data = json.dumps(payload).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        print(f'\nOK! active={result.get("active")}')
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
