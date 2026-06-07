-- Migration 012
-- Pagamento na conversa configurável + Pix manual com conferência.
--
-- Três modos (pizzarias.modo_pagamento_online):
--   'automatico' → cobrança via gateway (Mercado Pago/Asaas) — comportamento atual.
--   'manual'     → envia o copia-e-cola próprio da pizzaria; conferência manual do comprovante.
--   'desativado' → não oferece pagamento online; só na entrega/retirada.
--
-- O copia-e-cola NÃO é segredo (é compartilhado com o cliente) → texto puro, sem criptografia.

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS modo_pagamento_online TEXT NOT NULL DEFAULT 'automatico',
    ADD COLUMN IF NOT EXISTS pix_manual_copia_cola TEXT,
    ADD COLUMN IF NOT EXISTS pix_manual_titular TEXT;

-- O antigo gateway_pagamento='manual' não gerava cobrança nenhuma → equivale a
-- "desativado". Migra os registros existentes pra não prometer Pix que não enviava.
UPDATE public.pizzarias
    SET modo_pagamento_online = 'desativado'
    WHERE gateway_pagamento = 'manual';

-- Novo estado de pagamento: 'em_analise' (Pix manual aguardando conferência da equipe).
-- O CHECK inline original gera o nome convencional pedidos_payment_status_check.
DO $$
BEGIN
    ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_payment_status_check;
    ALTER TABLE public.pedidos
        ADD CONSTRAINT pedidos_payment_status_check
        CHECK (payment_status IN ('pending','approved','rejected','expired','em_analise'));
END $$;
