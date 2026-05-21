-- PizzaBot v1.5 - CRUD de pizzarias pelo painel Admin SaaS.
-- Execute no SQL Editor do Supabase.

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
    RAISE EXCEPTION 'Nome da pizzaria é obrigatório.';
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
    'Você é o PizzaBot, o assistente virtual da pizzaria. Seja simpático, rápido e ajude o cliente a fechar o pedido.',
    'nenhum',
    '{"seg-sex": "18:00 - 23:00", "sab-dom": "18:00 - 00:00"}'::jsonb,
    'Agradecemos a preferência! Seu pedido foi entregue com sucesso.',
    '{"confirmado":"Pagamento aprovado! Seu pedido já está na fila de preparação.","no_forno":"Boa notícia! Seu pedido está no forno.","a_caminho":"Seu pedido saiu para entrega e chegará em breve.","entregue":"Agradecemos a preferência! Seu pedido foi entregue com sucesso."}'::jsonb,
    '{"novo":"Novos","confirmado":"Confirmados","no_forno":"No Forno","a_caminho":"A Caminho","entregue":"Entregues","cancelado":"Cancelados"}'::jsonb
  )
  RETURNING id INTO new_pizzaria_id;

  IF normalized_owner_email IS NOT NULL THEN
    INSERT INTO public.equipe_pizzaria (pizzaria_id, email, role, status)
    VALUES (new_pizzaria_id, normalized_owner_email, 'Admin', 'Proprietário')
    ON CONFLICT (pizzaria_id, email) DO UPDATE
      SET role = 'Admin', status = 'Proprietário';
  END IF;

  RETURN new_pizzaria_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_delete_pizzeria(p_pizzaria_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_instance TEXT;
  target_name TEXT;
  deleted_queue_count INT := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.';
  END IF;

  SELECT instancia, nome
    INTO target_instance, target_name
    FROM public.pizzarias
   WHERE id = p_pizzaria_id;

  IF target_name IS NULL THEN
    RAISE EXCEPTION 'Pizzaria não encontrada.';
  END IF;

  IF target_instance IS NOT NULL AND to_regclass('public.n8n_fila_mensagens') IS NOT NULL THEN
    DELETE FROM public.n8n_fila_mensagens WHERE instancia = target_instance;
    GET DIAGNOSTICS deleted_queue_count = ROW_COUNT;
  END IF;

  DELETE FROM public.pizzarias WHERE id = p_pizzaria_id;

  RETURN jsonb_build_object(
    'ok', true,
    'deletedPizzeriaId', p_pizzaria_id,
    'name', target_name,
    'instance', target_instance,
    'deletedQueueMessages', deleted_queue_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_create_pizzeria(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_delete_pizzeria(UUID) TO authenticated;
