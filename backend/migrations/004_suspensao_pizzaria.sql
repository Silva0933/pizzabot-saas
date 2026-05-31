-- Migration 004
-- Suspensão administrativa da pizzaria (ex.: inadimplência) — desliga o
-- atendimento sem excluir os dados.

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS suspensa BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS suspensa_motivo TEXT DEFAULT NULL;
