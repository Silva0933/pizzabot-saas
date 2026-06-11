-- Migration 016
-- Dispatcher assíncrono vira o caminho PADRÃO. Piloto (Pizzaria Palazio) validado
-- ponta-a-ponta em produção (2026-06-11). Novas pizzarias já nascem no dispatcher
-- e todas as existentes (ambiente de teste, sem clientes reais ainda) são migradas.
-- O worker Celery continua de pé como fallback: voltar usar_dispatcher=false numa
-- pizzaria a faz cair no worker de novo (rollback por tenant, sem deploy).

ALTER TABLE public.pizzarias
    ALTER COLUMN usar_dispatcher SET DEFAULT true;

UPDATE public.pizzarias
    SET usar_dispatcher = true
    WHERE usar_dispatcher IS DISTINCT FROM true;
