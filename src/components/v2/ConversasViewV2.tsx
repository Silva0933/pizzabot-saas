/**
 * Conversas v2 — lista + chat panel, conectado ao backend Python.
 *
 * Cada conversa: 2 colunas. Esquerda: lista. Direita: histórico + input.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Bot, BotOff, AlertCircle, MessageSquare, User } from "lucide-react";
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
    <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] h-[calc(100vh-120px)] bg-white border-t border-slate-200">
      {/* Lista */}
      <aside className="border-r border-slate-200 overflow-y-auto bg-white">
        <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            <h2 className="text-sm font-bold">Conversas</h2>
            <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5 font-medium">{ordered.length}</span>
          </div>
        </div>
        {ordered.length === 0 && (
          <div className="p-8 text-sm text-slate-400 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Nenhuma conversa ainda.
          </div>
        )}
        {ordered.map((c) => {
          const isActive = active?.id === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setActive(c)}
              className={`w-full text-left px-3 py-3 border-b border-slate-50 flex gap-3 transition-colors ${
                isActive ? "bg-orange-50" : "hover:bg-slate-50"
              }`}
            >
              <Avatar name={c.cliente_nome || c.cliente_telefone} botAtivo={c.bot_ativo} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-slate-800 truncate">
                    {c.cliente_nome || c.cliente_telefone}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {relTime(c.last_timestamp)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-slate-500 truncate">{c.last_message || "—"}</span>
                  {c.unread_count > 0 && (
                    <span className="bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center shrink-0">
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </aside>

      {/* Chat panel */}
      <section className="flex flex-col bg-[#f7f3ee]">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <div className="w-16 h-16 rounded-full bg-orange-100 grid place-items-center mb-3">
              <MessageSquare className="w-8 h-8 text-orange-400" />
            </div>
            <p className="text-sm font-medium text-slate-500">Selecione uma conversa</p>
            <p className="text-xs text-slate-400 mt-1">As mensagens do WhatsApp aparecem aqui.</p>
          </div>
        ) : (
          <>
            <header className="px-4 py-3 bg-white border-b border-slate-200 flex items-center gap-3 shadow-sm">
              <Avatar name={active.cliente_nome || active.cliente_telefone} botAtivo={active.bot_ativo} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-slate-800 truncate">{active.cliente_nome || active.cliente_telefone}</div>
                <div className="text-xs text-slate-500 truncate">{active.cliente_telefone}</div>
              </div>
              <button
                type="button"
                onClick={toggleBot}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active.bot_ativo
                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {active.bot_ativo ? <Bot className="w-3.5 h-3.5" /> : <BotOff className="w-3.5 h-3.5" />}
                {active.bot_ativo ? "Bot ativo" : "Humano"}
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {mensagens.map((m) => {
                const isCliente = m.origem === "cliente";
                const isSistema = m.origem === "sistema";
                if (isSistema) {
                  return (
                    <div key={m.id} className="flex justify-center my-2">
                      <span className="bg-slate-200/70 text-slate-500 text-[11px] italic px-3 py-1 rounded-full">
                        {m.conteudo}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={`flex ${isCliente ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[78%] px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                        isCliente
                          ? "bg-white text-slate-800 rounded-2xl rounded-tl-md"
                          : m.origem === "bot"
                          ? "bg-emerald-500 text-white rounded-2xl rounded-tr-md"
                          : "bg-orange-500 text-white rounded-2xl rounded-tr-md"
                      }`}
                    >
                      {!isCliente && (
                        <div className="text-[10px] font-semibold opacity-80 mb-0.5">
                          {m.origem === "bot" ? "🤖 Atendente IA" : "👤 Você"}
                        </div>
                      )}
                      {m.conteudo}
                      <div className={`text-[10px] mt-0.5 ${isCliente ? "text-slate-400" : "text-white/70"}`}>
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
              className="p-3 bg-white border-t border-slate-200 flex gap-2 items-center"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Responder como operador humano…"
                disabled={sending}
                className="flex-1 px-4 py-2.5 bg-slate-100 rounded-full text-sm focus:bg-white focus:ring-2 focus:ring-orange-200 outline-none transition"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="bg-gradient-to-br from-orange-500 to-rose-500 hover:opacity-90 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-sm disabled:opacity-50 shrink-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

// ============================================
// Helpers
// ============================================
function Avatar({ name, botAtivo }: { name: string; botAtivo: boolean }) {
  const initials = (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const palette = ["from-orange-400 to-rose-400", "from-sky-400 to-blue-500", "from-violet-400 to-fuchsia-500", "from-emerald-400 to-teal-500", "from-amber-400 to-orange-500"];
  const idx = (name?.charCodeAt(0) || 0) % palette.length;
  return (
    <div className="relative shrink-0">
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${palette[idx]} text-white grid place-items-center font-semibold text-xs`}>
        {initials || <User className="w-4 h-4" />}
      </div>
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${botAtivo ? "bg-emerald-500" : "bg-slate-300"}`}
        title={botAtivo ? "Bot ativo" : "Atendimento humano"}
      />
    </div>
  );
}

function relTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 2) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
