"""
Remove tools com URL dinamica que quebram o Gemini.

CAUSA: toolHttpRequest com URL contendo {{ }} expressions parece confundir
o parser de schema do n8n + LangChain, gerando properties com key vazia
no schema enviado ao Gemini.

ACAO:
1. Deletar Tool: Enviar_alerta_cancelamento (n_alert)
2. Deletar Tool: Reagir_mensagem (n_react_tool)
3. Recriar nó automatico 'Reagir mensagem' (envio fixo de coracao na msg recebida)
4. Reconectar a 'Marcar como lida' para sinalizar visualizacao

Workaround para alertas de cancelamento: continuam sendo registrados via
Cancelar_pedido (status='cancelado' + audit trail). Equipe verifica no painel.
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

# 1. Remove os tools quebrados
to_remove_ids = ['n_alert', 'n_react_tool']
to_remove_names = []
for nid in to_remove_ids:
    idx = next((i for i,n in enumerate(wf['nodes']) if n.get('id') == nid), None)
    if idx is not None:
        name = wf['nodes'][idx].get('name','')
        to_remove_names.append(name)
        wf['nodes'].pop(idx)
        changes.append(f'[Removido] {name} (id={nid})')

# Remove as conexoes desses tools
for name in to_remove_names:
    if name in wf.get('connections', {}):
        del wf['connections'][name]
        changes.append(f'[Conexao removida] {name}')

# 2. Recria no automatico Reagir mensagem (mesmo que antes)
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
            "jsonBody": (
                "={\n"
                '  "key": {\n'
                '    "remoteJid": "{{ $(\'Info\').first().json.remoteJid }}",\n'
                '    "fromMe": false,\n'
                '    "id": "{{ $(\'Info\').first().json.id_mensagem }}"\n'
                "  },\n"
                '  "reaction": "❤️"\n'
                "}"
            ),
            "options": {"timeout": 8000}
        }
    }
    wf['nodes'].append(react_node)
    changes.append('[Reagir mensagem] no automatico recriado')

# 3. Reconectar a 'Marcar como lida' (paralelo a Upsert Conversa)
conn = wf.setdefault('connections', {})
marcar = conn.setdefault('Marcar como lida', {})
outs = marcar.setdefault('main', [[]])
already = any(c.get('node') == 'Reagir mensagem' for lst in outs for c in lst)
if not already:
    if outs and outs[0]:
        outs[0].append({"node":"Reagir mensagem","type":"main","index":0})
    else:
        outs[:] = [[{"node":"Reagir mensagem","type":"main","index":0}]]
    changes.append('[Conexao] Marcar como lida -> Reagir mensagem (automatico)')

# 4. Atualizar lista de FERRAMENTAS no prompt do Montar Contexto
# (remover referencias a Reagir_mensagem e Enviar_alerta_cancelamento)
for n in wf['nodes']:
    if n.get('id') == 'n22':
        code = n['parameters'].get('jsCode', '')
        # Substituicoes pontuais nas duas linhas das ferramentas
        replacements = [
            ('- Enviar_alerta_cancelamento: APOS cancelar, avise a equipe interna (nome do cliente, itens, motivo).\\n',
             ''),
            ('- Reagir_mensagem: reaja com emoji em momentos pontuais da conversa.\\n',
             ''),
            ("- Use Reagir_mensagem em momentos oportunos (cliente agradece -> coracao, pedido registrado -> check verde).\\n",
             ''),
            # Tambem ajusta procedimento de cancelamento
            ('Apos cancelar com sucesso, OBRIGATORIAMENTE chame Enviar_alerta_cancelamento.',
             'Apos cancelar, confirme ao cliente com tom acolhedor.'),
        ]
        new_code = code
        for old, new in replacements:
            new_code = new_code.replace(old, new)
        if new_code != code:
            n['parameters']['jsCode'] = new_code
            changes.append('[Montar Contexto] removidas referencias a tools deletadas')
        break

# 5. Tambem ajusta Cancelar_pedido para nao mencionar Enviar_alerta_cancelamento
for n in wf['nodes']:
    if n.get('id') == 'n_cancel':
        p = n['parameters']
        desc = p.get('toolDescription', '')
        new_desc = desc.replace(
            'Apos cancelar com sucesso, OBRIGATORIAMENTE chame Enviar_alerta_cancelamento. ',
            ''
        )
        if new_desc != desc:
            p['toolDescription'] = new_desc
            changes.append('[Cancelar_pedido] descricao ajustada')
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
        result = json.loads(resp.read())
        print(f'\nOK active={result.get("active")} nodes={len(result["nodes"])}')
        # Conta tools conectados ao Secretaria
        n = 0
        for src, conns in result.get('connections',{}).items():
            for ctype, branches in conns.items():
                if ctype == 'ai_tool':
                    for b in branches:
                        for c in b:
                            if c.get('node') == 'Secretaria':
                                n += 1
        print(f'Tools conectados ao Secretaria agora: {n}')
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:500]}')
