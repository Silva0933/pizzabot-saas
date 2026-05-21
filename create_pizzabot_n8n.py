import json
import os

filepath = 'E:/Tops Ferramentas/PizzaBot/n8n/1. Secretaria.json'
outpath = 'E:/Tops Ferramentas/PizzaBot/n8n/2. PizzaBot_Agente.json'

with open(filepath, 'r', encoding='utf-8') as f:
    wf = json.load(f)

# Modificar o Agent "Secretária" -> "PizzaBot"
for node in wf['nodes']:
    if node['name'] == 'Secretária':
        node['name'] = 'PizzaBot Agente'
        node['parameters']['text'] = """={{ $json.mensagem }}

## PAPEL
Você é o PizzaBot, o assistente virtual exclusivo da Don Peppone Pizzaria.
Sua missão é atender aos clientes no WhatsApp de maneira ágil, simpática e eficiente.

## PERSONALIDADE E TOM DE VOZ
- Simpático, acolhedor e com emojis de comida 🍕
- Respostas curtas e diretas.

## OBJETIVO
1. Dar boas-vindas.
2. Mostrar o cardápio usando a ferramenta 'Consultar_Cardapio'.
3. Receber o pedido (anotar os itens e calcular valor).
4. Registrar o pedido no sistema usando 'Registrar_Pedido'.

## REGRAS IMPORTANTES
1. Não invente produtos que não estão no cardápio.
2. Sempre confirme os itens e o valor total com o cliente ANTES de registrar o pedido.
3. Se o cliente estiver bravo ou fizer perguntas fora do escopo (ex: "Qual o sentido da vida?"), use a ferramenta 'Escalar_Humano'.
4. Após o registro com sucesso do pedido, informe que está sendo preparado.
"""

# Remover ferramentas desnecessárias
nodes_to_remove = ['MCP Google Calendar', 'Baixar e enviar arquivo', 'MCP Google Calendar.', 'Enviar alerta de cancelamento', 'Escalar humano']
wf['nodes'] = [n for n in wf['nodes'] if n['name'] not in nodes_to_remove]

# Criar Novas Ferramentas
tool_cardapio = {
  "parameters": {
    "toolDescription": "Retorna o cardápio da pizzaria com nomes, descrições e preços dos produtos.",
    "method": "GET",
    "url": "SUA_SUPABASE_URL_AQUI/rest/v1/produtos?select=*",
    "sendHeaders": True,
    "headerParameters": {
      "parameters": [
        { "name": "apikey", "value": "SUA_SUPABASE_KEY_AQUI" },
        { "name": "Authorization", "value": "Bearer SUA_SUPABASE_KEY_AQUI" }
      ]
    }
  },
  "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
  "typeVersion": 1.1,
  "position": [5180, 960],
  "id": "tool-cardapio-123",
  "name": "Consultar_Cardapio"
}

tool_pedido = {
  "parameters": {
    "toolDescription": "Registra um novo pedido no sistema. \nParâmetros necessários:\n- itens (lista de produtos em texto)\n- valor_total (número, ex: 49.90)\n- endereco_entrega (texto longo)\n- forma_pagamento (texto: 'pix', 'cartao', ou 'dinheiro')",
    "method": "POST",
    "url": "SUA_SUPABASE_URL_AQUI/rest/v1/pedidos",
    "sendHeaders": True,
    "headerParameters": {
      "parameters": [
        { "name": "apikey", "value": "SUA_SUPABASE_KEY_AQUI" },
        { "name": "Authorization", "value": "Bearer SUA_SUPABASE_KEY_AQUI" },
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Prefer", "value": "return=minimal" }
      ]
    },
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "{\n  \"pizzaria_id\": \"d8e6a570-5b5c-4217-a068-011dfd04085b\",\n  \"cliente_id\": \"c5c83b8b-18a0-4386-8800-ec8a0c20be53\",\n  \"itens\": [{ \"name\": \"{itens}\", \"qty\": 1, \"priceUnit\": {valor_total} }],\n  \"valor_total\": {valor_total},\n  \"endereco_entrega\": \"{endereco_entrega}\",\n  \"forma_pagamento\": \"{forma_pagamento}\",\n  \"status\": \"novo\",\n  \"bot_ativo\": false\n}"
  },
  "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
  "typeVersion": 1.1,
  "position": [5380, 960],
  "id": "tool-pedido-123",
  "name": "Registrar_Pedido"
}

wf['nodes'].extend([tool_cardapio, tool_pedido])

# Ajustar as conexões do PizzaBot Agente
if 'Secretária' in wf['connections']:
    wf['connections']['PizzaBot Agente'] = wf['connections'].pop('Secretária')

# Conectar as novas ferramentas ao Agente
# As ferramentas no langchain entram na entrada index 1 do Agente
agent_inputs = wf['connections'].get('PizzaBot Agente', {}).get('main', [[]])[0]
# Limpar ferramentas velhas da conexao
for old in nodes_to_remove:
    if old in wf['connections']:
        del wf['connections'][old]

wf['connections']['Consultar_Cardapio'] = {"main": [[{"node": "PizzaBot Agente", "type": "main", "index": 1}]]}
wf['connections']['Registrar_Pedido'] = {"main": [[{"node": "PizzaBot Agente", "type": "main", "index": 1}]]}

with open(outpath, 'w', encoding='utf-8') as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)

print("Gerado com sucesso!")
