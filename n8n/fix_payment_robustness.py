"""
Fixes para o workflow de Pagamento (7kSCqNiuuW511XuL):

1) MercadoPago Cobrança: adiciona payer.identification (CPF de teste, necessário
   em algumas validações do MP), retry em falhas transientes, e timeout maior.

2) Normalizar Resposta: passa a montar 'mensagem_bot' já formatada com a copy
   completa do link/PIX — evita repetir JS no SQL e elimina o bug 'invalid syntax'.

3) Salvar Link no Chat Central: queryReplacement passa a referenciar
   $('Normalizar Resposta').item.json.mensagem_bot (sem JS multilinha).

4) Enviar Link ao Cliente: passa a usar a mesma mensagem_bot pré-formatada,
   garantindo consistência entre WhatsApp e o histórico no painel.
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID = '7kSCqNiuuW511XuL'
url = f'https://n8nai.secretariaai.eu.cc/api/v1/workflows/{WF_ID}'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

# Novo código da Normalizar Resposta — adiciona campo mensagem_bot já formatado
new_norm_code = """// Normaliza retorno dos dois gateways em formato unico
const pedido = $('Carregar Pedido').first().json;
const resp = $json;

let paymentId = '', paymentLink = '', pixCopiaCola = '';
if (resp.id && resp.invoiceUrl) {
  // Asaas
  paymentId = String(resp.id);
  paymentLink = resp.invoiceUrl || resp.bankSlipUrl || '';
  pixCopiaCola = resp.pix?.payload || resp.encodedImage || '';
} else if (resp.id) {
  // MercadoPago
  paymentId = String(resp.id);
  paymentLink = resp.point_of_interaction?.transaction_data?.ticket_url || '';
  pixCopiaCola = resp.point_of_interaction?.transaction_data?.qr_code || '';
}

const hasLinkOrPix = Boolean(paymentLink || pixCopiaCola);
const valorBR = Number(pedido.valor_total).toFixed(2).replace('.', ',');

// Mensagem WhatsApp pré-formatada (template literal evita o bug de \\n em SQL)
let mensagem_bot = '';
if (hasLinkOrPix) {
  mensagem_bot = [
    `💳 *Pagamento do Pedido #${pedido.numero_pedido}*`,
    ``,
    `Valor: R$ ${valorBR}`,
    ``,
    paymentLink ? `🔗 Link de pagamento:\\n${paymentLink}` : '',
    pixCopiaCola ? `\\n📋 PIX copia-e-cola:\\n\\`\\`\\`\\n${pixCopiaCola}\\n\\`\\`\\`` : '',
    ``,
    `Assim que o pagamento for confirmado, te aviso aqui! ✅`
  ].filter(Boolean).join('\\n');
}

return [{
  json: {
    ok: hasLinkOrPix,
    error: hasLinkOrPix ? '' : 'Gateway retornou cobranca sem link/PIX. Verifique credenciais e ambiente do provedor.',
    pedido_id: pedido.id,
    pizzaria_id: pedido.pizzaria_id,
    telefone: pedido.cliente_telefone,
    instancia: pedido.instancia,
    payment_id: paymentId,
    payment_link: paymentLink,
    pix_copia_cola: pixCopiaCola,
    numero_pedido: pedido.numero_pedido,
    valor_total: pedido.valor_total,
    mensagem_bot
  }
}];"""

for n in wf['nodes']:
    nid = n.get('id')
    name = n.get('name', '')

    # ── 1) MercadoPago Cobrança ────────────────────────────────────────────
    if nid == 'p07_mp':
        p = n['parameters']
        new_body = (
            '={\n'
            '  "transaction_amount": {{ Number($json.valor_total) }},\n'
            '  "description": "Pedido #{{ $json.numero_pedido }} - {{ $json.pizzaria_nome }}",\n'
            '  "payment_method_id": "pix",\n'
            '  "external_reference": "{{ $json.id }}",\n'
            '  "payer": {\n'
            '    "first_name": "{{ $json.cliente_nome.split(\' \')[0] }}",\n'
            '    "last_name": "Cliente",\n'
            '    "email": "cliente{{ $json.cliente_telefone }}@gmail.com",\n'
            '    "identification": {\n'
            '      "type": "CPF",\n'
            '      "number": "19119119100"\n'
            '    }\n'
            '  }\n'
            '}'
        )
        if p.get('jsonBody') != new_body:
            p['jsonBody'] = new_body
            changes.append('[MercadoPago Cobrança] body agora inclui payer.identification (CPF teste)')

        # Retry on transient errors
        opts = p.setdefault('options', {})
        if not opts.get('retry'):
            opts['retry'] = {
                'retryOnFail': True,
                'maxTries': 3,
                'waitBetweenTries': 2000
            }
            changes.append('[MercadoPago Cobrança] retry 3x com 2s de pausa habilitado')

        # Timeout maior
        if opts.get('timeout') != 30000:
            opts['timeout'] = 30000
            changes.append('[MercadoPago Cobrança] timeout = 30s')

    # ── 2) Normalizar Resposta ─────────────────────────────────────────────
    if nid == 'p08_norm':
        if n['parameters'].get('jsCode') != new_norm_code:
            n['parameters']['jsCode'] = new_norm_code
            changes.append('[Normalizar Resposta] agora gera mensagem_bot pré-formatada')

    # ── 3) Salvar Link no Chat Central ─────────────────────────────────────
    if nid == 'p10b_save_payment_message':
        p = n['parameters']
        new_repl = (
            "={{ $('Normalizar Resposta').item.json.mensagem_bot }},"
            "{{ $('Normalizar Resposta').item.json.pizzaria_id }},"
            "{{ $('Normalizar Resposta').item.json.telefone }},"
            "{{ $('Normalizar Resposta').item.json.payment_id }}"
        )
        opts = p.setdefault('options', {})
        if opts.get('queryReplacement') != new_repl:
            opts['queryReplacement'] = new_repl
            changes.append('[Salvar Link no Chat Central] queryReplacement usa mensagem_bot (sem JS inline)')

    # ── 4) Enviar Link ao Cliente ──────────────────────────────────────────
    if nid == 'p10_send':
        p = n['parameters']
        new_msg = "={{ $('Normalizar Resposta').item.json.mensagem_bot }}"
        if p.get('messageText') != new_msg:
            p['messageText'] = new_msg
            changes.append('[Enviar Link ao Cliente] messageText usa mensagem_bot (consistência com chat)')

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
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
