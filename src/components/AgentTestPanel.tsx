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
  Activity,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import { AgentTrace, personalityApi } from "../lib/api";

interface Mensagem {
  id: string;
  origem: "cliente" | "atendente" | "sistema";
  texto: string;
  tools?: string[];
  iter?: number;
  trace?: AgentTrace;
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
  const [sessao, setSessao] = useState(() => crypto.randomUUID());
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
            "Playground seguro — nenhuma mensagem vai para o WhatsApp e pedidos, pagamentos, handoffs e outras ações são apenas simulados.",
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
      const r = await personalityApi.test(pizzariaId, telefoneTeste, texto, sessao);
      const botMsg: Mensagem = {
        id: `b-${Date.now()}`,
        origem: "atendente",
        texto: r.texto || "(a atendente não retornou texto — provavelmente travou em tool calls)",
        tools: r.tool_calls,
        iter: r.iteracoes,
        trace: r.trace,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e: any) {
      setErro(e.message || "Erro desconhecido");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      await personalityApi.resetTest(pizzariaId, sessao);
    } catch (e: any) {
      setErro(e.message || "Não foi possível limpar a sessão simulada");
      return;
    }
    setSessao(crypto.randomUUID());
    setMessages([
      {
        id: "intro-reset",
        origem: "sistema",
        texto: "Conversa e memória simulada zeradas. Uma nova sessão segura foi criada.",
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
            className="bg-[#111622] border border-slate-800 text-slate-100 rounded-2xl shadow-2xl w-full max-w-2xl h-[85vh] max-h-[700px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b border-slate-800 px-5 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-orange-400" />
                  Conversa de teste
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  <ShieldCheck className="inline w-3 h-3 text-emerald-400 mr-1" />
                  Sessão isolada · sem envios reais
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  title="Zerar conversa e memória simulada"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0b0e14]">
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}

              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-sm text-slate-400 pl-10"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                  <span>Camila está digitando...</span>
                </motion.div>
              )}

              {erro && (
                <div className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/30 text-red-400 px-3.5 py-2.5 rounded-xl">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-800 p-4 bg-[#111622]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSend())}
                  disabled={busy}
                  placeholder="Digite como cliente..."
                  className="flex-1 px-3.5 py-2.5 text-sm bg-[#161f30] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl flex items-center gap-1.5 text-sm font-semibold transition-colors shadow-sm"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Enviar
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
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
const MessageBubble: React.FC<{ msg: Mensagem }> = ({ msg }) => {
  const [traceOpen, setTraceOpen] = useState(false);
  if (msg.origem === "sistema") {
    return (
      <div className="text-center">
        <span className="text-[11px] text-slate-400 bg-[#161f30] border border-slate-800 px-3 py-1 rounded-full inline-block">
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
        <div className="w-7 h-7 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-orange-400" />
        </div>
      )}
      <div className={`max-w-[80%] ${isCliente ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`px-3.5 py-2 rounded-2xl text-sm ${
            isCliente
              ? "bg-orange-500 text-white rounded-br-sm shadow-sm"
              : "bg-[#161f30] border border-slate-800 text-slate-200 rounded-bl-sm"
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
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              tools:
            </span>
            {msg.tools.map((t, i) => (
              <span
                key={i}
                className="text-[10px] bg-[#161f30] border border-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono"
              >
                {t}
              </span>
            ))}
            {msg.iter && (
              <span className="text-[10px] text-slate-500 ml-1">({msg.iter} iter)</span>
            )}
          </div>
        )}
        {!isCliente && msg.trace && (
          <div className="w-full mt-1">
            <button
              type="button"
              onClick={() => setTraceOpen((v) => !v)}
              className="text-[10px] text-slate-400 hover:text-orange-300 flex items-center gap-1"
            >
              <Activity className="w-3 h-3" />
              {msg.trace.pipeline || "agente"} · {msg.trace.intent || msg.trace.decision || "turno"}
              {typeof msg.trace.confidence === "number" && ` · ${Math.round(msg.trace.confidence * 100)}%`}
              <ChevronDown className={`w-3 h-3 transition-transform ${traceOpen ? "rotate-180" : ""}`} />
            </button>
            {traceOpen && (
              <pre className="mt-1 max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0b0e14] p-2 text-[10px] leading-relaxed text-slate-400">
                {JSON.stringify(msg.trace, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
      {isCliente && (
        <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center shrink-0 text-slate-300">
          <User className="w-3.5 h-3.5" />
        </div>
      )}
    </motion.div>
  );
}
