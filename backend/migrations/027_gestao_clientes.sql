-- Versao de sessao das contas do cardapio.
-- Incrementada quando o dono redefine a senha, invalidando tokens anteriores.
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS conta_versao INTEGER NOT NULL DEFAULT 1;
