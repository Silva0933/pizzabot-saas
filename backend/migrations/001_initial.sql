-- ===================================================================
-- PizzaBot v2 — Schema inicial (Postgres standalone, sem Supabase)
-- ===================================================================
-- Mudanças vs schema antigo:
-- - Removido tudo que depende de auth.users / auth.uid() / auth.jwt()
-- - Removido RLS (autorização passa a ser feita na camada FastAPI)
-- - Adicionada tabela `usuarios` (autenticação própria)
-- - Adicionada tabela `personalidade_atendente` (Fase 4)
-- - Adicionado pgvector na coluna `produtos.embedding` (Fase 3)
-- - Adicionada tabela `mensagens_fila` (Fase 2)
-- ===================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================
-- AUTENTICAÇÃO
-- ============================================
CREATE TABLE public.usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    nome TEXT,
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usuarios_email_lower_idx ON public.usuarios (lower(email));

-- ============================================
-- PIZZARIAS (tenant)
-- ============================================
CREATE TABLE public.pizzarias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome TEXT NOT NULL,
    slug TEXT UNIQUE,                                  -- para URLs
    logo_url TEXT,
    plano TEXT NOT NULL DEFAULT 'basico',
    bot_ativo_global BOOLEAN NOT NULL DEFAULT TRUE,

    -- Contato e localização
    endereco TEXT,
    telefone_admin TEXT,
    telefone_contato TEXT,
    instagram TEXT,

    -- Horários (jsonb estruturado)
    horario_funcionamento JSONB NOT NULL DEFAULT '{
        "seg": "18:00-23:00", "ter": "18:00-23:00", "qua": "18:00-23:00",
        "qui": "18:00-23:00", "sex": "18:00-23:00", "sab": "18:00-00:00",
        "dom": "18:00-23:00"
    }'::jsonb,

    -- Entrega
    formas_pagamento_aceitas JSONB NOT NULL DEFAULT '["pix","cartao","dinheiro"]'::jsonb,
    taxa_entrega_info TEXT,
    tempo_entrega_min INT DEFAULT 30,
    tempo_entrega_max INT DEFAULT 60,
    tempo_retirada_min INT DEFAULT 15,
    tempo_retirada_max INT DEFAULT 25,

    -- Mensagens automáticas (templates)
    mensagens_status JSONB NOT NULL DEFAULT '{
        "confirmado":"Pagamento aprovado! Seu pedido entrou na fila de preparação.",
        "no_forno":"Boa notícia! Seu pedido está no forno.",
        "a_caminho":"Seu pedido saiu para entrega e chegará em breve.",
        "entregue":"Obrigado pela preferência! Bom apetite."
    }'::jsonb,

    -- Kanban customizado
    nomes_colunas JSONB NOT NULL DEFAULT '{
        "novo":"Novos","confirmado":"Confirmados","no_forno":"No Forno",
        "a_caminho":"A Caminho","entregue":"Entregues","cancelado":"Cancelados"
    }'::jsonb,

    -- WhatsApp (Evolution)
    instancia TEXT UNIQUE,

    -- Gateways de pagamento (criptografados em produção)
    gateway_pagamento TEXT NOT NULL DEFAULT 'mercadopago' CHECK (gateway_pagamento IN ('mercadopago','asaas','manual')),
    mp_access_token TEXT,
    asaas_api_key TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- EQUIPE (vincula usuário ↔ pizzaria)
-- ============================================
CREATE TABLE public.equipe_pizzaria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'atendente' CHECK (role IN ('admin','atendente')),
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('ativo','pendente','proprietario','suspenso')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pizzaria_id, email)
);

CREATE INDEX equipe_usuario_idx ON public.equipe_pizzaria (usuario_id);
CREATE INDEX equipe_email_lower_idx ON public.equipe_pizzaria (lower(email));

-- ============================================
-- PERSONALIDADE DO ATENDENTE (Fase 4)
-- ============================================
-- Substitui o prompt cru. Cada bloco vira parte do prompt final, montado pelo backend.
CREATE TABLE public.personalidade_atendente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL UNIQUE REFERENCES public.pizzarias(id) ON DELETE CASCADE,

    -- Identidade
    nome TEXT NOT NULL DEFAULT 'Camila',

    -- Estilo (presets)
    estilo TEXT NOT NULL DEFAULT 'casual' CHECK (estilo IN ('casual','profissional','proximo')),
    nivel_emoji TEXT NOT NULL DEFAULT 'moderado' CHECK (nivel_emoji IN ('nenhum','pouco','moderado','muito')),

    -- Vocabulário regional (opcional, ex: "uai, trem, bão")
    vocabulario_regional TEXT,

    -- Listas estruturadas
    diferenciais JSONB NOT NULL DEFAULT '[]'::jsonb,        -- ex: ["Massa fermentada 48h", "Borda recheada de graça às 5ª"]
    restricoes JSONB NOT NULL DEFAULT '[]'::jsonb,          -- ex: ["Não falar de concorrentes"]

    -- Few-shot examples (até 3-5 turnos modelo)
    exemplos_conversa JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Modo avançado: prompt extra do usuário expert (override parcial)
    instrucoes_extras TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PRODUTOS (cardápio) — com embedding p/ busca semântica
-- ============================================
CREATE TABLE public.produtos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    categoria TEXT,
    nome TEXT NOT NULL,
    descricao TEXT,
    preco NUMERIC(10,2) NOT NULL,
    disponivel BOOLEAN NOT NULL DEFAULT TRUE,
    imagem_url TEXT,
    ordem INT NOT NULL DEFAULT 0,

    -- Embedding gerado pelo Gemini text-embedding-004 (768 dimensões)
    embedding vector(768),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX produtos_pizzaria_idx ON public.produtos (pizzaria_id);
CREATE INDEX produtos_categoria_idx ON public.produtos (pizzaria_id, categoria);
-- Índice IVF flat para busca semântica (cria após popular embeddings)
-- CREATE INDEX produtos_embedding_idx ON public.produtos
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- CLIENTES (CRM por pizzaria)
-- ============================================
CREATE TABLE public.clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    nome TEXT,
    endereco_padrao TEXT,
    preferencias TEXT,
    total_pedidos INT NOT NULL DEFAULT 0,
    total_gasto NUMERIC(10,2) NOT NULL DEFAULT 0,
    ultima_visita TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pizzaria_id, telefone)
);

CREATE INDEX clientes_pizzaria_idx ON public.clientes (pizzaria_id);

-- ============================================
-- PEDIDOS
-- ============================================
CREATE TABLE public.pedidos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    numero_pedido INT,

    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    valor_total NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'novo'
        CHECK (status IN ('novo','confirmado','no_forno','a_caminho','entregue','cancelado')),
    tipo TEXT NOT NULL DEFAULT 'delivery' CHECK (tipo IN ('delivery','retirada')),

    endereco_entrega TEXT,
    forma_pagamento TEXT,
    observacoes TEXT,

    -- Pagamento
    payment_id TEXT,
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','approved','rejected','expired')),
    link_pagamento TEXT,

    bot_ativo BOOLEAN NOT NULL DEFAULT TRUE,
    cancelado_at TIMESTAMPTZ,
    cancelamento_motivo TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX pedidos_pizzaria_numero_idx
    ON public.pedidos (pizzaria_id, numero_pedido);
CREATE INDEX pedidos_pizzaria_status_idx ON public.pedidos (pizzaria_id, status);
CREATE INDEX pedidos_cliente_idx ON public.pedidos (cliente_id);

-- Trigger: número sequencial POR pizzaria
CREATE OR REPLACE FUNCTION public.assign_numero_pedido()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.numero_pedido IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(NEW.pizzaria_id::text));
        SELECT COALESCE(MAX(numero_pedido), 0) + 1
            INTO NEW.numero_pedido
            FROM public.pedidos
            WHERE pizzaria_id = NEW.pizzaria_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER pedidos_numero
BEFORE INSERT ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.assign_numero_pedido();

-- ============================================
-- CONVERSAS (chat por cliente, para o painel)
-- ============================================
CREATE TABLE public.conversas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    cliente_telefone TEXT NOT NULL,
    cliente_nome TEXT,
    last_message TEXT,
    last_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bot_ativo BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'bot_ativo'
        CHECK (status IN ('bot_ativo','humano_assumiu','humano_necessario','encerrada')),
    unread_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pizzaria_id, cliente_telefone)
);

CREATE INDEX conversas_pizzaria_status_idx ON public.conversas (pizzaria_id, status);
CREATE INDEX conversas_last_ts_idx ON public.conversas (pizzaria_id, last_timestamp DESC);

-- ============================================
-- MENSAGENS (histórico completo - tabela normalizada)
-- ============================================
-- Antes era jsonb dentro de conversas (caro de filtrar). Agora é tabela própria.
CREATE TABLE public.mensagens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversa_id UUID NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    origem TEXT NOT NULL CHECK (origem IN ('cliente','bot','humano','sistema')),
    tipo TEXT NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','audio','imagem','figurinha','localizacao')),
    conteudo TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,        -- ex: {evolution_msg_id, audio_url, etc}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mensagens_conversa_idx ON public.mensagens (conversa_id, created_at);
CREATE INDEX mensagens_pizzaria_idx ON public.mensagens (pizzaria_id, created_at DESC);

-- ============================================
-- MEMÓRIA CONVERSACIONAL DO AGENTE (Fase 3)
-- ============================================
-- Substitui o n8n_historico_mensagens. Formato compatível com LangGraph checkpoint.
CREATE TABLE public.agente_memoria (
    id BIGSERIAL PRIMARY KEY,
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agente_memoria_session_idx
    ON public.agente_memoria (pizzaria_id, telefone, created_at);

-- ============================================
-- FILA DE MENSAGENS (Fase 2)
-- ============================================
-- Estado durável da fila. Redis processa, mas mantemos espelho no DB para auditoria.
CREATE TABLE public.mensagens_fila (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    telefone TEXT NOT NULL,
    payload JSONB NOT NULL,                              -- payload completo do Evolution
    status TEXT NOT NULL DEFAULT 'enfileirada'
        CHECK (status IN ('enfileirada','processando','concluida','erro')),
    tentativas INT NOT NULL DEFAULT 0,
    erro_ultimo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processada_at TIMESTAMPTZ
);

CREATE INDEX fila_status_idx ON public.mensagens_fila (status, created_at)
    WHERE status IN ('enfileirada','processando');

-- ============================================
-- AUDITORIA (eventos críticos)
-- ============================================
CREATE TABLE public.eventos (
    id BIGSERIAL PRIMARY KEY,
    pizzaria_id UUID REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    tipo TEXT NOT NULL,                                  -- ex: 'pedido.criado', 'cliente.escalou', 'login.success'
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX eventos_pizzaria_tipo_idx ON public.eventos (pizzaria_id, tipo, created_at DESC);

-- ============================================
-- TRIGGERS: updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'usuarios','pizzarias','personalidade_atendente',
        'produtos','pedidos','conversas'
    ] LOOP
        EXECUTE format('
            CREATE TRIGGER %I_updated_at
            BEFORE UPDATE ON public.%I
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        ', t, t);
    END LOOP;
END $$;
