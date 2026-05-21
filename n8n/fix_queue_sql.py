"""
Corrige 'invalid input syntax for type double precision' no no Enfileirar mensagem.

CAUSA: queryReplacement e separado por virgulas. Se a mensagem contem virgulas
(ex: "Oi, boa noite"), o parser divide os parametros errado:
  $3 = "Oi"          (so a primeira parte da mensagem)
  $4 = " boa noite"  (segunda parte, onde deveria ser id_mensagem)
  $5 = id_mensagem   (hex, jogado em to_timestamp() -> ERRO)

FIX:
1. Reordenar SQL: mensagem vem ULTIMO ($5), fora do risco de afetar params seguintes
2. Codificar mensagem em base64 na expressao n8n (base64 nunca tem virgulas)
3. Decodificar com convert_from(decode($5,'base64'),'UTF8') no PostgreSQL

Assim "Oi, boa noite" -> "T2ksIGJvYSBub2l0ZQ==" (sem virgulas) e depois
o SQL converte de volta para o texto original.
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
    "VALUES ($1, $2, $3, to_timestamp($4::float), convert_from(decode($5, 'base64'), 'UTF8'))\n"
    "ON CONFLICT DO NOTHING;"
)

# $1=instancia $2=telefone $3=id_mensagem $4=timestamp $5=mensagem_em_base64
# instancia, telefone, id_mensagem e timestamp nunca tem virgulas
# mensagem em base64 nunca tem virgulas (usa +/=/letras)
NEW_REPL = (
    "={{ $('Info').item.json.instancia }},"
    "{{ $('Info').item.json.telefone }},"
    "{{ $('Info').item.json.id_mensagem }},"
    "{{ $('Info').item.json.timestamp }},"
    "{{ Buffer.from($json.mensagem || $('Info').item.json.mensagem || '').toString('base64') }}"
)

for n in wf['nodes']:
    if n.get('id') == 'n14':  # Enfileirar mensagem
        p = n['parameters']
        opts = p.setdefault('options', {})

        old_q = p.get('query', '')
        old_r = opts.get('queryReplacement', '')

        if old_q != NEW_QUERY:
            p['query'] = NEW_QUERY
            changes.append('[Enfileirar mensagem] SQL reescrito: mensagem agora e $5 (base64), evita erro de virgula')

        if old_r != NEW_REPL:
            opts['queryReplacement'] = NEW_REPL
            changes.append('[Enfileirar mensagem] queryReplacement: mensagem codificada em base64')

        # garante continueOnFail
        if not n.get('continueOnFail'):
            n['continueOnFail'] = True
            changes.append('[Enfileirar mensagem] continueOnFail=true adicionado')

        break

print('Mudancas:' if changes else 'Nada mudou.')
for c in changes:
    print(f'  - {c}')

if not changes:
    sys.exit(0)

payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
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
            print(f'\n[Check] query:\n{p.get("query","")}')
            print(f'\n[Check] queryReplacement:\n{p.get("options",{}).get("queryReplacement","")}')

except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
