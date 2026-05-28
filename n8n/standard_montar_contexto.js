const produtos = $input.all().map(i => i.json);
const cliente = $('Upsert Cliente (RAG)').first().json;
const pizzaria = $('Carregar Pizzaria').first().json;
const conversa = $('Upsert Conversa').first().json;
const info = $('Info').first().json;
const msg = $('Consolidar mensagens').first().json.mensagem_consolidada;

const byCat = {};
for (const p of produtos) {
  const cat = p.categoria || 'outro';
  if (!byCat[cat]) byCat[cat] = [];
  byCat[cat].push(`- ${p.nome} (R$ ${Number(p.preco).toFixed(2)}) [id:${p.id}]${p.arquivo_drive_id ? ` [drive:${p.arquivo_drive_id}]` : ''}${p.descricao ? ` - ${p.descricao}` : ''}`);
}

let cardapioResumo = '';
for (const cat of Object.keys(byCat).sort()) {
  const count = byCat[cat].length;
  cardapioResumo += `\n- ${cat} (${count} ${count === 1 ? 'item' : 'itens'})`;
}
if (!cardapioResumo.trim()) cardapioResumo = '\n(sem produtos cadastrados)';

const formatHours = (value) => {
  if (!value) return 'nao informado';
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return value;
    }
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([periodo, horario]) => `${periodo}: ${horario}`).join(' | ');
  }
  return String(value);
};

let ragContext = '';
if (cliente?.total_pedidos > 0) {
  ragContext = `\n\nCLIENTE RECORRENTE:\nNome: ${cliente.nome || 'sem nome'}\nEndereco padrao: ${cliente.endereco_padrao || 'nao informado'}\nPreferencias: ${cliente.preferencias || 'nenhuma'}\nTotal de pedidos: ${cliente.total_pedidos} | Total gasto: R$ ${Number(cliente.total_gasto || 0).toFixed(2)}\nUltima visita: ${cliente.ultima_visita || 'nunca'}`;
  if (Array.isArray(cliente.historico_pedidos) && cliente.historico_pedidos.length) {
    const last = cliente.historico_pedidos.slice(-3).map(h => `. ${h.date || ''}: ${h.items || ''} (R$ ${Number(h.total || 0).toFixed(2)})`).join('\n');
    ragContext += `\nUltimos pedidos:\n${last}`;
  }
} else {
  ragContext = `\n\nCLIENTE NOVO: primeiro contato (telefone ${info.telefone}).`;
}

const standardPrompt = __STANDARD_PROMPT_JSON__;
const promptFromTenant = String(pizzaria.prompt_personalizado || '').trim();
const looksLikeFullPrompt = /PAPEL|PERSONALIDADE|OBJETIVO|PizzaBot|assistente virtual|atendente de WhatsApp/i.test(promptFromTenant);
const variables = {
  nome_pizzaria: pizzaria.nome || 'a pizzaria',
  endereco_pizzaria: pizzaria.endereco || 'nao informado',
  telefone_pizzaria: pizzaria.telefone_admin || 'nao informado',
  horario_funcionamento: formatHours(pizzaria.horario_funcionamento),
  cardapio_disponivel: cardapioResumo,
  nome_cliente: cliente.nome || 'nao informado',
  telefone: info.telefone || 'nao informado',
  endereco_padrao: cliente.endereco_padrao || 'nao informado',
  preferencias: cliente.preferencias || 'sem preferencias',
  historico_pedidos: JSON.stringify((cliente.historico_pedidos || []).slice(-10)),
  total_pedidos: String(cliente.total_pedidos || 0),
  total_gasto: `R$ ${Number(cliente.total_gasto || 0).toFixed(2)}`
};

const applyVariables = (text) => String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => variables[key] ?? match);
const basePrompt = applyVariables(standardPrompt);
const tenantNotes = promptFromTenant && !looksLikeFullPrompt ? applyVariables(promptFromTenant) : '';
const messages = Array.isArray(conversa?.messages) ? conversa.messages : [];
const botReplyCount = messages.filter(m => ['bot', 'human'].includes(m?.sender)).length;
const isFirstBotReply = botReplyCount === 0;

const dadosPizzaria = `NOME: ${variables.nome_pizzaria}\nENDERECO: ${variables.endereco_pizzaria}\nTELEFONE/WHATSAPP: ${variables.telefone_pizzaria}\nHORARIOS: ${variables.horario_funcionamento}`;

const systemMessage = `${basePrompt}
${tenantNotes ? `\n## OBSERVACOES ESPECIFICAS DA PIZZARIA\n${tenantNotes}\n` : ''}

## DADOS PARTICULARES DA PIZZARIA
${dadosPizzaria}

## CARDAPIO DISPONIVEL
${cardapioResumo}
${ragContext}

## REGRAS OPERACIONAIS DO WORKFLOW
- Responda sempre em portugues brasileiro natural, como atendimento de WhatsApp.
- Esta e a primeira resposta do bot nesta conversa? ${isFirstBotReply ? 'SIM' : 'NAO'}.
- Se for a primeira resposta, comece obrigatoriamente com saudacao adequada ao horario e identificacao da pizzaria. Exemplo: "Bom dia! Aqui e o atendimento da ${variables.nome_pizzaria}."
- Se o cliente enviou varias mensagens em sequencia, responda ao pedido principal depois da saudacao, sem ignorar o cumprimento.
- O contexto mostra apenas categorias e contagens para economizar tokens.
- Quando o cliente perguntar por produtos, sabores, precos ou itens de uma categoria, use obrigatoriamente Consultar_Cardapio antes de responder.
- Ao mostrar produtos, envie no maximo 8 itens por mensagem. Se houver mais, diga que existem mais opcoes e pergunte se o cliente quer continuar vendo.
- Se o cliente perguntar "o que tem disponivel?", responda com as categorias disponiveis e pergunte qual categoria ele quer ver. Nao envie todos os produtos.
- Use APENAS itens retornados por Consultar_Cardapio ou itens claramente presentes no contexto.
- Nunca invente produto, preco, tamanho, borda, taxa, prazo ou disponibilidade.
- Mantenha profissionalismo. Nao use piadas, frases pessoais, entusiasmo artificial ou exageros.
- Nao use: "que delicia", "que maravilha", "sabores incriveis", "te apetece", "adoro pizza", "uma de cada?", "hoje esta pedindo pizza", nem frases parecidas.
- Em respostas de cardapio, nao use emojis.
- Liste sabores de forma limpa: nome e preco. Nao inclua descricao dos ingredientes, salvo se o cliente pedir detalhes de um sabor.
- Ao confirmar o pedido, use Registrar_Pedido passando o array de itens com {nome, qtd, preco_unit}.
- Antes de Registrar_Pedido, confirme de forma natural itens, endereco/retirada, forma de pagamento e observacoes.
- Depois de Registrar_Pedido, confirme o pedido ao cliente somente se a ferramenta retornar sucesso.
- Apos registrar, se o cliente quiser pagar via PIX/cartao, use Gerar_Pagamento_PIX com o id retornado pelo Registrar_Pedido.
- O workflow de pagamento envia o link/PIX em mensagem separada; na resposta principal, apenas diga que vai enviar o pagamento.
- Se Gerar_Pagamento_PIX retornar ok=false, acione Escalar_Humano e diga que a equipe vai ajudar.
- Use Escalar_Humano se o cliente pedir atendente, estiver insatisfeito, tiver urgencia, restricao alimentar grave ou assunto fora do escopo.
- Use Atualizar_Obs_Pedido para adicionar observacoes ao pedido ja registrado.
- Use Enviar_Cardapio_Arquivo passando o file_id do produto (arquivo_drive_id) quando o cliente pedir imagem do produto.
- Use Lembrar_Cliente para salvar nome, endereco e preferencias quando identificados.
- Nao use listas numeradas frias para confirmar pedido; confirme em frase curta e fluida.
- Nao finalize toda mensagem com despedida corporativa.`;

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
}];
