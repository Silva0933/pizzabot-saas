-- ============================================================
-- Campos adicionais por pizzaria para o novo modelo de atendimento
-- Rode no Supabase SQL Editor
-- ============================================================
ALTER TABLE public.pizzarias
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS telefone_contato TEXT,
  ADD COLUMN IF NOT EXISTS formas_pagamento_aceitas JSONB
    DEFAULT '["PIX","Dinheiro","Cartao de debito","Cartao de credito"]'::jsonb,
  ADD COLUMN IF NOT EXISTS taxa_entrega_info TEXT
    DEFAULT 'A taxa varia por bairro. Confirme conosco antes de finalizar.',
  ADD COLUMN IF NOT EXISTS tempo_entrega_min INT DEFAULT 40,
  ADD COLUMN IF NOT EXISTS tempo_entrega_max INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS tempo_retirada_min INT DEFAULT 20,
  ADD COLUMN IF NOT EXISTS tempo_retirada_max INT DEFAULT 30;

-- ============================================================
-- Coluna cancelado_at em pedidos (audit trail de cancelamentos)
-- ============================================================
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cancelado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelamento_motivo TEXT;

-- ============================================================
-- Comentarios pra documentar
-- ============================================================
COMMENT ON COLUMN public.pizzarias.formas_pagamento_aceitas IS 'Array JSON dos meios de pagamento que a pizzaria aceita';
COMMENT ON COLUMN public.pizzarias.telefone_contato IS 'Telefone publico exibido aos clientes (diferente do telefone_admin)';
COMMENT ON COLUMN public.pizzarias.taxa_entrega_info IS 'Texto livre sobre taxas de entrega - exibido ao cliente';
COMMENT ON COLUMN public.pedidos.cancelado_at IS 'Timestamp quando o pedido foi cancelado';
