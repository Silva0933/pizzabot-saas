/**
 * Painel de teste da atendente (chat simulado, sem WhatsApp).
 *
 * Conversa com a atendente usando o endpoint /pizzarias/{id}/agente/testar.
 * Mostra também quais tools foram usadas — útil pra debugar comportamento.
 */
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { personalityApi } from "../lib/api";

interface Mensagem {
  id: string;
  origem: "cliente" | "atendente" | "sistema";
  texto: string;
  tools?: string[];
  iter?: number;
}

export interface AgentTestPanelProps {
  pizzariaId: string;
  open: boolean;
  onClose: () => void;
  telefoneTeste?: string;
}

export function AgentTestPanel({
  pizzariaId,
  open,
  onClose,
  telefoneTeste = "5511900000000",
}: AgentTestPanelProps) {
  const [messages, setMessages] = useState<Mensagem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Mensagem inicial
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          id: "intro",
          origem: "sistema",
          texto:
            "Modo teste — você conversa como cliente. A atendente responde com base na personalidade salva. As ações dela (registrar pedido etc) afetam o banco de dados de teste.",
        },
      ]);
    }
  }, [open]);

  const handleSend = async () => {
    const texto = input.trim();
    if (!texto || busy) return;

    setInput("");
    setErro(null);
    const userMsg: Mensagem = {
      id: `u-${Date.now()}`,
      origem: "cliente",
      texto,
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);

    try {
      const r = await personalityApi.test(pizzariaId, telefoneTeste, texto);
      const botMsg: Mensagem = {
        id: `b-${Date.now()}`,
        origem: "atendente",
        texto: r.texto || "(a atendente não retornou texto — provavelmente travou em tool calls)",
        tools: r.tool_calls,
        iter: r.iteracoes,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e: any) {
      setErro(e.message || "Erro desconhecido");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    setMessages([
      {
        id: "intro-reset",
        origem: "sistema",
        texto: "Conversa zerada. (A memória do agente também é resetada se você usar outro telefone.)",
      },
    ]);
    setErro(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[85vh] max-h-[700px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-orange-500" />
                  Conversa de teste
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Telefone simulado: <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">{telefoneTeste}</code>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  title="Limpar tela (memória do servidor persiste)"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}

              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-sm text-slate-500 pl-10"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Camila está digitando...</span>
                </motion.div>
              )}

              {erro && (
                <div className="flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-200 p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSend())}
                  disabled={busy}
                  placeholder="Digite como cliente..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  className="bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Enviar
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                Dica: teste cenários reais — "oi tem promoção?", "quero uma calabresa", "esqueci, troca pra mussarela", "cancela meu pedido".
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================
// Bolha de mensagem
// ============================================
function MessageBubble({ msg }: { msg: Mensagem }) {
  if (msg.origem === "sistema") {
    return (
      <div className="text-center">
        <span className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1 rounded-full inline-block">
          {msg.texto}
        </span>
      </div>
    );
  }

  const isCliente = msg.origem === "cliente";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-2 ${isCliente ? "justify-end" : "justify-start"}`}
    >
      {!isCliente && (
        <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-orange-600" />
        </div>
      )}
      <div className={`max-w-[80%] ${isCliente ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`px-3 py-2 rounded-2xl text-sm ${
            isCliente
              ? "bg-orange-500 text-white rounded-br-sm"
              : "bg-white border border-slate-200 text-slate-700 rounded-bl-sm"
          }`}
        >
          {msg.texto.split("\n").map((line, i) => (
            <React.Fragment key={i}>
              {line}
              {i < msg.texto.split("\n").length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>

        {!isCliente && msg.tools && msg.tools.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              tools:
            </span>
            {msg.tools.map((t, i) => (
              <span
                key={i}
                className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono"
              >
                {t}
              </span>
            ))}
            {msg.iter && (
              <span className="text-[10px] text-slate-400 ml-1">({msg.iter} iter)</span>
            )}
          </div>
        )}
      </div>
      {isCliente && (
        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
          <User className="w-3.5 h-3.5 text-slate-600" />
        </div>
      )}
    </motion.div>
  );
}
