"""
Adiciona header X-Idempotency-Key ao node p07_mp (obrigatório pelo MP).
Usa o ID do pedido como chave única para evitar duplicatas.
"""
import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/7kSCqNiuuW511XuL'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

for n in wf['nodes']:
    if n['id'] == 'p07_mp':
        params = n['parameters']

        # Add X-Idempotency-Key to headers
        current_headers = params.get('headerParameters', {}).get('parameters', [])

        # Remove existing idempotency key if any
        current_headers = [h for h in current_headers if h.get('name') != 'X-Idempotency-Key']

        # Add it using order UUID as unique key
        current_headers.append({
            "name": "X-Idempotency-Key",
            "value": "={{ $json.id }}"
        })

        params['headerParameters'] = {'parameters': current_headers}
        params['sendHeaders'] = True

        print('p07_mp headers now:')
        for h in current_headers:
            print(f'  {h["name"]}: {h["value"][:60]}')
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
