-- Migration: Add column 'tamanhos' to table 'produtos'
ALTER TABLE public.produtos ADD COLUMN tamanhos JSONB DEFAULT NULL;
