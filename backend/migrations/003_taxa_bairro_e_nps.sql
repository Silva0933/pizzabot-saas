-- Migration 003
-- (1) Taxa de entrega: valor fixo de fallback + tabela por bairro (JSONB)
-- (2) Pós-venda: nota NPS, comentário e timestamp de envio no pedido

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS taxa_entrega_fixa NUMERIC(10, 2) DEFAULT NULL;

-- Lista de objetos {"bairro": "...", "taxa": 0.00}
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS taxas_bairro JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS nps_nota INTEGER DEFAULT NULL;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS nps_comentario TEXT DEFAULT NULL;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS nps_enviado_at TIMESTAMPTZ DEFAULT NULL;
