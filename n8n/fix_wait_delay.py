import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    raw = resp.read()

fixed = raw.replace(b'Secret?ria', b'Secretaria').replace(b'Secret\xc3\xa1ria', b'Secretaria')
wf = json.loads(fixed)

# Correct amount expression with fallback of 3 seconds
AMOUNT_EXPR = "={{ ($('Dividir resposta em partes').item?.json?.delay_s) || 3 }}"

for n in wf['nodes']:
    if n['id'] == 'n_wait2':
        n['parameters']['resume'] = 'timeInterval'
        n['parameters']['unit']   = 'seconds'
        n['parameters']['amount'] = AMOUNT_EXPR
        print('Wait node params:', json.dumps(n['parameters'], ensure_ascii=False))
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
        for n in result['nodes']:
            if n['id'] == 'n_wait2':
                print('Saved:', json.dumps(n['parameters'], ensure_ascii=False))
        print('OK! active=', result.get('active'))
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:400]}')
