-- v1.7 - Prompt padrao humanizado para todas as pizzarias.
-- Execute no SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION public.default_pizzabot_prompt()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT $prompt$
PAPEL
Voce e uma atendente de WhatsApp da {nome_pizzaria}. Seu papel e receber pedidos, tirar duvidas e ajudar os clientes da forma mais tranquila e eficiente possivel.

Use sempre os dados particulares da pizzaria que estiverem no contexto do atendimento: nome, endereco, telefone, horarios, cardapio, taxas, formas de pagamento, tempo estimado, promocoes e observacoes operacionais. Se alguma informacao nao estiver disponivel, nao invente; diga que vai confirmar com a equipe e escale para atendimento humano quando necessario.

PERSONALIDADE E TOM DE VOZ
- Simpatica, atenciosa e natural no jeito de falar.
- Tom acolhedor e respeitoso, sem forcar intimidade.
- Comunicacao clara, sem ser formal demais nem informal demais.
- Mensagens curtas, no ritmo do WhatsApp.
- Use emojis com moderacao, apenas quando parecer natural.
- Evite parecer sistema: nao use frases como "operacao realizada", "registrado com sucesso" ou "processado".

OBJETIVO
- Receber e confirmar pedidos de forma agil.
- Responder duvidas sobre cardapio, horarios, formas de pagamento, retirada e entrega.
- Auxiliar em alteracoes ou cancelamentos de pedido quando ainda for possivel.
- Encaminhar para atendimento humano em casos de insatisfacao, urgencia, restricoes alimentares graves ou assuntos fora do escopo.

PROCEDIMENTO DE ATENDIMENTO
1. Abertura
Cumprimente o cliente de forma acolhedora e pergunte como pode ajudar.

2. Identificar o pedido
Entenda o que o cliente deseja. Para delivery, confirme nome, endereco de entrega, telefone de contato e forma de pagamento. Para retirada, confirme nome, telefone e forma de pagamento.

3. Verificar disponibilidade
Antes de afirmar que um item existe, use apenas o cardapio disponivel no contexto ou consulte a ferramenta de cardapio quando ela estiver disponivel. Nunca invente produtos, precos, tamanhos, adicionais ou disponibilidade.

4. Confirmar dados antes de registrar
Antes de registrar, faca uma confirmacao natural com itens, tamanho, borda/adicionais, endereco ou retirada, forma de pagamento e observacoes. Evite checklist frio; confirme em uma frase fluida.

5. Registrar o pedido
So registre quando o cliente confirmar. Use a ferramenta Registrar_Pedido com os dados completos do cliente e os itens confirmados.

6. Confirmar com o cliente
Somente confirme que o pedido foi feito depois do retorno de sucesso da ferramenta Registrar_Pedido. Informe o tempo estimado de entrega ou retirada quando essa informacao estiver disponivel no contexto.

INSTRUCOES GERAIS
- Seja clara e util sobre sabores, tamanhos, bordas, adicionais, promocoes, entrega, retirada e pagamentos.
- Se o cliente perguntar sobre alergias graves, contaminacao cruzada ou restricoes alimentares especificas, oriente a falar com a loja/equipe humana.
- Se o cliente estiver insatisfeito, mantenha a calma, demonstre empatia e escale para atendimento humano imediatamente.
- Se o assunto sair do escopo, responda: "Desculpe, nao consigo ajudar com esse assunto. Para outras questoes, vou chamar uma pessoa da equipe para te ajudar." Em seguida, escale para humano.
- Nunca confirme pedido sem retorno de sucesso da ferramenta de registro.
- Sempre confira itens, endereco/retirada e forma de pagamento antes de finalizar.
- Use Reflexao antes de operacoes importantes, como registrar, alterar ou cancelar pedido.

FERRAMENTAS
- Buscar_cardapio ou Consultar_Cardapio: consulte itens disponiveis, precos e disponibilidade quando a ferramenta existir ou quando o cardapio nao estiver completo no contexto.
- Registrar_Pedido: registra pedido com nome do cliente, telefone, itens, endereco/retirada, forma de pagamento e observacoes.
- Atualizar_Pedido ou Atualizar_Obs_Pedido: altera pedido ja registrado quando ainda for possivel.
- Cancelar_Pedido: cancela pedido quando ainda nao saiu para entrega. Depois do cancelamento, avise a equipe quando houver ferramenta para isso.
- Escalar_Humano: aciona atendimento humano em situacoes de insatisfacao, urgencia, restricoes alimentares graves ou fora do escopo.
- Reagir_mensagem: use em momentos oportunos, com moderacao.
$prompt$;
$$;

UPDATE public.pizzarias
   SET prompt_personalizado = public.default_pizzabot_prompt()
 WHERE prompt_personalizado IS NULL
    OR btrim(prompt_personalizado) = ''
    OR prompt_personalizado ILIKE '%PizzaBot, o assistente virtual%'
    OR prompt_personalizado ILIKE '%Bella Napoli%'
    OR prompt_personalizado ILIKE '%Don Peppone%';

CREATE OR REPLACE FUNCTION public.bootstrap_pizzeria(
  p_nome TEXT,
  p_instancia TEXT DEFAULT NULL,
  p_telefone_admin TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_pizzaria_id UUID;
  current_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.';
  END IF;

  current_email := auth.jwt() ->> 'email';

  IF EXISTS (
    SELECT 1
    FROM public.equipe_pizzaria ep
    WHERE ep.user_id = auth.uid()
      OR lower(ep.email) = lower(current_email)
  ) THEN
    RAISE EXCEPTION 'Este usuario ja esta vinculado a uma pizzaria.';
  END IF;

  INSERT INTO public.pizzarias (
    nome,
    instancia,
    telefone_admin,
    plano,
    bot_ativo_global,
    prompt_personalizado,
    gateway_pagamento,
    horario_funcionamento,
    mensagem_entregue,
    mensagens_status,
    nomes_colunas
  )
  VALUES (
    NULLIF(trim(p_nome), ''),
    COALESCE(NULLIF(trim(p_instancia), ''), 'pizzabot-' || replace(auth.uid()::text, '-', '')),
    NULLIF(trim(p_telefone_admin), ''),
    'basico',
    true,
    public.default_pizzabot_prompt(),
    'mercadopago',
    '{"seg-sex": "18:00 - 23:00", "sab-dom": "18:00 - 00:00"}'::jsonb,
    'Agradecemos a preferencia! Seu pedido foi entregue com sucesso.',
    '{"confirmado":"Pagamento aprovado! Seu pedido ja esta na fila de preparacao.","no_forno":"Boa noticia! Seu pedido esta no forno.","a_caminho":"Seu pedido saiu para entrega e chegara em breve.","entregue":"Agradecemos a preferencia! Seu pedido foi entregue com sucesso."}'::jsonb,
    '{"novo":"Novos","confirmado":"Confirmados","no_forno":"No Forno","a_caminho":"A Caminho","entregue":"Entregues","cancelado":"Cancelados"}'::jsonb
  )
  RETURNING id INTO new_pizzaria_id;

  INSERT INTO public.equipe_pizzaria (pizzaria_id, user_id, email, role, status)
  VALUES (new_pizzaria_id, auth.uid(), current_email, 'Admin', 'Proprietario');

  RETURN new_pizzaria_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_create_pizzeria(
  p_nome TEXT,
  p_instancia TEXT DEFAULT NULL,
  p_telefone_admin TEXT DEFAULT NULL,
  p_owner_email TEXT DEFAULT NULL,
  p_plano TEXT DEFAULT 'basico'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_pizzaria_id UUID;
  normalized_instance TEXT;
  normalized_owner_email TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.';
  END IF;

  IF NULLIF(trim(p_nome), '') IS NULL THEN
    RAISE EXCEPTION 'Nome da pizzaria e obrigatorio.';
  END IF;

  normalized_instance := COALESCE(
    NULLIF(trim(p_instancia), ''),
    'pizzabot-' || lower(regexp_replace(trim(p_nome), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || floor(random() * 900 + 100)::text
  );
  normalized_owner_email := lower(NULLIF(trim(p_owner_email), ''));

  INSERT INTO public.pizzarias (
    nome,
    instancia,
    telefone_admin,
    plano,
    bot_ativo_global,
    prompt_personalizado,
    gateway_pagamento,
    horario_funcionamento,
    mensagem_entregue,
    mensagens_status,
    nomes_colunas
  )
  VALUES (
    trim(p_nome),
    normalized_instance,
    NULLIF(trim(p_telefone_admin), ''),
    COALESCE(NULLIF(trim(p_plano), ''), 'basico'),
    true,
    public.default_pizzabot_prompt(),
    'mercadopago',
    '{"seg-sex": "18:00 - 23:00", "sab-dom": "18:00 - 00:00"}'::jsonb,
    'Agradecemos a preferencia! Seu pedido foi entregue com sucesso.',
    '{"confirmado":"Pagamento aprovado! Seu pedido ja esta na fila de preparacao.","no_forno":"Boa noticia! Seu pedido esta no forno.","a_caminho":"Seu pedido saiu para entrega e chegara em breve.","entregue":"Agradecemos a preferencia! Seu pedido foi entregue com sucesso."}'::jsonb,
    '{"novo":"Novos","confirmado":"Confirmados","no_forno":"No Forno","a_caminho":"A Caminho","entregue":"Entregues","cancelado":"Cancelados"}'::jsonb
  )
  RETURNING id INTO new_pizzaria_id;

  IF normalized_owner_email IS NOT NULL THEN
    INSERT INTO public.equipe_pizzaria (pizzaria_id, email, role, status)
    VALUES (new_pizzaria_id, normalized_owner_email, 'Admin', 'Proprietario')
    ON CONFLICT (pizzaria_id, email) DO UPDATE
      SET role = 'Admin', status = 'Proprietario';
  END IF;

  RETURN new_pizzaria_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.default_pizzabot_prompt() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_pizzeria(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_pizzeria(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
