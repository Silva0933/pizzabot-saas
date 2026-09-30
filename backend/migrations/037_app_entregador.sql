-- Migration 037
-- App do entregador (Fase 1): localização ao vivo e código de entrega.
--
-- entregadores.lat/lon/localizacao_em: última posição enviada pelo app durante
-- o turno. A pizzaria vê onde o entregador está e a rota parte dali.
ALTER TABLE public.entregadores
    ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS precisao_m DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS localizacao_em TIMESTAMPTZ;

-- pedidos.codigo_entrega: 4 dígitos enviados ao cliente no "saiu para entrega".
-- O entregador só confirma a entrega com o código (ou justificando a falta dele):
-- evita "entregue" marcado sem a pizza ter chegado.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS codigo_entrega VARCHAR(6);
