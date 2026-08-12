-- Contas dos consumidores do cardapio digital.
-- Reaproveita o cliente ja existente por telefone e adiciona credenciais por loja.
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS email VARCHAR,
    ADD COLUMN IF NOT EXISTS senha_hash TEXT,
    ADD COLUMN IF NOT EXISTS conta_ativa BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS conta_atualizada_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_pizzaria_email_conta
    ON public.clientes (pizzaria_id, LOWER(email))
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_clientes_conta_ativa
    ON public.clientes (pizzaria_id, conta_ativa)
    WHERE conta_ativa = TRUE;

COMMENT ON COLUMN public.clientes.senha_hash IS
    'Hash bcrypt da senha da conta do consumidor; nunca armazena senha em texto puro.';
