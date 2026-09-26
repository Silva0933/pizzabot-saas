-- Migration 033
-- Revogação de sessões. O login (JWT) valia 30 dias sem como derrubar: trocar a
-- senha do entregador ou "sair de todos os dispositivos" não invalidava o que
-- já estava emitido. Tokens com `iat` anterior a esta data são recusados.
-- NULL = nada revogado (comportamento antigo).
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS sessoes_validas_desde TIMESTAMPTZ;
