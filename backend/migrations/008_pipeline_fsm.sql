-- Migration 008
-- Flag para ativar o pipeline FSM (NLU→backend→voz) por pizzaria. Off por padrão.

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS pipeline_fsm BOOLEAN NOT NULL DEFAULT FALSE;
