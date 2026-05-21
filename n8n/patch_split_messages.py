import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

# --------------------------------------------------------------------------
# JS code for the split node
# --------------------------------------------------------------------------
split_code = (
    "const texto = ($input.first().json.text || '').trim();\n"
    "\n"
    "// 1) divide em parágrafos (double newline) — forma mais natural no WhatsApp\n"
    "let partes = texto.split(/\\n\\n+/).map(p => p.trim()).filter(p => p.length > 0);\n"
    "\n"
    "// 2) se bloco único muito longo, agrupa frases de 2 em 2\n"
    "if (partes.length === 1 && partes[0].length > 280) {\n"
    "  const frases = partes[0].match(/[^.!?]+[.!?]+\\s*/g);\n"
    "  if (frases && frases.length > 1) {\n"
    "    const agrupadas = [];\n"
    "    for (let i = 0; i < frases.length; i += 2) {\n"
    "      agrupadas.push((frases[i] + (frases[i+1] || '')).trim());\n"
    "    }\n"
    "    partes = agrupadas.filter(p => p.length > 0);\n"
    "  }\n"
    "}\n"
    "\n"
    "const instancia = $('Info').first().json.instancia;\n"
    "const telefone  = $('Info').first().json.telefone;\n"
    "\n"
    "// delay proporcional: ~55ms/char, min 0.8s, max 5s\n"
    "return partes.map((parte, i) => ({\n"
    "  json: {\n"
    "    texto: parte,\n"
    "    delay_s: Math.round(Math.min(Math.max(parte.length * 0.055, 0.8), 5) * 10) / 10,\n"
    "    indice: i + 1,\n"
    "    total: partes.length,\n"
    "    instancia,\n"
    "    telefone,\n"
    "  }\n"
    "}));"
)

composing_body = json.dumps({
    "instancia": "={{ $json.instancia }}",
    "telefone":  "={{ $json.telefone }}",
    "status":    "composing"
})

new_nodes = [
    {
        "id": "n_split",
        "name": "Dividir resposta em partes",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2640, 260],
        "parameters": {"jsCode": split_code}
    },
    {
        "id": "n_comp2",
        "name": "Composing por parte",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [2840, 260],
        "continueOnFail": True,
        "parameters": {
            "method": "POST",
            "url": "https://n8nai.secretariaai.eu.cc/webhook/e56e25c6-d00e-40aa-83b6-4985aea910f1",
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": composing_body,
            "options": {"batching": {"batch": {"batchSize": 1, "batchInterval": 0}}}
        }
    },
    {
        "id": "n_wait2",
        "name": "Pausa natural (digitando)",
        "type": "n8n-nodes-base.wait",
        "typeVersion": 1.1,
        "position": [3040, 260],
        "webhookId": "wait-typing-natural-01",
        "parameters": {
            "amount": "={{ $('Dividir resposta em partes').item.json.delay_s }}",
            "unit": "seconds"
        }
    },
    {
        "id": "n_sendp",
        "name": "Enviar parte WhatsApp",
        "type": "n8n-nodes-evolution-api.evolutionApi",
        "typeVersion": 1,
        "position": [3240, 260],
        "credentials": {"evolutionApi": {"id": "OfPUfZENlrzqKq0v", "name": "Evolution API"}},
        "parameters": {
            "resource": "messages-api",
            "operation": "send-text",
            "instanceName": "={{ $('Dividir resposta em partes').item.json.instancia }}",
            "remoteJid":    "={{ $('Dividir resposta em partes').item.json.telefone }}",
            "messageText":  "={{ $('Dividir resposta em partes').item.json.texto }}",
            "options_message": {}
        }
    },
    {
        "id": "n_pause",
        "name": "Parar de digitar",
        "type": "n8n-nodes-evolution-api.evolutionApi",
        "typeVersion": 1,
        "position": [3440, 260],
        "continueOnFail": True,
        "executeOnce": True,
        "credentials": {"evolutionApi": {"id": "OfPUfZENlrzqKq0v", "name": "Evolution API"}},
        "parameters": {
            "resource": "chat-api",
            "operation": "send-presence",
            "instanceName": "={{ $('Info').first().json.instancia }}",
            "remoteJid":    "={{ $('Info').first().json.telefone }}",
            "presence": "paused",
            "delay": 0
        }
    }
]

# Skip if already patched
existing_ids = {n['id'] for n in wf['nodes']}
for n in new_nodes:
    if n['id'] not in existing_ids:
        wf['nodes'].append(n)

# --------------------------------------------------------------------------
# Rewire connections
# Before: Formatar texto WhatsApp -> Enviar texto WhatsApp -> Salvar Resposta no DB
# After:  Formatar texto WhatsApp -> Dividir -> Composing -> Pausa -> Enviar parte -> Parar -> Salvar
# --------------------------------------------------------------------------
conns = wf['connections']

# Capture existing downstream of "Enviar texto WhatsApp" (Salvar Resposta no DB)
old_downstream = conns.get('Enviar texto WhatsApp', {}).get('main', [[]])[0]

# Rewire entry point
conns['Formatar texto WhatsApp']['main'][0] = [
    {'node': 'Dividir resposta em partes', 'type': 'main', 'index': 0}
]

# New chain
conns['Dividir resposta em partes'] = {'main': [[{'node': 'Composing por parte', 'type': 'main', 'index': 0}]]}
conns['Composing por parte']        = {'main': [[{'node': 'Pausa natural (digitando)', 'type': 'main', 'index': 0}]]}
conns['Pausa natural (digitando)']  = {'main': [[{'node': 'Enviar parte WhatsApp', 'type': 'main', 'index': 0}]]}
conns['Enviar parte WhatsApp']      = {'main': [[{'node': 'Parar de digitar', 'type': 'main', 'index': 0}]]}
conns['Parar de digitar']           = {'main': [old_downstream]}

# Disconnect old sender
if 'Enviar texto WhatsApp' in conns:
    del conns['Enviar texto WhatsApp']

# --------------------------------------------------------------------------
# Push to n8n
# --------------------------------------------------------------------------
allowed_settings = ['executionOrder', 'saveManualExecutions', 'callerPolicy', 'errorWorkflow', 'timezone']
payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': conns,
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in allowed_settings}
}
data = json.dumps(payload).encode()
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        added = [n['name'] for n in result['nodes'] if n.get('id') in ['n_split','n_comp2','n_wait2','n_sendp','n_pause']]
        print(f'OK! active={result.get("active")} | new nodes: {added}')
        c = result['connections']
        print('Formatar texto ->', c.get('Formatar texto WhatsApp',{}).get('main',[[]])[0])
        print('Dividir       ->', c.get('Dividir resposta em partes',{}).get('main',[[]])[0])
        print('Composing     ->', c.get('Composing por parte',{}).get('main',[[]])[0])
        print('Pausa         ->', c.get('Pausa natural (digitando)',{}).get('main',[[]])[0])
        print('Enviar parte  ->', c.get('Enviar parte WhatsApp',{}).get('main',[[]])[0])
        print('Parar         ->', c.get('Parar de digitar',{}).get('main',[[]])[0])
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
