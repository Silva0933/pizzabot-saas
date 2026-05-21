import os
import urllib.request, json, urllib.error

API_KEY = os.environ['N8N_API_KEY']
url = 'https://n8nai.secretariaai.eu.cc/api/v1/workflows/7kSCqNiuuW511XuL'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

for n in wf['nodes']:
    # 1) p07_mp: add continueOnFail so workflow doesn't die on API error
    if n['id'] == 'p07_mp':
        n['continueOnFail'] = True
        print('p07_mp: continueOnFail = True')

    # 2) p08_norm: add error detection when payment_link is empty
    if n['id'] == 'p08_norm':
        new_code = (
            "// Normaliza retorno dos dois gateways em formato unico\n"
            "const pedido = $('Carregar Pedido').first().json;\n"
            "const resp = $json;\n"
            "\n"
            "let paymentId = '', paymentLink = '', pixCopiaCola = '';\n"
            "if (resp.id && resp.invoiceUrl) {\n"
            "  // Asaas\n"
            "  paymentId = String(resp.id);\n"
            "  paymentLink = resp.invoiceUrl;\n"
            "  pixCopiaCola = resp.encodedImage || '';\n"
            "} else if (resp.id && resp.point_of_interaction) {\n"
            "  // MercadoPago\n"
            "  paymentId = String(resp.id);\n"
            "  paymentLink = resp.point_of_interaction?.transaction_data?.ticket_url || '';\n"
            "  pixCopiaCola = resp.point_of_interaction?.transaction_data?.qr_code || '';\n"
            "}\n"
            "\n"
            "const hasLink = paymentLink && paymentLink.length > 0;\n"
            "\n"
            "return [{\n"
            "  json: {\n"
            "    ok: hasLink,\n"
            "    error: hasLink ? null : 'Gateway de pagamento nao configurado ou credencial invalida. Configure a chave no painel.',\n"
            "    pedido_id: pedido.id,\n"
            "    pizzaria_id: pedido.pizzaria_id,\n"
            "    telefone: pedido.cliente_telefone,\n"
            "    instancia: pedido.instancia,\n"
            "    payment_id: paymentId,\n"
            "    payment_link: paymentLink,\n"
            "    pix_copia_cola: pixCopiaCola,\n"
            "    numero_pedido: pedido.numero_pedido,\n"
            "    valor_total: pedido.valor_total\n"
            "  }\n"
            "}];\n"
        )
        n['parameters']['jsCode'] = new_code
        print('p08_norm: updated with ok/error flag')

    # 3) p11_resp: return the ok/error from normalizer
    if n['id'] == 'p11_resp':
        n['parameters']['responseBody'] = (
            '={\n'
            '  "ok": {{ $("Normalizar Resposta").item.json.ok }},\n'
            '  "paymentId": "{{ $("Normalizar Resposta").item.json.payment_id }}",\n'
            '  "paymentLink": "{{ $("Normalizar Resposta").item.json.payment_link }}",\n'
            '  "error": "{{ $("Normalizar Resposta").item.json.error || \'\' }}"\n'
            '}'
        )
        print('p11_resp: updated with ok/error fields')

    # 4) p10_send: only send if there's actually a link
    if n['id'] == 'p10_send':
        n['continueOnFail'] = True
        print('p10_send: continueOnFail = True')

# Check connections: p08_norm → p09_update → p10_send → p11_resp
# Add a filter after p08_norm: only proceed if ok=true
# For now, just keep the flow but make p11_resp return proper error

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
