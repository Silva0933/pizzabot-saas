"""
Corrige 500 'internal_error' do MercadoPago causado por nomes de cliente
que contêm caracteres inválidos (ex: '@Jailson' → 'Jailson').

O campo 'first_name' do payer era construído com $json.cliente_nome.split(' ')[0],
que passava o @ literalmente para a API do MP, gerando 500.

Fix: sanitiza o nome removendo qualquer char que não seja letra ou espaço,
com fallback 'Cliente' caso o resultado fique vazio.

Também troca o CPF de teste para 12345678909 (CPF padrão de sandbox do MP)
e remove caracteres especiais do description.
"""
import os, json
import urllib.request, urllib.error

API_KEY = os.environ['N8N_API_KEY']
WF_ID = '7kSCqNiuuW511XuL'
url = f'https://n8nai.secretariaai.eu.cc/api/v1/workflows/{WF_ID}'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

for n in wf['nodes']:
    if n.get('id') == 'p07_mp':
        p = n['parameters']

        # Novo body com first_name sanitizado
        new_body = (
            '={\n'
            '  "transaction_amount": {{ Number($json.valor_total) }},\n'
            '  "description": "Pedido #{{ $json.numero_pedido }}",\n'
            '  "payment_method_id": "pix",\n'
            '  "external_reference": "{{ $json.id }}",\n'
            '  "payer": {\n'
            '    "first_name": "{{ $json.cliente_nome.replace(/[^a-zA-Z\\u00C0-\\u024F ]/g, \'\').trim().split(\' \')[0] || \'Cliente\' }}",\n'
            '    "last_name": "Cliente",\n'
            '    "email": "cliente{{ $json.cliente_telefone }}@gmail.com",\n'
            '    "identification": {\n'
            '      "type": "CPF",\n'
            '      "number": "12345678909"\n'
            '    }\n'
            '  }\n'
            '}'
        )

        if p.get('jsonBody') != new_body:
            p['jsonBody'] = new_body
            changes.append('[MercadoPago Cobrança] first_name sanitizado (remove @, #, etc.) + CPF padrão de sandbox')

print('Mudanças:' if changes else 'Nada mudou.')
for c in changes:
    print(f'  • {c}')

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
            if n.get('id') == 'p07_mp':
                print('\n--- MercadoPago Cobrança ---')
                print(json.dumps(n.get('parameters', {}).get('jsonBody'), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
