-- Migration 023
-- Identidade visual individual de cada cardápio: preset, fontes, cores,
-- arredondamento e textos de apresentação.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS tema_cardapio JSONB NOT NULL DEFAULT '{}'::jsonb;
