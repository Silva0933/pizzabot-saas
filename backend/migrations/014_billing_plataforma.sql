-- Migration 014
-- Cobrança da PLATAFORMA (assinatura mensal das pizzarias via Asaas) + trial.
--   - pizzarias: vínculo com o Asaas da plataforma (customer/subscription),
--     dados de cobrança (email/CPF-CNPJ exigidos pelo Asaas) e fim do trial.
--   - faturas: histórico de cobranças da assinatura (1 linha por payment Asaas).

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS asaas_customer_id text,
    ADD COLUMN IF NOT EXISTS asaas_subscription_id text,
    ADD COLUMN IF NOT EXISTS cobranca_email text,
    ADD COLUMN IF NOT EXISTS cobranca_cpf_cnpj text,
    ADD COLUMN IF NOT EXISTS trial_fim timestamptz;

CREATE TABLE IF NOT EXISTS public.faturas (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id           uuid NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    asaas_payment_id      text UNIQUE,
    asaas_subscription_id text,
    valor                 numeric(10,2) NOT NULL,
    status                text NOT NULL DEFAULT 'pendente',  -- pendente | paga | vencida | cancelada
    vencimento            date,
    pago_em               timestamptz,
    link_pagamento        text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faturas_pizzaria_idx
    ON public.faturas (pizzaria_id, created_at DESC);
CREATE INDEX IF NOT EXISTS faturas_status_idx
    ON public.faturas (status, vencimento);
