-- 018_entregadores.sql
-- Painel de entregador: cadastro de entregadores (conta de login reusa usuarios),
-- atribuição de pedidos a um entregador e toggle de auto-atribuição (self-claim)
-- por pizzaria.

CREATE TABLE IF NOT EXISTS public.entregadores (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id  uuid NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    usuario_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    nome         text NOT NULL,
    telefone     text,
    -- entregador marca que está trabalhando/aceitando entregas agora
    disponivel   boolean NOT NULL DEFAULT false,
    -- conta habilitada pelo dono (desativar sem excluir)
    ativo        boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pizzaria_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_entregadores_pizzaria ON public.entregadores(pizzaria_id);

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS entregador_id uuid REFERENCES public.entregadores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS atribuido_em  timestamptz;
CREATE INDEX IF NOT EXISTS idx_pedidos_entregador ON public.pedidos(pizzaria_id, entregador_id);

ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS permitir_autoatribuicao_entregador boolean NOT NULL DEFAULT false;
