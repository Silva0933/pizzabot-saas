-- v1.6 - Simplified payment onboarding
-- Keeps new tenants on Asaas/Mercado Pago only. The key is added later in the quick setup.

ALTER TABLE public.pizzarias
  ALTER COLUMN gateway_pagamento SET DEFAULT 'mercadopago';

UPDATE public.pizzarias
   SET gateway_pagamento = 'mercadopago'
 WHERE gateway_pagamento IS NULL
    OR gateway_pagamento = 'nenhum';

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
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  current_email := auth.jwt() ->> 'email';

  IF EXISTS (
    SELECT 1
    FROM public.equipe_pizzaria ep
    WHERE ep.user_id = auth.uid()
      OR lower(ep.email) = lower(current_email)
  ) THEN
    RAISE EXCEPTION 'Este usuário já está vinculado a uma pizzaria.';
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
    mensagens_status
  )
  VALUES (
    NULLIF(trim(p_nome), ''),
    COALESCE(NULLIF(trim(p_instancia), ''), 'pizzabot-' || replace(auth.uid()::text, '-', '')),
    NULLIF(trim(p_telefone_admin), ''),
    'basico',
    true,
    'Você é o PizzaBot, o assistente virtual da pizzaria. Seja simpático, rápido e ajude o cliente a fechar o pedido.',
    'mercadopago',
    '{"seg-sex": "18:00 - 23:00", "sab-dom": "18:00 - 00:00"}'::jsonb,
    'Agradecemos a preferência! Seu pedido foi entregue com sucesso.',
    '{"confirmado":"Pagamento aprovado! Seu pedido já está na fila de preparação.","no_forno":"Boa notícia! Seu pedido está no forno.","a_caminho":"Seu pedido saiu para entrega e chegará em breve.","entregue":"Agradecemos a preferência! Seu pedido foi entregue com sucesso."}'::jsonb
  )
  RETURNING id INTO new_pizzaria_id;

  INSERT INTO public.equipe_pizzaria (pizzaria_id, user_id, email, role, status)
  VALUES (new_pizzaria_id, auth.uid(), current_email, 'Admin', 'Proprietário');

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
    'mercadopago',
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

GRANT EXECUTE ON FUNCTION public.bootstrap_pizzeria(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_pizzeria(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
