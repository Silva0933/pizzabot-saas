-- Migration 034
-- Código Pix copia-e-cola da cobrança do pedido. Sem ele, "manda o pix de novo"
-- só tinha como criar OUTRA cobrança no gateway (duas cobranças pagáveis para o
-- mesmo pedido). Com o código guardado, o reenvio manda a mesma cobrança.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;
