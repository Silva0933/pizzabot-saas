import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    raw = resp.read()

fixed = raw.replace(b'Secret?ria', b'Secretaria').replace(b'Secret\xc3\xa1ria', b'Secretaria')
wf = json.loads(fixed)

for n in wf['nodes']:
    if n['id'] == 'n27':
        old_desc = n['parameters'].get('toolDescription', '')
        print('OLD desc:', old_desc[:100])

        new_desc = (
            "Gera link de pagamento PIX/cartao para um pedido ja registrado. "
            "Recebe pedido_id (UUID retornado por Registrar_Pedido). "
            "A resposta contem: ok (boolean), paymentLink (string), paymentId (string), error (string). "
            "Se ok=true: envie SOMENTE o paymentLink recebido como link de pagamento — NUNCA invente ou modifique o link. "
            "Se ok=false ou paymentLink vazio: informe ao cliente que o pagamento automatico nao esta disponivel no momento "
            "e peca para combinar o pagamento diretamente com a pizzaria."
        )
        n['parameters']['toolDescription'] = new_desc
        print('NEW desc:', new_desc[:120])
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
        print(f'OK! active={result.get("active")}')
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:400]}')
