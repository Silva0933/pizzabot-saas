-- Migration 009
-- FSM passa a ser o pipeline PADRÃO (ambiente de testes, sem clientes reais).
-- Liga em todas as pizzarias existentes e muda o default da coluna para TRUE.
-- O toggle no painel admin continua permitindo desligar por pizzaria.

ALTER TABLE public.pizzarias ALTER COLUMN pipeline_fsm SET DEFAULT TRUE;

UPDATE public.pizzarias SET pipeline_fsm = TRUE WHERE pipeline_fsm IS NOT TRUE;
