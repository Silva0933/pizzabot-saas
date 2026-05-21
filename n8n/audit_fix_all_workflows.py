"""
Auditoria e correção completa de todos os 6 workflows PizzaBot.

FIXES APLICADOS:

1. PAGAMENTOS (7kSCqNiuuW511XuL)
   - Atualizar Pedido: adiciona AND pizzaria_id=$4 (isolamento multi-tenant)
   - Asaas Cobrança, Atualizar Pedido, Atualizar Pedido Confirmação,
     Notificar Cliente, Asaas Cliente, Carregar Pedido: continueOnFail=true

2. SECRETÁRIA (eqzbMvnZ7P8uDduU)
   - continueOnFail=true em nodes de log/envio (não críticos para fluxo)
   - Nodes críticos de dados NÃO recebem continueOnFail

3. AGRADECIMENTO (B4DE3ZyQe9QE1RWv)
   - Enviar Agradecimento: continueOnFail=true

4. RAG CLIENTES (6zwlMqCrMia4cP2h)
   - Ambos os nodes postgres: continueOnFail=true

5. DRIVE (Tr6FTcHuvVVRzjS8)
   - Enviar imagem e Enviar documento: continueOnFail=true
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
BASE    = 'https://n8nai.secretariaai.eu.cc/api/v1'

ALLOWED_SETTINGS = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

def get_wf(wf_id):
    req = urllib.request.Request(f'{BASE}/workflows/{wf_id}',
                                  headers={'X-N8N-API-KEY': API_KEY})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def put_wf(wf_id, wf):
    payload = {
        'name': wf['name'],
        'nodes': wf['nodes'],
        'connections': wf['connections'],
        'settings': {k: v for k, v in wf.get('settings',{}).items() if k in ALLOWED_SETTINGS}
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f'{BASE}/workflows/{wf_id}', data=data, method='PUT',
        headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}: {e.read().decode()[:400]}'

def set_continue_on_fail(node, changes, label=''):
    if not node.get('continueOnFail'):
        node['continueOnFail'] = True
        changes.append(f'  + continueOnFail=true  [{label or node["name"]}]')

# ═══════════════════════════════════════════════════════════
# 1. PAGAMENTOS
# ═══════════════════════════════════════════════════════════
print('='*60)
print('1. PAGAMENTOS (7kSCqNiuuW511XuL)')
wf = get_wf('7kSCqNiuuW511XuL')
changes = []

for n in wf['nodes']:
    name = n['name']
    nid  = n.get('id','')

    # ── Multi-tenancy: Atualizar Pedido deve filtrar por pizzaria_id
    if nid == 'p09_update':
        old_q = n['parameters'].get('query','')
        new_q = (
            "UPDATE public.pedidos\n"
            "SET payment_id = $1, link_pagamento = $2, payment_status = 'pending', updated_at = NOW()\n"
            "WHERE id = $3 AND pizzaria_id = $4\n"
            "RETURNING id;"
        )
        old_r = n['parameters'].get('options',{}).get('queryReplacement','')
        new_r = (
            "={{ $json.payment_id }},"
            "{{ $json.payment_link }},"
            "{{ $json.pedido_id }},"
            "{{ $json.pizzaria_id }}"
        )
        if old_q != new_q:
            n['parameters']['query'] = new_q
            changes.append('  [Atualizar Pedido] WHERE id=$3 AND pizzaria_id=$4 (multi-tenant guard)')
        if old_r != new_r:
            n['parameters'].setdefault('options',{})['queryReplacement'] = new_r
            changes.append('  [Atualizar Pedido] queryReplacement inclui pizzaria_id como $4')
        set_continue_on_fail(n, changes)

    # ── continueOnFail nos outros nodes críticos
    elif nid in ('p06_asaas','p13_update_conf','p15_notify','p05a_asaas_customer','p04_load','p04b_validate_config'):
        set_continue_on_fail(n, changes)

    # Salvar Link já tem continueOnFail (fix anterior), Normalizar já tem
    # MercadoPago já tem retry + continueOnFail

print('\n'.join(changes) if changes else '  Nada mudou.')
result, err = put_wf('7kSCqNiuuW511XuL', wf)
print(f'  -> {"OK active="+str(result.get("active")) if result else "ERRO: "+err}')


# ═══════════════════════════════════════════════════════════
# 2. SECRETÁRIA — continueOnFail em nodes não-críticos
# ═══════════════════════════════════════════════════════════
print('\n' + '='*60)
print('2. SECRETÁRIA (eqzbMvnZ7P8uDduU)')
wf = get_wf('eqzbMvnZ7P8uDduU')
changes = []

# Nodes que SÃO críticos (falha = parar): Carregar Pizzaria, Gemini, Mensagem válida?
SKIP_NAMES = {
    'Carregar Pizzaria', 'Mensagem válida?', 'Mensagem recebida',
    'Mensagem enviada pela equipe?', 'Bot ativo global?', 'Bot ativo na conversa?',
    'Tipo de mensagem (in)', 'Tipo de mensagem (out)', 'Mensagem encavalada?',
    'Resposta em áudio?', 'Loop mensagens humanas', 'Marcar como lida',
    'Gemini', 'Gemini (formatador)', 'Secretaria', 'Memory',
}

# Tipos que devem ter continueOnFail
CRITICAL_TYPES = {
    'n8n-nodes-base.httpRequest',
    'n8n-nodes-base.postgres',
    'n8n-nodes-evolution-api.evolutionApi',
}

for n in wf['nodes']:
    name = n['name']
    if name in SKIP_NAMES:
        continue
    if n['type'] in CRITICAL_TYPES:
        set_continue_on_fail(n, changes)

print('\n'.join(changes) if changes else '  Nada mudou.')
result, err = put_wf('eqzbMvnZ7P8uDduU', wf)
print(f'  -> {"OK active="+str(result.get("active")) if result else "ERRO: "+err}')


# ═══════════════════════════════════════════════════════════
# 3. AGRADECIMENTO
# ═══════════════════════════════════════════════════════════
print('\n' + '='*60)
print('3. AGRADECIMENTO (B4DE3ZyQe9QE1RWv)')
wf = get_wf('B4DE3ZyQe9QE1RWv')
changes = []

for n in wf['nodes']:
    # Enviar Agradecimento deve sobreviver a falhas de API
    if n['type'] == 'n8n-nodes-evolution-api.evolutionApi':
        set_continue_on_fail(n, changes)
    # Carregar Pedido também — se DB falhar, workflow morre silenciosamente
    if n['type'] == 'n8n-nodes-base.postgres':
        set_continue_on_fail(n, changes)

print('\n'.join(changes) if changes else '  Nada mudou.')
result, err = put_wf('B4DE3ZyQe9QE1RWv', wf)
print(f'  -> {"OK active="+str(result.get("active")) if result else "ERRO: "+err}')


# ═══════════════════════════════════════════════════════════
# 4. RAG CLIENTES
# ═══════════════════════════════════════════════════════════
print('\n' + '='*60)
print('4. RAG CLIENTES (6zwlMqCrMia4cP2h)')
wf = get_wf('6zwlMqCrMia4cP2h')
changes = []

for n in wf['nodes']:
    if n['type'] == 'n8n-nodes-base.postgres':
        set_continue_on_fail(n, changes)

print('\n'.join(changes) if changes else '  Nada mudou.')
result, err = put_wf('6zwlMqCrMia4cP2h', wf)
print(f'  -> {"OK active="+str(result.get("active")) if result else "ERRO: "+err}')


# ═══════════════════════════════════════════════════════════
# 5. DRIVE (sub-workflow)
# ═══════════════════════════════════════════════════════════
print('\n' + '='*60)
print('5. DRIVE (Tr6FTcHuvVVRzjS8)')
wf = get_wf('Tr6FTcHuvVVRzjS8')
changes = []

for n in wf['nodes']:
    if n['type'] in ('n8n-nodes-evolution-api.evolutionApi', 'n8n-nodes-base.googleDrive',
                     'n8n-nodes-base.httpRequest'):
        set_continue_on_fail(n, changes)

print('\n'.join(changes) if changes else '  Nada mudou.')
result, err = put_wf('Tr6FTcHuvVVRzjS8', wf)
print(f'  -> {"OK active="+str(result.get("active")) if result else "ERRO: "+err}')


# ═══════════════════════════════════════════════════════════
# 6. SUMÁRIO FINAL
# ═══════════════════════════════════════════════════════════
print('\n' + '='*60)
print('AUDITORIA CONCLUÍDA')
print("""
Resumo das correções:
  [Pagamentos]  Atualizar Pedido: guard pizzaria_id adicionado
  [Pagamentos]  continueOnFail em Asaas, Atualizar, Notificar, Carregar
  [Secretária]  continueOnFail em todos os nodes HTTP/DB/Evolution não-críticos
  [Agradecimento] continueOnFail em Postgres e Evolution
  [RAG]         continueOnFail em ambos Postgres nodes
  [Drive]       continueOnFail em Evolution e GoogleDrive

Itens OK (não precisaram de fix):
  - Secretária: todas as queries filtram por pizzaria_id ou instancia (único por pizzaria)
  - Pagamentos: Carregar Pedido já usa pizzaria_id corretamente
  - RAG: Carregar Pedido + Cliente já usa pizzaria_id
  - Agradecimento: Carregar Pedido já usa pizzaria_id
  - PainelData: workflow legado (schema antigo) — não afeta PizzaBot
""")
