-- Migration 007
-- Adicionais/bordas da casa (aplicáveis a qualquer pizza).
-- Lista de objetos {"nome": "...", "preco": 0.00, "tipo": "borda"|"adicional"}.

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS adicionais JSONB NOT NULL DEFAULT '[]'::jsonb;
