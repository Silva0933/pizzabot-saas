-- PizzaBot: upgrade incremental para bancos criados antes deste ajuste.
-- Execute no SQL Editor do Supabase se o schema.sql original ja estava aplicado.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.pizzarias
  ADD COLUMN IF NOT EXISTS endereco TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS mensagens_status JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.equipe_pizzaria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Atendente',
    status TEXT NOT NULL DEFAULT 'Pendente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pizzaria_id, email)
);

ALTER TABLE public.equipe_pizzaria
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversas_pizzaria_id_cliente_telefone_key'
  ) THEN
    ALTER TABLE public.conversas
      ADD CONSTRAINT conversas_pizzaria_id_cliente_telefone_key UNIQUE (pizzaria_id, cliente_telefone);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_pizzeria_member(target_pizzaria_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.equipe_pizzaria ep
    WHERE ep.pizzaria_id = target_pizzaria_id
      AND ep.status IN ('Ativo', 'Proprietário', 'Pendente')
      AND (
        ep.user_id = auth.uid()
        OR lower(ep.email) = lower(auth.jwt() ->> 'email')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_pizzeria_role(target_pizzaria_id UUID, allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.equipe_pizzaria ep
    WHERE ep.pizzaria_id = target_pizzaria_id
      AND ep.status IN ('Ativo', 'Proprietário', 'Pendente')
      AND ep.role = ANY(allowed_roles)
      AND (
        ep.user_id = auth.uid()
        OR lower(ep.email) = lower(auth.jwt() ->> 'email')
      )
  );
$$;

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
    'nenhum',
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

GRANT EXECUTE ON FUNCTION public.bootstrap_pizzeria(TEXT, TEXT, TEXT) TO authenticated;

ALTER TABLE public.pizzarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_pizzaria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.pizzarias;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.produtos;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.clientes;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.pedidos;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.conversas;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.equipe_pizzaria;
DROP POLICY IF EXISTS "Enable read for anonymous" ON public.pizzarias;
DROP POLICY IF EXISTS "Enable read for anonymous" ON public.produtos;
DROP POLICY IF EXISTS "Enable insert for anonymous" ON public.pedidos;
DROP POLICY IF EXISTS "Enable update for anonymous" ON public.pedidos;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.clientes;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.conversas;
DROP POLICY IF EXISTS "Enable read for anonymous" ON public.equipe_pizzaria;

DROP POLICY IF EXISTS "Members can read pizzerias" ON public.pizzarias;
CREATE POLICY "Members can read pizzerias" ON public.pizzarias
  FOR SELECT USING (public.is_pizzeria_member(id));

DROP POLICY IF EXISTS "Admins can update pizzerias" ON public.pizzarias;
CREATE POLICY "Admins can update pizzerias" ON public.pizzarias
  FOR UPDATE USING (public.has_pizzeria_role(id, ARRAY['Admin']))
  WITH CHECK (public.has_pizzeria_role(id, ARRAY['Admin']));

DROP POLICY IF EXISTS "Members can manage products" ON public.produtos;
CREATE POLICY "Members can manage products" ON public.produtos
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id))
  WITH CHECK (public.is_pizzeria_member(pizzaria_id));

DROP POLICY IF EXISTS "Members can manage customers" ON public.clientes;
CREATE POLICY "Members can manage customers" ON public.clientes
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id))
  WITH CHECK (public.is_pizzeria_member(pizzaria_id));

DROP POLICY IF EXISTS "Members can manage orders" ON public.pedidos;
CREATE POLICY "Members can manage orders" ON public.pedidos
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id))
  WITH CHECK (public.is_pizzeria_member(pizzaria_id));

DROP POLICY IF EXISTS "Members can manage conversations" ON public.conversas;
CREATE POLICY "Members can manage conversations" ON public.conversas
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id))
  WITH CHECK (public.is_pizzeria_member(pizzaria_id));

DROP POLICY IF EXISTS "Members can read team" ON public.equipe_pizzaria;
CREATE POLICY "Members can read team" ON public.equipe_pizzaria
  FOR SELECT USING (public.is_pizzeria_member(pizzaria_id));

DROP POLICY IF EXISTS "Admins can insert team" ON public.equipe_pizzaria;
CREATE POLICY "Admins can insert team" ON public.equipe_pizzaria
  FOR INSERT WITH CHECK (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));

DROP POLICY IF EXISTS "Admins can update team" ON public.equipe_pizzaria;
CREATE POLICY "Admins can update team" ON public.equipe_pizzaria
  FOR UPDATE USING (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']))
  WITH CHECK (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));

DROP POLICY IF EXISTS "Admins can delete team" ON public.equipe_pizzaria;
CREATE POLICY "Admins can delete team" ON public.equipe_pizzaria
  FOR DELETE USING (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));
