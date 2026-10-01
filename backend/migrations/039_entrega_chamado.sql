-- Migration 039
-- Entrega da resposta do chamado interno com estado próprio.
--
-- Antes o chamado virava 'respondido' e a entrega ao cliente dependia de uma
-- task publicada DEPOIS do commit: queda do broker nesse intervalo, erro da
-- Evolution ou do worker deixavam a resposta sem chegar ao cliente — e o painel
-- mostrava "Resolvido" (achado A04 da análise de 01/10). Agora a intenção de
-- entregar nasce na mesma transação da resposta (entrega_status = 'pendente')
-- e o beat retoma o que ficou para trás.
--
--   entrega_status: pendente | enviando | enviado | falhou | humano
--     pendente  → resposta gravada, falta levar ao cliente
--     enviando  → um worker pegou (trava: só um envia)
--     enviado   → chegou ao WhatsApp
--     falhou    → esgotou as tentativas; a conversa foi para atendimento humano
--     humano    → um atendente assumiu a conversa antes da entrega
ALTER TABLE public.chamados_internos
    ADD COLUMN IF NOT EXISTS entrega_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS entrega_tentativas INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS entrega_atualizada_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS entrega_erro TEXT,
    ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ;

-- Respondidos antes desta migration: o que já mostrou a mensagem ao cliente foi
-- entregue; o que tem humano_assumiu ficou com o atendente. O resto fica NULL
-- (o painel mostra como antes).
UPDATE public.chamados_internos
   SET entrega_status = CASE
        WHEN contexto->>'mensagem_ao_cliente' IS NOT NULL THEN 'enviado'
        WHEN contexto->>'humano_assumiu' = 'true' THEN 'humano'
       END
 WHERE status = 'respondido' AND entrega_status IS NULL;

-- O beat procura só o que está em andamento.
CREATE INDEX IF NOT EXISTS ix_chamados_entrega_pendente
    ON public.chamados_internos (entrega_atualizada_em)
    WHERE entrega_status IN ('pendente', 'enviando');
