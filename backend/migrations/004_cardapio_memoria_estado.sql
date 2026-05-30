-- Migration 004
-- Cardapio mais expressivo + memoria resumida/estado de conversa.

ALTER TABLE public.produtos
    ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS opcoes JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS regras JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS memoria_resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS memoria_atualizada_at TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.atendimento_estado (
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    estado JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pizzaria_id, telefone)
);

CREATE INDEX IF NOT EXISTS atendimento_estado_updated_idx
    ON public.atendimento_estado (updated_at DESC);
