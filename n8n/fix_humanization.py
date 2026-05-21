"""
Humanizacao do bot + implementacao do sistema de reacoes com emoji.

MUDANCAS:
1. Montar Contexto (n22): reescreve secao INSTRUCOES com diretrizes de humanizacao
2. Reagir mensagem: novo no HTTP Request (id=n_react) em paralelo ao Upsert Conversa
3. Conexoes: Marcar como lida -> [Upsert Conversa, Reagir mensagem] em paralelo
4. Gemini (formatador) n35: temperature 0.1 -> 0.5 para respostas menos roboticas
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'
BASE    = 'https://n8nai.secretariaai.eu.cc/api/v1'
url     = f'{BASE}/workflows/{WF_ID}'

ALLOWED_SETTINGS = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

# =============================================================
# 1. MONTAR CONTEXTO (n22) - novo bloco INSTRUCOES humanizado
# =============================================================
# Novo conteudo das instrucoes (dentro do template literal JS).
# Usa \n reais pois o template literal JS suporta multiline.
# Nao usa caracteres especiais para evitar problemas de encoding no script.
NEW_INSTRUCTIONS = (
    "\n\n"
    "## COMO VOCE DEVE SE COMPORTAR\n"
    "\n"
    "Voce e uma atendente REAL trabalhando nesta pizzaria. Nao e um bot - e uma pessoa.\n"
    "\n"
    "JEITO DE FALAR:\n"
    "- Portugues brasileiro descontraido e caloroso, como atendente de WhatsApp\n"
    "- Mensagens curtas, no ritmo do WhatsApp - nao escreva paredes de texto\n"
    "- Use emojis com naturalidade (pizza, sorriso, mao, coracao, ok) - nao excessivamente\n"
    "- Varie as expressoes: 'que otimo!', 'vou anotar ja!', 'ta combinado!', 'pode deixar!', 'perfeito!'\n"
    "- Tom caloroso e proximo, como atendente simpatica - nao como sistema\n"
    "\n"
    "PROIBIDO (nunca use):\n"
    "- Listas numeradas para confirmar pedidos (1. Pizza 2. Bebida 3. Endereco)\n"
    "- 'Posso ajudar em algo mais?', 'Fico no aguardo', 'Estou a disposicao'\n"
    "- Linguagem de sistema: 'registrado com sucesso', 'operacao realizada', 'processado'\n"
    "- Negrito duplo asterisco (**texto**) - use negrito WhatsApp (*texto*)\n"
    "- Despedidas corporativas no fim de cada mensagem\n"
    "\n"
    "COMO CONFIRMAR PEDIDOS (fluido, nao checklist):\n"
    "Certo: 'Perfeito! Pizza Calabresa grande + Coca 2L, pix, Rua Osvaldo 3. Confirma?'\n"
    "Errado: 'Para finalizar preciso confirmar: 1. Endereco 2. Pagamento 3. Itens'\n"
    "\n"
    "APOS REGISTRAR (PIX/cartao):\n"
    "'Anotado! Vou mandar o link de pagamento pra voce agora'\n"
    "O link chega em mensagem separada automaticamente - NAO mencione nem repita\n"
    "\n"
    "RITMO DE CONVERSA:\n"
    "- Nao solicite tudo de uma vez - va conversando naturalmente\n"
    "- Se faltar info, pergunte de forma leve: 'e vai entregar onde?' em vez de 'Informe o endereco'\n"
    "- Quando o cliente confirmar, finalize rapido sem rodeios\n"
    "\n"
    "FERRAMENTAS:\n"
    "- Use APENAS itens do cardapio acima (ja filtrado por disponiveis)\n"
    "- Ao confirmar o pedido use Registrar_Pedido com array {nome, qtd, preco_unit}\n"
    "- Apos registrar, se PIX/cartao, use Gerar_Pagamento_PIX com o id retornado\n"
    "- Se Gerar_Pagamento_PIX retornar ok=false: acione Escalar_Humano e diga que a equipe vai ajudar\n"
    "- Use Escalar_Humano se cliente pedir atendente humano\n"
    "- Use Atualizar_Obs_Pedido para observacoes ao pedido ja registrado\n"
    "- Use Enviar_Cardapio_Arquivo com arquivo_drive_id quando cliente pedir imagem do produto\n"
    "- Use Lembrar_Cliente para salvar nome/endereco/preferencias quando identificados\n"
    "- Sempre confirme endereco de entrega antes de registrar o pedido"
)

for n in wf['nodes']:
    if n.get('id') == 'n22':
        old_code = n['parameters'].get('jsCode', '')

        # Localiza o inicio do bloco INSTRUCOES (busca por 'INSTRU' sem acentos)
        # Na string Python, os \n dentro do template literal JS sao \n reais
        instru_idx = old_code.find('\n\nINSTRU')
        if instru_idx == -1:
            changes.append('[Montar Contexto n22] AVISO: marcador INSTRU nao encontrado')
            break

        # Localiza o fechamento do template literal: `;\n\nreturn
        close_idx = old_code.find('`;\n\nreturn', instru_idx)
        if close_idx == -1:
            # Tenta variante sem duplo newline
            close_idx = old_code.find('`;\nreturn', instru_idx)
            closing = '`;\nreturn'
        else:
            closing = '`;\n\nreturn'

        if close_idx == -1:
            changes.append('[Montar Contexto n22] AVISO: fechamento do template literal nao encontrado')
            break

        # Monta novo codigo: tudo antes do INSTRUCOES + novo bloco + fechamento do template
        new_code = old_code[:instru_idx] + NEW_INSTRUCTIONS + '`' + old_code[close_idx + 1:]

        if new_code != old_code:
            n['parameters']['jsCode'] = new_code
            changes.append('[Montar Contexto n22] Bloco INSTRUCOES reescrito com diretrizes de humanizacao')
        else:
            changes.append('[Montar Contexto n22] Sem mudancas (conteudo ja identico)')
        break

# =============================================================
# 2. GEMINI FORMATADOR (n35) - aumentar temperature
# =============================================================
for n in wf['nodes']:
    if n.get('id') == 'n35':
        opts = n.get('parameters', {}).get('options', {})
        old_temp = opts.get('temperature')
        if old_temp != 0.5:
            opts['temperature'] = 0.5
            n['parameters']['options'] = opts
            changes.append(f'[Gemini formatador n35] temperature {old_temp} -> 0.5')
        else:
            changes.append('[Gemini formatador n35] temperature ja = 0.5')
        break

# =============================================================
# 3. NOVO NO: Reagir mensagem (n_react)
# =============================================================
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
                    {
                        "name": "apikey",
                        "value": "lSAG0e6P4B12JAgS00MIpJsDzYIRd80Q"
                    }
                ]
            },
            "sendBody": True,
            "contentType": "json",
            "jsonBody": "={\n  \"key\": {\n    \"remoteJid\": \"{{ $('Info').first().json.remoteJid }}\",\n    \"fromMe\": false,\n    \"id\": \"{{ $('Info').first().json.id_mensagem }}\"\n  },\n  \"reaction\": \"❤️\"\n}",
            "options": {
                "timeout": 8000
            }
        }
    }
    wf['nodes'].append(react_node)
    changes.append('[Reagir mensagem n_react] Novo no HTTP Request adicionado (reaction coracao, continueOnFail=true)')
else:
    changes.append('[Reagir mensagem n_react] No ja existe')

# =============================================================
# 4. CONEXOES: Marcar como lida -> Reagir mensagem (paralelo)
# =============================================================
conn = wf.get('connections', {})
marcar_conn = conn.get('Marcar como lida', {})
main_outputs = marcar_conn.get('main', [[]])

already_connected = any(
    c.get('node') == 'Reagir mensagem'
    for output_list in main_outputs
    for c in output_list
)

if not already_connected:
    if main_outputs and len(main_outputs) > 0:
        main_outputs[0].append({
            "node": "Reagir mensagem",
            "type": "main",
            "index": 0
        })
    else:
        main_outputs = [[{"node": "Reagir mensagem", "type": "main", "index": 0}]]
    conn['Marcar como lida'] = {'main': main_outputs}
    wf['connections'] = conn
    changes.append('[Conexoes] Marcar como lida -> Reagir mensagem adicionado (paralelo a Upsert Conversa)')
else:
    changes.append('[Conexoes] Reagir mensagem ja conectado')

# =============================================================
# RESUMO + PUSH
# =============================================================
print('Mudancas:' if changes else 'Nada mudou.')
for c in changes:
    print(f'  - {c}')

payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ALLOWED_SETTINGS}
}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        print(f'\nOK! active={result.get("active")} | total nodes={len(result.get("nodes",[]))}')

        # Verificacao: conexoes Marcar como lida
        out_conn = result.get('connections', {}).get('Marcar como lida', {})
        print('\n[Check] Marcar como lida outputs:')
        for i, lst in enumerate(out_conn.get('main', [])):
            for c in lst:
                print(f'  -> {c["node"]}')

        # Verificacao: Reagir mensagem node
        react = next((n for n in result.get('nodes', []) if n.get('id') == 'n_react'), None)
        if react:
            print(f'\n[Check] Reagir mensagem: continueOnFail={react.get("continueOnFail")}')
            print(f'        url={react["parameters"].get("url","")[:80]}')
        else:
            print('\n[WARN] Reagir mensagem NAO encontrado no resultado!')

        # Verificacao: Gemini temperature
        fmt = next((n for n in result.get('nodes', []) if n.get('id') == 'n35'), None)
        if fmt:
            temp = fmt.get('parameters', {}).get('options', {}).get('temperature', 'N/A')
            print(f'\n[Check] Gemini formatador temperature={temp}')

        # Verificacao: Montar Contexto - primeiros chars do novo bloco
        n22 = next((n for n in result.get('nodes', []) if n.get('id') == 'n22'), None)
        if n22:
            code = n22['parameters'].get('jsCode', '')
            instru_idx = code.find('\n\nINSTRU')
            if instru_idx != -1:
                print(f'\n[Check] Montar Contexto - bloco encontrado em pos {instru_idx}')
                print(f'        Preview: {code[instru_idx:instru_idx+80]}...')
            else:
                print('\n[Check] Montar Contexto - bloco INSTRU nao encontrado!')

except urllib.error.HTTPError as e:
    body = e.read().decode()[:1000]
    print(f'\nHTTP {e.code}: {body}')
