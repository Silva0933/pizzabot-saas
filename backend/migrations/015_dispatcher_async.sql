-- Migration 015
-- Etapa 1 — Dispatcher assíncrono: opt-in POR PIZZARIA. Quando true, as mensagens
-- dessa pizzaria são processadas pelo serviço APP_ROLE=dispatcher (Redis Streams,
-- 1 event loop + semáforo) em vez do worker Celery. Rollout gradual e rollback
-- instantâneo (basta voltar pra false; o próximo webhook já usa o caminho antigo).

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS usar_dispatcher BOOLEAN NOT NULL DEFAULT false;
