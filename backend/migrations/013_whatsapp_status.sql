-- Migration 013
-- Monitor de conexão WhatsApp: estado da instância Evolution por pizzaria,
-- alimentado pelo evento CONNECTION_UPDATE (webhook) + poll periódico (Beat).
-- 'open' = conectado | 'connecting' | 'close' = desconectado (atendimento parado).

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS whatsapp_estado text,
    ADD COLUMN IF NOT EXISTS whatsapp_estado_em timestamptz;
