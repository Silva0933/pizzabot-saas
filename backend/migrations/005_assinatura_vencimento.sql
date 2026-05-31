-- Migration 005
-- Assinatura: datas de ativação e vencimento do plano (ciclo de 30 dias rolando).

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS plano_ativado_em TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS plano_vence_em TIMESTAMPTZ DEFAULT NULL;
