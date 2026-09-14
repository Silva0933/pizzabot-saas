import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, Send, Bot, BotOff, AlertCircle, MessageSquare, User,
  Bell, X, ArrowLeft, Search,
} from "lucide-react";
import {
  conversasApi,
  BackendConversa,
  BackendMensagem,
} from "../../lib/api";

interface Props {
  pizzariaId: string;
  liveEvent?: { tipo: string; payload: any } | null;
  onConversationOpen?: (conversationId: string) => void;
}

export function ConversasViewV2({ pizzariaId, liveEvent, onConversationOpen }: Props) {
  const [conversas, setConversas] = useState<BackendConversa[]>([]);
  const [active, setActive] = useState<BackendConversa | null>(null);
  const [mensagens, setMensagens] = useState<BackendMensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [humanAlert, setHumanAlert] = useState<{ nome: string; motivo: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    conversasApi
      .list(pizzariaId)
      .then((c) => { if (!cancelled) setConversas(c); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pizzariaId]);

  useEffect(() => {
    if (!active) { setMensagens([]); return; }
    let cancelled = false;
    conversasApi
      .mensagens(pizzariaId, active.id)
      .then((m) => { if (!cancelled) setMensagens(m); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    conversasApi.marcarLida(pizzariaId, active.id).catch(() => {});
    return () => { cancelled = true; };
  }, [active?.id, pizzariaId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens, typing]);

  useEffect(() => {
    if (!liveEvent) return;

    if (liveEvent.tipo === "mensagem.nova") {
      const p = liveEvent.payload;

      if (active && p?.conversa_id === active.id) {
        const newMsg: BackendMensagem = {
          id: p.mensagem_id || crypto.randomUUID(),
          conversa_id: p.conversa_id,
          origem: p.origem || "cliente",
          tipo: p.tipo || "texto",
          conteudo: p.conteudo || "",
          metadata: {},
          created_at: p.created_at || new Date().toISOString(),
        };
        setMensagens((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        setTyping(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }

      setConversas((prev) => {
        const idx = prev.findIndex((c) => c.id === p?.conversa_id);
        if (idx >= 0) {
          const updated = { ...prev[idx] };
          updated.last_message = p.conteudo || updated.last_message;
          updated.last_timestamp = p.created_at || new Date().toISOString();
          if (p.origem === "cliente") {
            updated.unread_count = (updated.unread_count || 0) + 1;
          }
          const list = [...prev];
          list[idx] = updated;
          return list;
        }
        conversasApi.list(pizzariaId).then(setConversas).catch(() => {});
        return prev;
      });
    }

    if (liveEvent.tipo === "conversa.atualizada") {
      const p = liveEvent.payload;
      setConversas((prev) =>
        prev.map((c) => {
          if (c.id !== p?.conversa_id) return c;
          return {
            ...c,
            unread_count: p.unread_count ?? c.unread_count,
            last_message: p.last_message ?? c.last_message,
            bot_ativo: p.bot_ativo ?? c.bot_ativo,
            status: p.status ?? c.status,
          };
        }),
      );
      if (active && p?.conversa_id === active.id) {
        setActive((prev) =>
          prev ? {
            ...prev,
            unread_count: p.unread_count ?? prev.unread_count,
            bot_ativo: p.bot_ativo ?? prev.bot_ativo,
            status: p.status ?? prev.status,
          } : prev
        );
      }
    }

    if (liveEvent.tipo === "bot.digitando") {
      const p = liveEvent.payload;
      if (active && p?.conversa_id === active.id) {
        setTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), 30_000);
      }
    }

    if (liveEvent.tipo === "atendimento.humano") {
      const p = liveEvent.payload;
      setHumanAlert({
        nome: p?.cliente_nome || p?.telefone || "Cliente",
        motivo: p?.motivo || "Solicitação de atendimento humano",
      });
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==");
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("🔴 Atendimento humano solicitado", {
            body: `${p?.cliente_nome || "Cliente"}: ${p?.motivo || "Precisa de ajuda"}`,
            icon: "🍕",
          });
        }
        audio.play().catch(() => {});
      } catch {}
    }

    if (liveEvent.tipo === "conversas.limpas") {
      setConversas([]);
      setActive(null);
      setMensagens([]);
    }
  }, [liveEvent, active, pizzariaId]);

  const ordered = useMemo(() =>
    [...conversas].sort((a, b) => {
      if (a.status === "humano_necessario" && b.status !== "humano_necessario") return -1;
      if (b.status === "humano_necessario" && a.status !== "humano_necessario") return 1;
      return +new Date(b.last_timestamp) - +new Date(a.last_timestamp);
    }),
  [conversas]);

  const filtered = useMemo(() => {
    if (!search.trim()) return ordered;
    const s = search.toLowerCase();
    return ordered.filter(
      (c) =>
        (c.cliente_nome && c.cliente_nome.toLowerCase().includes(s)) ||
        (c.cliente_telefone && c.cliente_telefone.includes(s)) ||
        (c.last_message && c.last_message.toLowerCase().includes(s))
    );
  }, [ordered, search]);

  const unreadTotal = useMemo(() => {
    return conversas.reduce((acc, c) => acc + (c.unread_count || 0), 0) || conversas.length;
  }, [conversas]);

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
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <>
      {/* Alerta toast de atendimento humano */}
      {humanAlert && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in">
          <div className="bg-red-950/90 border border-red-700/60 backdrop-blur-md text-white rounded-2xl shadow-2xl p-4 max-w-sm flex gap-3 items-start">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 grid place-items-center shrink-0 animate-pulse">
              <Bell className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-red-200">🔴 Atendimento humano solicitado</p>
              <p className="text-xs text-white font-medium mt-0.5 truncate">{humanAlert.nome}</p>
              <p className="text-xs text-red-300/80 mt-0.5">{humanAlert.motivo}</p>
            </div>
            <button
              onClick={() => setHumanAlert(null)}
              className="text-white/60 hover:text-white transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 pb-24 md:pb-6">
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] h-[calc(100vh-140px)] min-h-[500px] bg-[#0b0e14] rounded-2xl border border-[#1e293b] overflow-hidden shadow-sm">
        {/* Lista de Conversas */}
        <aside className={`border-r border-[#1e293b] flex flex-col bg-[#0d1117] ${active ? "hidden md:flex" : "flex"}`}>
          {/* Header da lista */}
          <div className="p-4 border-b border-[#1e293b] bg-[#111622]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <h2 className="text-base font-bold text-white tracking-tight">Conversas</h2>
              </div>
              <span className="bg-red-500 text-white text-[11px] font-bold min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center shadow-sm">
                {unreadTotal}
              </span>
            </div>

            {/* Campo de busca */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa..."
                className="w-full bg-[#161f30] border border-[#1e293b] text-white text-xs rounded-xl pl-9 pr-4 py-2 placeholder-slate-500 focus:border-orange-500/50 outline-none transition"
              />
            </div>
          </div>

          {/* Lista de itens */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#1e293b]/40">
            {filtered.length === 0 && (
              <div className="p-8 text-sm text-slate-400 text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-500" />
                Nenhuma conversa encontrada.
              </div>
            )}
            {filtered.map((c) => {
              const isActive = active?.id === c.id;
              const isHumanNeeded = c.status === "humano_necessario";
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActive(c);
                    onConversationOpen?.(c.id);
                  }}
                  className={`w-full text-left px-4 py-3.5 flex gap-3 transition-colors ${
                    isActive
                      ? "bg-[#161f30] border-l-2 border-l-orange-500"
                      : isHumanNeeded
                      ? "bg-red-950/20 hover:bg-red-950/30"
                      : "hover:bg-[#131926]"
                  }`}
                >
                  <Avatar name={c.cliente_nome || c.cliente_telefone} botAtivo={c.bot_ativo} isHumanNeeded={isHumanNeeded} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold text-xs truncate ${isHumanNeeded ? "text-red-400" : "text-white"}`}>
                        {c.cliente_nome || c.cliente_telefone}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                        {relTime(c.last_timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-xs text-slate-400 truncate">{c.last_message || "—"}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isHumanNeeded && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                          </span>
                        )}
                        {c.unread_count > 0 && (
                          <span className="bg-emerald-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Painel do Chat */}
        <section className={`flex-col bg-[#0b0e14] min-h-0 min-w-0 h-full overflow-hidden ${active ? "flex" : "hidden md:flex"}`}>
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 grid place-items-center mb-4">
                <MessageSquare className="w-8 h-8 text-orange-400" />
              </div>
              <p className="text-base font-bold text-white">Selecione uma conversa</p>
              <p className="text-xs text-slate-400 mt-1">As mensagens do WhatsApp aparecem aqui.</p>
            </div>
          ) : (
            <>
              {/* Header da conversa ativa */}
              <header className="px-5 py-3.5 bg-[#111622] border-b border-[#1e293b] flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="md:hidden -ml-1 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#161f30] shrink-0"
                  title="Voltar para conversas"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar name={active.cliente_nome || active.cliente_telefone} botAtivo={active.bot_ativo} isHumanNeeded={active.status === "humano_necessario"} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-white truncate">{active.cliente_nome || active.cliente_telefone}</div>
                  <div className="text-xs text-slate-400 truncate flex items-center gap-2">
                    {active.cliente_telefone}
                    {active.status === "humano_necessario" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-950/60 border border-red-800/50 px-2 py-0.5 rounded-full animate-pulse">
                        <Bell className="w-2.5 h-2.5" />
                        HUMANO NECESSÁRIO
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleBot}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors border ${
                    active.bot_ativo
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                      : "bg-[#161f30] text-slate-300 border-[#1e293b] hover:bg-[#1e293b]"
                  }`}
                >
                  {active.bot_ativo ? <Bot className="w-3.5 h-3.5" /> : <BotOff className="w-3.5 h-3.5" />}
                  {active.bot_ativo ? "Bot ativo" : "Humano"}
                </button>
              </header>

              {/* Área de mensagens */}
              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2.5">
                {mensagens.map((m) => {
                  const isCliente = m.origem === "cliente";
                  const isSistema = m.origem === "sistema";
                  if (isSistema) {
                    return (
                      <div key={m.id} className="flex justify-center my-3">
                        <span className="bg-[#161f30] border border-[#1e293b] text-slate-400 text-[11px] px-3.5 py-1 rounded-full font-medium">
                          {m.conteudo}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={`flex ${isCliente ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[75%] px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm leading-relaxed ${
                          isCliente
                            ? "bg-[#161f30] border border-[#1e293b] text-slate-100 rounded-2xl rounded-tl-sm"
                            : m.origem === "bot"
                            ? "bg-emerald-950/60 border border-emerald-800/40 text-emerald-100 rounded-2xl rounded-tr-sm"
                            : "bg-orange-500 text-white rounded-2xl rounded-tr-sm font-medium"
                        }`}
                      >
                        {!isCliente && (
                          <div className="text-[10px] font-bold uppercase tracking-wider opacity-75 mb-1">
                            {m.origem === "bot" ? "🤖 Atendente IA" : "👤 Você"}
                          </div>
                        )}
                        {m.conteudo}
                        <div className={`text-[10px] mt-1 text-right font-medium ${isCliente ? "text-slate-400" : "text-white/70"}`}>
                          {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Indicador de digitando */}
                {typing && (
                  <div className="flex justify-end">
                    <div className="bg-emerald-950/60 border border-emerald-800/40 text-emerald-200 rounded-2xl rounded-tr-sm px-4 py-2.5 flex items-center gap-2 shadow-sm">
                      <div className="text-[10px] font-bold uppercase">🤖 Atendente IA</div>
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-xs ml-1 text-emerald-300">Digitando...</span>
                    </div>
                  </div>
                )}
              </div>

              {err && (
                <div className="px-4 py-2 bg-red-950/60 text-red-300 text-xs flex items-center gap-2 border-t border-red-800/40">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400" /> {err}
                  <button onClick={() => setErr(null)} className="ml-auto text-red-400 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Barra de input / ação */}
              {active.bot_ativo ? (
                <div className="p-3.5 bg-[#111622] border-t border-[#1e293b] flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2.5 text-xs text-slate-400 bg-[#161f30] border border-[#1e293b] rounded-xl px-4 py-2.5">
                    <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
                    O bot está atendendo esta conversa automaticamente.
                  </div>
                  <button
                    type="button"
                    onClick={toggleBot}
                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 shadow-sm transition"
                  >
                    <BotOff className="w-4 h-4" /> Assumir conversa
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); send(); }}
                  className="p-3.5 bg-[#111622] border-t border-[#1e293b] flex gap-2.5 items-center"
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Responder como operador humano…"
                    disabled={sending}
                    className="flex-1 px-4 py-2.5 bg-[#161f30] border border-[#1e293b] rounded-xl text-xs text-white placeholder-slate-500 focus:border-orange-500 outline-none transition"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="bg-orange-500 hover:bg-orange-600 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-sm disabled:opacity-50 shrink-0 transition"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
      </div>
    </>
  );
}

function Avatar({ name, botAtivo, isHumanNeeded }: { name: string; botAtivo: boolean; isHumanNeeded?: boolean }) {
  const initials = (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div className="relative shrink-0">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-white grid place-items-center font-bold text-xs shadow-sm">
        {initials || <User className="w-4 h-4" />}
      </div>
      {isHumanNeeded ? (
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111622] bg-red-500 animate-pulse" title="Atendimento humano necessário" />
      ) : (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111622] ${botAtivo ? "bg-emerald-500" : "bg-slate-500"}`}
          title={botAtivo ? "Bot ativo" : "Atendimento humano"}
        />
      )}
    </div>
  );
}

function relTime(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 2) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
