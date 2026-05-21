-- PizzaBot v1.2 — Personalização de colunas do Kanban (PRD sec. 4.4)
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.pizzarias
  ADD COLUMN IF NOT EXISTS nomes_colunas JSONB DEFAULT '{
    "novo": "Novos",
    "confirmado": "Confirmados ✅",
    "no_forno": "No Forno 🍕",
    "a_caminho": "A Caminho 🏍️",
    "entregue": "Entregues 📦",
    "cancelado": "Cancelados ❌"
  }'::jsonb;

-- Backfill default para pizzarias existentes que ainda não tinham
UPDATE public.pizzarias
SET nomes_colunas = '{
  "novo": "Novos",
  "confirmado": "Confirmados ✅",
  "no_forno": "No Forno 🍕",
  "a_caminho": "A Caminho 🏍️",
  "entregue": "Entregues 📦",
  "cancelado": "Cancelados ❌"
}'::jsonb
WHERE nomes_colunas IS NULL OR nomes_colunas = '{}'::jsonb;

-- Atualiza a função bootstrap_pizzeria para incluir os nomes_colunas no defaults
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
    mensagens_status,
    nomes_colunas
  )
  VALUES (
    NULLIF(trim(p_nome), ''),
    COALESCE(NULLIF(trim(p_instancia), ''), 'pizzabot-' || replace(auth.uid()::text, '-', '')),
    NULLIF(trim(p_telefone_admin), ''),
    'basico',
    true,
    'Você é o PizzaBot, o assistente virtual da pizzaria. Seja simpático, rápido e ajude o cliente a fechar o pedido.',
    'nenhum',
    '{"seg-sex": "18:00 - 23:00", "sab-dom": "18:00 - 00:00"}'::jsonb,
    'Agradecemos a preferência! Seu pedido foi entregue com sucesso.',
    '{"confirmado":"Pagamento aprovado! Seu pedido já está na fila de preparação.","no_forno":"Boa notícia! Seu pedido está no forno.","a_caminho":"Seu pedido saiu para entrega e chegará em breve.","entregue":"Agradecemos a preferência! Seu pedido foi entregue com sucesso."}'::jsonb,
    '{"novo":"Novos","confirmado":"Confirmados ✅","no_forno":"No Forno 🍕","a_caminho":"A Caminho 🏍️","entregue":"Entregues 📦","cancelado":"Cancelados ❌"}'::jsonb
  )
  RETURNING id INTO new_pizzaria_id;

  INSERT INTO public.equipe_pizzaria (pizzaria_id, user_id, email, role, status)
  VALUES (new_pizzaria_id, auth.uid(), current_email, 'Admin', 'Proprietário');

  RETURN new_pizzaria_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_pizzeria(TEXT, TEXT, TEXT) TO authenticated;
