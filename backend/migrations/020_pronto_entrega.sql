-- Migration 020
-- Novo status de pedido: 'pronto_entrega' (Pronto para entrega).
--
-- Etapa intermediária entre 'no_forno' e 'a_caminho', usada SÓ por pedidos
-- delivery: quando a pizza sai do forno e está pronta para sair, o pedido vira
-- 'pronto_entrega'. É a partir desse status que o entregador enxerga e pega os
-- pedidos livres (self-claim). Pedidos de retirada continuam indo de 'no_forno'
-- direto para 'entregue' (não passam por 'pronto_entrega').
--
-- O CHECK inline original (001_initial.sql) gera o nome convencional
-- pedidos_status_check.
DO $$
BEGIN
    ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check;
    ALTER TABLE public.pedidos
        ADD CONSTRAINT pedidos_status_check
        CHECK (status IN ('novo','confirmado','no_forno','pronto_entrega','a_caminho','entregue','cancelado'));
END $$;
