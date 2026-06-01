-- Migration 010
-- Transição do cardápio e adicionais para tabelas relacionais normatizadas.

-- 1. Criação da tabela de tamanhos de produtos
CREATE TABLE IF NOT EXISTS public.produto_tamanhos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
    tamanho VARCHAR(30) NOT NULL,
    preco NUMERIC(10, 2) NOT NULL,
    disponivel BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_produto_tamanhos_prod_id ON public.produto_tamanhos(produto_id);

-- 2. Criação da tabela de grupos de complementos
CREATE TABLE IF NOT EXISTS public.grupo_complementos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pizzaria_id UUID NOT NULL REFERENCES public.pizzarias(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    obrigatorio BOOLEAN NOT NULL DEFAULT FALSE,
    min_opcoes INTEGER NOT NULL DEFAULT 0,
    max_opcoes INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grupo_complementos_pizzaria_id ON public.grupo_complementos(pizzaria_id);

-- 3. Criação da tabela de itens de complementos (adicionais/bordas)
CREATE TABLE IF NOT EXISTS public.complementos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grupo_id UUID NOT NULL REFERENCES public.grupo_complementos(id) ON DELETE CASCADE,
    nome VARCHAR(120) NOT NULL,
    preco NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    disponivel BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complementos_grupo_id ON public.complementos(grupo_id);

-- 4. Tabela de ligação muitos-para-muitos entre produtos e grupos de complementos
CREATE TABLE IF NOT EXISTS public.produto_complementos (
    produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
    grupo_id UUID NOT NULL REFERENCES public.grupo_complementos(id) ON DELETE CASCADE,
    PRIMARY KEY (produto_id, grupo_id)
);

-- 5. Migração de dados de tamanhos do JSONB antigo para produto_tamanhos
INSERT INTO public.produto_tamanhos (id, produto_id, tamanho, preco, disponivel)
SELECT uuid_generate_v4(), id, r.tamanho, r.preco, TRUE
FROM public.produtos,
LATERAL jsonb_to_recordset(tamanhos) as r(tamanho text, preco numeric(10,2))
WHERE tamanhos IS NOT NULL AND jsonb_array_length(tamanhos) > 0;

-- 6. Migração de adicionais globais antigos da pizzaria para grupos/complementos (vinculados a pizzas)
WITH novos_grupos AS (
    INSERT INTO public.grupo_complementos (id, pizzaria_id, nome, obrigatorio, min_opcoes, max_opcoes)
    SELECT uuid_generate_v4(), id, 'Bordas e Adicionais', FALSE, 0, 10
    FROM public.pizzarias
    WHERE adicionais IS NOT NULL AND jsonb_array_length(adicionais) > 0
    RETURNING id, pizzaria_id
)
, novos_comp AS (
    INSERT INTO public.complementos (id, grupo_id, nome, preco, disponivel)
    SELECT uuid_generate_v4(), g.id, r.nome, r.preco, TRUE
    FROM novos_grupos g
    JOIN public.pizzarias p ON p.id = g.pizzaria_id,
    LATERAL jsonb_to_recordset(p.adicionais) as r(nome text, preco numeric(10,2))
    RETURNING id, grupo_id
)
INSERT INTO public.produto_complementos (produto_id, grupo_id)
SELECT prod.id, g.id
FROM novos_grupos g
JOIN public.produtos prod ON prod.pizzaria_id = g.pizzaria_id
WHERE prod.categoria = 'pizza';
