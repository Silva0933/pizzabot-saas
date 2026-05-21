"""
Corrige '400 - instance requires property "text"' no 'Enviar parte WhatsApp'.

Mesmo padrao do fix anterior: o no 'Composing por parte' eh HTTP, entao seu
output substitui o $json (response body) — o campo 'texto' que veio de
'Dividir resposta em partes' tambem desaparece, nao so 'instancia'/'telefone'.

Fix: messageText agora le diretamente de $('Dividir resposta em partes').item.json.texto
(pairedItem mantem a correspondencia por iteracao).

Reforco: garantir typeVersion=1 e operation=send-text caso a API tenha mudado.
"""
import os, json
import urllib.request, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

for n in wf['nodes']:
    if n.get('id') == 'n_sendp':
        p = n.get('parameters', {})
        before = json.dumps(p, ensure_ascii=False)

        p['resource'] = 'messages-api'
        p['operation'] = 'send-text'
        p['instanceName'] = "={{ $('Info').first().json.instancia }}"
        p['remoteJid']    = "={{ $('Info').first().json.telefone }}"
        p['messageText']  = "={{ $('Dividir resposta em partes').item.json.texto }}"
        if 'options_message' not in p:
            p['options_message'] = {}

        n['parameters'] = p
        if json.dumps(p, ensure_ascii=False) != before:
            changes.append("  [Enviar parte WhatsApp] messageText agora le de $('Dividir resposta em partes').item.json.texto")

if not changes:
    print('Nada mudou.')
else:
    print('Mudancas:')
    for c in changes:
        print(c)

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
        for n in result['nodes']:
            if n.get('id') == 'n_sendp':
                print('\n--- Enviar parte WhatsApp ---')
                print(json.dumps(n.get('parameters'), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
