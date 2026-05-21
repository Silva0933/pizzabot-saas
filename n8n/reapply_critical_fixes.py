"""
Reaplica fixes criticos que reverteram (provavelmente por edicao manual no n8n UI):
1. Enfileirar mensagem (n14): SQL com replace %2C + ON CONFLICT
2. Reagir mensagem (n_react): node de emoji + conexao paralela
3. Verifica Memory contextWindowLength
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

# 1. Enfileirar mensagem (n14) - SQL fix
NEW_QUERY = (
    "INSERT INTO public.n8n_fila_mensagens (instancia, telefone, id_mensagem, timestamp, mensagem)\n"
    "VALUES ($1, $2, $3, to_timestamp($4::float), replace($5, '%2C', ','))\n"
    "ON CONFLICT (id_mensagem) DO NOTHING;"
)
NEW_REPL = (
    "={{ $('Info').item.json.instancia }},"
    "{{ $('Info').item.json.telefone }},"
    "{{ $('Info').item.json.id_mensagem }},"
    "{{ $('Info').item.json.timestamp }},"
    "{{ ($json.mensagem || $('Info').item.json.mensagem || '').replace(/,/g, '%2C') }}"
)
for n in wf['nodes']:
    if n.get('id') == 'n14':
        p = n['parameters']
        opts = p.setdefault('options', {})
        if p.get('query') != NEW_QUERY:
            p['query'] = NEW_QUERY
            changes.append('[Enfileirar mensagem] SQL fix reaplicado (%2C replace)')
        if opts.get('queryReplacement') != NEW_REPL:
            opts['queryReplacement'] = NEW_REPL
            changes.append('[Enfileirar mensagem] queryReplacement reaplicado')
        if not n.get('continueOnFail'):
            n['continueOnFail'] = True
        break

# 2. Reagir mensagem (n_react) - re-criar se nao existir
react_exists = any(n.get('id') == 'n_react' for n in wf['nodes'])
if not react_exists:
    react_node = {
        "id": "n_react",
        "name": "Reagir mensagem",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [-1008, 220],
        "continueOnFail": True,
        "parameters": {
            "method": "POST",
            "url": "=http://evolution.secretariaai.eu.cc/message/sendReaction/{{ $('Info').first().json.instancia }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "lSAG0e6P4B12JAgS00MIpJsDzYIRd80Q"}
                ]
            },
            "sendBody": True,
            "contentType": "json",
            "jsonBody": "={\n  \"key\": {\n    \"remoteJid\": \"{{ $('Info').first().json.remoteJid }}\",\n    \"fromMe\": false,\n    \"id\": \"{{ $('Info').first().json.id_mensagem }}\"\n  },\n  \"reaction\": \"❤️\"\n}",
            "options": {"timeout": 8000}
        }
    }
    wf['nodes'].append(react_node)
    changes.append('[Reagir mensagem n_react] recriado')

# 3. Conexao: Marcar como lida -> Reagir mensagem
conn = wf.setdefault('connections', {})
marcar = conn.setdefault('Marcar como lida', {})
outs = marcar.setdefault('main', [[]])
if not any(c.get('node') == 'Reagir mensagem' for lst in outs for c in lst):
    if outs and outs[0]:
        outs[0].append({"node":"Reagir mensagem","type":"main","index":0})
    else:
        outs[:] = [[{"node":"Reagir mensagem","type":"main","index":0}]]
    changes.append('[Conexao] Marcar como lida -> Reagir mensagem reativada')

# 4. Memory contextWindowLength (garantir que esta em 8)
for n in wf['nodes']:
    if n.get('id') == 'n25':
        if n['parameters'].get('contextWindowLength', 30) != 8:
            n['parameters']['contextWindowLength'] = 8
            changes.append('[Memory n25] contextWindowLength garantido em 8')
        break

print('Mudancas:' if changes else 'Nada mudou.')
for c in changes: print(f'  - {c}')

if not changes:
    print('\n(workflow ja esta correto)')
    sys.exit(0)

payload = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in wf.get('settings',{}).items() if k in ALLOWED}}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(put_req) as r:
        result = json.loads(r.read())
        print(f'\nOK active={result.get("active")} nodes={len(result["nodes"])}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:500]}')
