"""
Adiciona continueOnFail ao p04_load e ajusta p08_norm para
lidar com o caso de erro do p04 (pedido nao encontrado).
"""
import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/7kSCqNiuuW511XuL'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

for n in wf['nodes']:
    # 1) p04_load: continueOnFail so DB errors don't crash workflow
    if n['id'] == 'p04_load':
        n['continueOnFail'] = True
        print('p04_load: continueOnFail = True')

    # 2) p08_norm: also handle case where p04 failed (no order data)
    if n['id'] == 'p08_norm':
        new_code = (
            "// Normaliza retorno dos dois gateways em formato unico\n"
            "// Tenta obter dados do pedido - pode nao existir se p04 falhou\n"
            "let pedido = {};\n"
            "try { pedido = $('Carregar Pedido').first().json; } catch(e) {}\n"
            "const resp = $json;\n"
            "\n"
            "// Se $json tem 'error' key ou nao tem 'id', a chamada falhou\n"
            "let paymentId = '', paymentLink = '', pixCopiaCola = '';\n"
            "if (resp && resp.id && resp.invoiceUrl) {\n"
            "  // Asaas\n"
            "  paymentId = String(resp.id);\n"
            "  paymentLink = resp.invoiceUrl;\n"
            "  pixCopiaCola = resp.encodedImage || '';\n"
            "} else if (resp && resp.id && resp.point_of_interaction) {\n"
            "  // MercadoPago\n"
            "  paymentId = String(resp.id);\n"
            "  paymentLink = resp.point_of_interaction?.transaction_data?.ticket_url || '';\n"
            "  pixCopiaCola = resp.point_of_interaction?.transaction_data?.qr_code || '';\n"
            "}\n"
            "\n"
            "const hasLink = !!(paymentLink && paymentLink.length > 0);\n"
            "\n"
            "return [{\n"
            "  json: {\n"
            "    ok: hasLink,\n"
            "    error: hasLink ? null : 'Gateway de pagamento nao configurado ou credencial invalida.',\n"
            "    pedido_id: pedido.id || '',\n"
            "    pizzaria_id: pedido.pizzaria_id || '',\n"
            "    telefone: pedido.cliente_telefone || '',\n"
            "    instancia: pedido.instancia || '',\n"
            "    payment_id: paymentId,\n"
            "    payment_link: paymentLink,\n"
            "    pix_copia_cola: pixCopiaCola,\n"
            "    numero_pedido: pedido.numero_pedido || '',\n"
            "    valor_total: pedido.valor_total || 0\n"
            "  }\n"
            "}];\n"
        )
        n['parameters']['jsCode'] = new_code
        print('p08_norm: updated with resilient error handling')

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
        print(f'OK! active={result.get("active")}')
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
