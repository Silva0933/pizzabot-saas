"""
Adiciona regra explicita de 'uma pergunta por vez' no system prompt.

Problema: bot perguntou 'entrega ou retirada?' e ja pediu o endereco
na mesma mensagem, sem esperar o cliente decidir.

Fix: instrucao clara para nunca fazer duas perguntas na mesma mensagem
e ramificar a proxima pergunta com base na resposta.
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

# Bloco novo: inserido apos "RITMO DE CONVERSA:" e antes de "FERRAMENTAS:"
NEW_RULE = (
    "\\n\\n"
    "UMA PERGUNTA POR VEZ (regra critica):\\n"
    "- NUNCA faca duas perguntas seguidas na mesma mensagem\\n"
    "- ESPERE a resposta do cliente antes de pedir o proximo dado\\n"
    "- Ramifique a proxima pergunta de acordo com o que ele responder\\n"
    "\\n"
    "Errado: 'Quer entrega ou retirada? Qual o endereco?'\\n"
    "Certo: 'Voce quer que a gente entregue ou prefere passar aqui pra buscar?'\\n"
    "  [aguarda a resposta]\\n"
    "  Se entrega: 'Beleza! Me passa o endereco entao?'\\n"
    "  Se retirada: 'Otimo! Qual seu nome pra eu deixar separado?'\\n"
    "\\n"
    "Mesma regra para outras perguntas:\\n"
    "- Forma de pagamento: pergunte sozinha, sem misturar com outras\\n"
    "- Confirmacao final: faca o resumo completo numa mensagem, peca confirmacao na proxima"
)

for n in wf['nodes']:
    if n.get('id') == 'n22':
        old_code = n['parameters'].get('jsCode', '')

        # Marcador: insere antes de "FERRAMENTAS:"
        marker = '\\nFERRAMENTAS:'
        idx = old_code.find(marker)

        if idx == -1:
            changes.append('[n22] marcador FERRAMENTAS nao encontrado')
            break

        # Verifica se ja foi inserida
        if 'UMA PERGUNTA POR VEZ' in old_code:
            changes.append('[n22] regra ja existe - nada a fazer')
            break

        new_code = old_code[:idx] + NEW_RULE + old_code[idx:]
        n['parameters']['jsCode'] = new_code
        changes.append('[Montar Contexto n22] adicionada regra UMA PERGUNTA POR VEZ')
        break

print('Mudancas:' if changes else 'Nada mudou.')
for c in changes: print(f'  - {c}')

if not [c for c in changes if 'adicionada' in c or 'atualizada' in c]:
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
        print(f'\nOK! active={result.get("active")}')
        n22 = next((n for n in result.get('nodes',[]) if n.get('id')=='n22'), None)
        if n22:
            code = n22['parameters'].get('jsCode','')
            idx = code.find('UMA PERGUNTA')
            if idx != -1:
                print(f'\n[Check] preview da nova regra:')
                print(code[idx:idx+300].replace('\\\\n','\n'))
except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:500]}')
