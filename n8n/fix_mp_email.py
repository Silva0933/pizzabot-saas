"""
Corrige o email do pagador no node p07_mp do workflow de pagamento.
MP rejeita domínios .local — troca para @gmail.com (formato válido para sandbox e prod).
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
        old_body = n['parameters'].get('jsonBody', '')
        print('OLD jsonBody:')
        print(old_body)
        print()

        # Fix: troca domínio .local por .com (MP valida formato do email)
        new_body = (
            '={\n'
            '  "transaction_amount": {{ $json.valor_total }},\n'
            '  "description": "Pedido #{{ $json.numero_pedido }} - {{ $json.pizzaria_nome }}",\n'
            '  "payment_method_id": "pix",\n'
            '  "external_reference": "{{ $json.id }}",\n'
            '  "payer": {\n'
            '    "first_name": "{{ $json.cliente_nome.split(\' \')[0] }}",\n'
            '    "email": "cliente{{ $json.cliente_telefone }}@gmail.com"\n'
            '  }\n'
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
