-- Configuração versionada do comportamento do atendente.
-- JSONB mantém evolução retrocompatível; a API normaliza/valida o conteúdo.
ALTER TABLE public.personalidade_atendente
    ADD COLUMN IF NOT EXISTS config_atendimento JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.personalidade_atendente.config_atendimento IS
    'Config v1: comunicação, vendas, memória, handoff e follow-ups do agente.';
