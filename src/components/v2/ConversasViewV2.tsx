/**
 * Conversas v2 — lista + chat panel, conectado ao backend Python.
 *
 * Cada conversa: 2 colunas. Esquerda: lista. Direita: histórico + input.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Bot, BotOff, AlertCircle } from "lucide-react";
import {
  conversasApi,
  BackendConversa,
  BackendMensagem,
} from "../../lib/api";

interface Props {
  pizzariaId: string;
  /** Se WS já estiver conectado no App.tsx, App propaga eventos por aqui */
  liveEvent?: { tipo: string; payload: any } | null;
}

export function ConversasViewV2({ pizzariaId, liveEvent }: Props) {
  const [conversas, setConversas] = useState<BackendConversa[]>([]);
  const [active, setActive] = useState<BackendConversa | null>(null);
  const [mensagens, setMensagens] = useState<BackendMensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Inicial: lista
  useEffect(() => {
    let cancelled = false;
    conversasApi
      .list(pizzariaId)
      .then((c) => { if (!cancelled) setConversas(c); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pizzariaId]);

  // Quando seleciona conversa, busca mensagens
  useEffect(() => {
    if (!active) { setMensagens([]); return; }
    let cancelled = false;
    conversasApi
      .mensagens(pizzariaId, active.id)
      .then((m) => { if (!cancelled) setMensagens(m); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [active, pizzariaId]);

  // Auto-scroll ao receber nova mensagem
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  // Reagir a evento WS
  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.tipo === "mensagem.nova" && liveEvent.payload?.conversa_id === active?.id) {
      conversasApi.mensagens(pizzariaId, active!.id).then(setMensagens).catch(() => {});
    }
    if (liveEvent.tipo === "conversa.atualizada") {
      conversasApi.list(pizzariaId).then(setConversas).catch(() => {});
    }
  }, [liveEvent, active, pizzariaId]);

  const ordered = useMemo(() =>
    [...conversas].sort((a, b) => +new Date(b.last_timestamp) - +new Date(a.last_timestamp)),
  [conversas]);

  async function send() {
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      await conversasApi.enviar(pizzariaId, active.id, draft.trim());
      setDraft("");
      const fresh = await conversasApi.mensagens(pizzariaId, active.id);
      setMensagens(fresh);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  }

  async function toggleBot() {
    if (!active) return;
    try {
      await conversasApi.toggleBot(pizzariaId, active.id, !active.bot_ativo);
      setActive({ ...active, bot_ativo: !active.bot_ativo });
      setConversas((cs) =>
        cs.map((c) => (c.id === active.id ? { ...c, bot_ativo: !c.bot_ativo } : c)),
      );
    } catch (e: any) { setErr(e.message); }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] h-[calc(100vh-120px)] bg-white border-t border-slate-200">
      {/* Lista */}
      <aside className="border-r border-slate-200 overflow-y-auto">
        {ordered.length === 0 && (
          <div className="p-6 text-sm text-slate-500 text-center">Sem conversas ainda.</div>
        )}
        {ordered.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c)}
            className={`w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 ${
              active?.id === c.id ? "bg-orange-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-slate-800 truncate">
                {c.cliente_nome || c.cliente_telefone}
              </span>
              {c.unread_count > 0 && (
                <span className="bg-orange-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                  {c.unread_count}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 truncate mt-0.5">{c.last_message}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {new Date(c.last_timestamp).toLocaleString("pt-BR")}
              {c.bot_ativo ? " · 🤖" : " · 👤"}
            </div>
          </button>
        ))}
      </aside>

      {/* Chat panel */}
      <section className="flex flex-col bg-slate-50">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Selecione uma conversa
          </div>
        ) : (
          <>
            <header className="p-3 bg-white border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{active.cliente_nome || active.cliente_telefone}</div>
                <div className="text-xs text-slate-500">{active.cliente_telefone}</div>
              </div>
              <button
                type="button"
                onClick={toggleBot}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md ${
                  active.bot_ativo
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {active.bot_ativo ? <Bot className="w-3.5 h-3.5" /> : <BotOff className="w-3.5 h-3.5" />}
                {active.bot_ativo ? "Bot ativo" : "Humano"}
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
              {mensagens.map((m) => {
                const isCliente = m.origem === "cliente";
                const isSistema = m.origem === "sistema";
                return (
                  <div key={m.id} className={`flex ${isCliente ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap ${
                        isCliente
                          ? "bg-white border border-slate-200 text-slate-800"
                          : isSistema
                          ? "bg-slate-100 text-slate-600 italic text-xs"
                          : m.origem === "bot"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-orange-500 text-white"
                      }`}
                    >
                      {m.conteudo}
                      <div className="text-[10px] opacity-60 mt-0.5">
                        {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {err && (
              <div className="px-3 py-1.5 bg-red-50 text-red-700 text-xs flex items-center gap-1.5 border-t border-red-200">
                <AlertCircle className="w-3.5 h-3.5" /> {err}
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="p-3 bg-white border-t border-slate-200 flex gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Mensagem como operador humano..."
                disabled={sending}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-md flex items-center gap-1.5 text-sm font-medium disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                Enviar
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
