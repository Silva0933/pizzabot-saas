/**
 * Ajuda — guia rápido e direto de toda a ferramenta.
 *
 * Acordeão sequencial: o dono da pizzaria clica numa seção e vê, de forma simples,
 * para que serve cada opção do painel e como a atendente de IA trabalha. Conteúdo
 * estático (sem chamada de API) — carrega instantâneo.
 */
import React, { useState } from "react";
import {
  HelpCircle, ClipboardList, TrendingUp, MessageSquare, UtensilsCrossed,
  Store, CreditCard, Sparkles, Lightbulb, ChevronDown, Rocket, Globe,
} from "lucide-react";

type HelpItem = { titulo: string; descricao: string };
type HelpSection = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  resumo: string;
  itens: HelpItem[];
};

const SECOES: HelpSection[] = [
  {
    id: "visao",
    icon: Rocket,
    titulo: "1. Visão geral — o que é o PizzaBot",
    resumo: "Como a ferramenta funciona, em poucas linhas.",
    itens: [
      { titulo: "O que ele faz", descricao: "É uma atendente de inteligência artificial que conversa com seus clientes no WhatsApp: mostra o cardápio, monta o pedido, calcula a taxa de entrega, cobra (quando você quiser) e acompanha o status até a entrega." },
      { titulo: "O painel", descricao: "Aqui você acompanha tudo em tempo real: pedidos, conversas, cardápio e as configurações do seu negócio. As mudanças que você salva aqui valem na hora para a atendente." },
      { titulo: "Menu lateral", descricao: "Pedidos, Análise, Conversas, Cardápio, Meu Negócio e Ajuda. Cada um está explicado nas seções abaixo, na ordem do menu." },
    ],
  },
  {
    id: "pedidos",
    icon: ClipboardList,
    titulo: "2. Pedidos",
    resumo: "O quadro onde você acompanha e move cada pedido.",
    itens: [
      { titulo: "Para que serve", descricao: "Mostra todos os pedidos em cards, do mais novo ao entregue. É a sua tela principal do dia a dia." },
      { titulo: "Status do pedido", descricao: "Novo → Confirmado → No forno → A caminho → Entregue (ou Cancelado). Mude o status pelo seletor do card." },
      { titulo: "Aviso automático ao cliente", descricao: "Toda vez que você muda o status, a atendente avisa o cliente no WhatsApp sozinha (ex.: 'Saiu para entrega')." },
      { titulo: "Conferência de Pix manual", descricao: "Se você usa Pix manual, o card fica destacado ('aguardando comprovante' / 'comprovante recebido') com os botões Confirmar e Rejeitar pagamento." },
      { titulo: "Filtros e métricas", descricao: "No topo: total de pedidos, pendentes, em preparo e faturamento. Você pode filtrar por status e por data." },
      { titulo: "WhatsApp e Excluir", descricao: "Cada card tem um atalho para abrir a conversa no WhatsApp e um botão para excluir o pedido (ação irreversível)." },
    ],
  },
  {
    id: "analise",
    icon: TrendingUp,
    titulo: "3. Análise",
    resumo: "Os numbers do seu negócio.",
    itens: [
      { titulo: "Para que serve", descricao: "Mostra o desempenho: faturamento, quantidade de pedidos, ticket médio e gráficos de vendas ao longo do tempo." },
      { titulo: "Como usar", descricao: "Use para entender seus dias e horários mais fortes e acompanhar o crescimento das vendas." },
    ],
  },
  {
    id: "conversas",
    icon: MessageSquare,
    titulo: "4. Conversas",
    resumo: "O histórico de WhatsApp e o atendimento manual.",
    itens: [
      { titulo: "Para que serve", descricao: "Central de atendimento: você lê todas as conversas dos clientes com a atendente, em tempo real." },
      { titulo: "Assumir a conversa", descricao: "Você pode pausar o bot numa conversa e responder você mesmo. Quando terminar, é só reativar o bot." },
      { titulo: "Quando a IA chama você", descricao: "Se o cliente reclama, pede um humano, ou a IA não entende após algumas tentativas, ela passa a conversa para a equipe automaticamente." },
    ],
  },
  {
    id: "cardapio",
    icon: UtensilsCrossed,
    titulo: "5. Cardápio",
    resumo: "Seus produtos, tamanhos e bebidas.",
    itens: [
      { titulo: "Para que serve", descricao: "Onde você cadastra tudo que a atendente pode vender: categorias, produtos, descrições e preços. Ela só oferece o que está aqui (não inventa)." },
      { titulo: "Tamanhos", descricao: "Cada pizza pode ter vários tamanhos (P, M, G, GG) com preços diferentes. A atendente pergunta o tamanho antes de fechar." },
      { titulo: "Bebidas", descricao: "Cadastre bebidas na categoria 'bebida'. Assim, depois que o cliente escolhe a pizza, a atendente oferece uma bebida — e só oferece se houver bebida cadastrada." },
      { titulo: "Subir cardápio (PDF/imagem)", descricao: "Você pode enviar o arquivo do seu cardápio. A atendente manda esse arquivo para o cliente quando ele pede para ver o cardápio." },
      { titulo: "Importar por texto/foto", descricao: "Dá para importar os produtos a partir de um texto ou de uma foto do cardápio, com a ajuda da IA, para não cadastrar tudo na mão." },
    ],
  },
  {
    id: "negocio",
    icon: Store,
    titulo: "6. Meu Negócio",
    resumo: "Todas as configurações da sua pizzaria.",
    itens: [
      { titulo: "Atendente (personalidade)", descricao: "Defina o nome da atendente, o estilo (casual/profissional), o nível de emojis e os diferenciais da casa. É a 'cara' do seu atendimento." },
      { titulo: "Identidade", descricao: "Nome da pizzaria, endereço, link do Google Maps (enviado quando o cliente pergunta onde fica ou escolhe retirada) e logo." },
      { titulo: "WhatsApp / Bot", descricao: "Conecte o WhatsApp lendo o QR Code e ligue/desligue o bot globalmente. Com o bot desligado, a atendente não responde." },
      { titulo: "Tempos de entrega e retirada", descricao: "Os minutos estimados que a atendente informa ao cliente (ex.: 'fica pronto em 30–60 min')." },
      { titulo: "Taxa de entrega", descricao: "Uma taxa fixa padrão e/ou uma tabela por bairro. A atendente informa a taxa certa pelo endereço do cliente." },
      { titulo: "Adicionais & Bordas", descricao: "Cadastre bordas recheadas e adicionais (com preço). A atendente oferece depois da escolha da pizza — e só oferece se houver algo cadastrado." },
      { titulo: "Horário de funcionamento", descricao: "Defina os horários de cada dia. Fora do horário, a atendente avisa que está fechada (com a mensagem que você escrever)." },
      { titulo: "Histórico de pedidos", descricao: "A lista completa de todos os pedidos já feitos, para consulta." },
    ],
  },
  {
    id: "cardapio_digital",
    icon: Globe,
    titulo: "7. Cardápio Digital (Site de Vendas)",
    resumo: "Seu e-commerce próprio de pizza integrado ao WhatsApp.",
    itens: [
      { titulo: "O que é", descricao: "É o site de vendas exclusivo da sua pizzaria (ex: seudominio.com/m/sua-pizzaria) para você divulgar em redes sociais, anúncios ou direto no WhatsApp. Os clientes compram por ele sem precisar instalar nada." },
      { titulo: "Carrinho de compras", descricao: "O cliente clica na Pizza, escolhe o tamanho, opcionais/adicionais e pode voltar ao menu para escolher uma bebida (refrigerante, etc.). A barra flutuante acumula e soma os preços em tempo real." },
      { titulo: "Checkout e endereço", descricao: "O cliente preenche os dados de entrega. Se digitar o bairro, o sistema calcula a taxa de entrega baseado nas tabelas configuradas no painel. Também suporta Retirada." },
      { titulo: "Integração instantânea", descricao: "Ao finalizar, o pedido entra imediatamente no seu painel em Pedidos (com origem 'Cardápio Digital') e o cliente recebe mensagem de confirmação automática no WhatsApp." },
      { titulo: "Configuração do link", descricao: "Você ativa o cardápio, copia o link para compartilhar e personaliza o nome amigável (slug) do endereço em Meu Negócio → aba Geral, na seção 'Cardápio Digital'." },
    ],
  },
  {
    id: "pagamentos",
    icon: CreditCard,
    titulo: "8. Pagamentos na conversa",
    resumo: "Os 3 modos de receber — escolha em Meu Negócio → Geral.",
    itens: [
      { titulo: "Automático (Mercado Pago / Asaas)", descricao: "A atendente gera a cobrança Pix/cartão na hora e o sistema confirma o pagamento sozinho. Precisa cadastrar o token do provedor. O Pix expira em 30 min." },
      { titulo: "Manual (Pix próprio)", descricao: "Você cadastra o seu código Pix copia-e-cola uma vez. A atendente envia esse código ao cliente e pede o comprovante. Quando ele envia, o card é destacado para você Confirmar ou Rejeitar o pagamento." },
      { titulo: "Desativado", descricao: "A atendente não oferece pagamento online — o cliente paga só na entrega ou retirada (dinheiro/cartão)." },
      { titulo: "Confirmar / Rejeitar (modo manual)", descricao: "Na aba Pedidos, ao receber o comprovante, clique em Confirmar (o cliente é avisado e o pedido avança) ou Rejeitar (o cliente é avisado para tentar de novo ou pagar na entrega)." },
    ],
  },
  {
    id: "atendente",
    icon: Sparkles,
    titulo: "9. Como a atendente monta o pedido",
    resumo: "O passo a passo que ela segue em cada conversa.",
    itens: [
      { titulo: "1) Saudação", descricao: "Ela cumprimenta e oferece mostrar o cardápio." },
      { titulo: "2) Escolha do produto", descricao: "O cliente escolhe; ela confirma o tamanho quando necessário." },
      { titulo: "3) Oferta extra (upsell)", descricao: "Logo após a pizza, ela oferece bebida, borda ou adicional — mas só o que existe cadastrado. Se o cliente diz que quer sem dizer qual, ela lista as opções e pergunta." },
      { titulo: "4) Entrega ou retirada", descricao: "Ela pergunta como será e, se for entrega, pede o endereço e calcula a taxa." },
      { titulo: "5) Pagamento", descricao: "Pergunta a forma de pagamento, conforme o modo configurado (automático, manual ou na entrega)." },
      { titulo: "6) Resumo e fechamento", descricao: "Mostra o resumo com os valores reais e pede a confirmação antes de fechar o pedido." },
      { titulo: "Proteções", descricao: "Ela usa sempre os preços reais do cardápio (não inventa valores) e, se travar ou não entender, passa a conversa para a equipe." },
    ],
  },
  {
    id: "dicas",
    icon: Lightbulb,
    titulo: "10. Dúvidas comuns",
    resumo: "Soluções rápidas para o dia a dia.",
    itens: [
      { titulo: "A atendente não está respondendo", descricao: "Verifique em Meu Negócio: o bot está ativo? O WhatsApp está conectado (QR Code)? Está dentro do horário de funcionamento?" },
      { titulo: "Ela não oferece bebida/borda", descricao: "Confira se há bebidas no Cardápio (categoria 'bebida') e adicionais/bordas cadastrados em Meu Negócio. Ela só oferece o que existe." },
      { titulo: "O cliente não recebeu o Pix", descricao: "Veja o modo de pagamento em Meu Negócio → Geral. No automático, precisa do token do provedor; no manual, do seu código copia-e-cola." },
      { titulo: "Quero atender pessoalmente", descricao: "Em Conversas, assuma a conversa para pausar o bot e responder você mesmo." },
    ],
  },
];

export function AjudaView() {
  // Primeira seção aberta por padrão; clicar abre/fecha cada uma.
  const [aberta, setAberta] = useState<string | null>(SECOES[0].id);

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 max-w-3xl mx-auto space-y-4">
      <div className="bg-brand-gradient text-white rounded-2xl p-5 shadow-card">
        <div className="flex items-center gap-2.5">
          <HelpCircle className="w-6 h-6" />
          <h2 className="font-bold text-lg md:text-xl">Central de Ajuda</h2>
        </div>
        <p className="text-sm text-white/90 mt-1.5">
          Um guia rápido e direto de cada parte da ferramenta. Clique numa seção para abrir.
        </p>
      </div>

      <div className="space-y-2.5">
        {SECOES.map(({ id, icon: Icon, titulo, resumo, itens }) => {
          const open = aberta === id;
          return (
            <div key={id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setAberta(open ? null : id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{titulo}</p>
                  <p className="text-xs text-slate-500 truncate">{resumo}</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {open && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
                  {itens.map((it, i) => (
                    <div key={i} className="flex gap-2.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{it.titulo}</p>
                        <p className="text-sm text-slate-600 leading-relaxed">{it.descricao}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 text-center pt-2">
        Ainda com dúvida? Fale com o suporte da plataforma. 🍕
      </p>
    </div>
  );
}
