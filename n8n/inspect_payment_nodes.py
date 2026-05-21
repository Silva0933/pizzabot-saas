"""Inspeciona os nodes-chave do workflow de Pagamento."""
import os, json, sys
import urllib.request, urllib.error

# Force UTF-8 on Windows console
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID = '7kSCqNiuuW511XuL'
BASE = 'https://n8nai.secretariaai.eu.cc/api/v1'

req = urllib.request.Request(f'{BASE}/workflows/{WF_ID}', headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

target_names = (
    'Validar Input', 'Carregar Pedido', 'Validar Configuracao Pagamento',
    'MercadoPago Cobranca', 'MercadoPago Cobranca', 'Mercado Pago Cobranca',
    'MercadoPago Cobrança', 'Normalizar Resposta', 'Atualizar Pedido',
    'Enviar Link ao Cliente', 'Salvar Link no Chat Central',
)

print(f"Workflow: {wf['name']}")
print(f"Nodes: {[n['name'] for n in wf['nodes']]}")
print()

for n in wf['nodes']:
    if n['name'] in target_names or 'mercado' in n['name'].lower() or 'salvar link' in n['name'].lower():
        print('=' * 80)
        print(f"NODE: {n['name']}  (id={n.get('id')}, type={n.get('type')})")
        print('=' * 80)
        print(json.dumps(n.get('parameters', {}), ensure_ascii=False, indent=2)[:3000])
        print()
