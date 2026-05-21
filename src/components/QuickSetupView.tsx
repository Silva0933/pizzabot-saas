import React, { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
  Rocket,
  Store,
  UtensilsCrossed
} from "lucide-react";
import { Pizzeria, Product, ProductGroup } from "../types";
import { WhatsAppPanel } from "./WhatsAppPanel";

interface QuickSetupViewProps {
  pizzeria: Pizzeria;
  products: Product[];
  onUpdatePizzeria: (fields: Partial<Pizzeria>) => Promise<void> | void;
  onCreateProduct: (fields: Omit<Product, "id" | "pizzeriaId" | "order">) => Promise<void> | void;
  onOpenTestAgent?: () => void;
}

const PROMPT_PRESETS = {
  simpatico: `Você é o atendente da pizzaria. Atenda de forma simpática, natural e objetiva.

Objetivo:
- Ajudar o cliente a escolher produtos do cardápio.
- Confirmar endereço, forma de pagamento e observações antes de fechar o pedido.
- Não inventar produtos ou preços.
- Se o cliente pedir atendimento humano, encaminhe para a equipe.

Tom:
- Educado, acolhedor e direto.
- Sem respostas longas demais.
- Sempre confirme o pedido antes de registrar.`,
  rapido: `Você é um atendente de delivery rápido.

Prioridade:
- Responder curto e claro.
- Levar o cliente rapidamente para o fechamento do pedido.
- Confirmar itens, endereço e pagamento.
- Usar somente produtos disponíveis no cardápio.
- Acionar humano quando houver dúvida, reclamação ou pedido fora do escopo.`,
  premium: `Você é um atendente premium de pizzaria.

Atendimento:
- Seja cordial, consultivo e elegante.
- Sugira combinações quando fizer sentido.
- Confirme todos os dados do pedido com cuidado.
- Use apenas produtos e preços do cardápio.
- Mantenha uma experiência humana, sem parecer robótico.`
};

const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=60";

export function QuickSetupView({
  pizzeria,
  products,
  onUpdatePizzeria,
  onCreateProduct,
  onOpenTestAgent
}: QuickSetupViewProps) {
  const [prompt, setPrompt] = useState(pizzeria.promptPersonalized || PROMPT_PRESETS.simpatico);
  const [gateway, setGateway] = useState<"asaas" | "mercadopago">(
    pizzeria.gatewayPayment === "asaas" ? "asaas" : "mercadopago"
  );
  const [paymentKey, setPaymentKey] = useState(
    pizzeria.gatewayPayment === "asaas" ? pizzeria.asaasApiKey || "" : pizzeria.mpAccessToken || ""
  );
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productCategory, setProductCategory] = useState<ProductGroup>("pizza");
  const [productPrice, setProductPrice] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const paymentConfigured = pizzeria.gatewayPayment !== "nenhum" && Boolean(
    pizzeria.gatewayPayment === "asaas" ? pizzeria.asaasApiKey : pizzeria.mpAccessToken
  );

  const checklist = useMemo(() => [
    { label: "Dados da pizzaria criados", done: Boolean(pizzeria.id) },
    { label: "WhatsApp conectado", done: Boolean(pizzeria.instance) },
    { label: "Cardápio com produtos", done: products.length > 0 },
    { label: "Atendimento configurado", done: Boolean(pizzeria.promptPersonalized?.trim()) },
    { label: "Pagamento online conectado", done: paymentConfigured }
  ], [pizzeria, products.length, paymentConfigured]);

  const completed = checklist.filter(item => item.done).length;

  const showStatus = (message: string) => {
    setStatusMessage(message);
    window.setTimeout(() => setStatusMessage(null), 4000);
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    await onUpdatePizzeria({
      promptPersonalized: prompt,
      botActiveGlobal: true
    });
    setSavingPrompt(false);
    showStatus("Estilo de atendimento salvo.");
  };

  const savePayment = async () => {
    setSavingPayment(true);
    await onUpdatePizzeria({
      gatewayPayment: gateway,
      asaasApiKey: gateway === "asaas" ? paymentKey.trim() : pizzeria.asaasApiKey,
      mpAccessToken: gateway === "mercadopago" ? paymentKey.trim() : pizzeria.mpAccessToken
    });
    setSavingPayment(false);
    showStatus("Pagamento salvo. Faça um pedido teste para validar a cobrança.");
  };

  const addProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    const price = Number(productPrice.replace(",", "."));
    if (!productName.trim() || !Number.isFinite(price) || price <= 0) return;

    setSavingProduct(true);
    await onCreateProduct({
      name: productName.trim(),
      description: productDescription.trim() || "Produto cadastrado pela configuração rápida.",
      category: productCategory,
      price,
      imageUrl: DEFAULT_IMAGE,
      available: true
    });
    setProductName("");
    setProductDescription("");
    setProductPrice("");
    setSavingProduct(false);
    showStatus("Produto cadastrado e disponível para o bot.");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Configuração Rápida
          </h1>
          <p className="text-sm text-slate-500 font-sans">
            Conecte o WhatsApp, cadastre produtos, escolha o atendimento e ative pagamentos sem mexer em ferramentas técnicas.
          </p>
        </div>
        <div className="px-4 py-3 bg-white border border-slate-100 rounded-lg shadow-2xs min-w-52">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Progresso</span>
            <span className="font-mono">{completed}/{checklist.length}</span>
          </div>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-600 transition-all"
              style={{ width: `${(completed / checklist.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-semibold">
          {statusMessage}
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {checklist.map(item => (
          <div key={item.label} className="p-4 bg-white border border-slate-100 rounded-lg flex items-center gap-3">
            <CheckCircle2 className={`w-5 h-5 ${item.done ? "text-emerald-500" : "text-slate-300"}`} />
            <span className="text-xs font-semibold text-slate-700">{item.label}</span>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-4 shadow-2xs">
          <Header icon={MessageSquare} title="1. Conectar WhatsApp" subtitle="Escaneie o QR Code e o bot começa a receber mensagens." />
          <WhatsAppPanel instanceName={pizzeria.instance} />
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-4 shadow-2xs">
          <Header icon={UtensilsCrossed} title="2. Cadastrar cardápio" subtitle="Comece com os produtos mais vendidos. Depois você completa o restante." />
          <form onSubmit={addProduct} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Nome do produto"
                className="md:col-span-2 px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500"
              />
              <input
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                placeholder="Preço"
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500 font-mono"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value as ProductGroup)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500"
              >
                <option value="pizza">Pizza</option>
                <option value="lanche">Lanche</option>
                <option value="bebida">Bebida</option>
                <option value="sobremesa">Sobremesa</option>
                <option value="outro">Outro</option>
              </select>
              <input
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Descrição simples"
                className="md:col-span-2 px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500"
              />
            </div>
            <button
              type="submit"
              disabled={savingProduct || !productName.trim() || !productPrice.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50"
            >
              {savingProduct ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Adicionar produto
            </button>
          </form>
          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
            Produtos cadastrados: <strong className="text-slate-800">{products.length}</strong>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-4 shadow-2xs">
          <Header icon={Bot} title="3. Estilo do atendimento" subtitle="Escolha um modelo pronto e ajuste com suas palavras." />
          <div className="flex flex-wrap gap-2">
            <PresetButton label="Simpático" onClick={() => setPrompt(PROMPT_PRESETS.simpatico)} />
            <PresetButton label="Rápido" onClick={() => setPrompt(PROMPT_PRESETS.rapido)} />
            <PresetButton label="Premium" onClick={() => setPrompt(PROMPT_PRESETS.premium)} />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={9}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500 leading-relaxed"
          />
          <button
            type="button"
            onClick={savePrompt}
            disabled={savingPrompt}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg disabled:opacity-50"
          >
            {savingPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            Salvar atendimento
          </button>
        </div>

        <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-4 shadow-2xs">
          <Header icon={CreditCard} title="4. Pagamentos online" subtitle="Use Asaas ou Mercado Pago. O cliente cria a chave e cola aqui." />
          <div className="grid grid-cols-2 gap-2">
            <GatewayButton active={gateway === "asaas"} label="Asaas" onClick={() => {
              setGateway("asaas");
              setPaymentKey(pizzeria.asaasApiKey || "");
            }} />
            <GatewayButton active={gateway === "mercadopago"} label="Mercado Pago" onClick={() => {
              setGateway("mercadopago");
              setPaymentKey(pizzeria.mpAccessToken || "");
            }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
              {gateway === "asaas" ? "API Key do Asaas" : "Access Token do Mercado Pago"}
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={paymentKey}
                onChange={(e) => setPaymentKey(e.target.value)}
                placeholder={gateway === "asaas" ? "$aact_..." : "APP_USR-... ou TEST-..."}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>
          <PaymentHelp gateway={gateway} />
          <button
            type="button"
            onClick={savePayment}
            disabled={savingPayment || paymentKey.trim().length < 5}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            {savingPayment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Salvar pagamento
          </button>
        </div>
      </section>

      <section className="bg-slate-900 text-white rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-600 rounded-lg">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold">5. Testar antes de divulgar</h2>
            <p className="text-xs text-slate-300">Envie uma mensagem simulada e veja como o bot responde antes de colocar clientes reais no fluxo.</p>
          </div>
        </div>
        {onOpenTestAgent && (
          <button
            type="button"
            onClick={onOpenTestAgent}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Testar agente
          </button>
        )}
      </section>
    </div>
  );
}

function Header({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 bg-orange-50 rounded-lg">
        <Icon className="w-4 h-4 text-orange-600" />
      </div>
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-orange-50 hover:text-orange-700"
    >
      {label}
    </button>
  );
}

function GatewayButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-xs font-bold rounded-lg border ${
        active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function PaymentHelp({ gateway }: { gateway: "asaas" | "mercadopago" }) {
  if (gateway === "asaas") {
    return (
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 leading-relaxed space-y-1">
        <p className="font-bold text-slate-800">Como orientar o cliente no Asaas:</p>
        <p>1. Entrar na conta Asaas da pizzaria.</p>
        <p>2. Procurar a área de integrações/API.</p>
        <p>3. Copiar a API Key da conta correta.</p>
        <p>4. Colar aqui e salvar. Depois faça um pedido teste de baixo valor.</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 leading-relaxed space-y-1">
      <p className="font-bold text-slate-800">Como orientar o cliente no Mercado Pago:</p>
      <p>1. Entrar na conta Mercado Pago da pizzaria.</p>
      <p>2. Acessar a área de desenvolvedores/credenciais.</p>
      <p>3. Copiar o Access Token de produção para vender de verdade.</p>
      <p>4. Para testes, usar token TEST. Para receber dinheiro real, usar APP_USR.</p>
    </div>
  );
}
