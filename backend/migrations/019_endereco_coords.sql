-- 019_endereco_coords.sql
-- Coordenadas exatas do endereço de entrega (pino preciso no mapa do entregador).
-- Preenchidas quando o cliente compartilha a localização no WhatsApp ou usa o GPS
-- do navegador no cardápio digital. Endereço só digitado fica nulo.

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS endereco_lat double precision,
    ADD COLUMN IF NOT EXISTS endereco_lon double precision;
