-- Migration 030
-- Resolução de tenant no webhook do Mercado Pago.
--
-- Problema corrigido: o webhook do MP só sabia achar o pedido por
-- `pedidos.payment_id`. No fluxo de cartão isso nunca casava, porque
-- /checkout/preferences devolve o id da PREFERÊNCIA e a notificação traz o id do
-- PAGAMENTO — espaços de id diferentes. O pedido ficava 'pending' para sempre.
--
-- A correção resolve o pedido pelo `external_reference` (que já é o id do
-- pedido), mas para consultar o pagamento é preciso o token da pizzaria dona da
-- cobrança. O corpo da notificação traz `user_id` = id da conta vendedora no MP,
-- então guardamos esse id por pizzaria para fazer a ponte.

ALTER TABLE public.pizzarias
    -- Id da conta vendedora no Mercado Pago (GET /users/me → id). Preenchido
    -- quando a pizzaria salva o access_token. Não é segredo → texto puro.
    ADD COLUMN IF NOT EXISTS mp_user_id TEXT,
    -- Secret de assinatura do webhook, que no MP é POR APLICAÇÃO. Como cada
    -- pizzaria usa a aplicação dela, o secret global do .env não serve para
    -- validar todas. Criptografado (prefixo enc:), igual ao access_token.
    ADD COLUMN IF NOT EXISTS mp_webhook_secret TEXT;

-- Ponte webhook (user_id) → pizzaria.
CREATE INDEX IF NOT EXISTS idx_pizzarias_mp_user_id
    ON public.pizzarias (mp_user_id)
    WHERE mp_user_id IS NOT NULL;

-- O webhook busca o pedido por payment_id a cada notificação (caminho rápido).
CREATE INDEX IF NOT EXISTS idx_pedidos_payment_id
    ON public.pedidos (payment_id)
    WHERE payment_id IS NOT NULL;
