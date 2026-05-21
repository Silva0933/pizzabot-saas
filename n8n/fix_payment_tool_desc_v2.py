"""
Corrige a descrição da tool Gerar_Pagamento_PIX para evitar mensagem dupla.

PROBLEMA: quando ok=true, o workflow de pagamento JÁ enviou o link direto
ao cliente via WhatsApp. Mas o Gemini não sabe disso e envia uma segunda
mensagem com o link, causando duplicidade.

FIX: instruir o Gemini que, se ok=true, o link JÁ FOI ENVIADO automaticamente
ao cliente — basta confirmar brevemente ("Link enviado!") sem repetir o link.
Se ok=false, deve escalar para humano.
"""
import os, json
import urllib.request, urllib.error

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'  # Secretária
url     = f'https://n8nai.secretariaai.eu.cc/api/v1/workflows/{WF_ID}'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

NEW_DESC = (
    "Gera link/PIX de pagamento para um pedido já registrado. "
    "Use após Registrar_Pedido quando a forma de pagamento for pix ou cartao. "
    "Recebe pedido_id (UUID retornado por Registrar_Pedido). "
    "IMPORTANTE — ao receber a resposta:\n"
    "• Se ok=true: o link JÁ foi enviado automaticamente ao cliente via WhatsApp pelo sistema. "
    "NÃO repita o link nem o código PIX. Apenas confirme brevemente, ex: "
    "'✅ Link de pagamento enviado! Assim que confirmado, te aviso.'\n"
    "• Se ok=false: use a tool Escalar_Humano e informe que o pagamento automático "
    "está indisponível e um atendente vai ajudar."
)

changes = []
for n in wf['nodes']:
    if n.get('id') == 'n27':
        old_desc = n['parameters'].get('toolDescription', '')
        if old_desc != NEW_DESC:
            n['parameters']['toolDescription'] = NEW_DESC
            changes.append('[Gerar_Pagamento_PIX] toolDescription atualizada — instrui Gemini a não repetir o link')

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
            if n.get('id') == 'n27':
                print('\n--- Gerar_Pagamento_PIX toolDescription ---')
                print(n['parameters'].get('toolDescription', ''))
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
