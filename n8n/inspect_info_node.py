"""
Inspeciona o nó 'Info' do workflow Secretária para entender de onde
ele extrai 'instancia'. O erro 'The "undefined" instance does not exist'
indica que esse campo está chegando vazio em 'Enviar parte WhatsApp'.
"""
import os
import urllib.request, json

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/eqzbMvnZ7P8uDduU'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

print(f"Workflow: {wf['name']}  active={wf.get('active')}")
print(f"Total nodes: {len(wf['nodes'])}")
print()

# Mostra todos os nodes com seus tipos
print("=" * 80)
print("ALL NODES (id | name | type)")
print("=" * 80)
for n in wf['nodes']:
    print(f"  {n.get('id','?'):<25} | {n.get('name','?'):<35} | {n.get('type','?')}")

print()
print("=" * 80)
print("NODES THAT REFERENCE 'instancia' or 'Info'")
print("=" * 80)

for n in wf['nodes']:
    name = n.get('name', '?')
    # serialise params and check
    pjson = json.dumps(n.get('parameters', {}), ensure_ascii=False)
    refs_instancia = 'instancia' in pjson
    refs_info = "'Info'" in pjson or '"Info"' in pjson
    if refs_instancia or refs_info or name in ('Info',):
        print(f"\n--- NODE: {name} (id={n.get('id')}, type={n.get('type')}) ---")
        print(json.dumps(n.get('parameters', {}), ensure_ascii=False, indent=2)[:2000])

# Mostra connections entrando no nó "Info"
print()
print("=" * 80)
print("CONNECTIONS feeding into 'Info' (upstream sources)")
print("=" * 80)
for src_name, ports in wf['connections'].items():
    for port_list in ports.get('main', []):
        for conn in port_list:
            if conn.get('node') == 'Info':
                print(f"  {src_name} -> Info  (index {conn.get('index')})")
