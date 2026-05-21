-- PizzaBot: Schema do Banco de Dados (Supabase PostgreSQL)
-- Baseado no PRD v1.0 - Seção 3. Modelo de Dados

-- Extensão para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabela: pizzarias
CREATE TABLE public.pizzarias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome TEXT NOT NULL,
    endereco TEXT,
    logo_url TEXT,
    instancia TEXT UNIQUE,
    telefone_admin TEXT,
    plano TEXT DEFAULT 'basico',
    bot_ativo_global BOOLEAN DEFAULT true,
    prompt_personalizado TEXT,
    asaas_api_key TEXT,
    mp_access_token TEXT,
    gateway_pagamento TEXT DEFAULT 'mercadopago',
    horario_funcionamento JSONB,
    mensagem_entregue TEXT,
    mensagens_status JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabela: produtos (Cardápio)
CREATE TABLE public.produtos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    categoria TEXT,
    nome TEXT NOT NULL,
    descricao TEXT,
    preco NUMERIC(10, 2) NOT NULL,
    disponivel BOOLEAN DEFAULT true,
    arquivo_drive_id TEXT,
    imagem_url TEXT,
    ordem INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabela: clientes (CRM + RAG)
CREATE TABLE public.clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    nome TEXT,
    endereco_padrao TEXT,
    preferencias TEXT,
    historico_pedidos JSONB DEFAULT '[]'::jsonb,
    total_pedidos INT DEFAULT 0,
    total_gasto NUMERIC(10, 2) DEFAULT 0,
    ultima_visita TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pizzaria_id, telefone)
);

-- 4. Tabela: pedidos
CREATE TABLE public.pedidos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    numero_pedido INT,
    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    valor_total NUMERIC(10, 2) NOT NULL,
    status TEXT DEFAULT 'novo',
    tipo TEXT DEFAULT 'delivery',
    endereco_entrega TEXT,
    forma_pagamento TEXT,
    payment_id TEXT,
    payment_status TEXT DEFAULT 'pending',
    link_pagamento TEXT,
    observacoes TEXT,
    bot_ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX pedidos_pizzaria_numero_pedido_key
  ON public.pedidos (pizzaria_id, numero_pedido);

CREATE OR REPLACE FUNCTION public.assign_numero_pedido_por_pizzaria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero_pedido IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.pizzaria_id::text));
    SELECT COALESCE(MAX(numero_pedido), 0) + 1
      INTO NEW.numero_pedido
      FROM public.pedidos
     WHERE pizzaria_id = NEW.pizzaria_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pedidos_numero_por_pizzaria
BEFORE INSERT ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.assign_numero_pedido_por_pizzaria();

-- 5. Tabela: conversas (Para controle do chat no Kanban/Painel)
CREATE TABLE public.conversas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    cliente_telefone TEXT NOT NULL,
    cliente_nome TEXT,
    last_message TEXT,
    last_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    bot_ativo BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'Bot ativo',
    messages JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pizzaria_id, cliente_telefone)
);

-- 6. Tabela: equipe_pizzaria (Operadores e permissões)
CREATE TABLE public.equipe_pizzaria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Atendente',
    status TEXT NOT NULL DEFAULT 'Pendente',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pizzaria_id, email)
);

-- 7. Tabela: administradores da plataforma SaaS
-- Estes usuários acessam o painel global do dono da ferramenta.
CREATE TABLE public.plataforma_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    nome TEXT,
    role TEXT NOT NULL DEFAULT 'Owner',
    status TEXT NOT NULL DEFAULT 'Ativo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Helpers de RLS multi-tenant. SECURITY DEFINER evita recursao nas policies.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.plataforma_admins pa
    WHERE lower(pa.email) = lower(auth.jwt() ->> 'email')
      AND pa.status = 'Ativo'
  );
$$;

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

GRANT EXECUTE ON FUNCTION public.bootstrap_pizzeria(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_saas_admin_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.';
  END IF;

  SELECT jsonb_build_object(
    'generatedAt', NOW(),
    'metrics', jsonb_build_object(
      'totalPizzerias', (SELECT COUNT(*) FROM public.pizzarias),
      'activePizzerias', (SELECT COUNT(*) FROM public.pizzarias WHERE bot_ativo_global = true),
      'newPizzerias30d', (SELECT COUNT(*) FROM public.pizzarias WHERE created_at >= NOW() - INTERVAL '30 days'),
      'totalCustomers', (SELECT COUNT(*) FROM public.clientes),
      'totalOrders', (SELECT COUNT(*) FROM public.pedidos),
      'ordersToday', (SELECT COUNT(*) FROM public.pedidos WHERE created_at::date = CURRENT_DATE),
      'approvedRevenue', COALESCE((SELECT SUM(valor_total) FROM public.pedidos WHERE payment_status = 'approved' AND status <> 'cancelado'), 0),
      'revenueToday', COALESCE((SELECT SUM(valor_total) FROM public.pedidos WHERE payment_status = 'approved' AND status <> 'cancelado' AND created_at::date = CURRENT_DATE), 0),
      'pendingPayments', (SELECT COUNT(*) FROM public.pedidos WHERE payment_status = 'pending' AND status <> 'cancelado'),
      'humanEscalations', (SELECT COUNT(*) FROM public.conversas WHERE status = 'Humano necessário')
    ),
    'pizzerias', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.nome,
          'instance', p.instancia,
          'plan', p.plano,
          'gateway', p.gateway_pagamento,
          'botActive', p.bot_ativo_global,
          'createdAt', p.created_at,
          'totalOrders', COALESCE(stats.total_orders, 0),
          'activeOrders', COALESCE(stats.active_orders, 0),
          'pendingPayments', COALESCE(stats.pending_payments, 0),
          'customers', COALESCE(stats.customers_count, 0),
          'conversations', COALESCE(stats.conversations_count, 0),
          'humanEscalations', COALESCE(stats.human_escalations, 0),
          'approvedRevenue', COALESCE(stats.approved_revenue, 0),
          'todayRevenue', COALESCE(stats.today_revenue, 0),
          'gatewayConfigured', CASE
            WHEN p.gateway_pagamento = 'asaas' THEN COALESCE(NULLIF(p.asaas_api_key, ''), '') <> ''
            WHEN p.gateway_pagamento = 'mercadopago' THEN COALESCE(NULLIF(p.mp_access_token, ''), '') <> ''
            ELSE false
          END
        )
        ORDER BY p.created_at DESC
      )
      FROM public.pizzarias p
      LEFT JOIN LATERAL (
        SELECT
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id = p.id) AS total_orders,
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id = p.id AND pe.status NOT IN ('entregue', 'cancelado')) AS active_orders,
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id = p.id AND pe.payment_status = 'pending' AND pe.status <> 'cancelado') AS pending_payments,
          (SELECT COUNT(*) FROM public.clientes c WHERE c.pizzaria_id = p.id) AS customers_count,
          (SELECT COUNT(*) FROM public.conversas cv WHERE cv.pizzaria_id = p.id) AS conversations_count,
          (SELECT COUNT(*) FROM public.conversas cv WHERE cv.pizzaria_id = p.id AND cv.status = 'Humano necessário') AS human_escalations,
          COALESCE((SELECT SUM(pe.valor_total) FROM public.pedidos pe WHERE pe.pizzaria_id = p.id AND pe.payment_status = 'approved' AND pe.status <> 'cancelado'), 0) AS approved_revenue,
          COALESCE((SELECT SUM(pe.valor_total) FROM public.pedidos pe WHERE pe.pizzaria_id = p.id AND pe.payment_status = 'approved' AND pe.status <> 'cancelado' AND pe.created_at::date = CURRENT_DATE), 0) AS today_revenue
      ) stats ON true
    ), '[]'::jsonb)
  ) INTO payload;

  RETURN payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_saas_admin_snapshot() TO authenticated;

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

-- Configurações de Segurança: Row Level Security (RLS)
-- Como é um painel de administração, liberamos acesso autenticado geral para este MVP.
ALTER TABLE public.pizzarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_pizzaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read pizzerias" ON public.pizzarias
  FOR SELECT USING (public.is_pizzeria_member(id));
CREATE POLICY "Admins can update pizzerias" ON public.pizzarias
  FOR UPDATE USING (public.has_pizzeria_role(id, ARRAY['Admin'])) WITH CHECK (public.has_pizzeria_role(id, ARRAY['Admin']));

CREATE POLICY "Members can manage products" ON public.produtos
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id)) WITH CHECK (public.is_pizzeria_member(pizzaria_id));
CREATE POLICY "Members can manage customers" ON public.clientes
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id)) WITH CHECK (public.is_pizzeria_member(pizzaria_id));
CREATE POLICY "Members can manage orders" ON public.pedidos
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id)) WITH CHECK (public.is_pizzeria_member(pizzaria_id));
CREATE POLICY "Members can manage conversations" ON public.conversas
  FOR ALL USING (public.is_pizzeria_member(pizzaria_id)) WITH CHECK (public.is_pizzeria_member(pizzaria_id));
CREATE POLICY "Members can read team" ON public.equipe_pizzaria
  FOR SELECT USING (public.is_pizzeria_member(pizzaria_id));
CREATE POLICY "Admins can insert team" ON public.equipe_pizzaria
  FOR INSERT WITH CHECK (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));
CREATE POLICY "Admins can update team" ON public.equipe_pizzaria
  FOR UPDATE USING (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin'])) WITH CHECK (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));
CREATE POLICY "Admins can delete team" ON public.equipe_pizzaria
  FOR DELETE USING (public.has_pizzeria_role(pizzaria_id, ARRAY['Admin']));

CREATE POLICY "Platform admins can read platform admins" ON public.plataforma_admins
  FOR SELECT USING (public.is_platform_admin());
CREATE POLICY "Platform admins can manage platform admins" ON public.plataforma_admins
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Ativar REPLICA IDENTITY para o Realtime funcionar nas tabelas que importam pro front
ALTER TABLE public.pedidos REPLICA IDENTITY FULL;
ALTER TABLE public.conversas REPLICA IDENTITY FULL;
