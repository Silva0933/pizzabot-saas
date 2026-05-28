"""
Corrige Escalar_Humano e Lembrar_Cliente que tinham placeholders SQL $N
sem $fromAI() correspondentes - n8n gerava properties com key vazia
para o Gemini, quebrando a tool com 'key cannot be empty'.

FIX: pizzaria_id e telefone (vindos do contexto, nao da IA) sao agora
embutidos diretamente no SQL via template literal, deixando os $N somente
para parametros vindos da IA via $fromAI.
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

# =============================================================
# Escalar_Humano (n28): sem $fromAI, contexto inline
# =============================================================
NEW_QUERY_ESCALAR = (
    "UPDATE public.conversas\n"
    "SET bot_ativo = false,\n"
    "    status = 'Humano necessario',\n"
    "    updated_at = NOW()\n"
    "WHERE pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid\n"
    "  AND cliente_telefone = '{{ $('Montar Contexto').item.json.telefone }}'\n"
    "RETURNING id;"
)

for n in wf['nodes']:
    if n.get('id') == 'n28':
        p = n['parameters']
        if p.get('query') != NEW_QUERY_ESCALAR:
            p['query'] = NEW_QUERY_ESCALAR
            changes.append('[Escalar_Humano] query com pizzaria_id/telefone inline')
        opts = p.setdefault('options', {})
        # Remove queryReplacement (nao tem mais $N)
        if 'queryReplacement' in opts and opts['queryReplacement']:
            opts['queryReplacement'] = ''
            changes.append('[Escalar_Humano] queryReplacement vazio (sem params)')
        break

# =============================================================
# Lembrar_Cliente (n30): mantem 3 $fromAI, inline pizzaria_id/telefone
# =============================================================
NEW_QUERY_LEMBRAR = (
    "UPDATE public.clientes\n"
    "SET nome = COALESCE(NULLIF($1,''), nome),\n"
    "    endereco_padrao = COALESCE(NULLIF($2,''), endereco_padrao),\n"
    "    preferencias = COALESCE(NULLIF($3,''), preferencias)\n"
    "WHERE pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid\n"
    "  AND telefone = '{{ $('Montar Contexto').item.json.telefone }}'\n"
    "RETURNING id;"
)

NEW_REPL_LEMBRAR = (
    "={{ $fromAI('nome','Nome do cliente (vazio se nao alterar)','string') }},"
    "{{ $fromAI('endereco','Endereco padrao (vazio se nao alterar)','string') }},"
    "{{ $fromAI('preferencias','Preferencias do cliente (vazio se nao alterar)','string') }}"
)

for n in wf['nodes']:
    if n.get('id') == 'n30':
        p = n['parameters']
        if p.get('query') != NEW_QUERY_LEMBRAR:
            p['query'] = NEW_QUERY_LEMBRAR
            changes.append('[Lembrar_Cliente] query com pizzaria_id/telefone inline')
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != NEW_REPL_LEMBRAR:
            opts['queryReplacement'] = NEW_REPL_LEMBRAR
            changes.append('[Lembrar_Cliente] queryReplacement apenas com $fromAI')
        break

print('Mudancas:' if changes else 'Nada mudou.')
for c in changes: print(f'  - {c}')

if not changes:
    sys.exit(0)

payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ALLOWED}
}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        print(f'\nOK active={json.loads(resp.read()).get("active")}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:500]}')
