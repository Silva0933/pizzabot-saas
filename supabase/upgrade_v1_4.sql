-- PizzaBot v1.4 - Painel administrativo do SaaS.
-- Execute no SQL Editor do Supabase.
--
-- Depois de executar, cadastre o email do dono da ferramenta:
-- INSERT INTO public.plataforma_admins (email, nome, role)
-- VALUES ('seu-email@dominio.com', 'Dono da Plataforma', 'Owner')
-- ON CONFLICT (email) DO UPDATE SET status = 'Ativo', role = EXCLUDED.role;

CREATE TABLE IF NOT EXISTS public.plataforma_admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    nome TEXT,
    role TEXT NOT NULL DEFAULT 'Owner',
    status TEXT NOT NULL DEFAULT 'Ativo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

ALTER TABLE public.plataforma_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read platform admins" ON public.plataforma_admins;
CREATE POLICY "Platform admins can read platform admins" ON public.plataforma_admins
  FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admins can manage platform admins" ON public.plataforma_admins;
CREATE POLICY "Platform admins can manage platform admins" ON public.plataforma_admins
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
