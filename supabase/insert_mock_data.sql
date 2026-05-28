-- 1. Inserir a Pizzaria Padrão
INSERT INTO public.pizzarias (id, nome, endereco, instancia, telefone_admin, plano, bot_ativo_global, prompt_personalizado, asaas_api_key, gateway_pagamento, horario_funcionamento, mensagem_entregue, mensagens_status)
VALUES (
    'd8e6a570-5b5c-4217-a068-011dfd04085b',
    'Don Peppone Pizzaria',
    'Avenida Paulista, 1000 - Bela Vista, São Paulo - SP',
    'inst-peppone-883',
    '+55 (11) 98888-7777',
    'pro',
    true,
    public.default_pizzabot_prompt(),
    'asaas_api_key_mock_123456',
    'asaas',
    '{"seg-sex": "18:00 - 23:30", "sab-dom": "17:30 - 00:30"}',
    'Agradecemos a preferência! Seu pedido foi entregue com sucesso pela Don Peppone. Bom apetite! Se puder, nos avalie!',
    '{"confirmado":"Pagamento aprovado! Seu pedido já está na fila de preparação.","no_forno":"Boa notícia! Seu pedido está no forno.","a_caminho":"Seu pedido saiu para entrega e chegará em breve.","entregue":"Agradecemos a preferência! Seu pedido foi entregue com sucesso."}'
) ON CONFLICT DO NOTHING;

-- 2. Inserir Produtos Iniciais
INSERT INTO public.produtos (pizzaria_id, categoria, nome, descricao, preco, disponivel, ordem)
VALUES 
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'pizza', 'Pizza Calabresa Especial', 'Molho de tomate artesanal, muçarela premium, calabresa defumada fatiada, cebola roxa e azeitonas pretas chilenas.', 49.90, true, 1),
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'pizza', 'Pizza Marguerita Elegante', 'Molho de tomate fresco, muçarela de búfala, tomates-cereja confitados, manjericão fresco e fio de azeite extravirgem.', 45.90, true, 2),
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'lanche', 'X-Burger Di Peppone', 'Hambúrguer de 150g blend de costela, muçarela derretida, pão brioche selado na manteiga.', 24.90, true, 3),
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'bebida', 'Coca-Cola Original 2L', 'Garrafa de refrigerante Coca-Cola original de 2 Litros gelada.', 12.00, true, 4)
ON CONFLICT DO NOTHING;

-- 3. Inserir Clientes de Teste
INSERT INTO public.clientes (id, pizzaria_id, telefone, nome, endereco_padrao, preferencias, total_pedidos, total_gasto)
VALUES
    ('c5c83b8b-18a0-4386-8800-ec8a0c20be53', 'd8e6a570-5b5c-4217-a068-011dfd04085b', '+55 (11) 98888-1111', 'João Silva', 'Rua das Flores, 123, Apto 4', 'Massa fina, borda tradicional. Gosta de Coca gelada.', 2, 165.70),
    ('b9d0322b-31bc-4e5a-9351-c0356c9a9244', 'd8e6a570-5b5c-4217-a068-011dfd04085b', '+55 (11) 97777-2222', 'Maria Souza', 'Avenida Paulista, 1000', 'Vegetariana. Sem cebola.', 1, 55.80)
ON CONFLICT DO NOTHING;

-- 4. Inserir equipe inicial
INSERT INTO public.equipe_pizzaria (pizzaria_id, email, role, status)
VALUES
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'chefe.peppone@gmail.com', 'Admin', 'Proprietário'),
    ('d8e6a570-5b5c-4217-a068-011dfd04085b', 'atendimento.donpeppone@gmail.com', 'Atendente', 'Ativo')
ON CONFLICT DO NOTHING;
