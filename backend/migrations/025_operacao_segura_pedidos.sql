-- Safe order operations: idempotency, problem queue and audit trail.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR(120),
    ADD COLUMN IF NOT EXISTS valor_subtotal NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS valor_desconto NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS taxa_entrega NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cupom_codigo VARCHAR(40),
    ADD COLUMN IF NOT EXISTS em_problema BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS problema_motivo TEXT,
    ADD COLUMN IF NOT EXISTS problema_aberto_em TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_idempotencia
    ON public.pedidos (pizzaria_id, chave_idempotencia)
    WHERE chave_idempotencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_pedidos_problema_aberto
    ON public.pedidos (pizzaria_id, problema_aberto_em DESC)
    WHERE em_problema = TRUE;

CREATE TABLE IF NOT EXISTS public.pedido_eventos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    tipo VARCHAR(40) NOT NULL,
    status_anterior VARCHAR(30),
    status_novo VARCHAR(30),
    motivo TEXT,
    ator_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    ator_nome VARCHAR(160),
    ator_tipo VARCHAR(30) NOT NULL DEFAULT 'sistema',
    detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pedido_eventos_pedido_data
    ON public.pedido_eventos (pedido_id, created_at DESC);
