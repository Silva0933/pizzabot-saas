-- Migration 038
-- Valor por entrega do entregador e histórico de entregas no app.
--
-- pizzarias.repasse_entregador_*: a loja define se paga um valor fixo por
-- entrega e quanto. Desligado, o app do entregador não mostra valores.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS repasse_entregador_ativo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS repasse_entregador_valor NUMERIC(10, 2);

-- pedidos.entregue_em: quando a entrega foi concluída (o updated_at muda com
-- qualquer edição posterior e bagunçava o "hoje" do entregador).
-- pedidos.repasse_entregador: valor da entrega congelado no momento em que foi
-- concluída — mudar o valor na loja não altera o que já foi ganho.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS repasse_entregador NUMERIC(10, 2);

UPDATE public.pedidos SET entregue_em = updated_at
 WHERE status = 'entregue' AND entregue_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_entregador_entregue
    ON public.pedidos (entregador_id, entregue_em DESC)
    WHERE status = 'entregue';
