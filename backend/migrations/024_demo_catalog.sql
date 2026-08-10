-- Catálogo de demonstração inicial (somente aditivo).
-- Não cria usuários, não altera produtos existentes e roda uma única vez.

DO $seed$
DECLARE
    v_pizza jsonb := $catalog${"nome":"Fornalha Burger & Pizza","slug":"fornalha-burger-pizza","logo_url":null,"banner_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=2000&q=88","endereco":"Rua da Brasa, 147 - Centro","endereco_maps_url":"https://maps.app.goo.gl/yefpPgSmrADMczoX6","telefone_contato":"11999992026","instagram":null,"horario_funcionamento":{"dom":{"abre":"18:00","fecha":"23:00","fechado":false},"qua":{"abre":"18:00","fecha":"23:00","fechado":false},"qui":{"abre":"18:00","fecha":"23:00","fechado":false},"sab":{"abre":"18:00","fecha":"23:00","fechado":false},"seg":{"abre":"18:00","fecha":"23:00","fechado":false},"sex":{"abre":"18:00","fecha":"23:00","fechado":false},"ter":{"abre":"18:00","fecha":"23:00","fechado":false}},"tema_cardapio":{"bordas":"retas","cupons":[{"id":"demo-brasa15","tipo":"percentual","ativo":true,"valor":15,"codigo":"BRASA15","validade":"2027-12-31","descricao":"15% OFF em pedidos acima de R$ 30","pedido_minimo":30}],"modelo":"brasa","titulo":"O SABOR QUE|ACENDE A FOME.","chamada":"FEITO NA HORA. DO SEU JEITO.","campanhas":[{"id":"demo-brasa-week","ativa":true,"ordem":0,"titulo":"Semana da Brasa","etiqueta":"OFERTA DA SEMANA","cta_label":"Escolher meu favorito","subtitulo":"Os favoritos da casa com uma condicao especial por tempo limitado.","imagem_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=2000&q=88","cupom_codigo":"BRASA15"}],"cor_fundo":"#090907","descricao":"Escolha seus favoritos, personalize o pedido e receba tudo quentinho onde estiver.","fonte_texto":"inter","cor_primaria":"#f26b21","fonte_titulo":"anton","cor_secundaria":"#ff4d22","mostrar_acompanhamento":true},"formas_pagamento_aceitas":["pix","cartao","dinheiro"],"taxa_entrega_info":null,"taxa_entrega_fixa":6.9,"taxas_bairro":[],"adicionais":[{"nome":"Bacon crocante","tipo":"lanche","preco":5},{"nome":"Queijo extra","tipo":"todos","preco":4},{"nome":"Molho da casa","tipo":"todos","preco":2.5}],"tempo_entrega_min":30,"tempo_entrega_max":45,"tempo_retirada_min":15,"tempo_retirada_max":25}$catalog$::jsonb;
    v_products jsonb := $catalog$[{"categoria":"lanche","nome":"Brasa Supreme","descricao":"Pão brioche, blend de 180g, cheddar, bacon crocante, cebola caramelizada e molho da casa.","preco":39.9,"imagem_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=84","ordem":1,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"lanche","nome":"Smash Duplo","descricao":"Dois smash burgers, queijo derretido, picles artesanal e molho especial.","preco":32.9,"imagem_url":"https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=84","ordem":2,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"lanche","nome":"Fornalha Bacon","descricao":"Blend bovino, queijo, bacon em tiras e barbecue defumado.","preco":36.9,"imagem_url":"https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=84","ordem":3,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"lanche","nome":"Cheese Clássico","descricao":"Carne suculenta, queijo, alface, tomate e maionese da casa.","preco":28.9,"imagem_url":"https://images.unsplash.com/photo-1551782450-a2132b4ba21d?auto=format&fit=crop&w=900&q=84","ordem":4,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"pizza","nome":"Pizza Brasa","descricao":"Molho artesanal, mussarela, pepperoni e toque de manjericão.","preco":49.9,"imagem_url":"https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=84","ordem":5,"tamanhos":[{"tamanho":"M","preco":49.9},{"tamanho":"G","preco":64.9}],"opcoes":{},"regras":{}},{"categoria":"pizza","nome":"Pizza Calabresa","descricao":"Mussarela, calabresa artesanal, cebola roxa e orégano.","preco":46.9,"imagem_url":"https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=900&q=84","ordem":6,"tamanhos":[{"tamanho":"M","preco":46.9},{"tamanho":"G","preco":59.9}],"opcoes":{},"regras":{}},{"categoria":"bebida","nome":"Cola Gelada","descricao":"Refrigerante cola servido bem gelado.","preco":8.0,"imagem_url":"https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=900&q=84","ordem":7,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"sobremesa","nome":"Brownie da Casa","descricao":"Brownie intenso de chocolate com casquinha crocante.","preco":16.9,"imagem_url":"https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=84","ordem":8,"tamanhos":null,"opcoes":{},"regras":{}},{"categoria":"pizza","nome":"Pizza Margherita Artesanal","descricao":"Molho de tomate italiano, muçarela, tomate fresco, manjericão e azeite extravirgem.","preco":37.9,"imagem_url":"https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85","ordem":9,"tamanhos":[{"tamanho":"P","preco":37.9},{"tamanho":"M","preco":49.9},{"tamanho":"G","preco":62.9}],"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"pizza","nome":"Pizza Frango com Catupiry","descricao":"Frango temperado e desfiado, Catupiry cremoso, muçarela e orégano.","preco":40.9,"imagem_url":"https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=85","ordem":10,"tamanhos":[{"tamanho":"P","preco":40.9},{"tamanho":"M","preco":53.9},{"tamanho":"G","preco":66.9}],"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"pizza","nome":"Pizza Quatro Queijos","descricao":"Muçarela, provolone, parmesão e gorgonzola em uma combinação intensa e cremosa.","preco":41.9,"imagem_url":"https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=900&q=85","ordem":11,"tamanhos":[{"tamanho":"P","preco":41.9},{"tamanho":"M","preco":54.9},{"tamanho":"G","preco":68.9}],"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"pizza","nome":"Pizza Portuguesa Premium","descricao":"Presunto, ovos, cebola roxa, azeitonas, ervilha, muçarela e orégano.","preco":40.9,"imagem_url":"https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=85","ordem":12,"tamanhos":[{"tamanho":"P","preco":40.9},{"tamanho":"M","preco":53.9},{"tamanho":"G","preco":66.9}],"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"bebida","nome":"Coca-Cola 2L","descricao":"Refrigerante Coca-Cola gelado, garrafa de 2 litros.","preco":15.9,"imagem_url":"https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=900&q=85","ordem":13,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"bebida","nome":"Guaraná Antarctica 2L","descricao":"Guaraná Antarctica gelado, garrafa de 2 litros.","preco":13.9,"imagem_url":"https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85","ordem":14,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"bebida","nome":"Suco Natural de Laranja 500ml","descricao":"Suco de laranja natural, preparado na hora e servido bem gelado.","preco":12.9,"imagem_url":"https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=900&q=85","ordem":15,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"bebida","nome":"Água Mineral 500ml","descricao":"Água mineral sem gás, gelada.","preco":4.5,"imagem_url":"https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=900&q=85","ordem":16,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"sobremesa","nome":"Pudim de Leite da Casa","descricao":"Pudim cremoso de leite condensado com calda de caramelo.","preco":12.9,"imagem_url":"https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=900&q=85","ordem":17,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"sobremesa","nome":"Pizza Doce de Chocolate com Morango","descricao":"Chocolate cremoso, morangos frescos e finalização com leite em pó.","preco":39.9,"imagem_url":"https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=85","ordem":18,"tamanhos":[{"tamanho":"M","preco":39.9},{"tamanho":"G","preco":52.9}],"opcoes":{"adicionais":[]},"regras":{}},{"categoria":"sobremesa","nome":"Petit Gâteau com Sorvete","descricao":"Bolinho quente de chocolate com recheio cremoso e sorvete de baunilha.","preco":21.9,"imagem_url":"https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=900&q=85","ordem":19,"tamanhos":null,"opcoes":{"adicionais":[]},"regras":{}}]$catalog$::jsonb;
    v_pizzaria_id uuid;
    v_product jsonb;
    v_product_id uuid;
    v_size jsonb;
BEGIN
    INSERT INTO public.pizzarias (
        nome, slug, plano, bot_ativo_global, aberto_manual,
        logo_url, banner_url, endereco, endereco_maps_url,
        telefone_contato, instagram, horario_funcionamento,
        tema_cardapio, formas_pagamento_aceitas, taxa_entrega_info,
        taxa_entrega_fixa, taxas_bairro, adicionais,
        tempo_entrega_min, tempo_entrega_max,
        tempo_retirada_min, tempo_retirada_max,
        mensagens_status, nomes_colunas
    )
    VALUES (
        v_pizza->>'nome',
        v_pizza->>'slug',
        'basico',
        FALSE,
        TRUE,
        v_pizza->>'logo_url',
        v_pizza->>'banner_url',
        v_pizza->>'endereco',
        v_pizza->>'endereco_maps_url',
        v_pizza->>'telefone_contato',
        v_pizza->>'instagram',
        COALESCE(v_pizza->'horario_funcionamento', '{}'::jsonb),
        COALESCE(v_pizza->'tema_cardapio', '{}'::jsonb),
        COALESCE(v_pizza->'formas_pagamento_aceitas', '[]'::jsonb),
        v_pizza->>'taxa_entrega_info',
        NULLIF(v_pizza->>'taxa_entrega_fixa', '')::numeric,
        COALESCE(v_pizza->'taxas_bairro', '[]'::jsonb),
        COALESCE(v_pizza->'adicionais', '[]'::jsonb),
        COALESCE(NULLIF(v_pizza->>'tempo_entrega_min', '')::integer, 30),
        COALESCE(NULLIF(v_pizza->>'tempo_entrega_max', '')::integer, 60),
        COALESCE(NULLIF(v_pizza->>'tempo_retirada_min', '')::integer, 15),
        COALESCE(NULLIF(v_pizza->>'tempo_retirada_max', '')::integer, 25),
        '{}'::jsonb,
        '{}'::jsonb
    )
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO v_pizzaria_id
    FROM public.pizzarias
    WHERE slug = v_pizza->>'slug';

    IF v_pizzaria_id IS NULL THEN
        RAISE NOTICE 'Pizzaria de demonstração não encontrada; catálogo ignorado.';
        RETURN;
    END IF;

    FOR v_product IN
        SELECT value FROM jsonb_array_elements(v_products)
    LOOP
        SELECT id INTO v_product_id
        FROM public.produtos
        WHERE pizzaria_id = v_pizzaria_id
          AND lower(nome) = lower(v_product->>'nome')
        ORDER BY created_at
        LIMIT 1;

        IF v_product_id IS NULL THEN
            INSERT INTO public.produtos (
                pizzaria_id, categoria, nome, descricao, preco,
                disponivel, imagem_url, ordem, aliases, tags, opcoes, regras
            )
            VALUES (
                v_pizzaria_id,
                v_product->>'categoria',
                v_product->>'nome',
                v_product->>'descricao',
                (v_product->>'preco')::numeric,
                TRUE,
                v_product->>'imagem_url',
                COALESCE(NULLIF(v_product->>'ordem', '')::integer, 0),
                '[]'::jsonb,
                '[]'::jsonb,
                COALESCE(v_product->'opcoes', '{}'::jsonb),
                COALESCE(v_product->'regras', '{}'::jsonb)
            )
            RETURNING id INTO v_product_id;
        END IF;

        FOR v_size IN
            SELECT value
            FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(v_product->'tamanhos') = 'array'
                    THEN v_product->'tamanhos'
                    ELSE '[]'::jsonb
                END
            )
        LOOP
            INSERT INTO public.produto_tamanhos (
                produto_id, tamanho, preco, disponivel
            )
            SELECT
                v_product_id,
                v_size->>'tamanho',
                (v_size->>'preco')::numeric,
                TRUE
            WHERE NOT EXISTS (
                SELECT 1
                FROM public.produto_tamanhos current_size
                WHERE current_size.produto_id = v_product_id
                  AND lower(current_size.tamanho) = lower(v_size->>'tamanho')
            );
        END LOOP;
    END LOOP;
END
$seed$;