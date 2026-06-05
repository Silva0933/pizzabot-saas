-- Migration 011
-- Link do endereço no Google Maps, enviado ao cliente quando ele pergunta o
-- endereço ou escolhe retirada. (Os campos de tempo de retirada já existem desde
-- migrations anteriores; aqui só adicionamos o link do mapa.)

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS endereco_maps_url TEXT;
