import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Send,
  Bot,
  User,
  UserCheck,
  Smartphone,
  MapPin,
  ClipboardList,
  History,
  Unlock,
  Lock,
  ArrowDown,
  ArrowLeft,
  MessageSquare
} from "lucide-react";
import { Conversation, Customer, Order } from "../types";

interface ConversationsViewProps {
  conversations: Conversation[];
  activeConvPhone: string | null;
  onSelectConversation: (phone: string) => void;
  onSendHumanMessage: (phone: string, content: string) => void;
  onToggleBot: (phone: string, botActive: boolean) => void;
  customers: Customer[];
  orders: Order[];
}

// Stable color from phone string
function avatarColor(phone: string): string {
  const colors = [
    "bg-orange-400","bg-amber-400","bg-emerald-500","bg-teal-500",
    "bg-indigo-500","bg-violet-500","bg-rose-500","bg-cyan-500"
  ];
  let hash = 0;
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return "Ontem";
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  } catch { return ""; }
}

const BADGE: Record<string, string> = {
  "Bot ativo":             "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Aguardando pagamento":  "bg-amber-50 text-amber-700 border-amber-200",
  "Humano necessário":     "bg-rose-50 text-rose-700 border-rose-200 animate-pulse font-bold",
  "Encerrada":             "bg-slate-100 text-slate-500 border-slate-200",
};

export function ConversationsView({
  conversations,
  activeConvPhone,
  onSelectConversation,
  onSendHumanMessage,
  onToggleBot,
  customers,
  orders
}: ConversationsViewProps) {
  const [searchQuery, setSearchQuery]   = useState("");
  const [replyText, setReplyText]       = useState("");
  const [mobileView, setMobileView]     = useState<"list" | "chat">("list");
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef       = useRef<HTMLDivElement>(null);

  const filtered = conversations.filter(c => {
    const q = searchQuery.toLowerCase();
    return c.customerName.toLowerCase().includes(q) || c.customerPhone.includes(q);
  });

  const activeConv     = conversations.find(c => c.customerPhone === activeConvPhone);
  const activeCustomer = activeConv ? customers.find(cu => cu.phone === activeConv.customerPhone) : null;
  const activeOrders   = activeCustomer ? orders.filter(o => o.customerPhone === activeCustomer.phone) : [];

  // Scroll to bottom when messages or active conv change
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  useEffect(() => {
    scrollToBottom("smooth");
  }, [activeConv?.messages?.length, activeConvPhone, scrollToBottom]);

  // Show/hide scroll button based on scroll position
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  };

  // When selecting a conv on mobile → switch to chat view
  const handleSelect = (phone: string) => {
    onSelectConversation(phone);
    setMobileView("chat");
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (replyText.trim() && activeConvPhone) {
      onSendHumanMessage(activeConvPhone, replyText.trim());
      setReplyText("");
    }
  };

  // ─── Conversation List Panel ───────────────────────────────────────────────
  const ConvList = (
    <div className={`
      ${mobileView === "list" ? "flex" : "hidden"} lg:flex
      lg:col-span-4 flex-col min-h-0 border-r border-slate-100 bg-slate-50/50
    `}>
      {/* Header */}
      <div className="p-4 border-b border-slate-100 bg-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest font-sans">
            Central de Conversas
          </h2>
          <span className="text-[10px] font-bold text-slate-400 font-mono bg-slate-100 px-2 py-0.5 rounded-full">
            {conversations.length}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-orange-500 focus:outline-none transition-all font-sans"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-sans">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          filtered.map(conv => {
            const isActive  = conv.customerPhone === activeConvPhone;
            const isUrgent  = conv.status === "Humano necessário";
            const color     = avatarColor(conv.customerPhone);
            const letters   = initials(conv.customerName);
            const lastTime  = formatTime(conv.lastTimestamp);

            return (
              <button
                key={conv.id}
                onClick={() => handleSelect(conv.customerPhone)}
                className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors border-b border-slate-100 relative ${
                  isActive
                    ? "bg-orange-50 border-l-4 border-l-orange-500 pl-3.5"
                    : "hover:bg-slate-100/60 border-l-4 border-l-transparent"
                }`}
              >
                {/* Avatar */}
                <div className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold font-mono shadow-sm ${color}`}>
                  {letters}
                  {/* Online / urgent dot */}
                  {isUrgent && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-ping" />
                  )}
                </div>

                {/* Text content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className={`text-sm font-semibold font-sans leading-tight truncate ${isUrgent ? "text-rose-700" : "text-slate-800"}`}>
                      {conv.customerName}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono shrink-0">{lastTime}</span>
                  </div>

                  <p className="text-xs text-slate-500 font-sans truncate leading-snug">
                    {conv.lastMessage || "Sem mensagens"}
                  </p>

                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] text-slate-400 font-mono flex items-center gap-0.5">
                      <Smartphone className="w-2.5 h-2.5" />
                      {conv.customerPhone}
                    </span>
                    <span className={`text-[8px] font-bold font-mono px-1.5 py-0.5 border rounded-full uppercase leading-none ${BADGE[conv.status] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      {conv.status}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  // ─── Chat Panel ────────────────────────────────────────────────────────────
  const ChatPanel = (
    <div className={`
      ${mobileView === "chat" ? "flex" : "hidden"} lg:flex
      lg:col-span-5 flex-col bg-white min-h-0 overflow-hidden relative
    `}>
      {activeConv ? (
        <>
          {/* Header */}
          <div className="p-3.5 border-b border-slate-100 flex items-center gap-2.5 bg-white shadow-sm shrink-0">
            {/* Back button (mobile only) */}
            <button
              onClick={() => setMobileView("list")}
              className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
              aria-label="Voltar para lista"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Avatar */}
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold font-mono shrink-0 ${avatarColor(activeConv.customerPhone)}`}>
              {initials(activeConv.customerName)}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-slate-800 font-sans leading-tight truncate">
                {activeConv.customerName}
              </h3>
              <p className="text-[10px] text-slate-400 font-mono leading-none">
                {activeConv.botActive ? "🤖 PizzaBot ativo" : "👨‍💻 Atendimento humano"}
              </p>
            </div>

            {/* Bot toggle */}
            {activeConv.botActive ? (
              <button
                onClick={() => onToggleBot(activeConv.customerPhone, false)}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all rounded-lg font-semibold font-sans"
              >
                <Lock className="w-3 h-3 text-red-500" />
                <span className="hidden sm:inline">Assumir</span>
              </button>
            ) : (
              <button
                onClick={() => onToggleBot(activeConv.customerPhone, true)}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 transition-all rounded-lg font-semibold font-sans shadow-sm"
              >
                <Unlock className="w-3 h-3" />
                <span className="hidden sm:inline">Ativar Bot</span>
              </button>
            )}
          </div>

          {/* Messages — fixed height, scrollable */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23f0f0f0' fill-opacity='0.4'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7z'/%3E%3C/g%3E%3C/svg%3E")`,
              backgroundColor: "#f4f7f6"
            }}
          >
            {/* Date separator */}
            <div className="flex items-center justify-center mb-2">
              <span className="px-3 py-1 bg-slate-200/60 text-[10px] text-slate-500 rounded-full font-sans uppercase tracking-wide select-none">
                Hoje · Chat WhatsApp
              </span>
            </div>

            {activeConv.messages.map(m => {
              const isUser = m.sender === "client";
              const isBot  = m.sender === "bot";

              return (
                <div
                  key={m.id}
                  className={`flex ${isUser ? "justify-start" : "justify-end"}`}
                >
                  <div className={`max-w-[80%] flex flex-col ${isUser ? "items-start" : "items-end"}`}>
                    {/* Sender label */}
                    {!isUser && (
                      <span className={`text-[9px] font-bold font-mono mb-0.5 px-1 ${isBot ? "text-emerald-600" : "text-indigo-500"}`}>
                        {isBot ? "🤖 PIZZABOT" : "👤 ATENDENTE"}
                      </span>
                    )}

                    <div className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                      isUser
                        ? "bg-white text-slate-800 rounded-tl-none border border-slate-100"
                        : isBot
                          ? "bg-emerald-50 text-emerald-900 rounded-tr-none border border-emerald-100"
                          : "bg-indigo-600 text-white rounded-tr-none"
                    }`}>
                      <p className="whitespace-pre-line font-sans leading-normal">{m.content}</p>
                      <span className={`block text-[8px] text-right mt-1 font-mono ${
                        isUser ? "text-slate-400" : isBot ? "text-emerald-500" : "text-indigo-200"
                      }`}>
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {!isUser && " ✓✓"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom floating button */}
          {showScrollBtn && (
            <button
              onClick={() => scrollToBottom("smooth")}
              className="absolute bottom-16 right-4 z-10 w-9 h-9 bg-white border border-slate-200 rounded-full shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:shadow-lg transition-all"
              aria-label="Ir para mensagens mais recentes"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}

          {/* Reply input */}
          <form
            onSubmit={handleSend}
            className="p-3 border-t border-slate-100 flex items-center gap-2 bg-white shrink-0"
          >
            <input
              type="text"
              placeholder={
                activeConv.botActive
                  ? "Digite para responder (desativa o bot automaticamente)..."
                  : "Responder como humano..."
              }
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              className="flex-1 px-4 py-2.5 text-xs border border-slate-200 focus:border-indigo-500 focus:outline-none transition-all rounded-lg font-sans"
            />
            <button
              type="submit"
              disabled={!replyText.trim()}
              className={`shrink-0 p-2.5 rounded-lg text-white transition-all flex items-center justify-center disabled:opacity-40 ${
                activeConv.botActive
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </>
      ) : (
        /* Empty state */
        <div className={`flex-1 flex flex-col items-center justify-center text-slate-400 p-8 space-y-3 bg-slate-50/30 ${mobileView === "chat" ? "flex" : "hidden"} lg:flex`}>
          <MessageSquare className="w-12 h-12 text-slate-300 stroke-1" />
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-slate-500 font-sans">Nenhuma conversa selecionada</p>
            <p className="text-xs text-slate-400 font-sans max-w-xs">
              Selecione uma conversa na lista para começar o atendimento.
            </p>
          </div>
          <button
            onClick={() => setMobileView("list")}
            className="lg:hidden mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-xs text-orange-600 border border-orange-200 rounded-lg bg-orange-50 font-semibold font-sans"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Ver conversas
          </button>
        </div>
      )}
    </div>
  );

  // ─── CRM Panel ─────────────────────────────────────────────────────────────
  const CrmPanel = (
    <div className={`
      lg:col-span-3 flex-col min-h-0 bg-slate-50/40 p-4 overflow-y-auto space-y-4
      ${mobileView === "chat" ? "hidden lg:flex" : "hidden lg:flex"}
    `}>
      {activeConv && activeCustomer ? (
        <>
          {/* Identity */}
          <div className="bg-white p-4 border border-slate-100 rounded-xl space-y-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold font-mono ${avatarColor(activeCustomer.phone)}`}>
                {initials(activeCustomer.name)}
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">CRM · Perfil</h4>
                <p className="text-sm font-bold text-slate-800 font-sans">{activeCustomer.name}</p>
              </div>
            </div>
            <div className="text-xs text-slate-500 font-sans space-y-2 border-t pt-3 border-slate-100">
              <div className="flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-mono">{activeCustomer.phone}</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span className="leading-tight">{activeCustomer.defaultAddress || "Nenhum endereço cadastrado."}</span>
              </div>
            </div>
          </div>

          {/* RAG Memory */}
          <div className="bg-white p-4 border border-slate-100 rounded-xl space-y-2 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1">
              <Bot className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-slate-700 font-sans uppercase tracking-wide">Memória do Agente</h4>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed italic bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 font-sans">
              {activeCustomer.preferences || "Sem preferências cadastradas. O PizzaBot anotará automaticamente."}
            </p>
          </div>

          {/* Stats */}
          <div className="bg-white p-4 border border-slate-100 rounded-xl shadow-sm">
            <h4 className="text-xs font-bold text-slate-700 font-sans uppercase tracking-wide flex items-center gap-1 mb-3">
              <ClipboardList className="w-4 h-4 text-slate-400" />
              Indicadores
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 bg-slate-50 rounded-lg text-center">
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">Pedidos</span>
                <p className="text-base font-bold text-slate-800 font-mono">{activeCustomer.totalOrders}</p>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg text-center">
                <span className="text-[9px] font-bold text-slate-400 uppercase font-mono block">Total Gasto</span>
                <p className="text-sm font-bold text-slate-800 font-mono">R${activeCustomer.totalSpent.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Order history */}
          <div className="bg-white p-4 border border-slate-100 rounded-xl shadow-sm flex flex-col min-h-0">
            <h4 className="text-xs font-bold text-slate-700 font-sans uppercase tracking-wide flex items-center gap-1 border-b pb-2 mb-3 shrink-0">
              <History className="w-4 h-4 text-slate-400" />
              Histórico ({activeOrders.length})
            </h4>
            <div className="space-y-3 overflow-y-auto max-h-48 pr-0.5 divide-y divide-slate-50">
              {activeOrders.map((order, idx) => (
                <div key={order.id} className={`space-y-1 ${idx > 0 ? "pt-2" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-800 font-mono">Ped #{order.orderNumber}</span>
                    <span className="text-[9px] text-slate-400 font-mono">
                      {new Date(order.createdAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate font-sans">
                    {order.items.map(i => `${i.qty}x ${i.name}`).join(", ")}
                  </p>
                  <span className="block text-[10px] font-bold text-slate-900 font-mono">
                    R$ {order.totalValue.toFixed(2)}
                  </span>
                </div>
              ))}
              {activeOrders.length === 0 && (
                <div className="py-6 text-center text-[10px] text-slate-300 font-sans">
                  Sem pedidos registrados.
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center border border-dashed border-slate-200 rounded-xl p-6">
            <User className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-sans">Selecione uma conversa para ver o perfil CRM.</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 border border-slate-100 rounded-xl bg-white overflow-hidden shadow-sm h-[calc(100vh-150px)] max-h-[calc(100vh-150px)]"
    >
      {ConvList}
      {ChatPanel}
      {CrmPanel}
    </div>
  );
}
