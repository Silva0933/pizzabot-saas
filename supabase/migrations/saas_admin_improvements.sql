-- =========================================================
-- PIZZABOT SAAS — Admin Platform Improvements
-- Execute no SQL Editor do Supabase Dashboard
-- =========================================================

-- 1. Garantir que o dono da plataforma tem acesso ao painel admin
INSERT INTO public.plataforma_admins (email, nome, role, status)
VALUES ('jailson.jesus2121@gmail.com', 'Jailson Jesus', 'Owner', 'Ativo')
ON CONFLICT (email) DO UPDATE SET status = 'Ativo', nome = 'Jailson Jesus';

-- 2. Função para editar pizzaria pelo painel admin
CREATE OR REPLACE FUNCTION public.platform_update_pizzeria(
  p_pizzaria_id UUID,
  p_plano       TEXT    DEFAULT NULL,
  p_nome        TEXT    DEFAULT NULL,
  p_bot_ativo   BOOLEAN DEFAULT NULL,
  p_instancia   TEXT    DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.';
  END IF;
  UPDATE public.pizzarias SET
    plano            = COALESCE(NULLIF(trim(p_plano),   ''), plano),
    nome             = COALESCE(NULLIF(trim(p_nome),    ''), nome),
    bot_ativo_global = COALESCE(p_bot_ativo, bot_ativo_global),
    instancia        = COALESCE(NULLIF(trim(p_instancia),''), instancia)
  WHERE id = p_pizzaria_id;
  RETURN FOUND;
END;
$$;

-- 3. Atualizar snapshot com contagem de operadores e planCounts
CREATE OR REPLACE FUNCTION public.get_saas_admin_snapshot()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE payload JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.';
  END IF;
  SELECT jsonb_build_object(
    'generatedAt', NOW(),
    'metrics', jsonb_build_object(
      'totalPizzerias',    (SELECT COUNT(*) FROM public.pizzarias),
      'activePizzerias',   (SELECT COUNT(*) FROM public.pizzarias WHERE bot_ativo_global = true),
      'newPizzerias30d',   (SELECT COUNT(*) FROM public.pizzarias WHERE created_at >= NOW() - INTERVAL '30 days'),
      'totalCustomers',    (SELECT COUNT(*) FROM public.clientes),
      'totalOrders',       (SELECT COUNT(*) FROM public.pedidos),
      'ordersToday',       (SELECT COUNT(*) FROM public.pedidos WHERE created_at::date = CURRENT_DATE),
      'approvedRevenue',   COALESCE((SELECT SUM(valor_total) FROM public.pedidos WHERE payment_status='approved' AND status<>'cancelado'),0),
      'revenueToday',      COALESCE((SELECT SUM(valor_total) FROM public.pedidos WHERE payment_status='approved' AND status<>'cancelado' AND created_at::date=CURRENT_DATE),0),
      'pendingPayments',   (SELECT COUNT(*) FROM public.pedidos WHERE payment_status='pending' AND status<>'cancelado'),
      'humanEscalations',  (SELECT COUNT(*) FROM public.conversas WHERE status='Humano necessário'),
      'planCounts', jsonb_build_object(
        'basico',      (SELECT COUNT(*) FROM public.pizzarias WHERE plano='basico'),
        'pro',         (SELECT COUNT(*) FROM public.pizzarias WHERE plano='pro'),
        'enterprise',  (SELECT COUNT(*) FROM public.pizzarias WHERE plano='enterprise')
      )
    ),
    'pizzerias', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'name',             p.nome,
          'instance',         p.instancia,
          'plan',             p.plano,
          'gateway',          p.gateway_pagamento,
          'botActive',        p.bot_ativo_global,
          'createdAt',        p.created_at,
          'totalOrders',      COALESCE(st.total_orders, 0),
          'activeOrders',     COALESCE(st.active_orders, 0),
          'pendingPayments',  COALESCE(st.pending_payments, 0),
          'customers',        COALESCE(st.customers_count, 0),
          'conversations',    COALESCE(st.conversations_count, 0),
          'humanEscalations', COALESCE(st.human_escalations, 0),
          'approvedRevenue',  COALESCE(st.approved_revenue, 0),
          'todayRevenue',     COALESCE(st.today_revenue, 0),
          'operators',        COALESCE(st.operators_count, 0),
          'gatewayConfigured', CASE
            WHEN p.gateway_pagamento='asaas' THEN COALESCE(NULLIF(p.asaas_api_key,''),'') <> ''
            WHEN p.gateway_pagamento='mercadopago' THEN COALESCE(NULLIF(p.mp_access_token,''),'') <> ''
            ELSE false END
        ) ORDER BY p.created_at DESC
      )
      FROM public.pizzarias p
      LEFT JOIN LATERAL (
        SELECT
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id=p.id) AS total_orders,
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id=p.id AND pe.status NOT IN ('entregue','cancelado')) AS active_orders,
          (SELECT COUNT(*) FROM public.pedidos pe WHERE pe.pizzaria_id=p.id AND pe.payment_status='pending' AND pe.status<>'cancelado') AS pending_payments,
          (SELECT COUNT(*) FROM public.clientes c WHERE c.pizzaria_id=p.id) AS customers_count,
          (SELECT COUNT(*) FROM public.conversas cv WHERE cv.pizzaria_id=p.id) AS conversations_count,
          (SELECT COUNT(*) FROM public.conversas cv WHERE cv.pizzaria_id=p.id AND cv.status='Humano necessário') AS human_escalations,
          (SELECT COUNT(*) FROM public.equipe_pizzaria eq WHERE eq.pizzaria_id=p.id) AS operators_count,
          COALESCE((SELECT SUM(pe.valor_total) FROM public.pedidos pe WHERE pe.pizzaria_id=p.id AND pe.payment_status='approved' AND pe.status<>'cancelado'),0) AS approved_revenue,
          COALESCE((SELECT SUM(pe.valor_total) FROM public.pedidos pe WHERE pe.pizzaria_id=p.id AND pe.payment_status='approved' AND pe.status<>'cancelado' AND pe.created_at::date=CURRENT_DATE),0) AS today_revenue
      ) st ON true
    ), '[]'::jsonb)
  ) INTO payload;
  RETURN payload;
END;
$$;
