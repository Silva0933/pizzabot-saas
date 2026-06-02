import React, { useState } from "react";
import { 
  Pizza, MessageSquare, Clock, CreditCard, BarChart3, 
  Users, Check, ChevronDown, ArrowRight, Menu, X, 
  ShieldCheck, Smartphone, Zap
} from "lucide-react";

interface LandingPageProps {
  onAccessLogin: () => void;
}

export function LandingPage({ onAccessLogin }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const features = [
    {
      icon: <MessageSquare className="w-6 h-6 text-orange-500" />,
      title: "Atendente Inteligente (FSM)",
      description: "Nossa IA conversa como um atendente humano real, tirando dúvidas, anotando pedidos e sem inventar preços ou errar no funil."
    },
    {
      icon: <Clock className="w-6 h-6 text-amber-500" />,
      title: "Taxa de Entrega Automática",
      description: "O robô consulta a taxa do bairro do cliente no sistema ou calcula via geolocalização e informa de forma transparente no ato."
    },
    {
      icon: <CreditCard className="w-6 h-6 text-orange-500" />,
      title: "Pagamentos Integrados",
      description: "Gera o Pix (QR Code + Copia e Cola) ou link de cartão automaticamente na conversa do WhatsApp e confirma na hora o pagamento."
    },
    {
      icon: <Users className="w-6 h-6 text-amber-500" />,
      title: "Intervenção Humana",
      description: "Se o cliente precisar de suporte humano, o bot pausa automaticamente e alerta o atendente para assumir no chat unificado."
    },
    {
      icon: <BarChart3 className="w-6 h-6 text-orange-500" />,
      title: "Dashboard de Métricas",
      description: "Acompanhe faturamento, quantidade de pedidos, ticket médio e gráficos de desempenho diários e mensais em tempo real."
    },
    {
      icon: <Pizza className="w-6 h-6 text-amber-500" />,
      title: "Cardápio Relacional",
      description: "Gerencie sabores, tamanhos (P, M, G, GG), complementos, adicionais e bebidas de forma relacional estruturada e simples."
    }
  ];

  const plans = [
    {
      name: "Plano Standard",
      price: "149",
      description: "Perfeito para pizzarias e lanchonetes locais em crescimento.",
      features: [
        "Atendimento Automatizado Ilimitado",
        "Até 2.000 mensagens de IA por mês",
        "Integração Pix Automático (Mercado Pago/Asaas)",
        "Painel de Pedidos (Kanban)",
        "Chat Multicanal com Operador Humano",
        "Suporte via e-mail e WhatsApp"
      ],
      cta: "Começar Agora",
      popular: false
    },
    {
      name: "Plano Premium",
      price: "249",
      description: "A escolha favorita dos donos de pizzarias de alto volume.",
      features: [
        "Tudo do Plano Standard",
        "Até 6.000 mensagens de IA por mês",
        "Integração Cartão de Crédito (Link de pagamento)",
        "Pesquisa de Satisfação Pós-Venda (NPS)",
        "Dashboard Avançado de Métricas",
        "Suporte Prioritário 24/7"
      ],
      cta: "Experimentar Premium",
      popular: true
    },
    {
      name: "Plano Platinum",
      price: "399",
      description: "Para grandes pizzarias e redes multi-lojas que exigem máxima performance.",
      features: [
        "Tudo do Plano Premium",
        "Mensagens de IA Ilimitadas",
        "Suporte a Múltiplas Instâncias de WhatsApp",
        "Opção de Personalidade de IA customizada",
        "Treinamento de equipe dedicado",
        "Gerente de conta exclusivo"
      ],
      cta: "Falar com Consultor",
      popular: false
    }
  ];

  const faqs = [
    {
      q: "Como o PizzaBot se conecta ao meu WhatsApp?",
      a: "Utilizamos a Evolution API para criar uma conexão estável e segura através de um QR Code simples, igual ao WhatsApp Web. Você conecta em segundos e o robô já começa a responder."
    },
    {
      q: "A Inteligência Artificial pode errar o preço ou inventar sabores?",
      a: "Não. Nosso bot utiliza uma FSM (Máquina de Estados Finita) e filtros rígidos de blindagem no backend. Os preços, adicionais e o resumo são gerados diretamente do seu banco de dados, impedindo alucinações da IA."
    },
    {
      q: "O cliente pode pagar diretamente pelo WhatsApp?",
      a: "Sim! O PizzaBot é integrado ao Mercado Pago e Asaas. Ele gera o Pix copia-e-cola e a imagem do QR Code de forma automática. Assim que o pagamento é aprovado, a cozinha é notificada no painel e o cliente recebe a confirmação."
    },
    {
      q: "Como faço para assumir a conversa se o cliente pedir ajuda?",
      a: "Temos um painel de chat unificado (Conversas) que avisa com alarmes sonoros e visuais quando um cliente solicita atendimento humano ou quando o bot é desativado devido a alguma pendência."
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-orange-500 selection:text-white overflow-x-hidden">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/4 -translate-x-1/2 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 translate-x-1/2 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-50 border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <div className="flex items-center gap-2.5 group cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-orange-500/20 group-hover:rotate-12 transition-transform duration-300">
                <Pizza className="w-5.5 h-5.5 text-white" />
              </div>
              <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white to-slate-200 bg-clip-text text-transparent">
                PizzaBot
              </span>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="#funcionalidades" className="text-sm text-slate-300 hover:text-orange-400 font-medium transition-colors">Funcionalidades</a>
              <a href="#como-funciona" className="text-sm text-slate-300 hover:text-orange-400 font-medium transition-colors">Como Funciona</a>
              <a href="#planos" className="text-sm text-slate-300 hover:text-orange-400 font-medium transition-colors">Planos</a>
              <a href="#faq" className="text-sm text-slate-300 hover:text-orange-400 font-medium transition-colors">FAQ</a>
            </nav>

            {/* CTA Button */}
            <div className="hidden md:flex items-center gap-4">
              <button 
                onClick={onAccessLogin}
                className="px-5 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl font-semibold text-sm transition-all duration-300 hover:text-orange-400"
              >
                Área do Cliente
              </button>
              <a 
                href="#planos"
                className="px-5 py-2.5 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 rounded-xl font-bold text-sm shadow-md shadow-orange-950/20 hover:shadow-orange-500/10 active:scale-[0.98] transition-all duration-300"
              >
                Testar Grátis
              </a>
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-slate-400 hover:text-white p-2"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-900 bg-slate-950/95 px-4 pt-2 pb-6 space-y-4">
            <a 
              href="#funcionalidades" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base text-slate-300 hover:text-orange-400 font-medium"
            >
              Funcionalidades
            </a>
            <a 
              href="#como-funciona" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base text-slate-300 hover:text-orange-400 font-medium"
            >
              Como Funciona
            </a>
            <a 
              href="#planos" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base text-slate-300 hover:text-orange-400 font-medium"
            >
              Planos
            </a>
            <a 
              href="#faq" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-base text-slate-300 hover:text-orange-400 font-medium"
            >
              FAQ
            </a>
            <div className="pt-4 flex flex-col gap-3">
              <button 
                onClick={() => { setMobileMenuOpen(false); onAccessLogin(); }}
                className="w-full py-3 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-sm text-center"
              >
                Área do Cliente
              </button>
              <a 
                href="#planos"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full py-3 bg-gradient-to-r from-orange-600 to-amber-500 text-white rounded-xl font-bold text-sm text-center"
              >
                Testar Grátis
              </a>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative pt-12 pb-24 md:pt-20 md:pb-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-12 gap-12 items-center">
          {/* Hero Text */}
          <div className="md:col-span-7 flex flex-col gap-6 text-left">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold w-fit">
              <Zap className="w-3.5 h-3.5" /> O melhor robô para WhatsApp do mercado
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-white">
              Venda mais no WhatsApp com o{' '}
              <span className="bg-gradient-to-r from-orange-500 to-amber-400 bg-clip-text text-transparent">
                Atendente IA
              </span>{' '}
              que não alucina.
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed max-w-xl">
              Chega de perder vendas por demora no WhatsApp. O PizzaBot atende, anota pedidos, calcula taxas por bairro e gera o Pix automaticamente — tudo conectado a um Kanban administrativo incrível.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mt-2">
              <a 
                href="#planos" 
                className="px-8 py-4 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white rounded-xl font-extrabold text-base shadow-lg shadow-orange-950/40 hover:shadow-orange-500/20 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 group"
              >
                Ver Planos e Testar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>
              <button 
                onClick={onAccessLogin}
                className="px-8 py-4 bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl font-bold text-base transition-all duration-300 flex items-center justify-center"
              >
                Área do Cliente
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-900 mt-4 text-center sm:text-left">
              <div>
                <span className="block text-2xl font-bold text-white">100%</span>
                <span className="text-xs text-slate-500 uppercase tracking-wider">Automatizado</span>
              </div>
              <div>
                <span className="block text-2xl font-bold text-white">3 Segundos</span>
                <span className="text-xs text-slate-500 uppercase tracking-wider">Tempo de resposta</span>
              </div>
              <div>
                <span className="block text-2xl font-bold text-white">Zero</span>
                <span className="text-xs text-slate-500 uppercase tracking-wider">Erros de Preços</span>
              </div>
            </div>
          </div>

          {/* Hero Visual: Mockup do WhatsApp */}
          <div className="md:col-span-5 relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/20 to-amber-400/20 rounded-[32px] blur-2xl pointer-events-none" />
            <div className="relative bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl rounded-[32px] shadow-2xl overflow-hidden max-w-sm mx-auto w-full">
              {/* WhatsApp Header */}
              <div className="bg-slate-950/80 border-b border-slate-800/60 px-4 py-3.5 flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center ml-2">
                  <Pizza className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Camila 🍕</h4>
                  <span className="text-[10px] text-green-500 flex items-center gap-1 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> online
                  </span>
                </div>
              </div>

              {/* Chat History Mock */}
              <div className="p-4 space-y-4 text-xs h-[380px] overflow-y-auto bg-slate-950/40">
                {/* Client Msg */}
                <div className="flex flex-col items-end gap-1">
                  <div className="bg-orange-600/20 border border-orange-500/20 text-orange-100 p-2.5 rounded-2xl rounded-tr-none max-w-[80%]">
                    Quero uma pizza portuguesa média e uma coca de 2 litros, retirada.
                  </div>
                  <span className="text-[9px] text-slate-500">16:08</span>
                </div>

                {/* Bot Msg 1 */}
                <div className="flex flex-col items-start gap-1">
                  <div className="bg-slate-900 border border-slate-800 text-slate-200 p-2.5 rounded-2xl rounded-tl-none max-w-[85%]">
                    Perfeito, Jairo! Seu pedido é: 1x Portuguesa (M) e 1x Coca-Cola 2L. O total fica R$ 43,90.
                  </div>
                </div>

                {/* Bot Msg 2 */}
                <div className="flex flex-col items-start gap-1">
                  <div className="bg-slate-900 border border-slate-800 text-slate-200 p-2.5 rounded-2xl rounded-tl-none max-w-[85%]">
                    Como você prefere pagar? Pix, cartão ou dinheiro?
                  </div>
                  <span className="text-[9px] text-slate-500">16:09</span>
                </div>

                {/* Client Msg 2 */}
                <div className="flex flex-col items-end gap-1">
                  <div className="bg-orange-600/20 border border-orange-500/20 text-orange-100 p-2.5 rounded-2xl rounded-tr-none max-w-[80%]">
                    pix
                  </div>
                  <span className="text-[9px] text-slate-500">16:09</span>
                </div>

                {/* Bot Msg 3 (Resumo Verbatim) */}
                <div className="flex flex-col items-start gap-1">
                  <div className="bg-slate-900 border border-slate-800 text-slate-200 p-2.5 rounded-2xl rounded-tl-none max-w-[85%] font-mono text-[11px] leading-relaxed">
                    Fechando seu pedido 📝<br/>
                    • 1x Portuguesa (M) — R$ 31,90<br/>
                    • 1x Coca Cola 2L — R$ 12,00<br/>
                    <strong>*Total: R$ 43,90*</strong><br/><br/>
                    🛵 Retirada no balcão<br/>
                    💳 Pagamento: Pix (agora)<br/><br/>
                    Posso fechar o pedido? 😊
                  </div>
                  <span className="text-[9px] text-slate-500">16:10</span>
                </div>
              </div>

              {/* Chat Input Mock */}
              <div className="bg-slate-950/80 border-t border-slate-800/60 p-3.5 flex items-center justify-between gap-2.5">
                <div className="flex-1 bg-slate-900/60 border border-slate-800/50 rounded-xl px-3 py-2 text-[10px] text-slate-500">
                  Escreva uma resposta...
                </div>
                <div className="w-8 h-8 rounded-xl bg-orange-600 flex items-center justify-center shrink-0">
                  <ArrowRight className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="funcionalidades" className="py-24 border-t border-slate-900 bg-slate-900/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto flex flex-col gap-4 mb-16">
            <h2 className="text-xs text-orange-500 font-extrabold tracking-widest uppercase">Funcionalidades do PizzaBot</h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white">
              Tudo o que sua pizzaria precisa para vender no piloto automático.
            </p>
            <p className="text-base text-slate-400">
              Desenvolvemos uma estrutura robusta focada em controle, blindagem e praticidade tanto para você quanto para o seu cliente final.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <div 
                key={i} 
                className="bg-slate-900/20 backdrop-blur-md border border-slate-800/60 rounded-2xl p-8 hover:border-slate-700/60 transition-all duration-300 hover:-translate-y-1 group"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-950 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="como-funciona" className="py-24 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto flex flex-col gap-4 mb-20">
            <h2 className="text-xs text-orange-500 font-extrabold tracking-widest uppercase">Passo a Passo</h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white">Como funciona o PizzaBot?</p>
            <p className="text-base text-slate-400">Em menos de 10 minutos você tem o atendente rodando.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
            {/* Step 1 */}
            <div className="flex flex-col gap-4 text-left relative z-10">
              <span className="text-5xl font-black text-slate-800">01</span>
              <h3 className="text-lg font-bold text-white">Cadastre seu Cardápio</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Insira seus produtos, tamanhos e complementos. Pode colar o cardápio em texto e deixar a IA formatar para você.
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col gap-4 text-left relative z-10">
              <span className="text-5xl font-black text-slate-800">02</span>
              <h3 className="text-lg font-bold text-white">Conecte o WhatsApp</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Escaneie o QR Code em nosso painel administrativo e conecte o bot à sua linha do WhatsApp instantaneamente.
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col gap-4 text-left relative z-10">
              <span className="text-5xl font-black text-slate-800">03</span>
              <h3 className="text-lg font-bold text-white">Defina Taxas e Pagamento</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Cadastre as taxas de entrega por bairro e adicione suas chaves do Mercado Pago ou Asaas para receber online.
              </p>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col gap-4 text-left relative z-10">
              <span className="text-5xl font-black text-slate-800">04</span>
              <h3 className="text-lg font-bold text-white">Comece a Vender!</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                O robô assume o chat, registra os pedidos no Kanban e você só precisa preparar a pizza e mandar entregar!
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Plans Section */}
      <section id="planos" className="py-24 border-t border-slate-900 bg-slate-900/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto flex flex-col gap-4 mb-16">
            <h2 className="text-xs text-orange-500 font-extrabold tracking-widest uppercase">Nossos Planos</h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white">Preços simples, sem pegadinhas.</p>
            <p className="text-base text-slate-400">Escolha o plano que melhor atende à demanda da sua pizzaria.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {plans.map((plan, i) => (
              <div 
                key={i} 
                className={`relative bg-slate-900/40 backdrop-blur-xl border rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 hover:border-slate-700/60 ${
                  plan.popular 
                    ? "border-orange-500 shadow-xl shadow-orange-950/20 lg:-translate-y-4" 
                    : "border-slate-800/80"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[10px] font-black uppercase tracking-wider">
                    Mais Popular
                  </span>
                )}
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                  <p className="text-xs text-slate-400 mb-6">{plan.description}</p>
                  <div className="flex items-baseline gap-1 mb-8">
                    <span className="text-lg font-bold text-slate-400">R$</span>
                    <span className="text-5xl font-black text-white">{plan.price}</span>
                    <span className="text-sm text-slate-400 font-medium">/mês</span>
                  </div>
                  <ul className="space-y-4 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-300">
                        <Check className="w-5 h-5 text-green-500 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button 
                  onClick={onAccessLogin}
                  className={`w-full py-3.5 font-bold text-sm rounded-xl transition-all duration-300 active:scale-[0.98] ${
                    plan.popular
                      ? "bg-gradient-to-r from-orange-600 to-amber-500 text-white hover:from-orange-500 hover:to-amber-400 shadow-md shadow-orange-950/40"
                      : "bg-slate-950 border border-slate-800 hover:border-slate-700/80 hover:text-orange-400"
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 border-t border-slate-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center flex flex-col gap-4 mb-16">
            <h2 className="text-xs text-orange-500 font-extrabold tracking-widest uppercase">Dúvidas Frequentes</h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white">Perguntas Frequentes</p>
            <p className="text-base text-slate-400">Tem alguma dúvida? Encontre a resposta aqui.</p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div 
                key={i} 
                className="bg-slate-900/20 border border-slate-800/80 rounded-2xl overflow-hidden transition-colors hover:border-slate-800"
              >
                <button 
                  onClick={() => toggleFaq(i)}
                  className="w-full px-6 py-5 flex items-center justify-between gap-4 text-left font-bold text-white text-base outline-none"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${activeFaq === i ? "rotate-180" : ""}`} />
                </button>
                {activeFaq === i && (
                  <div className="px-6 pb-6 text-sm text-slate-400 leading-relaxed border-t border-slate-900/60 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-12 bg-slate-950/40 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b border-slate-900 pb-8 mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <Pizza className="w-4.5 h-4.5 text-white" />
              </div>
              <span className="font-bold text-lg text-white tracking-tight">PizzaBot</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-slate-400">
              <a href="#funcionalidades" className="hover:text-white transition-colors">Funcionalidades</a>
              <a href="#como-funciona" className="hover:text-white transition-colors">Como Funciona</a>
              <a href="#planos" className="hover:text-white transition-colors">Planos</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </nav>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <span>&copy; {new Date().getFullYear()} PizzaBot SaaS. Todos os direitos reservados.</span>
            <span className="flex gap-4">
              <a href="#" className="hover:text-white transition-colors">Termos de Uso</a>
              <a href="#" className="hover:text-white transition-colors">Política de Privacidade</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
