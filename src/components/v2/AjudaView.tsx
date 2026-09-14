/**
 * Central de Ajuda — Reestruturação 1:1 fiel à imagem de referência (Ajuda.png).
 *
 * Estrutura:
 * 1. Banner "Central de Ajuda"
 * 2. Seção 1 ("1. Visão geral do PizzaBot") com grid interno de 3 cartões
 * 3. Duas colunas de categorias:
 *    - "OPERAÇÃO DO DIA A DIA" (Pedidos, Análise, Conversas, Clientes)
 *    - "CONFIGURAÇÃO DA LOJA" (Cardápio, Temas, Meu Negócio, Entregadores)
 * 4. Bloco inferior "CONTA E CRESCIMENTO" (Cardápio Digital, Assinatura e dúvidas rápidas)
 * 5. Drawer / Modal com detalhes completos ao clicar nos itens.
 */
import React, { useState } from "react";
import {
  HelpCircle, ClipboardList, TrendingUp, MessageSquare, UtensilsCrossed,
  Store, ChevronDown, ChevronRight, Rocket, Globe, Palette, Bike,
  ReceiptText, Users, Settings, User, X,
} from "lucide-react";

interface HelpTopic {
  titulo: string;
  descricao: string;
}

interface HelpItem {
  id: string;
  num: number;
  titulo: string;
  resumo: string;
  icon: React.ComponentType<{ className?: string }>;
  itens: HelpTopic[];
}

const VISAO_GERAL_ITEMS: HelpTopic[] = [
  {
    titulo: "O que o PizzaBot faz",
    descricao: "A atendente de IA conversa pelo WhatsApp, vende os produtos cadastrados, monta pedidos, calcula entrega, recebe pagamentos quando configurado e acompanha o andamento.",
  },
  {
    titulo: "Menu do painel",
    descricao: "Use Pedidos, Análise, Conversas, Clientes, Cardápio, Temas, Meu Negócio, Entregadores, Assinatura e Ajuda para administrar a operação.",
  },
  {
    titulo: "Atualizações em tempo real",
    descricao: "Pedidos e conversas são atualizados no painel. Salve as configurações para que passem a valer na operação.",
  },
];

const OPERACAO_ITEMS: HelpItem[] = [
  {
    id: "pedidos",
    num: 2,
    titulo: "2. Pedidos",
    resumo: "Controle a produção, saída e entrega.",
    icon: ClipboardList,
    itens: [
      { titulo: "Fluxo de produção", descricao: "Novo → Confirmado → No forno → Pronto para entrega → A caminho → Entregue. Para retirada, o pedido fica pronto para o cliente buscar." },
      { titulo: "Notificação sonora", descricao: "Novos pedidos acionam um alerta sonoro no painel até você abrir a notificação ou entrar na conversa." },
      { titulo: "Pix manual", descricao: "Pedidos com comprovante recebido ficam destacados no Kanban para você conferir e aprovar o pagamento." },
      { titulo: "Filtros rápidos", descricao: "Filtre por status, veja pedidos de hoje e abra a conversa do cliente com um clique." },
    ],
  },
  {
    id: "analise",
    num: 3,
    titulo: "3. Análise",
    resumo: "Métricas e histórico reunidos em um lugar.",
    icon: TrendingUp,
    itens: [
      { titulo: "Visão geral", descricao: "Acompanhe pedidos, faturamento, ticket médio, cancelamentos, vendas por dia, horários de pico e produtos mais vendidos." },
      { titulo: "Histórico completo", descricao: "Consulte todos os pedidos passados com filtros detalhados e faturamento acumulado." },
      { titulo: "Períodos comparativos", descricao: "Alterne entre 7, 30 e 90 dias para entender o ritmo de crescimento da sua pizzaria." },
    ],
  },
  {
    id: "conversas",
    num: 4,
    titulo: "4. Conversas",
    resumo: "Atendimento humano e IA no WhatsApp.",
    icon: MessageSquare,
    itens: [
      { titulo: "Central em tempo real", descricao: "Acompanhe as mensagens recebidas e enviadas pelo robô em tempo real diretamente pelo painel." },
      { titulo: "Assumir conversa", descricao: "Pause o bot com um clique para falar pessoalmente com o cliente e reative-o quando concluir." },
      { titulo: "Encaminhamento automático", descricao: "Quando o cliente solicita um atendente humano, a conversa fica destacada na lista." },
    ],
  },
  {
    id: "clientes",
    num: 5,
    titulo: "5. Clientes",
    resumo: "Contas, compras e controle de acesso.",
    icon: Users,
    itens: [
      { titulo: "Base de clientes cadastrados", descricao: "Veja quem criou conta no cardápio digital, com histórico de pedidos e total gasto na sua loja." },
      { titulo: "Histórico de compras", descricao: "Abra a ficha do cliente para ver endereços salvos, contatos e os últimos 100 pedidos." },
      { titulo: "Redefinir senha", descricao: "Ajude o cliente a recuperar o acesso gerando uma nova senha temporária direto pelo painel." },
    ],
  },
];

const CONFIG_ITEMS: HelpItem[] = [
  {
    id: "cardapio",
    num: 6,
    titulo: "6. Cardápio",
    resumo: "Produtos, tamanhos e disponibilidade.",
    icon: UtensilsCrossed,
    itens: [
      { titulo: "Cadastro de produtos", descricao: "Categorias, preços, fotos, tamanhos (ex: brotinho, média, grande) e bordas recheadas." },
      { titulo: "Pausar produtos", descricao: "Desative temporariamente itens esgotados sem precisar excluí-los do cardápio." },
      { titulo: "Importação rápida", descricao: "Envie imagem, PDF ou importe via JSON para acelerar o cadastro de novos itens." },
    ],
  },
  {
    id: "temas",
    num: 7,
    titulo: "7. Temas, banners e cupons",
    resumo: "Personalize a identidade do cardápio público.",
    icon: Palette,
    itens: [
      { titulo: "Identidade visual", descricao: "Alterne entre estilos (Brasa, Trattoria, Metrópole) e ajuste cores, fontes e botões ao vivo." },
      { titulo: "Banners promocionais", descricao: "Crie campanhas de destaque com imagem e botão de ação no topo do cardápio." },
      { titulo: "Cupons de desconto", descricao: "Crie cupons em % ou valor fixo com regras de valor mínimo e data de validade." },
    ],
  },
  {
    id: "negocio",
    num: 8,
    titulo: "8. Meu Negócio",
    resumo: "Configurações organizadas em categorias expansíveis.",
    icon: Store,
    itens: [
      { titulo: "Identidade e endereço", descricao: "Nome, telefone, endereço, link do Google Maps e banners da pizzaria." },
      { titulo: "Horários de funcionamento", descricao: "Defina abertura e fechamento por dia da semana e a mensagem automática de fora do horário." },
      { titulo: "Atendente IA", descricao: "Personalize o tom de voz, nome da atendente, nível de emojis e regras estritas do bot." },
    ],
  },
  {
    id: "entregadores",
    num: 9,
    titulo: "9. Entregadores",
    resumo: "Organize entregas com uma área própria.",
    icon: Bike,
    itens: [
      { titulo: "Área do entregador", descricao: "Acesso exclusivo para os motoboys visualizarem pedidos prontos e rota de entrega." },
      { titulo: "Autoatribuição", descricao: "Permita que os próprios motoboys assumam as entregas ou controle manualmente." },
      { titulo: "Status em tempo real", descricao: "Veja quem está livre, em rota de entrega ou offline na base operacional." },
    ],
  },
];

const CRESCIMENTO_ITEMS: HelpItem[] = [
  {
    id: "digital",
    num: 10,
    titulo: "10. Cardápio Digital",
    resumo: "Seu site de vendas ligado ao painel.",
    icon: Globe,
    itens: [
      { titulo: "Link público exclusivo", descricao: "Site rápido para seus clientes pedirem online direto pelo celular sem baixar app." },
      { titulo: "Sacola inteligente", descricao: "Cálculo automático de taxa de entrega, cupom de desconto e escolha de pagamento." },
      { titulo: "Rastreio de pedido", descricao: "O cliente acompanha o status do pedido em tempo real pelo número do WhatsApp." },
    ],
  },
  {
    id: "assinatura",
    num: 11,
    titulo: "11. Assinatura e dúvidas rápidas",
    resumo: "Plano, cobrança e soluções comuns.",
    icon: ReceiptText,
    itens: [
      { titulo: "Plano e recorrência", descricao: "Acompanhe limite de atendimentos, faturas geradas e renovação automática via Asaas." },
      { titulo: "Pix instantâneo", descricao: "Pague as faturas do plano diretamente com QR Code Pix com liberação imediata." },
      { titulo: "Suporte e ajuda", descricao: "Canais rápidos para falar com o suporte técnico da plataforma sempre que precisar." },
    ],
  },
];

export function AjudaView() {
  const [visaoGeralAberta, setVisaoGeralAberta] = useState(true);
  const [detalheItem, setDetalheItem] = useState<HelpItem | null>(null);

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-8 max-w-7xl mx-auto space-y-5">
      {/* 1. Header Banner "Central de Ajuda" */}
      <div className="relative overflow-hidden rounded-2xl border border-[#1e293b] bg-[#111622] p-5 md:p-6 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <HelpCircle className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Central de Ajuda</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Um guia rápido e direto de cada parte da ferramenta. Clique numa seção para abrir.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Seção 1: "1. Visão geral do PizzaBot" (Acordeão com grid de 3 colunas) */}
      <div className="rounded-2xl border border-[#1e293b] bg-[#111622] shadow-sm overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setVisaoGeralAberta(!visaoGeralAberta)}
          className="w-full flex items-center gap-3.5 p-5 text-left hover:bg-[#161f30]/40 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm md:text-base font-bold text-white">1. Visão geral do PizzaBot</h2>
            <p className="text-xs text-slate-400 mt-0.5">Do pedido à entrega, em um único painel.</p>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-slate-500 shrink-0 transition-transform duration-200 ${
              visaoGeralAberta ? "rotate-180 text-orange-400" : ""
            }`}
          />
        </button>

        {visaoGeralAberta && (
          <div className="px-5 pb-5 pt-1 border-t border-[#1e293b] bg-[#0d1118]/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-3">
              {VISAO_GERAL_ITEMS.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[#1e293b] bg-[#111622] p-4 flex flex-col justify-start"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                    <h3 className="text-xs font-bold text-white tracking-wide">{item.titulo}</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{item.descricao}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Grade em 2 Colunas: "OPERAÇÃO DO DIA A DIA" e "CONFIGURAÇÃO DA LOJA" */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Coluna Esquerda: Operação do Dia a Dia */}
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-orange-400">
                Operação do dia a dia
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Atendimento, pedidos e relacionamento com clientes.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            {OPERACAO_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDetalheItem(item)}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[#1e293b] bg-[#161f30]/60 hover:bg-[#161f30] hover:border-slate-600 transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-orange-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white group-hover:text-orange-400 transition-colors">
                      {item.titulo}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.resumo}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Coluna Direita: Configuração da Loja */}
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-orange-400">
                Configuração da loja
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Produtos, identidade e área da operação.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            {CONFIG_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDetalheItem(item)}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[#1e293b] bg-[#161f30]/60 hover:bg-[#161f30] hover:border-slate-600 transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-orange-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white group-hover:text-orange-400 transition-colors">
                      {item.titulo}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.resumo}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Bloco Inferior: "CONTA E CRESCIMENTO" (2 Colunas) */}
      <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-orange-400">
              Conta e crescimento
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Seu plano, presença online e suporte.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          {CRESCIMENTO_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDetalheItem(item)}
                className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[#1e293b] bg-[#161f30]/60 hover:bg-[#161f30] hover:border-slate-600 transition-all text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4.5 h-4.5 text-orange-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white group-hover:text-orange-400 transition-colors">
                    {item.titulo}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.resumo}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Footer */}
      <p className="text-xs text-slate-500 text-center pt-2">
        Ainda com dúvida? Fale com o suporte da plataforma. 🍕
      </p>

      {/* Modal de Detalhes do Tópico Selecionado */}
      {detalheItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setDetalheItem(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#1e293b] bg-[#111622] shadow-2xl p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#1e293b]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <detalheItem.icon className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{detalheItem.titulo}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{detalheItem.resumo}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetalheItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#161f30] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {detalheItem.itens.map((it, idx) => (
                <div key={idx} className="rounded-xl border border-[#1e293b] bg-[#161f30]/60 p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                    <h4 className="text-xs font-bold text-white">{it.titulo}</h4>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed pl-4">{it.descricao}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-[#1e293b] flex justify-end">
              <button
                type="button"
                onClick={() => setDetalheItem(null)}
                className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
