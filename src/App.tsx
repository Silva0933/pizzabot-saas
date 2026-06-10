/**
 * App principal — totalmente conectado ao backend Python.
 *
 * Fluxo:
 *  1. Login (JWT do backend, NÃO Supabase)
 *  2. /auth/me + /pizzarias para descobrir contexto
 *  3. Se usuário não tem pizzaria → form de onboarding (cria via API)
 *  4. AppShell com 5 navs: Início, Conversas, Pedidos, Cardápio, Meu Negócio
 *  5. WebSocket pra updates ao vivo
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pizza, Loader2, AlertCircle, LogOut, Mail, Lock } from "lucide-react";
import {
  AppShell, NAV_PAGE_META,
} from "./components/v2";
// LandingPage desconectada por opção do dono (vai direto pro login). O componente
// continua existindo em ./components/v2 — pra reativar, reimporte-o aqui.
import type { NavKey } from "./components/v2/Sidebar";
import { ConversasViewV2 } from "./components/v2/ConversasViewV2";
import { PedidosViewV2 } from "./components/v2/PedidosViewV2";
import { CardapioViewV2 } from "./components/v2/CardapioViewV2";
import { MeuNegocioViewV2 } from "./components/v2/MeuNegocioViewV2";
import { PlatformAdminView } from "./components/v2/PlatformAdminView";
import { MetricasView } from "./components/v2/MetricasView";
import { AjudaView } from "./components/v2/AjudaView";
import {
  authApi, pizzariasApi, cardapioApi, pedidosApi, conversasApi, personalityApi,
  connectWebSocket, BackendPizzaria, UserMe, WsEvent,
  backendToOrder, backendToConversation,
  clearTokens, getToken, ApiError,
} from "./lib/api";

// ============================================
// Sinal sonoro de pedidos (Web Audio API)
// ============================================
function playNotificationSound(type: "novo" | "confirmado") {
  try {
    // @ts-ignore
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    if (type === "novo") {
      // Som de novo pedido: tom duplo alegre (D5 seguido de A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);
    } else {
      // Som de pedido confirmado: tom de sino ascendente premium (E5 seguido de B5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now); // E5
      osc1.frequency.setValueAtTime(987.77, now + 0.08); // B5
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);
    }
  } catch (e) {
    console.warn("Não foi possível reproduzir o sinal sonoro:", e);
  }
}

export default function App() {
  // ============================================
  // Auth
  // ============================================
  const [bootstrap, setBootstrap] = useState(true);
  const [user, setUser] = useState<UserMe | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authSenha, setAuthSenha] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  // ============================================
  // Workspace
  // ============================================
  const [pizzaria, setPizzaria] = useState<BackendPizzaria | null>(null);
  const [pizzarias, setPizzarias] = useState<BackendPizzaria[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [atendenteOk, setAtendenteOk] = useState(false);
  const [nav, setNav] = useState<NavKey>("pedidos");
  const [liveEvent, setLiveEvent] = useState<WsEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ============================================
  // Bootstrap (verifica token + busca user)
  // ============================================
  useEffect(() => {
    if (!getToken()) { setBootstrap(false); return; }
    authApi.me()
      .then(setUser)
      .catch(() => { clearTokens(); setUser(null); })
      .finally(() => setBootstrap(false));
  }, []);

  // ============================================
  // Carrega pizzaria do usuário
  // ============================================
  function loadPizzarias() {
    return pizzariasApi.list()
      .then((list) => {
        setPizzarias(list);
        // Platform admin NÃO entra automaticamente — escolhe no painel da plataforma.
        // Operador comum entra direto na sua (única) pizzaria.
        if (user && !user.is_platform_admin) setPizzaria(list[0] ?? null);
        return list;
      })
      .catch((e: ApiError) => {
        if (e.status === 401) { clearTokens(); setUser(null); }
        return [] as BackendPizzaria[];
      });
  }

  useEffect(() => {
    if (!user) { setPizzaria(null); setPizzarias([]); return; }
    loadPizzarias();
  }, [user]);

  // ============================================
  // Carrega dados base da pizzaria
  // ============================================
  async function refreshData(p: BackendPizzaria) {
    try {
      const [prods, peds, convs, pers] = await Promise.all([
        cardapioApi.list(p.id),
        pedidosApi.list(p.id),
        conversasApi.list(p.id),
        personalityApi.get(p.id).catch(() => null),
      ]);
      setProductCount(prods.length);
      setOrders(peds.map(backendToOrder));
      setConversations(convs.map(backendToConversation));
      setAtendenteOk(Boolean(pers && (pers as any).id));
    } catch (e) { console.warn("refreshData:", e); }
  }

  useEffect(() => {
    if (pizzaria) refreshData(pizzaria);
  }, [pizzaria?.id]);

  // Re-busca a pizzaria ao focar a aba: pega mudanças feitas fora (ex.: o admin
  // suspendeu/reativou) sem o operador precisar recarregar a página.
  useEffect(() => {
    if (!pizzaria) return;
    const pid = pizzaria.id;
    function onFocus() {
      pizzariasApi.get(pid).then(setPizzaria).catch(() => {});
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pizzaria?.id]);

  // Ao voltar pra tela inicial (Pedidos), recarrega os dados para o checklist
  // de onboarding refletir configurações concluídas em outras telas.
  useEffect(() => {
    if (pizzaria && nav === "pedidos") refreshData(pizzaria);
  }, [nav]);

  // ============================================
  // WebSocket
  // ============================================
  useEffect(() => {
    if (!pizzaria) return;
    const ws = connectWebSocket(pizzaria.id, (ev) => {
      setLiveEvent(ev);
      // Eventos de pedido → som e refresh
      if (ev.tipo === "pedido.novo") {
        playNotificationSound("novo");
        pedidosApi.list(pizzaria.id).then((p) => setOrders(p.map(backendToOrder))).catch(() => {});
      } else if (ev.tipo === "pedido.atualizado") {
        const statusNovo = ev.payload?.status_novo;
        if (statusNovo === "confirmado") {
          playNotificationSound("confirmado");
        } else if (statusNovo === "novo") {
          playNotificationSound("novo");
        }
        pedidosApi.list(pizzaria.id).then((p) => setOrders(p.map(backendToOrder))).catch(() => {});
      } else if (ev.tipo === "pedidos.limpos") {
        setOrders([]);
      }
      // Mensagem nova → atualização incremental da conversa na lista
      if (ev.tipo === "mensagem.nova") {
        setConversations((prev) => {
          const p = ev.payload;
          const idx = prev.findIndex((c: any) => c.id === p?.conversa_id);
          if (idx >= 0) {
            const updated = { ...prev[idx] };
            updated.lastMessage = p.conteudo || updated.lastMessage;
            updated.lastTimestamp = p.created_at || new Date().toISOString();
            if (p.origem === "cliente") {
              (updated as any).unreadCount = ((updated as any).unreadCount || 0) + 1;
            }
            const list = [...prev];
            list[idx] = updated;
            return list;
          }
          // Nova conversa - refetch
          conversasApi.list(pizzaria.id).then((c) => setConversations(c.map(backendToConversation))).catch(() => {});
          return prev;
        });
      }
      // Conversa atualizada (unread resetado, bot toggled, etc.)
      if (ev.tipo === "conversa.atualizada" || ev.tipo === "bot.toggled") {
        setConversations((prev) => 
          prev.map((c: any) => {
            if (c.id !== ev.payload?.conversa_id) return c;
            return {
              ...c,
              unreadCount: ev.payload.unread_count ?? c.unreadCount,
              lastMessage: ev.payload.last_message ?? c.lastMessage,
              botActive: ev.payload.bot_ativo ?? c.botActive,
              status: ev.payload.status === "humano_necessario" ? "Humano necessário" 
                    : ev.payload.bot_ativo ? "Bot ativo" 
                    : c.status,
            };
          })
        );
      }
      // Atendimento humano → refresh conversas (para badge) 
      if (ev.tipo === "atendimento.humano") {
        conversasApi.list(pizzaria.id).then((c) => setConversations(c.map(backendToConversation))).catch(() => {});
      }
      // Conversas limpas → esvaziar tudo
      if (ev.tipo === "conversas.limpas") {
        setConversations([]);
      }
      // Estado da conexão WhatsApp (indicador no Topbar + banner)
      if (ev.tipo === "whatsapp.status") {
        const estado = ev.payload?.estado;
        if (estado) {
          setPizzaria((prev) => (prev ? { ...prev, whatsapp_estado: estado } : prev));
        }
      }
    });
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, [pizzaria?.id]);

  // ============================================
  // Handlers
  // ============================================
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthErr(null);
    try {
      const u = await authApi.login(authEmail, authSenha);
      setUser(u);
      setAuthEmail("");
      setAuthSenha("");
    } catch (e: any) {
      setAuthErr(e.status === 401 ? "Email ou senha inválidos." : (e.message || "Erro ao logar."));
    }
    setAuthLoading(false);
  }

  function handleLogout() {
    clearTokens();
    setUser(null);
    setPizzaria(null);
    wsRef.current?.close();
  }

  async function handleToggleBot() {
    if (!pizzaria) return;
    const updated = await pizzariasApi.update(pizzaria.id, { bot_ativo_global: !pizzaria.bot_ativo_global });
    setPizzaria(updated);
  }

  // ============================================
  // Render: bootstrap (loading)
  // ============================================
  if (bootstrap) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
      </div>
    );
  }

  // ============================================
  // Render: login
  // ============================================
  if (!user) {
    // Sem LandingPage: usuário não autenticado cai direto na tela de login.
    return (
      <LoginScreen
        email={authEmail}
        setEmail={setAuthEmail}
        senha={authSenha}
        setSenha={setAuthSenha}
        loading={authLoading}
        err={authErr}
        onSubmit={handleLogin}
      />
    );
  }

  // ============================================
  // Render: painel da plataforma (admin sem pizzaria ativa)
  // ============================================
  if (user.is_platform_admin && !pizzaria) return (
    <PlatformAdminView
      userName={user.nome}
      pizzarias={pizzarias}
      onRefresh={() => loadPizzarias().then(() => {})}
      onEnter={async (p) => {
        // Busca o estado FRESCO ao entrar (ex.: suspensa/vencimento podem ter
        // mudado no admin) — senão o painel entraria com um objeto em cache.
        try { setPizzaria(await pizzariasApi.get(p.id)); }
        catch { setPizzaria(p); }
      }}
      onLogout={handleLogout}
    />
  );

  // ============================================
  // Render: onboarding (operador sem pizzaria)
  // ============================================
  if (!pizzaria) return (
    <OnboardingScreen
      userName={user.nome}
      isPlatformAdmin={user.is_platform_admin}
      onLogout={handleLogout}
      onCreated={(p) => setPizzaria(p)}
    />
  );

  // ============================================
  // Render: painel completo
  // ============================================
  const meta = NAV_PAGE_META[nav];

  return (
    <AppShell
      activeNav={nav}
      onNavChange={(k) => {
        // Admin: a aba "Admin" volta para o painel da plataforma
        if (k === "admin" && user.is_platform_admin) {
          setPizzaria(null);
          loadPizzarias();
          setNav("pedidos");
          return;
        }
        setNav(k as NavKey);
      }}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      badges={{
        conversas: conversations.filter((c) => (c.unreadCount ?? 0) > 0).length,
        pedidos: orders.filter((o) => o.status === "novo").length,
      }}
      pizzariaNome={pizzaria.nome}
      pizzariaLogo={pizzaria.logo_url ?? undefined}
      userName={user.nome}
      userEmail={user.email}
      botAtivo={pizzaria.bot_ativo_global}
      onToggleBot={handleToggleBot}
      whatsappEstado={pizzaria.instancia ? pizzaria.whatsapp_estado ?? null : null}
      onWhatsAppClick={() => setNav("negocio")}
      isPlatformAdmin={user.is_platform_admin}
      onLogout={handleLogout}
      notifPermission={"default" as NotificationPermission}
      onEnableNotifications={() => {}}
    >
      <AssinaturaAviso
        venceEm={pizzaria.plano_vence_em ?? null}
        suspensa={pizzaria.suspensa ?? false}
        suspensaMotivo={pizzaria.suspensa_motivo ?? null}
      />

      {nav === "conversas" && <ConversasViewV2 pizzariaId={pizzaria.id} liveEvent={liveEvent}/>}
      {nav === "analise"   && <MetricasView pizzariaId={pizzaria.id}/>}
      {nav === "pedidos"   && (
        <PedidosViewV2
          pizzariaId={pizzaria.id}
          columnNames={pizzaria.nomes_colunas ?? undefined}
          liveEvent={liveEvent}
          onNavigate={(k) => setNav(k as NavKey)}
          onboarding={[
            {
              id: "menu", title: "Cadastre seu cardápio",
              description: "Adicione pelo menos 3 produtos",
              done: productCount >= 3, action: () => setNav("cardapio"),
            },
            {
              id: "wpp", title: "Conecte o WhatsApp",
              description: "Defina a instância Evolution em Meu Negócio",
              done: Boolean(pizzaria.instancia), action: () => setNav("negocio"),
            },
            {
              id: "pay", title: "Configure pagamento",
              description: "Mercado Pago ou Asaas",
              done: pizzaria.gateway_pagamento !== "manual" && Boolean(pizzaria.mp_access_token || pizzaria.asaas_api_key),
              action: () => setNav("negocio"),
            },
            {
              id: "atendente", title: "Personalize a atendente",
              description: "Defina nome, estilo e diferenciais",
              done: atendenteOk, action: () => setNav("negocio"),
            },
          ]}
        />
      )}
      {nav === "cardapio"  && <CardapioViewV2 pizzariaId={pizzaria.id}/>}
      {nav === "negocio"   && (
        <MeuNegocioViewV2 pizzaria={pizzaria} onUpdated={setPizzaria}/>
      )}
      {nav === "ajuda"     && <AjudaView/>}
      {nav === "admin" && user.is_platform_admin && (
        <div className="p-6 text-center text-slate-500">
          Painel SaaS admin — em breve via API nova.
        </div>
      )}
    </AppShell>
  );
}

// ============================================
// Aviso sutil de assinatura (atraso / suspensão) no painel do dono
// ============================================
function AssinaturaAviso({ venceEm, suspensa, suspensaMotivo }: {
  venceEm: string | null;
  suspensa: boolean;
  suspensaMotivo?: string | null;
}) {
  // ---- Suspensão: aviso PROMINENTE e fixo (não pode passar despercebido) ----
  if (suspensa) {
    return (
      <div className="sticky top-0 z-20 mx-3 md:mx-6 mt-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3.5 flex items-start gap-3 shadow-sm">
        <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm md:text-base font-bold text-red-800">Seu painel está suspenso</p>
          <p className="text-xs md:text-sm text-red-700 mt-1 leading-snug">
            O atendimento automático no WhatsApp está <strong>desligado</strong>
            {suspensaMotivo ? <> — motivo: <strong>{suspensaMotivo}</strong></> : null}.
            {" "}Para reativar e obter mais informações, entre em contato com o administrador / suporte.
          </p>
        </div>
      </div>
    );
  }

  // ---- Vencimento de assinatura: aviso discreto ----
  if (!venceEm) return null;
  const dias = Math.ceil((new Date(venceEm).getTime() - Date.now()) / 86_400_000);
  // Só mostra se vencida (dias<0) ou bem perto (<=3 dias).
  if (dias > 3) return null;

  let cls = "bg-amber-50 border-amber-200 text-amber-800";
  let msg = `Sua assinatura vence em ${dias} dia(s). Fique atento para não interromper o atendimento.`;
  if (dias < 0) {
    cls = "bg-red-50 border-red-200 text-red-800";
    msg = `Sua assinatura está em atraso há ${Math.abs(dias)} dia(s). Regularize para evitar a suspensão do atendimento.`;
  }

  return (
    <div className={`mx-4 md:mx-6 mt-3 flex items-center gap-2 border ${cls} px-3 py-2 rounded-lg text-xs`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
      <span className="leading-snug">{msg}</span>
    </div>
  );
}

// ============================================
// Tela de login
// ============================================
function LoginScreen(props: {
  email: string; setEmail: (v: string) => void;
  senha: string; setSenha: (v: string) => void;
  loading: boolean; err: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack?: () => void;
}) {
  return (
    <div className="min-h-screen relative flex items-center justify-center bg-slate-950 overflow-hidden font-sans">
      {/* Elementos de background decorativos (Glows neons sutis) */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Card Principal Glassmorphic */}
      <div className="relative bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl shadow-2xl p-10 w-full max-w-md transition-all duration-300 hover:border-slate-700/60 mx-4">
        
        {/* Cabeçalho */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-orange-500/25 mb-4">
            <Pizza className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">PizzaBot</h1>
          <p className="text-sm text-slate-400 mt-1">Gerencie seus pedidos com inteligência</p>
        </div>

        {/* Formulário */}
        <form onSubmit={props.onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <span className="text-xs text-slate-300 font-semibold tracking-wider uppercase">E-mail</span>
            <div className="relative group">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 group-focus-within:text-orange-500 transition-colors">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                required
                value={props.email}
                onChange={(e) => props.setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none transition-all"
                placeholder="exemplo@pizzaria.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-slate-300 font-semibold tracking-wider uppercase">Senha</span>
            <div className="relative group">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 group-focus-within:text-orange-500 transition-colors">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                value={props.senha}
                onChange={(e) => props.setSenha(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>

          {props.err && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2.5 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{props.err}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={props.loading}
            className="w-full py-3 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-orange-950/40 hover:shadow-orange-500/10 transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {props.loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Entrar no Painel"
            )}
          </button>
        </form>
        {props.onBack && (
          <button
            type="button"
            onClick={props.onBack}
            className="w-full mt-4 text-xs text-slate-500 hover:text-slate-300 font-medium transition-colors"
          >
            ← Voltar para a página inicial
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Onboarding — criar primeira pizzaria
// ============================================
function OnboardingScreen({ userName, isPlatformAdmin, onLogout, onCreated }: {
  userName: string;
  isPlatformAdmin: boolean;
  onLogout: () => void;
  onCreated: (p: BackendPizzaria) => void;
}) {
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [telefone, setTelefone] = useState("");
  const [instancia, setInstancia] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const p = await pizzariasApi.create({
        nome: nome.trim(),
        endereco: endereco.trim() || undefined,
        telefone_admin: telefone.trim() || undefined,
        instancia: instancia.trim() || undefined,
      });
      onCreated(p);
    } catch (e: any) {
      setErr(
        e.status === 403
          ? "Apenas administradores da plataforma podem criar pizzarias por enquanto."
          : e.message || "Erro ao criar pizzaria.",
      );
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pizza className="w-5 h-5 text-orange-500"/>
          <span className="font-semibold text-sm text-slate-800">PizzaBot</span>
        </div>
        <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
          <LogOut className="w-3.5 h-3.5"/> Sair
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Bem-vindo, {userName}!</h2>
          <p className="text-sm text-slate-500 mb-5">
            {isPlatformAdmin
              ? "Vamos criar sua primeira pizzaria."
              : "Você ainda não está vinculado a nenhuma pizzaria. Peça pro admin te adicionar como operador."}
          </p>

          {isPlatformAdmin ? (
            <form onSubmit={submit} className="space-y-3">
              <Field label="Nome da pizzaria" required>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Ex.: Pizzaria do Zé"/>
              </Field>
              <Field label="Endereço">
                <input value={endereco} onChange={(e) => setEndereco(e.target.value)} className={inputCls} placeholder="Rua, número, bairro"/>
              </Field>
              <Field label="WhatsApp do dono">
                <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputCls} placeholder="5511999999999"/>
              </Field>
              <Field label="Instância Evolution (opcional)">
                <input value={instancia} onChange={(e) => setInstancia(e.target.value)} className={inputCls} placeholder="pizzaria-do-ze"/>
              </Field>
              {err && (
                <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 px-2.5 py-2 rounded text-xs">
                  <AlertCircle className="w-3.5 h-3.5"/> {err}
                </div>
              )}
              <button
                type="submit" disabled={loading || !nome.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-md py-2 font-medium text-sm disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                Criar pizzaria
              </button>
            </form>
          ) : (
            <button onClick={onLogout} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md py-2 font-medium text-sm">
              Sair
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none";

function Field({ label, children, required }: any) {
  return (
    <label className="block">
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
