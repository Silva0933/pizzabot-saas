/**
 * Conversas v2 — lista + chat panel, conectado ao backend Python.
 *
 * Melhorias:
 * - Append incremental de mensagens via WS (sem re-fetch)
 * - Indicador de "digitando" do bot
 * - Botão para limpar todas as conversas
 * - Badge pulsante para atendimento humano necessário
 * - Alerta sonoro para atendimento humano
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Loader2, Send, Bot, BotOff, AlertCircle, MessageSquare, User,
  Trash2, AlertTriangle, Bell, X,
} from "lucide-react";
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
  const [typing, setTyping] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [humanAlert, setHumanAlert] = useState<{ nome: string; motivo: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Marcar como lida ao selecionar
    conversasApi.marcarLida(pizzariaId, active.id).catch(() => {});
    return () => { cancelled = true; };
  }, [active?.id, pizzariaId]);

  // Auto-scroll ao receber nova mensagem
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens, typing]);

  // ---- Reagir a evento WS (incremental, sem re-fetch pesado) ----
  useEffect(() => {
    if (!liveEvent) return;

    if (liveEvent.tipo === "mensagem.nova") {
      const p = liveEvent.payload;

      // Se a conversa ativa é a que recebeu a msg, faz APPEND
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
          // Evita duplicata
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        // Limpa indicador de digitando
        setTyping(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }

      // Atualiza a lista de conversas (merge incremental)
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
        // Nova conversa — refetch leve
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
      // Atualiza a conversa ativa também
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

    // Indicador de "digitando" do bot
    if (liveEvent.tipo === "bot.digitando") {
      const p = liveEvent.payload;
      if (active && p?.conversa_id === active.id) {
        setTyping(true);
        // Auto-clear após 30s (segurança)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), 30_000);
      }
    }

    // Alerta de atendimento humano
    if (liveEvent.tipo === "atendimento.humano") {
      const p = liveEvent.payload;
      setHumanAlert({
        nome: p?.cliente_nome || p?.telefone || "Cliente",
        motivo: p?.motivo || "Solicitação de atendimento humano",
      });
      // Toca som de alerta
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==");
        // Fallback: usa o beep do browser
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("🔴 Atendimento humano solicitado", {
            body: `${p?.cliente_nome || "Cliente"}: ${p?.motivo || "Precisa de ajuda"}`,
            icon: "🍕",
          });
        }
        audio.play().catch(() => {});
      } catch {}
    }

    // Conversas limpas
    if (liveEvent.tipo === "conversas.limpas") {
      setConversas([]);
      setActive(null);
      setMensagens([]);
    }
  }, [liveEvent, active, pizzariaId]);

  const ordered = useMemo(() =>
    [...conversas].sort((a, b) => {
      // Humano necessário primeiro
      if (a.status === "humano_necessario" && b.status !== "humano_necessario") return -1;
      if (b.status === "humano_necessario" && a.status !== "humano_necessario") return 1;
      return +new Date(b.last_timestamp) - +new Date(a.last_timestamp);
    }),
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

  async function handleDeleteAll() {
    setDeleting(true);
    try {
      await conversasApi.limparTodas(pizzariaId);
      setConversas([]);
      setActive(null);
      setMensagens([]);
      setShowDeleteModal(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <>
      {/* Modal de confirmação para deletar */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 grid place-items-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Apagar todas as conversas?</h3>
                <p className="text-sm text-slate-500">Esta ação é permanente e irreversível.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              Todas as <strong>conversas</strong> e <strong>mensagens</strong> desta pizzaria serão apagadas permanentemente do banco de dados. As filas de processamento do bot também serão limpas.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <Trash2 className="w-4 h-4" />
                Sim, apagar tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerta toast de atendimento humano */}
      {humanAlert && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in">
          <div className="bg-red-600 text-white rounded-xl shadow-2xl p-4 max-w-sm flex gap-3 items-start">
            <div className="w-10 h-10 rounded-full bg-white/20 grid place-items-center shrink-0 animate-pulse">
              <Bell className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">🔴 Atendimento humano solicitado</p>
              <p className="text-xs text-red-100 mt-0.5 truncate">{humanAlert.nome}</p>
              <p className="text-xs text-red-200 mt-0.5">{humanAlert.motivo}</p>
            </div>
            <button
              onClick={() => setHumanAlert(null)}
              className="text-white/70 hover:text-white transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] h-[calc(100vh-120px)] bg-white border-t border-slate-200">
        {/* Lista */}
        <aside className="border-r border-slate-200 overflow-y-auto bg-white">
          <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <h2 className="text-sm font-bold">Conversas</h2>
              <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5 font-medium">{ordered.length}</span>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="ml-1 text-white/80 hover:text-white transition-colors p-1 hover:bg-white/15 rounded-lg"
                title="Limpar todas as conversas"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
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
            const isHumanNeeded = c.status === "humano_necessario";
            return (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className={`w-full text-left px-3 py-3 border-b border-slate-50 flex gap-3 transition-colors ${
                  isActive ? "bg-orange-50" : isHumanNeeded ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-slate-50"
                }`}
              >
                <Avatar name={c.cliente_nome || c.cliente_telefone} botAtivo={c.bot_ativo} isHumanNeeded={isHumanNeeded} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-semibold text-sm truncate ${isHumanNeeded ? "text-red-700" : "text-slate-800"}`}>
                      {c.cliente_nome || c.cliente_telefone}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {relTime(c.last_timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-500 truncate">{c.last_message || "—"}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {isHumanNeeded && (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
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
                <Avatar name={active.cliente_nome || active.cliente_telefone} botAtivo={active.bot_ativo} isHumanNeeded={active.status === "humano_necessario"} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-slate-800 truncate">{active.cliente_nome || active.cliente_telefone}</div>
                  <div className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                    {active.cliente_telefone}
                    {active.status === "humano_necessario" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full animate-pulse">
                        <Bell className="w-2.5 h-2.5" />
                        HUMANO NECESSÁRIO
                      </span>
                    )}
                  </div>
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

                {/* Indicador de digitando */}
                {typing && (
                  <div className="flex justify-end">
                    <div className="bg-emerald-100 text-emerald-700 rounded-2xl rounded-tr-md px-4 py-3 flex items-center gap-2 shadow-sm">
                      <div className="text-[10px] font-semibold">🤖 Atendente IA</div>
                      <div className="flex gap-1 items-center">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-xs ml-1">Digitando...</span>
                    </div>
                  </div>
                )}
              </div>

              {err && (
                <div className="px-3 py-1.5 bg-red-50 text-red-700 text-xs flex items-center gap-1.5 border-t border-red-200">
                  <AlertCircle className="w-3.5 h-3.5" /> {err}
                  <button onClick={() => setErr(null)} className="ml-auto text-red-400 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
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
    </>
  );
}

// ============================================
// Helpers
// ============================================
function Avatar({ name, botAtivo, isHumanNeeded }: { name: string; botAtivo: boolean; isHumanNeeded?: boolean }) {
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
      {isHumanNeeded ? (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white bg-red-500 animate-pulse" title="Atendimento humano necessário" />
      ) : (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${botAtivo ? "bg-emerald-500" : "bg-slate-300"}`}
          title={botAtivo ? "Bot ativo" : "Atendimento humano"}
        />
      )}
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
