-- Migration 022
-- NULL segue a agenda; TRUE/FALSE força a loja aberta/fechada sem alterar
-- os horários cadastrados.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS aberto_manual BOOLEAN NULL;
