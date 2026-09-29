-- Migration 036
-- Proteção contra banimento do número (API não oficial do WhatsApp).
--
-- clientes.nao_perturbe: o cliente pediu para não receber mais mensagens
-- automáticas ("pare de mandar mensagem"). Quem se irrita e não tem como sair
-- aperta "Denunciar" — e denúncia é o maior gatilho de banimento.
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS nao_perturbe BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS nao_perturbe_em TIMESTAMPTZ;

-- pizzarias.whatsapp_conectado_desde: início do uso do número no sistema. Nos
-- primeiros 14 dias (aquecimento) o sistema não manda resgate de carrinho nem
-- pesquisa de satisfação e envia mais devagar: número novo com volume alto é o
-- perfil mais banido.
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS whatsapp_conectado_desde TIMESTAMPTZ;

-- Números que já estavam em uso antes desta migration contam como aquecidos.
UPDATE public.pizzarias
   SET whatsapp_conectado_desde = now() - INTERVAL '30 days'
 WHERE whatsapp_conectado_desde IS NULL AND instancia IS NOT NULL;
