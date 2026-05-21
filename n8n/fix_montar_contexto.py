"""
Corrige o bloco INSTRUCOES do Montar Contexto (n22) com diretrizes de humanizacao.

DETALHE TECNICO: dentro do template literal JS, \n e armazenado como
sequencia LITERAL \\ + n (2 chars), nao como newline real (0x0a).
Por isso a busca por marcadores usa '\\\\n\\\\nINSTRU' (escaped backslash-n).
"""
import os, json, sys
import urllib.request, urllib.error

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

API_KEY = os.environ['N8N_API_KEY']
WF_ID   = 'eqzbMvnZ7P8uDduU'
BASE    = 'https://n8nai.secretariaai.eu.cc/api/v1'
url     = f'{BASE}/workflows/{WF_ID}'
ALLOWED = ['executionOrder','saveManualExecutions','callerPolicy','errorWorkflow','timezone']

req = urllib.request.Request(url, headers={'X-N8N-API-KEY': API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []

# Novo bloco de instrucoes. Dentro do template literal JS, \n e literal.
# Em Python: '\\n' = 2 chars (backslash + n) = \n no JS = newline no resultado.
NL = '\\n'  # representa \n dentro do template JS

NEW_BLOCK = (
    NL + NL +
    "## COMO VOCE DEVE SE COMPORTAR" + NL +
    NL +
    "Voce e uma atendente REAL trabalhando nesta pizzaria. Nao e um bot - e uma pessoa." + NL +
    NL +
    "JEITO DE FALAR:" + NL +
    "- Portugues brasileiro descontraido e caloroso, como atendente de WhatsApp" + NL +
    "- Mensagens curtas, no ritmo do WhatsApp - nao escreva paredes de texto" + NL +
    "- Use emojis com naturalidade (pizza, sorriso, joinha, coracao) - nao excessivamente" + NL +
    "- Varie as expressoes: 'que otimo!', 'vou anotar ja!', 'ta combinado!', 'pode deixar!', 'perfeito!'" + NL +
    "- Tom caloroso e proximo, como atendente simpatica - nao como sistema" + NL +
    NL +
    "PROIBIDO (nunca use):" + NL +
    "- Listas numeradas para confirmar pedidos (1. Pizza 2. Bebida 3. Endereco)" + NL +
    "- 'Posso ajudar em algo mais?', 'Fico no aguardo', 'Estou a disposicao'" + NL +
    "- Linguagem de sistema: 'registrado com sucesso', 'operacao realizada', 'processado'" + NL +
    "- Negrito duplo asterisco (**texto**) - use negrito WhatsApp (*texto*)" + NL +
    "- Despedidas corporativas no fim de cada mensagem" + NL +
    NL +
    "COMO CONFIRMAR PEDIDOS (fluido, nao checklist):" + NL +
    "Certo: 'Perfeito! Pizza Calabresa grande + Coca 2L, pix, Rua Osvaldo 3. Confirma?'" + NL +
    "Errado: 'Para finalizar preciso confirmar: 1. Endereco 2. Pagamento 3. Itens'" + NL +
    NL +
    "APOS REGISTRAR (PIX/cartao):" + NL +
    "Diga: 'Anotado! Vou mandar o link de pagamento pra voce agora'" + NL +
    "O link chega em mensagem separada automaticamente - NAO mencione nem repita" + NL +
    NL +
    "RITMO DE CONVERSA:" + NL +
    "- Nao solicite tudo de uma vez - va conversando naturalmente" + NL +
    "- Se faltar info, pergunte de forma leve: 'e vai entregar onde?' em vez de 'Informe o endereco'" + NL +
    "- Quando o cliente confirmar, finalize rapido sem rodeios" + NL +
    NL +
    "FERRAMENTAS:" + NL +
    "- Use APENAS itens do cardapio acima (ja filtrado por disponiveis)" + NL +
    "- Ao confirmar o pedido use Registrar_Pedido com array de itens {nome, qtd, preco_unit}" + NL +
    "- Apos registrar, se PIX/cartao, use Gerar_Pagamento_PIX com o id retornado" + NL +
    "- Se Gerar_Pagamento_PIX retornar ok=false: acione Escalar_Humano, diga que a equipe vai ajudar" + NL +
    "- Use Escalar_Humano se cliente pedir atendente humano" + NL +
    "- Use Atualizar_Obs_Pedido para observacoes ao pedido ja registrado" + NL +
    "- Use Enviar_Cardapio_Arquivo com arquivo_drive_id quando cliente pedir imagem do produto" + NL +
    "- Use Lembrar_Cliente para salvar nome/endereco/preferencias quando identificados" + NL +
    "- Sempre confirme endereco de entrega antes de registrar o pedido"
)

for n in wf['nodes']:
    if n.get('id') == 'n22':
        old_code = n['parameters'].get('jsCode', '')

        # Busca pelo \n\n antes de INSTRU (literal backslash-n no template JS)
        # Em Python, '\\n' = backslash + n (2 chars)
        instru_marker = '\\n\\nINSTRU'
        instru_idx = old_code.find(instru_marker)

        if instru_idx == -1:
            print('[n22] INSTRU marker nao encontrado. Tentando alternativa...')
            # Tenta buscar por apenas INSTRU e verificar o que vem antes
            instru_idx_bare = old_code.find('INSTRU')
            if instru_idx_bare != -1:
                print(f'  INSTRU found at {instru_idx_bare}, chars before: {repr(old_code[instru_idx_bare-4:instru_idx_bare])}')
            break

        print(f'  [n22] Marcador encontrado em pos {instru_idx}')

        # Busca o fechamento do template literal: backtick + ; + newline real
        close_marker = '`;\n'
        close_idx = old_code.find(close_marker, instru_idx)

        if close_idx == -1:
            print('[n22] Fechamento do template nao encontrado')
            break

        print(f'  [n22] Fechamento encontrado em pos {close_idx}')

        # Reconstroi: tudo antes do \n\nINSTRU + novo bloco + backtick + ;...
        new_code = old_code[:instru_idx] + NEW_BLOCK + '`' + old_code[close_idx + 1:]

        if new_code == old_code:
            print('[n22] Conteudo ja identico - nenhuma mudanca')
        else:
            n['parameters']['jsCode'] = new_code
            changes.append('[Montar Contexto n22] Bloco INSTRUCOES reescrito com humanizacao')
            print(f'  [n22] Novo jsCode len: {len(new_code)} (era {len(old_code)})')

        break

print('\nMudancas:' if changes else '\nNada mudou.')
for c in changes:
    print(f'  - {c}')

if not changes:
    print('Abortando push (sem mudancas).')
    import sys; sys.exit(0)

payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': {k: v for k, v in wf.get('settings', {}).items() if k in ALLOWED}
}
data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
put_req = urllib.request.Request(url, data=data, method='PUT',
    headers={'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json'})

try:
    with urllib.request.urlopen(put_req) as resp:
        result = json.loads(resp.read())
        print(f'\nOK! active={result.get("active")}')

        # Verifica o novo bloco
        n22r = next((n for n in result.get('nodes', []) if n.get('id') == 'n22'), None)
        if n22r:
            code = n22r['parameters'].get('jsCode', '')
            idx = code.find('INSTRU')
            if idx != -1:
                print(f'\n[Check] Preview pos {idx}..{idx+120}:')
                print(code[idx:idx+120])
            else:
                print('\n[Check] INSTRU ainda nao encontrado!')

except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:800]}')
