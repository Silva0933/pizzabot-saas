-- Migration 021
-- Banner do cardápio digital: imagem larga exibida no topo da página pública
-- (/m/:slug). É apenas uma URL (igual ao logo_url) — sem pipeline de upload.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS banner_url TEXT;
