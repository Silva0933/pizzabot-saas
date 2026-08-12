-- Saved delivery address used by the customer account in the public menu.
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS endereco_dados JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.clientes.endereco_dados IS
    'Structured delivery address: cep, rua, numero, bairro, complemento and referencia.';
