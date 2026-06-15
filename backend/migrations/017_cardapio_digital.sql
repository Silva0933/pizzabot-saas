-- Migration 017: Cardápio Digital Público
-- Adiciona campo 'origem' nos pedidos e popula slugs nas pizzarias existentes.

-- Campo 'origem' para distinguir pedidos via WhatsApp vs. Cardápio Digital.
ALTER TABLE public.pedidos
ADD COLUMN IF NOT EXISTS origem VARCHAR(30) DEFAULT 'whatsapp' NOT NULL;

-- Popula o slug das pizzarias que ainda não têm.
UPDATE public.pizzarias
SET slug = LOWER(REGEXP_REPLACE(TRIM(nome), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL AND nome IS NOT NULL;

-- Remove hífens duplicados e trailing hyphens do slug gerado.
UPDATE public.pizzarias
SET slug = TRIM(BOTH '-' FROM REGEXP_REPLACE(slug, '-{2,}', '-', 'g'))
WHERE slug IS NOT NULL AND slug ~ '(^-|-$|-{2,})';

-- Garante unicidade: desambigua slugs duplicados adicionando sufixo numérico.
-- (executado como DO block idempotente)
DO $$
DECLARE
  r RECORD;
  i INT;
BEGIN
  FOR r IN
    SELECT slug, ARRAY_AGG(id ORDER BY created_at) AS ids
    FROM public.pizzarias
    WHERE slug IS NOT NULL
    GROUP BY slug
    HAVING COUNT(*) > 1
  LOOP
    i := 1;
    FOR j IN 2..ARRAY_LENGTH(r.ids, 1) LOOP
      UPDATE public.pizzarias SET slug = r.slug || '-' || i WHERE id = r.ids[j];
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;
