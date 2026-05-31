-- Migration 006
-- Central de alertas da plataforma: falhas (envio/IA/pagamento) e sinais de
-- possível alucinação de preço. Usado pelo painel admin (Fase 2 — C4/C5).

CREATE TABLE IF NOT EXISTS public.plataforma_alertas (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id uuid,
    tipo        text NOT NULL,                  -- preco_suspeito | falha_envio | falha_ia | falha_pagamento
    nivel       text NOT NULL DEFAULT 'warning',-- info | warning | error
    detalhe     text,
    resolvido   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plataforma_alertas_idx
    ON public.plataforma_alertas (resolvido, created_at DESC);
