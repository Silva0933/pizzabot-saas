-- Migration 032
-- Conferência humana do pedido (camada 5 da blindagem do atendimento): com a
-- opção "Conferir pedidos antes da cozinha" ligada no comportamento da
-- pizzaria, o pedido fechado pela IA entra como "novo" com esta marca e só vai
-- para "confirmado" quando alguém da loja aprovar no painel — nem a aprovação
-- do pagamento pula essa etapa. Padrão falso: nada muda para quem não ligar.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS aguardando_revisao BOOLEAN NOT NULL DEFAULT FALSE;
