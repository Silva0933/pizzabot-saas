"""
Publica no n8n o prompt padrao humanizado do atendimento.

Requer N8N_API_KEY no ambiente:
  $env:N8N_API_KEY="..."
  python n8n/apply_standard_attendance_prompt.py
"""
import json
import os
import re
import sys
import urllib.request


if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

API_KEY = os.environ.get("N8N_API_KEY")
if not API_KEY:
    raise SystemExit("N8N_API_KEY nao encontrado no ambiente. Nada foi publicado.")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF_ID = "eqzbMvnZ7P8uDduU"
BASE = "https://n8nai.secretariaai.eu.cc/api/v1"
URL = f"{BASE}/workflows/{WF_ID}"
ALLOWED_SETTINGS = ["executionOrder", "saveManualExecutions", "callerPolicy", "errorWorkflow", "timezone"]


def read_text(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()


prompt_source = read_text("src/lib/defaultPrompts.ts")
match = re.search(
    r"STANDARD_PIZZERIA_ATTENDANCE_PROMPT = `([\s\S]*?)`;\n\nexport const PROMPT_PRESETS",
    prompt_source,
)
if not match:
    raise SystemExit("Prompt padrao nao encontrado em src/lib/defaultPrompts.ts")

standard_prompt = match.group(1)
montar_contexto = read_text("n8n/standard_montar_contexto.js").replace(
    "__STANDARD_PROMPT_JSON__",
    json.dumps(standard_prompt, ensure_ascii=False),
)

req = urllib.request.Request(URL, headers={"X-N8N-API-KEY": API_KEY})
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read())

changes = []
registrar_node = next((n for n in wf.get("nodes", []) if n.get("name") == "Tool: Registrar_Pedido"), None)

def replace_in_params(node, replacements):
    text = json.dumps(node.get("parameters", {}), ensure_ascii=False)
    original = text
    for old, new in replacements:
        text = text.replace(old, new)
    if text != original:
        node["parameters"] = json.loads(text)
        return True
    return False

schema_replacements = [
    ("$fromAI('itens','Array novo de itens [{nome,qtd,preco_unit}] - opcional','json')", "$fromAI('itens','Array de objetos [{nome, qtd, preco_unit, observacao}]','json')"),
    ("$fromAI('itens','','json')", "$fromAI('itens','Array de objetos [{nome, qtd, preco_unit, observacao}]','json')"),
    ("$fromAI('valor_total','Novo valor total - opcional','string')", "$fromAI('valor_total','Valor total em R$','number')"),
    ("$fromAI('forma_pagamento','Nova forma: pix/cartao/dinheiro - opcional','string')", "$fromAI('forma_pagamento','pix, cartao ou dinheiro','string')"),
    ("$fromAI('observacoes','Observacoes do cliente - opcional','string')", "$fromAI('observacoes','Observacoes do cliente','string')"),
    ("$fromAI('observacoes', 'Observa??es do cliente', 'string')", "$fromAI('observacoes','Observacoes do cliente','string')"),
    ("$fromAI('endereco','Novo endereco - opcional','string')", "$fromAI('endereco','Endereco do cliente','string')"),
    ("$fromAI('endereco','Endere?o padr?o (vazio se n?o alterar)','string')", "$fromAI('endereco','Endereco do cliente','string')"),
    ("$fromAI('pedido_id', 'UUID do pedido criado', 'string')", "$fromAI('pedido_id','UUID do pedido','string')"),
    ("$fromAI('pedido_id','UUID do pedido a alterar','string')", "$fromAI('pedido_id','UUID do pedido','string')"),
    ("$fromAI('pedido_id','UUID do pedido a cancelar','string')", "$fromAI('pedido_id','UUID do pedido','string')"),
    ("$fromAI('motivo','Motivo do cancelamento informado pelo cliente','string')", "$fromAI('motivo','Motivo informado pelo cliente','string')"),
    ("$fromAI('motivo','Motivo informado','string')", "$fromAI('motivo','Motivo informado pelo cliente','string')"),
    ("$fromAI('tipo','imagem ou documento','string')", "$fromAI('tipo_arquivo','imagem ou documento','string')"),
    ("Parâmetros: file_id (ID do arquivo no Drive, vem do campo [drive:...] do cardápio), tipo (imagem|documento)", "Parâmetros: file_id (ID do arquivo no Drive, vem do campo [drive:...] do cardápio), tipo_arquivo (imagem|documento)"),
    ("Par?metros: file_id (ID do arquivo no Drive, vem do campo [drive:...] do card?pio), tipo (imagem|documento)", "Parametros: file_id (ID do arquivo no Drive, vem do campo [drive:...] do cardapio), tipo_arquivo (imagem|documento)"),
]

for node in wf.get("nodes", []):
    if replace_in_params(node, schema_replacements):
        changes.append(f"{node.get('name')} teve schemas $fromAI padronizados.")

    if node.get("name") == "Tool: Gerar_Pagamento_PIX":
        json_body = (
            "={{ JSON.stringify({ "
            "event: 'generate_payment', "
            "pedido_id: $fromAI('pedido_id','UUID do pedido','string'), "
            "pizzaria_id: $('Montar Contexto').item.json.pizzaria_id, "
            "telefone: $('Montar Contexto').item.json.telefone, "
            "instancia: $('Montar Contexto').item.json.instancia "
            "}) }}"
        )
        if node.setdefault("parameters", {}).get("jsonBody") != json_body:
            node["parameters"]["jsonBody"] = json_body
            changes.append("Tool Gerar_Pagamento_PIX agora usa JSON.stringify sem propriedades vazias.")

    if node.get("name") == "Tool: Escalar_Humano":
        query = (
            "UPDATE public.conversas "
            "SET bot_ativo = false, status = 'Humano necessario', updated_at = NOW() "
            "WHERE pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid "
            "AND cliente_telefone = '{{ $('Montar Contexto').item.json.telefone }}' "
            "RETURNING id;"
        )
        params = node.setdefault("parameters", {})
        if params.get("query") != query or "options" in params:
            params["query"] = query
            params.pop("options", None)
            changes.append("Tool Escalar_Humano deixou de expor queryReplacement vazio ao agente.")

    if node.get("name") in {"Tool: Enviar_alerta_cancelamento", "Tool: Reagir_mensagem"}:
        params = node.setdefault("parameters", {})
        headers = params.get("parametersHeaders", {}).get("values")
        if headers and any(value == {} for value in headers):
            params.pop("parametersHeaders", None)
            params["sendHeaders"] = False
            changes.append(f"{node.get('name')} teve header vazio removido.")

    if node.get("name") == "Upsert Conversa":
        query = node.get("parameters", {}).get("query", "")
        updated_query = query.replace("RETURNING id, bot_ativo;", "RETURNING id, bot_ativo, messages;")
        if updated_query != query:
            node.setdefault("parameters", {})["query"] = updated_query
            changes.append("Upsert Conversa agora retorna historico para detectar primeira resposta.")

    if node.get("name") == "Carregar Pizzaria":
        query = (
            "SELECT id, nome, endereco, prompt_personalizado, bot_ativo_global, "
            "gateway_pagamento, mensagens_status, telefone_admin, horario_funcionamento "
            "FROM public.pizzarias WHERE instancia = $1 LIMIT 1;"
        )
        if node.get("parameters", {}).get("query") != query:
            node.setdefault("parameters", {})["query"] = query
            changes.append("Carregar Pizzaria agora busca endereco e horario_funcionamento.")

    if node.get("name") == "Montar Contexto":
        if node.get("parameters", {}).get("jsCode") != montar_contexto:
            node.setdefault("parameters", {})["jsCode"] = montar_contexto
            changes.append("Montar Contexto atualizado com prompt padrao humanizado.")

consulta_description = (
    "Consulta produtos disponiveis por categoria, sabor ou termo do cardapio. "
    "Use sempre que o cliente perguntar quais sabores/produtos existem, pedir precos "
    "ou citar uma categoria. Retorna no maximo 8 itens por chamada para evitar mensagens longas. "
    "Ao responder, mostre nome e preco, sem emojis e sem descricoes longas. "
    "Se total_categoria for maior que 8, avise que ha mais opcoes e pergunte se o cliente quer continuar vendo."
)
consulta_query = (
    "SELECT id, nome, categoria, preco, arquivo_drive_id, COUNT(*) OVER() AS total_categoria "
    "FROM public.produtos "
    "WHERE pizzaria_id = '{{ $('Montar Contexto').item.json.pizzaria_id }}'::uuid "
    "AND disponivel = true "
    "AND (categoria ILIKE '%' || $1 || '%' OR nome ILIKE '%' || $1 || '%' OR COALESCE(descricao, '') ILIKE '%' || $1 || '%') "
    "ORDER BY categoria, ordem NULLS LAST, nome "
    "LIMIT 8;"
)
consulta_replacement = "={{ $fromAI('categoria_ou_termo', 'Categoria, sabor ou termo buscado no cardapio. Ex: pizza, tradicional, calabresa, bebida', 'string') }}"

consulta_node = next((n for n in wf.get("nodes", []) if n.get("id") == "n_consulta" or n.get("name") == "Tool: Consultar_Cardapio"), None)
consulta_payload = {
    "parameters": {
        "descriptionType": "manual",
        "toolDescription": consulta_description,
        "operation": "executeQuery",
        "query": consulta_query,
        "options": {"queryReplacement": consulta_replacement},
    },
    "id": "n_consulta",
    "name": "Tool: Consultar_Cardapio",
    "type": "n8n-nodes-base.postgresTool",
    "typeVersion": 2.5,
    "position": [1760, 520],
    "credentials": registrar_node.get("credentials") if registrar_node else {
        "postgres": {"id": "3gxY8xTADs50F07C", "name": "Postgres pizzabot"}
    },
}

if consulta_node:
    before = json.dumps(consulta_node, sort_keys=True, ensure_ascii=False)
    consulta_node.update(consulta_payload)
    after = json.dumps(consulta_node, sort_keys=True, ensure_ascii=False)
    if before != after:
        changes.append("Tool Consultar_Cardapio atualizada com limite de 8 itens.")
else:
    wf.setdefault("nodes", []).append(consulta_payload)
    changes.append("Tool Consultar_Cardapio criada com consulta paginada por categoria/termo.")

connections = wf.setdefault("connections", {})
node_names = {node.get("name") for node in wf.get("nodes", [])}
removed_connections = []
for source_name in list(connections.keys()):
    if source_name not in node_names:
        removed_connections.append(source_name)
        del connections[source_name]
        continue
    for output_type, outputs in list((connections.get(source_name) or {}).items()):
        for output in outputs or []:
            if isinstance(output, list):
                output[:] = [target for target in output if target.get("node") in node_names]
if removed_connections:
    changes.append("Conexoes orfas removidas: " + ", ".join(removed_connections))

consulta_connections = connections.setdefault("Tool: Consultar_Cardapio", {})
ai_tool = consulta_connections.setdefault("ai_tool", [[]])
if not ai_tool:
    ai_tool.append([])
already_connected = any(
    c.get("node") == "Secretaria" and c.get("type") == "ai_tool"
    for output in ai_tool
    for c in output
)
if not already_connected:
    ai_tool[0].append({"node": "Secretaria", "type": "ai_tool", "index": 0})
    changes.append("Tool Consultar_Cardapio conectada ao agente Secretaria.")

if not changes:
    print("Nada mudou. Workflow remoto ja estava atualizado.")
    raise SystemExit(0)

payload = {
    "name": wf["name"],
    "nodes": wf["nodes"],
    "connections": wf["connections"],
    "settings": {k: v for k, v in wf.get("settings", {}).items() if k in ALLOWED_SETTINGS},
}

put_req = urllib.request.Request(
    URL,
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    method="PUT",
    headers={"X-N8N-API-KEY": API_KEY, "Content-Type": "application/json"},
)
with urllib.request.urlopen(put_req) as resp:
    result = json.loads(resp.read())

print("Publicado no n8n.")
print(f"Workflow ativo: {result.get('active')}")
for change in changes:
    print(f"- {change}")
