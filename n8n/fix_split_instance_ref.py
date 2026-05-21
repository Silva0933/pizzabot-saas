"""
Corrige o bug 'The "undefined" instance does not exist'.

Causa raiz: o no 'Composing por parte' eh um HTTP request — seu output eh a
resposta HTTP (sem os campos instancia/telefone). O Wait subsequente apenas
propaga esse output. Quando chega em 'Enviar parte WhatsApp', $json.instancia
e $json.telefone estao undefined.

Fix: nos nos que ENVIAM via Evolution API ('Enviar parte WhatsApp' e
'Composing por parte'), referenciar diretamente o no 'Info' (fonte da verdade)
em vez de $json.

Adicional: garantir que 'operation' esteja setado em 'Enviar parte WhatsApp'.
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
    nid = n.get('id')
    name = n.get('name')
    p = n.get('parameters', {})

    if nid == 'n_sendp':
        # Enviar parte WhatsApp — Evolution API send-text
        before = json.dumps(p, ensure_ascii=False)
        p['resource'] = 'messages-api'
        p['operation'] = 'send-text'
        p['instanceName'] = "={{ $('Info').first().json.instancia }}"
        p['remoteJid']    = "={{ $('Info').first().json.telefone }}"
        # texto eh per-iteracao, mantem $json
        p['messageText']  = "={{ $json.texto }}"
        if 'options_message' not in p:
            p['options_message'] = {}
        n['parameters'] = p
        if json.dumps(p, ensure_ascii=False) != before:
            changes.append(f"  [{name}] resource/operation/instanceName/remoteJid sanitizados")

    elif nid == 'n_comp2':
        # Composing por parte — HTTP request
        body = (
            '={\n'
            '  "instancia": "{{ $(\'Info\').first().json.instancia }}",\n'
            '  "telefone": "{{ $(\'Info\').first().json.telefone }}",\n'
            '  "status": "composing"\n'
            '}'
        )
        if p.get('jsonBody') != body:
            p['jsonBody'] = body
            changes.append(f"  [{name}] jsonBody agora usa $('Info').first().json.*")

if not changes:
    print('Nada mudou — nodes ja estao corretos.')
else:
    print('Mudancas a aplicar:')
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
        print(f'\nOK! workflow atualizado. active={result.get("active")}')
        # Verifica os nodes corrigidos
        for n in result['nodes']:
            if n.get('id') in ('n_sendp', 'n_comp2'):
                print(f"\n--- {n['name']} ---")
                print(json.dumps(n.get('parameters'), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
