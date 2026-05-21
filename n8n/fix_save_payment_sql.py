"""
Corrige o bug 'invalid input syntax for type uuid' no nó
'Salvar Link no Chat Central' (p10b_save_payment_message).

CAUSA: queryReplacement é separado por vírgulas, mas mensagem_bot contém
       vírgulas (ex: "R$ 49,90") → o parser divide em parâmetros errados.

FIX: Monta a mensagem DENTRO do próprio SQL usando parâmetros escalares
     (nenhum deles contém vírgula):
       $1 = pizzaria_id  (UUID)
       $2 = telefone     (somente dígitos)
       $3 = payment_id   (somente dígitos)
       $4 = payment_link (URL — sem vírgulas em links MP)
       $5 = pix_copia_cola (código EMV — sem vírgulas)
       $6 = numero_pedido (inteiro)
       $7 = valor_total   (ex: "49.90" — ponto, não vírgula)

Também adiciona continueOnFail=true no nó para que qualquer erro futuro
de log NÃO quebre o fluxo e NÃO faça a Secretária mandar mensagem de erro.
"""
import os, json
import urllib.request, urllib.error

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = '7kSCqNiuuW511XuL'
url     = f'https://n8nai.secretariaai.eu.cc/api/v1/workflows/{WF_ID}'

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

NEW_QUERY = (
    "UPDATE public.conversas\n"
    "SET messages = COALESCE(messages, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(\n"
    "    'id', concat('payment-', $3::text, '-', extract(epoch from now())::text),\n"
    "    'sender', 'bot',\n"
    "    'content', concat(\n"
    "      '\U0001f4b3 *Pagamento do Pedido #', $6::text, '*', chr(10),\n"
    "      chr(10),\n"
    "      'Valor: R$ ', replace($7::text, '.', ','), chr(10),\n"
    "      chr(10),\n"
    "      CASE WHEN $4 <> '' THEN concat('\U0001f517 Link de pagamento:', chr(10), $4, chr(10)) ELSE '' END,\n"
    "      CASE WHEN $5 <> '' THEN concat(chr(10), '\U0001f4cb PIX copia-e-cola:', chr(10), '```', chr(10), $5, chr(10), '```') ELSE '' END,\n"
    "      chr(10), chr(10),\n"
    "      'Assim que o pagamento for confirmado, te aviso aqui! ✅'\n"
    "    ),\n"
    "    'timestamp', to_jsonb(NOW())\n"
    "  )),\n"
    "  last_message = concat('\U0001f4b3 Pedido #', $6::text, ' - Link de pagamento enviado'),\n"
    "  last_timestamp = NOW(),\n"
    "  updated_at = NOW()\n"
    "WHERE pizzaria_id = $1::uuid AND cliente_telefone = $2\n"
    "RETURNING id;"
)

# Replacement sem vírgulas nos valores:
# $1=pizzaria_id, $2=telefone, $3=payment_id, $4=link, $5=pix, $6=numero, $7=valor
NEW_REPL = (
    "={{ $('Normalizar Resposta').item.json.pizzaria_id }},"
    "{{ $('Normalizar Resposta').item.json.telefone }},"
    "{{ $('Normalizar Resposta').item.json.payment_id }},"
    "{{ $('Normalizar Resposta').item.json.payment_link }},"
    "{{ $('Normalizar Resposta').item.json.pix_copia_cola }},"
    "{{ $('Normalizar Resposta').item.json.numero_pedido }},"
    "{{ $('Normalizar Resposta').item.json.valor_total }}"
)

for n in wf['nodes']:
    if n.get('id') == 'p10b_save_payment_message':
        p = n['parameters']
        opts = p.setdefault('options', {})

        if p.get('query') != NEW_QUERY:
            p['query'] = NEW_QUERY
            changes.append('[Salvar Link] query reescrita — mensagem montada no SQL, sem vírgulas')

        if opts.get('queryReplacement') != NEW_REPL:
            opts['queryReplacement'] = NEW_REPL
            changes.append('[Salvar Link] queryReplacement usa 7 params escalares (sem vírgulas nos valores)')

        # continueOnFail garante que falha de log não derruba o workflow
        if not n.get('continueOnFail'):
            n['continueOnFail'] = True
            changes.append('[Salvar Link] continueOnFail=true adicionado')

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
            if n.get('id') == 'p10b_save_payment_message':
                print('\n--- Salvar Link no Chat Central ---')
                p = n.get('parameters', {})
                print('query:', p.get('query', '')[:200])
                print('queryReplacement:', p.get('options', {}).get('queryReplacement', ''))
                print('continueOnFail:', n.get('continueOnFail'))
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
