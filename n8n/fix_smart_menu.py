"""
Otimizacao de tokens + apresentacao padrao + tool de busca por categoria.

1. Montar Contexto (n22): nao injeta mais o cardapio completo - so o RESUMO
   (categorias + contagem). Reduz drasticamente os tokens em conversas curtas.

2. Novo Tool: Consultar_Cardapio (n_consulta): postgresTool que recebe a
   categoria como parametro e retorna os produtos disponiveis nela.
   O Gemini chama essa tool quando o cliente pergunta sobre uma categoria.

3. INSTRUCOES atualizadas com REGRA DE APRESENTACAO:
   No primeiro hello, sempre: "Oi/Boa noite! Aqui é a [Nome] da [Pizzaria].
   Como posso te ajudar?". Depois segue humanizado.
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

# =============================================================
# 1. MONTAR CONTEXTO (n22) - novo codigo
# =============================================================
NEW_JS = r"""const produtos = $input.all().map(i => i.json);
const cliente = $('Upsert Cliente (RAG)').first().json;
const pizzaria = $('Carregar Pizzaria').first().json;
const info = $('Info').first().json;
const msg = $('Consolidar mensagens').first().json.mensagem_consolidada;

// Resumo: categorias + contagem (em vez de listar produtos completos)
const byCat = {};
for (const p of produtos) {
  const cat = p.categoria || 'outros';
  if (!byCat[cat]) byCat[cat] = 0;
  byCat[cat]++;
}
let cardapioResumo = '';
for (const cat of Object.keys(byCat).sort()) {
  cardapioResumo += `\n- ${cat} (${byCat[cat]} ${byCat[cat]===1?'item':'itens'})`;
}
if (!cardapioResumo) cardapioResumo = '\n(sem produtos cadastrados)';

// Contexto RAG do cliente
let ragContext = '';
if (cliente?.total_pedidos > 0) {
  ragContext = `\n\nCLIENTE RECORRENTE:\nNome: ${cliente.nome || 'sem nome'}\nEndereco padrao: ${cliente.endereco_padrao || 'nao informado'}\nPreferencias: ${cliente.preferencias || 'nenhuma'}\nTotal de pedidos: ${cliente.total_pedidos} | Total gasto: R$ ${Number(cliente.total_gasto||0).toFixed(2)}\nUltima visita: ${cliente.ultima_visita || 'nunca'}`;
  if (Array.isArray(cliente.historico_pedidos) && cliente.historico_pedidos.length) {
    const last = cliente.historico_pedidos.slice(-3).map(h => `. ${h.date || ''}: ${h.items || ''} (R$ ${Number(h.total||0).toFixed(2)})`).join('\n');
    ragContext += `\nUltimos pedidos:\n${last}`;
  }
} else {
  ragContext = `\n\nCLIENTE NOVO: primeiro contato (telefone ${info.telefone}).`;
}

const basePrompt = pizzaria.prompt_personalizado || 'Voce e a atendente virtual da pizzaria. Seja simpatica e ajude o cliente a fechar o pedido.';
const nomePizzaria = pizzaria.nome || 'a pizzaria';

const systemMessage = `${basePrompt}\n\nNOME DA PIZZARIA: ${nomePizzaria}${ragContext}\n\n## CATEGORIAS DISPONIVEIS NO CARDAPIO${cardapioResumo}\n\nIMPORTANTE: voce nao tem a lista de produtos no contexto - apenas as categorias acima.\nQuando o cliente perguntar sobre uma categoria (ex: \"quais pizzas voces tem?\", \"quero uma bebida\"), use OBRIGATORIAMENTE a tool Consultar_Cardapio passando o nome da categoria. So assim voce vai saber nomes, precos e descricoes dos produtos.\n\n## REGRA DE APRESENTACAO (primeira interacao da conversa)\nQuando o cliente cumprimentar (oi, ola, boa noite, bom dia, etc.) e for o inicio da conversa, SEMPRE se apresente neste formato:\n\"Oi/Bom dia/Boa tarde/Boa noite! Aqui e a [SEU NOME conforme persona acima] da ${nomePizzaria}. Como posso te ajudar hoje?\" + um emoji adequado.\nNao repita a apresentacao em mensagens seguintes - so na PRIMEIRA do dia/conversa.\n\n## COMO VOCE DEVE SE COMPORTAR\nVoce e uma atendente REAL trabalhando nesta pizzaria. Nao e um bot - e uma pessoa.\n\nJEITO DE FALAR:\n- Portugues brasileiro descontraido e caloroso, como atendente de WhatsApp\n- Mensagens curtas, no ritmo do WhatsApp - nao escreva paredes de texto\n- Use emojis com naturalidade (pizza, sorriso, joinha, coracao) - nao excessivamente\n- Varie as expressoes: 'que otimo!', 'vou anotar ja!', 'ta combinado!', 'pode deixar!', 'perfeito!'\n- Tom caloroso e proximo, como atendente simpatica - nao como sistema\n\nPROIBIDO (nunca use):\n- Listas numeradas para confirmar pedidos (1. Pizza 2. Bebida 3. Endereco)\n- 'Posso ajudar em algo mais?', 'Fico no aguardo', 'Estou a disposicao'\n- Linguagem de sistema: 'registrado com sucesso', 'operacao realizada', 'processado'\n- Negrito duplo asterisco (**texto**) - use negrito WhatsApp (*texto*)\n- Despedidas corporativas no fim de cada mensagem\n- INVENTAR produtos, precos ou disponibilidade - sempre consulte via Consultar_Cardapio\n\nCOMO CONFIRMAR PEDIDOS (fluido, nao checklist):\nCerto: 'Perfeito! Pizza Calabresa grande + Coca 2L, pix, Rua Osvaldo 3. Confirma?'\nErrado: 'Para finalizar preciso confirmar: 1. Endereco 2. Pagamento 3. Itens'\n\nAPOS REGISTRAR (PIX/cartao):\nDiga: 'Anotado! Vou mandar o link de pagamento pra voce agora'\nO link chega em mensagem separada automaticamente - NAO mencione nem repita\n\nRITMO DE CONVERSA:\n- Nao solicite tudo de uma vez - va conversando naturalmente\n- Se faltar info, pergunte de forma leve: 'e vai entregar onde?' em vez de 'Informe o endereco'\n- Quando o cliente confirmar, finalize rapido sem rodeios\n\nFERRAMENTAS:\n- Consultar_Cardapio: SEMPRE consulte antes de citar produtos/precos. Passe a categoria como parametro.\n- Registrar_Pedido: array de itens {nome, qtd, preco_unit}\n- Gerar_Pagamento_PIX: apos registrar, se PIX/cartao, passa o id do pedido\n- Se Gerar_Pagamento_PIX retornar ok=false: acione Escalar_Humano, diga que a equipe vai ajudar\n- Escalar_Humano: cliente pedir atendente humano\n- Atualizar_Obs_Pedido: observacoes ao pedido ja registrado\n- Enviar_Cardapio_Arquivo: passa arquivo_drive_id quando cliente pedir imagem do produto\n- Lembrar_Cliente: salvar nome/endereco/preferencias quando identificados\n- Sempre confirme endereco de entrega antes de registrar o pedido`;

return [{
  json: {
    systemMessage,
    userMessage: msg || info.mensagem || '',
    sessionId: `${pizzaria.id}-${info.telefone}`,
    pizzaria_id: pizzaria.id,
    cliente_id: cliente.id,
    telefone: info.telefone,
    instancia: info.instancia,
    has_audio: info.has_audio
  }
}];"""

for n in wf['nodes']:
    if n.get('id') == 'n22':
        old_code = n['parameters'].get('jsCode', '')
        if old_code != NEW_JS:
            n['parameters']['jsCode'] = NEW_JS
            changes.append('[Montar Contexto n22] reescrito - cardapio agora e RESUMO por categoria')
        break

# =============================================================
# 2. NOVO TOOL: Consultar_Cardapio (n_consulta)
# =============================================================
TOOL_DESC = (
    "Lista todos os produtos disponiveis em uma categoria especifica do cardapio. "
    "Use SEMPRE que o cliente perguntar sobre uma categoria (\"quais pizzas voces tem?\", "
    "\"me ve as bebidas\", \"tem lanche?\") ou citar um produto especifico. "
    "Retorna: id, nome, preco, descricao, arquivo_drive_id de cada item disponivel. "
    "Parametro: categoria (string) - nome da categoria conforme aparece na lista de categorias do contexto."
)

# pizzaria_id embedded no SQL (mesma pratica dos outros tools)
TOOL_QUERY = (
    "SELECT id, nome, preco, descricao, arquivo_drive_id "
    "FROM public.produtos "
    "WHERE pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid "
    "AND categoria ILIKE $1 "
    "AND disponivel = true "
    "ORDER BY ordem NULLS LAST, nome;"
)

TOOL_REPL = (
    "={{ $fromAI('categoria', 'Nome da categoria do cardapio (ex: Pizzas, Bebidas, Lanches)', 'string') }}"
)

consulta_exists = any(n.get('id') == 'n_consulta' for n in wf['nodes'])

if not consulta_exists:
    new_tool = {
        "parameters": {
            "descriptionType": "manual",
            "toolDescription": TOOL_DESC,
            "operation": "executeQuery",
            "query": TOOL_QUERY,
            "options": {
                "queryReplacement": TOOL_REPL
            }
        },
        "id": "n_consulta",
        "name": "Tool: Consultar_Cardapio",
        "type": "n8n-nodes-base.postgresTool",
        "typeVersion": 2.5,
        "position": [1760, 480],
        "credentials": {
            "postgres": {
                "id": "3gxY8xTADs50F07C",
                "name": "Postgres pizzabot"
            }
        }
    }
    wf['nodes'].append(new_tool)
    changes.append('[Tool: Consultar_Cardapio] novo node criado (postgresTool com $fromAI categoria)')
else:
    # Atualiza se ja existir
    for n in wf['nodes']:
        if n.get('id') == 'n_consulta':
            p = n['parameters']
            p['toolDescription'] = TOOL_DESC
            p['query'] = TOOL_QUERY
            p.setdefault('options',{})['queryReplacement'] = TOOL_REPL
            changes.append('[Tool: Consultar_Cardapio] atualizado')
            break

# =============================================================
# 3. CONEXAO: Tool: Consultar_Cardapio -> Secretaria (ai_tool)
# =============================================================
conn = wf.setdefault('connections', {})
consulta_conn = conn.setdefault('Tool: Consultar_Cardapio', {})
ai_tool_outs = consulta_conn.setdefault('ai_tool', [[]])

already = any(
    c.get('node') == 'Secretaria'
    for lst in ai_tool_outs
    for c in lst
)

if not already:
    if ai_tool_outs and len(ai_tool_outs) > 0:
        ai_tool_outs[0].append({"node":"Secretaria","type":"ai_tool","index":0})
    else:
        ai_tool_outs = [[{"node":"Secretaria","type":"ai_tool","index":0}]]
    conn['Tool: Consultar_Cardapio'] = {'ai_tool': ai_tool_outs}
    changes.append('[Conexao] Tool: Consultar_Cardapio -> Secretaria (ai_tool)')

# =============================================================
# PUSH
# =============================================================
print('Mudancas:' if changes else 'Nada mudou.')
for c in changes:
    print(f'  - {c}')

if not changes: sys.exit(0)

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
        print(f'\nOK! active={result.get("active")} | total nodes={len(result["nodes"])}')

        # Confere tools conectados ao Secretaria
        print('\n[Check] Tools conectados ao Secretaria:')
        for src, conns in result.get('connections',{}).items():
            for ctype, branches in conns.items():
                if ctype == 'ai_tool':
                    for b in branches:
                        for c in b:
                            if c.get('node') == 'Secretaria':
                                print(f'  - {src}')

except urllib.error.HTTPError as e:
    print(f'\nHTTP {e.code}: {e.read().decode()[:1000]}')
