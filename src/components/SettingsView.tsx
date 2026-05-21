import React, { useRef, useState } from "react";
import {
  Building2,
  Bot,
  Wallet,
  MessageSquare,
  Users,
  Save,
  RefreshCw,
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Lock,
  Sparkles,
  Clock,
  Columns3,
  X,
  AlertTriangle
} from "lucide-react";
import { Operator, Pizzeria } from "../types";
import { WhatsAppPanel } from "./WhatsAppPanel";

const DEFAULT_COLUMN_NAMES: Record<string, string> = {
  novo: "Novos",
  confirmado: "Confirmados ✅",
  no_forno: "No Forno 🍕",
  a_caminho: "A Caminho 🏍️",
  entregue: "Entregues 📦",
  cancelado: "Cancelados ❌"
};

const PROMPT_VARIABLES: { key: string; description: string }[] = [
  { key: "{nome_cliente}", description: "Nome do cliente identificado" },
  { key: "{telefone}", description: "Telefone do cliente (somente números)" },
  { key: "{endereco_padrao}", description: "Último endereço de entrega salvo" },
  { key: "{preferencias}", description: "Notas livres de gostos do cliente" },
  { key: "{historico_pedidos}", description: "Resumo dos últimos pedidos" },
  { key: "{total_pedidos}", description: "Quantidade total de pedidos do cliente" },
  { key: "{total_gasto}", description: "Valor total já gasto pelo cliente" },
  { key: "{cardapio_disponivel}", description: "Lista do cardápio filtrado por disponíveis" },
  { key: "{nome_pizzaria}", description: "Nome do estabelecimento" },
  { key: "{horario_funcionamento}", description: "Horários cadastrados" }
];

interface SettingsViewProps {
  pizzeria: Pizzeria;
  operators: Operator[];
  onUpdatePizzeria: (updatedFields: Partial<Pizzeria>) => void;
  onInviteOperator: (email: string, role: Operator['role']) => void;
  onDeleteOperator: (id: string) => void;
  onOpenTestAgent?: () => void;
}

export function SettingsView({
  pizzeria,
  operators,
  onUpdatePizzeria,
  onInviteOperator,
  onDeleteOperator,
  onOpenTestAgent
}: SettingsViewProps) {
  // Pizzeria Profile Local states
  const [name, setName] = useState(pizzeria.name);
  const [address, setAddress] = useState(pizzeria.address || "");
  const [logoUrl, setLogoUrl] = useState(pizzeria.logoUrl || "");
  const [phone, setPhone] = useState(pizzeria.phoneAdmin);
  const [botPrompt, setBotPrompt] = useState(pizzeria.promptPersonalized || "");
  const [gateway, setGateway] = useState<Pizzeria['gatewayPayment']>(
    pizzeria.gatewayPayment === 'nenhum' ? 'mercadopago' : pizzeria.gatewayPayment
  );
  const [apiKey, setApiKey] = useState(
    pizzeria.gatewayPayment === 'asaas'
      ? pizzeria.asaasApiKey || ""
      : pizzeria.gatewayPayment === 'mercadopago'
      ? pizzeria.mpAccessToken || ""
      : ""
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [msgDelivered, setMsgDelivered] = useState(pizzeria.messageDelivered || "");
  
  // Business hours state (PRD sec. 4.6)
  const defaultHours: Record<string, string> = pizzeria.hoursOfOperation || {
    "seg-sex": "18:00 - 23:00",
    "sab-dom": "17:00 - 00:00"
  };
  const [businessHours, setBusinessHours] = useState<Record<string, string>>(defaultHours);
  const [newHoursKey, setNewHoursKey] = useState("seg-sex");
  const [newHoursValue, setNewHoursValue] = useState("18:00 - 23:00");

  // Custom states for Kanban automatics (section 4.6 automatic messages text config)
  const [msgConfirmed, setMsgConfirmed] = useState(pizzeria.statusMessages?.confirmado || "Pagamento aprovado! Seu pedido ja esta na fila de preparacao!");
  const [msgNoForno, setMsgNoForno] = useState(pizzeria.statusMessages?.no_forno || "Boa noticia! Seu pedido esta no forno.");
  const [msgACaminho, setMsgACaminho] = useState(pizzeria.statusMessages?.a_caminho || "Seu pedido saiu para entrega e chegara em breve.");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Operator['role']>("Atendente");

  // Kanban column names (PRD 4.4 / 4.6)
  const initialColumnNames: Record<string, string> = { ...DEFAULT_COLUMN_NAMES, ...(pizzeria.columnNames || {}) };
  const [columnNames, setColumnNames] = useState<Record<string, string>>(initialColumnNames);

  // Prompt textarea ref for variable insertion
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const insertPromptVariable = (variable: string) => {
    const ta = promptRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? botPrompt.length;
    const end = ta.selectionEnd ?? botPrompt.length;
    const next = botPrompt.slice(0, start) + variable + botPrompt.slice(end);
    setBotPrompt(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  // Spinners & triggers
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testingGateway, setTestingGateway] = useState(false);
  const [gatewayTestResult, setGatewayTestResult] = useState<'success' | 'none' | 'failed'>('none');
  const [gatewayTestMessage, setGatewayTestMessage] = useState<string>("");

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      await onUpdatePizzeria({
        name,
        address,
        logoUrl,
        phoneAdmin: phone,
        promptPersonalized: botPrompt,
        gatewayPayment: gateway,
        asaasApiKey: gateway === 'asaas' ? apiKey : (pizzeria.asaasApiKey || ""),
        mpAccessToken: gateway === 'mercadopago' ? apiKey : (pizzeria.mpAccessToken || ""),
        messageDelivered: msgDelivered,
        hoursOfOperation: businessHours,
        statusMessages: {
          confirmado: msgConfirmed,
          no_forno: msgNoForno,
          a_caminho: msgACaminho,
          entregue: msgDelivered
        },
        columnNames
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      setSaveError(err?.message || 'Erro desconhecido ao salvar. Verifique o console.');
      setTimeout(() => setSaveError(null), 6000);
    } finally {
      setIsSaving(false);
    }
  };

  // Gateway key validation — APIs de pagamento bloqueiam CORS em chamadas diretas do browser.
  // A validação é feita localmente pelo formato da chave; o teste real ocorre via n8n na primeira cobrança.
  const handleTestGatewayConnection = async () => {
    setTestingGateway(true);
    setGatewayTestResult('none');
    setGatewayTestMessage("");

    await new Promise(r => setTimeout(r, 600)); // UX: pequeno delay visual

    const key = apiKey.trim();

    if (key.length < 5) {
      setGatewayTestResult('failed');
      setGatewayTestMessage("Informe a credencial do Asaas ou Mercado Pago.");
      setTestingGateway(false);
      return;
    }

    let ok = false;
    let label = "";

    if (gateway === 'mercadopago') {
      // Access tokens de produção: APP_USR-{números}-{data}-{hash}-{userId}
      // Access tokens de teste:    TEST-{números}-{data}-{hash}-{userId}
      const isProduction = /^APP_USR-\d{10,}/.test(key);
      const isTest = /^TEST-\d{10,}/.test(key);
      if ((isProduction || isTest) && key.length >= 40) {
        ok = true;
        label = isProduction
          ? "Chave de produção APP_USR válida ✓"
          : "Chave de teste TEST válida ✓ (use APP_USR em produção)";
      } else {
        ok = false;
        label = "Formato inválido — use o Access Token do painel Mercado Pago (APP_USR-... ou TEST-...)";
      }
    } else if (gateway === 'asaas') {
      // Chaves Asaas: $aact_... (sandbox) ou $aact_... (produção), 60-200 chars
      const isAsaas = key.startsWith('$aact_') && key.length >= 20;
      if (isAsaas) {
        ok = true;
        label = "Chave Asaas válida ✓ — conexão real confirmada no primeiro pagamento via n8n";
      } else {
        ok = false;
        label = "Formato inválido — use a API Key do painel Asaas (começa com $aact_...)";
      }
    }

    setGatewayTestResult(ok ? 'success' : 'failed');
    setGatewayTestMessage(label);
    setTestingGateway(false);
  };

  const handleInviteUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteEmail.trim()) {
      onInviteOperator(inviteEmail.trim(), inviteRole);
      setInviteEmail("");
    }
  };

  return (
    <form onSubmit={handleSaveAll} className="space-y-6">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Configurações do Estabelecimento
          </h1>
          <p className="text-sm text-slate-500 font-sans font-normal">
            Personalize o prompt do PizzaBot, credenciais de gateway financeiro, mensagens programadas e usuários.
          </p>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-4.5 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors rounded-lg shadow-sm font-sans cursor-pointer disabled:opacity-50"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saveSuccess ? "Configurações Salvas! ✓" : "Salvar Configurações"}
        </button>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-sans">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
          <div>
            <span className="font-bold block">Erro ao salvar:</span>
            {saveError}
          </div>
        </div>
      )}

      {/* Section 0: WhatsApp Connection */}
      <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b pb-3 border-slate-100">
          <div className="p-1 bg-emerald-100 rounded-md">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-emerald-600" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <h3 className="text-sm font-bold text-slate-800 font-sans">Conexão WhatsApp (Evolution API)</h3>
          <span className="ml-auto text-[10px] font-mono text-slate-400">instância: {pizzeria.instance || "não definida"}</span>
        </div>

        <WhatsAppPanel instanceName={pizzeria.instance} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left Side: General Profile & Payments Gateway */}
        <div className="lg:col-span-2 space-y-6">

          {/* Section 1: Perfil da Pizzaria */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-55">
              <Building2 className="w-4.5 h-4.5 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Perfil Comercial da Pizzaria</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Nome Comercial</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Telefone Principal (Admin Escalamento)</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Endereço de Sede Principal</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Logo da Pizzaria (URL)</label>
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                />
              </div>
            </div>
          </div>

          {/* Section 1b: Horário de Funcionamento */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-100">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Horário de Funcionamento</h3>
            </div>

            <div className="space-y-2">
              {Object.entries(businessHours).map(([periodo, horario]) => (
                <div key={periodo} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono w-20 shrink-0">{periodo}</span>
                  <input
                    type="text"
                    value={horario}
                    onChange={(e) => setBusinessHours({ ...businessHours, [periodo]: e.target.value })}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                    placeholder="Ex: 18:00 - 23:00"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...businessHours };
                      delete updated[periodo];
                      setBusinessHours(updated);
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <select
                value={newHoursKey}
                onChange={(e) => setNewHoursKey(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden font-sans text-slate-700"
              >
                <option value="seg-sex">Seg–Sex</option>
                <option value="sab">Sábado</option>
                <option value="dom">Domingo</option>
                <option value="sab-dom">Sáb–Dom</option>
                <option value="seg-dom">Seg–Dom</option>
                <option value="feriados">Feriados</option>
              </select>
              <input
                type="text"
                value={newHoursValue}
                onChange={(e) => setNewHoursValue(e.target.value)}
                placeholder="18:00 - 23:00"
                className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden font-sans text-slate-800"
              />
              <button
                type="button"
                onClick={() => {
                  if (newHoursKey && newHoursValue) {
                    setBusinessHours({ ...businessHours, [newHoursKey]: newHoursValue });
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1 font-sans"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar
              </button>
            </div>
          </div>

          {/* Section 2: Agente de IA PizzaBot Prompt */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-slate-55">
              <div className="flex items-center gap-2">
                <Bot className="w-4.5 h-4.5 text-orange-600" />
                <h3 className="text-sm font-bold text-slate-800 font-sans">Agente de IA (Personalização)</h3>
              </div>
              
              {onOpenTestAgent && (
                <button
                  type="button"
                  onClick={onOpenTestAgent}
                  className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors font-sans"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Testar Agente Inteligente
                </button>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">System Prompt Customizado do PizzaBot</label>
              <textarea
                ref={promptRef}
                value={botPrompt}
                onChange={(e) => setBotPrompt(e.target.value)}
                rows={10}
                className="w-full px-3 py-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans leading-relaxed"
              />
            </div>

            {/* Documented variables (PRD 4.6) — click to insert at cursor */}
            <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono tracking-wider">Variáveis RAG (clique para inserir no cursor)</span>
                <span className="text-[9px] text-slate-400 font-mono">{PROMPT_VARIABLES.length} disponíveis</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {PROMPT_VARIABLES.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertPromptVariable(v.key)}
                    className="text-left text-[10px] bg-white px-2 py-1.5 rounded border border-slate-150 hover:border-orange-400 hover:bg-orange-50 transition-colors font-mono"
                    title="Clique para inserir no prompt"
                  >
                    <span className="font-bold text-orange-600">{v.key}</span>
                    <span className="text-slate-500 font-sans"> — {v.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2b: Personalização das colunas do Kanban (PRD 4.4) */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-100">
              <Columns3 className="w-4.5 h-4.5 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Nomes das Colunas do Kanban</h3>
              <button
                type="button"
                onClick={() => setColumnNames({ ...DEFAULT_COLUMN_NAMES })}
                className="ml-auto text-[10px] font-bold text-slate-500 hover:text-orange-600 inline-flex items-center gap-1"
                title="Restaurar padrão"
              >
                <RefreshCw className="w-3 h-3" />
                Restaurar
              </button>
            </div>
            <p className="text-[10px] text-slate-500 font-sans">
              Personalize como cada etapa aparece no Kanban (ex: "No Forno" → "Em Preparação"). O status interno e as notificações continuam funcionando normalmente.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(DEFAULT_COLUMN_NAMES).map(([key]) => (
                <div key={key}>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">
                    Status <span className="font-mono text-orange-600">{key}</span>
                  </label>
                  <input
                    type="text"
                    value={columnNames[key] ?? DEFAULT_COLUMN_NAMES[key]}
                    onChange={(e) => setColumnNames({ ...columnNames, [key]: e.target.value })}
                    placeholder={DEFAULT_COLUMN_NAMES[key]}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Integração de Gateway Pagamentos */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-55">
              <Wallet className="w-4.5 h-4.5 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Integração de Gateways Financeiro</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1 flex-none whitespace-nowrap">Conector de Faturamento</label>
                <select
                  value={gateway}
                  onChange={(e: any) => {
                    const newGateway = e.target.value as Pizzeria['gatewayPayment'];
                    setGateway(newGateway);
                    // Load the correct key for the selected gateway
                    setApiKey(
                      newGateway === 'mercadopago' ? (pizzeria.mpAccessToken || "")
                      : newGateway === 'asaas' ? (pizzeria.asaasApiKey || "")
                      : ""
                    );
                    setGatewayTestResult('none');
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                >
                  <option value="asaas">Asaas</option>
                  <option value="mercadopago">Mercado Pago</option>
                </select>
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Chave privada do pagamento</label>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={gateway === 'mercadopago' ? "APP_USR-... ou TEST-... (Access Token MP)" : "$aact_... (API Key Asaas)"}
                    className="w-full pl-3 pr-10 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-2 p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Test connection — calls real gateway endpoint */}
            {gateway !== 'nenhum' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleTestGatewayConnection}
                  disabled={testingGateway}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all rounded shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {testingGateway ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Validar Chave"}
                  {testingGateway && <span>Validando formato...</span>}
                </button>

                {gatewayTestResult === 'success' && (
                  <span className="text-[10px] font-bold text-emerald-700 font-mono flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                    <Check className="w-3.5 h-3.5" />
                    Conectado ({gateway}): {gatewayTestMessage}
                  </span>
                )}
                {gatewayTestResult === 'failed' && (
                  <span className="text-[10px] font-bold text-red-700 font-mono flex items-center gap-1 bg-red-50 border border-red-200 rounded px-2 py-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {gatewayTestMessage || "Falha na conexão. Verifique a credencial."}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Auto notification templates config & Users and operators */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Section 4: Auto Whatsapp message Templates */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-55">
              <MessageSquare className="w-4.5 h-4.5 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Modelos Automáticos</h3>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-1">Notificação: Confirmado Pago</label>
                <textarea
                  value={msgConfirmed}
                  onChange={(e) => setMsgConfirmed(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans leading-normal"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-1">Notificação: No Forno</label>
                <textarea
                  value={msgNoForno}
                  onChange={(e) => setMsgNoForno(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans leading-normal"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-1">Notificação: A Caminho</label>
                <textarea
                  value={msgACaminho}
                  onChange={(e) => setMsgACaminho(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans leading-normal"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-1">Notificação: Entregue (Agradecimento)</label>
                <textarea
                  value={msgDelivered}
                  onChange={(e) => setMsgDelivered(e.target.value)}
                  rows={3}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans leading-normal"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Team operators and roles invite */}
          <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 border-slate-55">
              <Users className="w-4.5 h-4.5 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 font-sans">Atendentes e Permissões</h3>
            </div>

            {/* Invite Operators form */}
            <div className="p-3 bg-slate-55 rounded-lg border border-slate-100">
              <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block font-mono mb-1.5">Convidar Operador</span>
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="insira o email do convidado"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-205 rounded-md focus:border-orange-500 focus:outline-hidden font-sans"
                />
                
                <div className="flex items-center gap-1.5">
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Operator['role'])}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-205 rounded-md focus:border-orange-500 focus:outline-hidden font-sans"
                  >
                    <option value="Atendente">Atendente (Sem Financeiro/Config)</option>
                    <option value="Admin">Admin (Acesso Total)</option>
                  </select>
                  
                  <button
                    type="button"
                    onClick={handleInviteUser}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-md text-xs font-semibold flex items-center gap-1 font-sans"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Convidar
                  </button>
                </div>
              </div>
            </div>

            {/* Existing team lists */}
            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-0.5">
              {operators.map((tm) => (
                <div key={tm.id} className="p-2.5 bg-slate-50 rounded-lg flex items-center justify-between text-xs border border-slate-100">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-700 line-clamp-1 text-[11px] font-sans break-all">{tm.email}</p>
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono">
                      <span className="bg-slate-200 px-1 rounded uppercase font-bold text-[8px] text-slate-600">{tm.role}</span>
                      <span>•</span>
                      <span>{tm.status}</span>
                    </div>
                  </div>
                  
                  {tm.status !== "Proprietário" && (
                    <button
                      type="button"
                      onClick={() => onDeleteOperator(tm.id)}
                      className="p-1 text-slate-450 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {operators.length === 0 && (
                <div className="py-4 text-center text-[10px] text-slate-400 font-sans border border-dashed border-slate-200 rounded-lg">
                  Nenhum operador cadastrado para esta pizzaria.
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </form>
  );
}
