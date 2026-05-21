import React, { useState, useEffect, useRef } from "react";
import { 
  Smartphone, 
  CheckCheck, 
  Bot, 
  User, 
  RotateCcw,
  Volume2,
  Lock,
  MessageSquare,
  Users,
  Search,
  ChevronDown
} from "lucide-react";
import { Conversation, Message, Customer } from "../types";

interface ClientSimulatorProps {
  conversations: Conversation[];
  activeConvPhone: string | null;
  onRefreshAllData: () => void;
  onSelectConversation: (phone: string) => void;
}

export function ClientSimulator({
  conversations,
  activeConvPhone,
  onRefreshAllData,
  onSelectConversation
}: ClientSimulatorProps) {
  const [simPhone, setSimPhone] = useState<string | null>(activeConvPhone || (conversations.length > 0 ? conversations[0].customerPhone : null));
  const [isListExpanded, setIsListExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync state if main workspace selects a different active chat
  useEffect(() => {
    if (activeConvPhone) {
      setSimPhone(activeConvPhone);
    } else if (conversations.length > 0 && !simPhone) {
      setSimPhone(conversations[0].customerPhone);
    }
  }, [activeConvPhone, conversations]);

  const activeChat = conversations.find(c => c.customerPhone === simPhone);

  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }
  }, [activeChat?.messages?.length, simPhone]);

  const handleSelectClient = (phone: string) => {
    setSimPhone(phone);
    onSelectConversation(phone);
  };

  const filteredConversations = conversations.filter(c => {
    const term = searchQuery.toLowerCase();
    return c.customerName.toLowerCase().includes(term) || c.customerPhone.includes(term);
  });

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm relative font-sans">
      
      {/* Upper status info bar */}
      <div className="bg-slate-950 text-slate-100 p-2 text-[10px] font-mono flex items-center justify-between select-none">
        <span className="flex items-center gap-1">
          <Smartphone className="w-3.5 h-3.5 text-coral-500" />
          <span className="font-semibold text-slate-300">Central Simulada de Atendimento</span>
        </span>
        <div className="h-1.5 w-16 bg-slate-800 rounded-full mx-2" />
        <span className="text-[9px] font-bold text-emerald-400">APENAS LEITURA</span>
      </div>

      {/* Header with list of today's atendimentos */}
      <div className="bg-white border-b border-slate-200">
        <button 
          onClick={() => setIsListExpanded(!isListExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-600" />
            <div>
              <span className="text-xs font-bold text-slate-800 block">Atendimentos de Hoje</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {conversations.length} {conversations.length === 1 ? 'cliente ativo' : 'clientes ativos'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isListExpanded ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {isListExpanded && (
          <div className="px-4 pb-3 space-y-2 border-t border-slate-100 bg-slate-50/30">
            {/* Search filter for simulated contacts */}
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar atendimentos do dia..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-orange-500 text-slate-700"
              />
            </div>

            {/* Attendance contacts list */}
            <div className="grid grid-cols-2 gap-1.5 max-h-[140px] overflow-y-auto pr-1 py-1">
              {filteredConversations.map((conv) => {
                const isSelected = conv.customerPhone === simPhone;
                return (
                  <button
                    key={conv.customerPhone}
                    onClick={() => handleSelectClient(conv.customerPhone)}
                    className={`p-2 rounded-lg text-left transition-all border flex flex-col justify-between ${
                      isSelected 
                        ? "bg-slate-950 text-white border-slate-950 shadow-2xs" 
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-350"
                    }`}
                  >
                    <span className="text-xs font-semibold truncate block w-full leading-tight mb-0.5">
                      {conv.customerName}
                    </span>
                    <span className={`text-[9px] font-mono block ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {conv.customerPhone}
                    </span>
                  </button>
                );
              })}

              {filteredConversations.length === 0 && (
                <div className="col-span-2 py-4 text-center text-xs text-slate-400 font-sans">
                  Nenhum atendimento listado para hoje.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Green Header representing customer info */}
      <div className="bg-[#075e54] text-white p-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#128c7e] text-white flex items-center justify-center font-bold text-sm">
            🍕
          </div>
          <div>
            <h4 className="text-xs font-bold leading-tight">Don Peppone Pizzaria</h4>
            <div className="flex items-center gap-1 text-[9px] text-teal-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Agente de Atendimento Online</span>
            </div>
          </div>
        </div>

        <button 
          onClick={onRefreshAllData}
          className="p-1.5 hover:bg-teal-800/50 text-white/90 rounded transition-colors"
          title="Sincronizar dados"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Whatsapp Messages Area */}
      <div 
        className="flex-1 p-3 overflow-y-auto space-y-3"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23ece5dd' fill-opacity='0.5'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7z'/%3E%3C/g%3E%3C/svg%3E")`,
          backgroundColor: "#efe7dd"
        }}
      >
        <div className="mx-auto w-fit px-2.5 py-1 bg-slate-300/40 text-[9px] text-slate-500 rounded-md select-none text-center">
          Visualização em tempo real das mensagens WhatsApp deste cliente.
        </div>

        {activeChat?.messages?.map((m) => {
          const isUser = m.sender === "client";
          return (
            <div 
              key={m.id} 
              className={`flex flex-col max-w-[85%] ${
                isUser ? "ml-auto items-end" : "mr-auto items-start"
              }`}
            >
              <div className={`p-2.5 rounded-xl text-[11px] leading-relaxed relative ${
                isUser 
                  ? "bg-[#dcf8c6] text-slate-800 rounded-tr-none shadow-3xs" 
                  : "bg-white text-slate-800 rounded-tl-none border border-slate-200/60 shadow-3xs"
              }`}>
                <p className="whitespace-pre-line leading-normal">{m.content}</p>
                <div className="flex items-center justify-end gap-1 mt-1 font-mono text-[8px] text-slate-400">
                  <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isUser && <CheckCheck className="w-2.5 h-2.5 text-blue-500" />}
                </div>
              </div>
            </div>
          );
        })}

        {(!activeChat || activeChat.messages.length === 0) && (
          <div className="py-12 text-center text-xs text-slate-400 max-w-xs mx-auto bg-white/75 backdrop-blur-xs p-4 rounded-xl shadow-3xs space-y-1 mt-6">
            <Volume2 className="w-8 h-8 text-orange-500 mx-auto stroke-1" />
            <p className="font-semibold text-slate-600">Nenhuma conversa carrgada</p>
            <p className="text-[10px] text-slate-400 leading-normal">
              Selecione um cliente ativo nos atendimentos de hoje acima para carregar o histórico correspondente.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Simulator message locked notice */}
      <div className="p-3 bg-indigo-50 border-t border-indigo-150 flex items-center gap-2.5 shadow-xs">
        <Lock className="w-4 h-4 text-indigo-600 flex-none" />
        <span className="text-[10px] text-indigo-900 leading-normal font-medium">
          <strong>Apenas Leitura no Simulador</strong>. Para enviar mensagens de resposta ou interagir, utilize a <strong>Central de Chat</strong> principal de atendentes.
        </span>
      </div>

    </div>
  );
}
