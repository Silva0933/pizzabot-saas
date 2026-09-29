-- Migration 035
-- Chamado interno: quando a atendente não tem a resposta (ou uma operação no
-- pedido falha), ela pergunta à equipe pelo painel em vez de transferir o
-- cliente. Sem resposta no prazo, a conversa vira atendimento humano.
CREATE TABLE IF NOT EXISTS public.chamados_internos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    conversa_id UUID REFERENCES public.conversas(id) ON DELETE CASCADE,
    telefone VARCHAR(60) NOT NULL,
    pergunta TEXT NOT NULL,
    motivo VARCHAR(40) NOT NULL,
    contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',  -- aberto | respondido | expirado | cancelado
    resposta TEXT,
    respondido_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    respondido_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_chamados_pizzaria_status
    ON public.chamados_internos (pizzaria_id, status, created_at DESC);

-- Respostas que a loja salvou: a atendente passa a responder sozinha da próxima vez.
CREATE TABLE IF NOT EXISTS public.conhecimento_loja (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    pergunta TEXT NOT NULL,
    resposta TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    origem_chamado_id UUID REFERENCES public.chamados_internos(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_conhecimento_pizzaria
    ON public.conhecimento_loja (pizzaria_id) WHERE ativo = TRUE;
