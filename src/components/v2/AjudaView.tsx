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
  Store, Lightbulb, ChevronDown, Rocket, Globe, Palette, Bike, ReceiptText,
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
  { id: "visao", icon: Rocket, titulo: "1. Visão geral do PizzaBot", resumo: "Do pedido à entrega, em um único painel.", itens: [
    { titulo: "O que o PizzaBot faz", descricao: "A atendente de IA conversa pelo WhatsApp, vende os produtos cadastrados, monta pedidos, calcula entrega, recebe pagamentos quando configurado e acompanha o andamento." },
    { titulo: "Menu do painel", descricao: "Use Pedidos, Análise, Conversas, Cardápio, Temas, Meu Negócio, Entregadores, Assinatura e Ajuda para administrar a operação." },
    { titulo: "Atualizações em tempo real", descricao: "Pedidos e conversas são atualizados no painel. Salve as configurações para que passem a valer na operação." },
  ] },
  { id: "pedidos", icon: ClipboardList, titulo: "2. Pedidos", resumo: "Controle a produção, saída e entrega.", itens: [
    { titulo: "Fluxo", descricao: "Novo → Confirmado → No forno → Pronto para entrega → A caminho → Entregue. Para retirada, o pedido fica pronto para o cliente buscar." },
    { titulo: "Notificação sonora", descricao: "Novos pedidos acionam um aviso no painel até você abrir a notificação ou entrar na conversa." },
    { titulo: "Pix manual", descricao: "Pedidos com comprovante recebido ficam destacados para confirmar ou rejeitar o pagamento." },
    { titulo: "Filtros", descricao: "Filtre por status e data, abra a conversa do cliente e atualize o pedido conforme ele avança." },
  ] },
  { id: "analise", icon: TrendingUp, titulo: "3. Análise", resumo: "Métricas e histórico reunidos em um lugar.", itens: [
    { titulo: "Visão geral", descricao: "Acompanhe pedidos, faturamento, ticket médio, cancelamentos, vendas por dia, horários de pico e produtos mais vendidos." },
    { titulo: "Histórico", descricao: "Abra a segunda aba da tela para consultar todos os pedidos, filtrar por status e revisar o total faturado." },
    { titulo: "Períodos", descricao: "Alterne entre 7, 30 e 90 dias para enxergar a evolução do negócio." },
  ] },
  { id: "conversas", icon: MessageSquare, titulo: "4. Conversas", resumo: "Atendimento humano e IA no WhatsApp.", itens: [
    { titulo: "Central de atendimento", descricao: "Leia o histórico e acompanhe as conversas com os clientes em tempo real." },
    { titulo: "Assumir conversa", descricao: "Pause o bot em uma conversa para responder pessoalmente e reative-o ao terminar." },
    { titulo: "Encaminhamento", descricao: "Quando o cliente pede uma pessoa ou a IA não consegue resolver, a conversa pode ser direcionada para a equipe." },
  ] },
  { id: "cardapio", icon: UtensilsCrossed, titulo: "5. Cardápio", resumo: "Produtos, tamanhos e disponibilidade.", itens: [
    { titulo: "Produtos reais", descricao: "Cadastre categorias, preço, imagem, tamanhos, adicionais, regras e disponibilidade. A IA e o site oferecem apenas o que existe aqui." },
    { titulo: "Disponibilidade", descricao: "Desative um produto sem apagá-lo quando ele estiver em falta." },
    { titulo: "Importação", descricao: "Envie PDF, foto ou texto do seu cardápio para acelerar o cadastro e revise os dados antes de publicar." },
  ] },
  { id: "temas", icon: Palette, titulo: "6. Temas, banners e cupons", resumo: "Personalize a identidade do cardápio público.", itens: [
    { titulo: "Identidade visual", descricao: "Escolha Brasa, Trattoria ou Metrópole; personalize fontes, cantos, cores de fundo, superfície, textos e botões." },
    { titulo: "Cartões e botões", descricao: "Escolha cartões elevados, minimalistas ou contornados; e botões em gradiente ou cor sólida." },
    { titulo: "Banners e ofertas", descricao: "Na aba Banners e cupons dentro de Temas, crie campanhas com imagem, chamada, botão, ordem e cupom associado." },
    { titulo: "Cupons", descricao: "Crie descontos em percentual ou reais, com pedido mínimo e validade. O servidor valida as regras no fechamento." },
  ] },
  { id: "negocio", icon: Store, titulo: "7. Meu Negócio", resumo: "Configurações organizadas em categorias expansíveis.", itens: [
    { titulo: "Como navegar", descricao: "Clique para abrir ou recolher Identidade e horário, Atendimento e automação, Cardápio e pagamentos, Logística e entregas e Área sensível." },
    { titulo: "Identidade e horário", descricao: "Cadastre endereço, logo, banner, telefone e link do Google Maps. Configure horário e a mensagem fora de expediente." },
    { titulo: "Atendimento e pagamentos", descricao: "Conecte WhatsApp por QR Code, ative o bot, copie o link do cardápio e configure Pix, Mercado Pago ou Asaas." },
    { titulo: "Logística", descricao: "Defina tempos, taxas por bairro e encontre o link da Área do entregador." },
    { titulo: "Loja aberta ou fechada", descricao: "Use o controle de funcionamento para pausar pedidos quando precisar fechar mais cedo." },
  ] },
  { id: "entregadores", icon: Bike, titulo: "8. Entregadores", resumo: "Organize entregas com uma área própria.", itens: [
    { titulo: "Acesso", descricao: "Em Meu Negócio → Geral → Logística e entregas, copie o link da Área do entregador e envie para a equipe." },
    { titulo: "Pedidos disponíveis", descricao: "O entregador vê pedidos de delivery quando eles estão Prontos para entrega e ele está disponível." },
    { titulo: "Finalização", descricao: "Ao assumir a entrega, o pedido segue para A caminho; quando concluído, é marcado como entregue e vai para o histórico." },
  ] },
  { id: "digital", icon: Globe, titulo: "9. Cardápio Digital", resumo: "Seu site de vendas ligado ao painel.", itens: [
    { titulo: "Sacola", descricao: "Ao tocar em +, o produto anima até a sacola. A sacola flutuante fica acima do botão de WhatsApp." },
    { titulo: "Localização", descricao: "Com endereço e link do Google Maps cadastrados, o site exibe um mapa e um atalho para o cliente abrir a rota." },
    { titulo: "Acompanhar pedido", descricao: "O cliente acompanha pelo número e telefone. A visibilidade é configurada em Temas → Banners e cupons." },
    { titulo: "Checkout", descricao: "O cliente escolhe entrega ou retirada, informa endereço, aplica cupom quando houver e o pedido entra no painel." },
  ] },
  { id: "assinatura", icon: ReceiptText, titulo: "10. Assinatura e dúvidas rápidas", resumo: "Plano, cobrança e soluções comuns.", itens: [
    { titulo: "Central de assinaturas", descricao: "Acompanhe plano, recorrência, faturas, vencimentos e as opções de gerenciamento disponíveis na conta." },
    { titulo: "Cobrança via Asaas", descricao: "Com a integração configurada, pagamentos confirmados atualizam a fatura e o ciclo da assinatura." },
    { titulo: "IA não responde", descricao: "Confira WhatsApp conectado, bot ativo e loja aberta." },
    { titulo: "Entregador não vê pedido", descricao: "Confirme que é delivery, está Pronto para entrega e que o entregador está disponível." },
    { titulo: "Cupom ou mapa não funciona", descricao: "Revise ativação, validade e pedido mínimo do cupom; para localização, confira endereço e link válido do Google Maps." },
  ] },
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
