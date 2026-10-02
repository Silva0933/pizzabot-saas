-- Migration 040
-- Opção de conectar a pizzaria pela API OFICIAL do WhatsApp (Cloud API da Meta).
--
-- Até aqui a única conexão era por QR Code (Baileys, via Evolution): número
-- comum do WhatsApp, sujeito a banimento e a desconexões. A API oficial é uma
-- conexão SEPARADA, sem a Evolution: a Meta chama /webhook/whatsapp-cloud/{id}
-- e o envio sai pela Graph API (services/whatsapp_cloud). A integração
-- WHATSAPP-BUSINESS da Evolution v2.3.7 não serve: guarda o número do cliente
-- numa variável da instância e, com dois clientes ao mesmo tempo, trocava as
-- mensagens de um pelo outro.
--
--   whatsapp_tipo:  qrcode | cloud_api
--   whatsapp_cloud: phone_number_id, waba_id, token e app_secret (CIFRADOS,
--                   services/secrets), verify_token, webhook_verificado_em,
--                   numero_exibicao, nome_verificado, qualidade, e o modelo
--                   (template) usado fora da janela de 24 h (modelo_nome,
--                   modelo_idioma, modelo_parametros, modelo_texto).
ALTER TABLE public.pizzarias
    ADD COLUMN IF NOT EXISTS whatsapp_tipo VARCHAR(20) NOT NULL DEFAULT 'qrcode',
    ADD COLUMN IF NOT EXISTS whatsapp_cloud JSONB NOT NULL DEFAULT '{}'::jsonb;
