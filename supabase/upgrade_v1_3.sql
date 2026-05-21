-- PizzaBot v1.3 - Numero de pedido sequencial por pizzaria (PRD sec. 3.1.4)
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.pedidos
  ALTER COLUMN numero_pedido DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.assign_numero_pedido_por_pizzaria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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

DROP TRIGGER IF EXISTS pedidos_numero_por_pizzaria ON public.pedidos;
CREATE TRIGGER pedidos_numero_por_pizzaria
BEFORE INSERT ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.assign_numero_pedido_por_pizzaria();

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_pizzaria_numero_pedido_key
  ON public.pedidos (pizzaria_id, numero_pedido);
