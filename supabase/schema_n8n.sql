-- Tabela de fila de mensagens para o workflow n8n (Secretaria)
-- O campo 'instancia' é obrigatório para isolamento multi-tenant (PRD sec. 5.2.4):
-- SELECT/DELETE da fila devem incluir WHERE instancia = '...' para não misturar pizzarias.
CREATE TABLE IF NOT EXISTS public.n8n_fila_mensagens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_mensagem TEXT NOT NULL,
    instancia TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.n8n_fila_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.n8n_fila_mensagens;
CREATE POLICY "Enable all for anonymous" ON public.n8n_fila_mensagens FOR ALL USING (true);
