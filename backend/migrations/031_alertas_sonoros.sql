-- Migration 031
-- Liga/desliga os sons de alerta de pedido no painel (Meu Negócio → Geral).
-- Padrão ligado: pizzarias existentes seguem ouvindo o alerta como antes.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS alertas_sonoros BOOLEAN NOT NULL DEFAULT TRUE;
