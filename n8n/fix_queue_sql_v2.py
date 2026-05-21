"""
v2: substitui base64 (que falha porque Buffer nao existe no sandbox n8n)
por replace simples: virgulas viram %2C na expressao, SQL desfaz com replace().

CAUSA DA v1: 'there is no parameter $5' - Buffer.from() falhou no expression
engine do n8n (sandbox limitado, sem Node globals).

SOLUCAO v2:
- Expressao: .replace(/,/g, '%2C') - vanilla JS, sempre funciona
- SQL: replace($5, '%2C', ',') - PostgreSQL builtin
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'
BASE    = 'https://n8nai.secretariaai.eu.cc/api/v1'
url     = f'{BASE}/workflows/{WF_ID}'
ALLOWED = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

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
            changes.append('[Enfileirar mensagem] SQL: usa replace(%2C,",") em vez de base64')
        if opts.get('queryReplacement') != NEW_REPL:
            opts['queryReplacement'] = NEW_REPL
            changes.append('[Enfileirar mensagem] queryReplacement: troca virgulas por %2C na expressao')
        if not n.get('continueOnFail'):
            n['continueOnFail'] = True
            changes.append('[Enfileirar mensagem] continueOnFail=true')
        break

print('Mudancas:' if changes else 'Nada mudou.')
for c in changes:
    print(f'  - {c}')

if not changes: sys.exit(0)

payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ALLOWED}
}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        print(f'\nOK! active={result.get("active")}')
        n14 = next((n for n in result.get('nodes', []) if n.get('id') == 'n14'), None)
        if n14:
            p = n14['parameters']
            print(f'\nquery:\n{p.get("query","")}')
            print(f'\nqueryReplacement:\n{p.get("options",{}).get("queryReplacement","")}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
