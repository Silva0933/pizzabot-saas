import React, { useEffect, useRef, useState } from "react";
import { Bot, X, Send, RefreshCw, Sparkles, Smartphone, AlertCircle } from "lucide-react";
import { Conversation, Pizzeria } from "../types";
import { supabase } from "../lib/supabase";

interface TestAgentModalProps {
  pizzeria: Pizzeria;
  isOpen: boolean;
  onClose: () => void;
}

type SimMessage = {
  id: string;
  sender: "client" | "bot" | "human";
  content: string;
  timestamp: string;
};

/**
 * PRD 4.6 — "Testar Agente": modal que simula uma conversa real.
 * Usa um telefone de teste (default 5500000000999) e dispara mensagens
 * para o webhook /pizzabot-secretaria. O bot processa, registra na tabela
 * "conversas" e o modal exibe o histórico em tempo real via Supabase Realtime.
 */
export function TestAgentModal({ pizzeria, isOpen, onClose }: TestAgentModalProps) {
  const [testPhone, setTestPhone] = useState<string>("5500000000999");
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load any existing test conversation when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("conversas")
        .select("id, messages")
        .eq("pizzaria_id", pizzeria.id)
        .eq("cliente_telefone", testPhone)
        .maybeSingle();
      if (!active) return;
      if (data) {
        setConversationId(data.id);
        setMessages((data.messages as SimMessage[]) || []);
      } else {
        setConversationId(null);
        setMessages([]);
      }
    })();
    return () => { active = false; };
  }, [isOpen, pizzeria.id, testPhone]);

  // Realtime subscription to this conversation
  useEffect(() => {
    if (!isOpen) return;
    const channel = supabase
      .channel(`test-agent-${pizzeria.id}-${testPhone}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversas", filter: `pizzaria_id=eq.${pizzeria.id}` },
        (payload) => {
          const row: any = payload.new;
          if (row?.cliente_telefone === testPhone) {
            setConversationId(row.id);
            setMessages((row.messages as SimMessage[]) || []);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, pizzeria.id, testPhone]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    setIsSending(true);
    setError(null);

    // Optimistic local append
    const localMsg: SimMessage = {
      id: `local-${Date.now()}`,
      sender: "client",
      content: inputText.trim(),
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, localMsg]);

    // Simulate Evolution webhook payload to PizzaBot Secretária
    const fakeEvolutionPayload = {
      event: "messages.upsert",
      instance: pizzeria.instance,
      data: {
        key: {
          remoteJid: `${testPhone}@s.whatsapp.net`,
          fromMe: false,
          id: `TEST-${Date.now()}`
        },
        pushName: "Teste do Painel",
        message: { conversation: inputText.trim() },
        messageTimestamp: Math.floor(Date.now() / 1000)
      }
    };

    const webhookUrl =
      import.meta.env.VITE_N8N_SECRETARIA_WEBHOOK_URL ||
      "https://n8nai.secretariaai.eu.cc/webhook/pizzabot-secretaria";

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fakeEvolutionPayload)
      });
      if (!res.ok) {
        setError(`Webhook retornou HTTP ${res.status}.`);
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao chamar webhook do agente.");
    } finally {
      setInputText("");
      setIsSending(false);
    }
  };

  const handleResetConversation = async () => {
    if (!conversationId) { setMessages([]); return; }
    if (!confirm("Apagar histórico de teste e começar nova conversa simulada?")) return;
    await supabase
      .from("conversas")
      .delete()
      .eq("id", conversationId)
      .eq("pizzaria_id", pizzeria.id);
    setMessages([]);
    setConversationId(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden border border-slate-200" style={{ maxHeight: "85vh" }}>

        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-orange-600 to-rose-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                Simulador de Conversa do Agente
              </h3>
              <p className="text-[10px] text-orange-50 font-mono">
                instância <strong>{pizzeria.instance}</strong> • telefone teste <strong>{testPhone}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-toolbar */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, ""))}
              className="px-2.5 py-1 text-xs font-mono bg-white border border-slate-200 rounded-md focus:border-orange-500 focus:outline-hidden text-slate-700 w-44"
              placeholder="Telefone de teste"
            />
            <span className="text-[10px] text-slate-400">(use um número fictício, ex: 5500000000999)</span>
          </div>
          <button
            onClick={handleResetConversation}
            className="text-[10px] font-bold text-slate-500 hover:text-red-600 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Resetar
          </button>
        </div>

        {/* Conversation area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-[#efe7dd]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23ece5dd' fill-opacity='0.5'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7z'/%3E%3C/g%3E%3C/svg%3E\")"
          }}
        >
          {messages.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-500 bg-white/70 rounded-xl px-4 mx-auto max-w-xs">
              <Bot className="w-6 h-6 mx-auto mb-2 text-orange-500" />
              <p className="font-semibold">Nenhuma mensagem ainda</p>
              <p className="text-[10px] mt-1">
                Digite uma mensagem abaixo. Ela será enviada ao webhook <code className="text-orange-600">/pizzabot-secretaria</code> exatamente como se viesse do WhatsApp.
              </p>
            </div>
          )}

          {messages.map((m) => {
            const isClient = m.sender === "client";
            return (
              <div
                key={m.id}
                className={`max-w-[80%] ${isClient ? "ml-auto" : "mr-auto"}`}
              >
                <div
                  className={`p-2.5 rounded-xl text-[11px] leading-relaxed shadow-3xs ${
                    isClient
                      ? "bg-[#dcf8c6] text-slate-800 rounded-tr-none"
                      : "bg-white text-slate-800 rounded-tl-none border border-slate-200/60"
                  }`}
                >
                  <p className="whitespace-pre-line">{m.content}</p>
                  <div className="text-[8px] text-slate-400 font-mono mt-1 text-right">
                    {m.sender} • {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {/* Input */}
        <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Digite uma mensagem como se fosse o cliente..."
            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden font-sans"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 transition-colors rounded-lg shadow-sm disabled:opacity-50"
          >
            {isSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar
          </button>
        </div>

      </div>
    </div>
  );
}
