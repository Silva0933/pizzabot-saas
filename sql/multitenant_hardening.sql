-- ═══════════════════════════════════════════════════════════════
-- MULTITENANT HARDENING - PizzaBot
-- Rode tudo isto no Supabase SQL Editor
-- (Read-only MCP nao permite aplicar automaticamente)
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. INDICES (performance)
-- ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_produtos_pizzaria_id
  ON public.produtos(pizzaria_id);

CREATE INDEX IF NOT EXISTS idx_produtos_pizzaria_disponivel
  ON public.produtos(pizzaria_id, disponivel) WHERE disponivel = true;

CREATE INDEX IF NOT EXISTS idx_produtos_pizzaria_categoria
  ON public.produtos(pizzaria_id, categoria) WHERE disponivel = true;

CREATE INDEX IF NOT EXISTS idx_pedidos_pizzaria_status
  ON public.pedidos(pizzaria_id, status);

CREATE INDEX IF NOT EXISTS idx_pedidos_pizzaria_created
  ON public.pedidos(pizzaria_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversas_pizzaria_updated
  ON public.conversas(pizzaria_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_clientes_pizzaria
  ON public.clientes(pizzaria_id);

CREATE INDEX IF NOT EXISTS idx_fila_instancia_telefone
  ON public.n8n_fila_mensagens(instancia, telefone, timestamp);

-- ───────────────────────────────────────────────────────────────
-- 2. FOREIGN KEYS (integridade referencial)
-- ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_produtos_pizzaria') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT fk_produtos_pizzaria
      FOREIGN KEY (pizzaria_id) REFERENCES public.pizzarias(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_pedidos_pizzaria') THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT fk_pedidos_pizzaria
      FOREIGN KEY (pizzaria_id) REFERENCES public.pizzarias(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_clientes_pizzaria') THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT fk_clientes_pizzaria
      FOREIGN KEY (pizzaria_id) REFERENCES public.pizzarias(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_conversas_pizzaria') THEN
    ALTER TABLE public.conversas
      ADD CONSTRAINT fk_conversas_pizzaria
      FOREIGN KEY (pizzaria_id) REFERENCES public.pizzarias(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_equipe_pizzaria') THEN
    ALTER TABLE public.equipe_pizzaria
      ADD CONSTRAINT fk_equipe_pizzaria
      FOREIGN KEY (pizzaria_id) REFERENCES public.pizzarias(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_pedidos_cliente') THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT fk_pedidos_cliente
      FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 3. LIMPAR HISTORICO DE CHAT CONTAMINADO (caso ainda exista)
-- ───────────────────────────────────────────────────────────────
DELETE FROM public.n8n_historico_mensagens
WHERE session_id LIKE '%-559887353587';

-- ───────────────────────────────────────────────────────────────
-- 4. SECURITY HARDENING - remover policies anonimas abertas
-- ATENCAO: rodar APENAS depois de garantir que o painel usa autenticacao
-- (usuarios logados via Supabase Auth, nao anon key)
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.pedidos;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.produtos;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.pizzarias;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.n8n_fila_mensagens;
DROP POLICY IF EXISTS "Enable all for anonymous" ON public.n8n_historico_mensagens;

-- Substitui por policies restritas para tabelas internas do n8n
-- (acessadas via service_role pelo n8n, nao precisam ser publicas)
CREATE POLICY "service_role only" ON public.n8n_fila_mensagens
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role only" ON public.n8n_historico_mensagens
  FOR ALL USING (auth.role() = 'service_role');
