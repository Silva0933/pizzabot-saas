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
import { Pizza, Loader2, AlertCircle, LogOut, Mail, Lock, Sparkles } from "lucide-react";
import {
  AppShell, NAV_PAGE_META,
} from "./components/v2";
// LandingPage desconectada por opção do dono (vai direto pro login). O componente
// continua existindo em ./components/v2 — pra reativar, reimporte-o aqui.
import type { NavKey } from "./components/v2/Sidebar";
import { ConversasViewV2 } from "./components/v2/ConversasViewV2";
import { PedidosViewV2 } from "./components/v2/PedidosViewV2";
import { CardapioViewV2 } from "./components/v2/CardapioViewV2";
import { CardapioPublico } from "./components/v2/CardapioPublico";
import { ClientesView } from "./components/v2/ClientesView";
import { TemasView } from "./components/v2/TemasView";
import { DriverApp } from "./components/driver/DriverApp";
import { MeuNegocioViewV2, NegocioTab } from "./components/v2/MeuNegocioViewV2";
import { EntregadoresView } from "./components/v2/EntregadoresView";
import { PlatformAdminView } from "./components/v2/PlatformAdminView";
import { MetricasView } from "./components/v2/MetricasView";
import { AjudaView } from "./components/v2/AjudaView";
import { AssinaturaView } from "./components/v2/AssinaturaView";
import {
  authApi, pizzariasApi, cardapioApi, pedidosApi, conversasApi, personalityApi,
  connectWebSocket, BackendPizzaria, UserMe, WsEvent,
  backendToOrder, backendToConversation,
  clearTokens, getToken, ApiError,
} from "./lib/api";
import { calcEstaAberto } from "./lib/businessHours";

// ============================================
// Sinal sonoro de pedidos (Web Audio API)
// ============================================
let notificationAudioContext: AudioContext | null = null;

function getNotificationAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  notificationAudioContext ??= new AudioContextClass();
  return notificationAudioContext;
}

function unlockNotificationSound() {
  const ctx = getNotificationAudioContext();
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
}

function playNotificationSound(type: "novo" | "confirmado") {
  try {
    const ctx = getNotificationAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    if (type === "novo") {
      // Alerta de pedido: três bipes curtos, altos e bem diferentes do som de confirmação.
      // O volume final ainda respeita o volume definido pelo usuário no dispositivo.
      const master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      master.gain.setValueAtTime(0.27, now);
      compressor.threshold.setValueAtTime(-18, now);
      compressor.knee.setValueAtTime(12, now);
      compressor.ratio.setValueAtTime(8, now);
      master.connect(compressor);
      compressor.connect(ctx.destination);

      [
        { at: 0, freq: 1046.5, duration: 0.12 },
        { at: 0.2, freq: 1046.5, duration: 0.12 },
        { at: 0.4, freq: 1318.51, duration: 0.24 },
      ].forEach(({ at, freq, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startsAt = now + at;
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, startsAt);
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.exponentialRampToValueAtTime(0.9, startsAt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(startsAt);
        osc.stop(startsAt + duration + 0.02);
      });
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
  // Rota pública do Cardápio Digital (/m/:slug)
  // ============================================
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const menuMatch = path.match(/^\/m\/([a-z0-9-]+)/i);
  if (menuMatch) {
    return <CardapioPublico slug={menuMatch[1]} />;
  }

  // ============================================
  // Painel Admin (continua normalmente)
  // ============================================
  return <AdminApp />;
}

function AdminApp() {
  // ============================================
  // Auth
  // ============================================
  const [bootstrap, setBootstrap] = useState(true);
  const [user, setUser] = useState<UserMe | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authSenha, setAuthSenha] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");

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
  const [negocioTab, setNegocioTab] = useState<NegocioTab>("atendente");
  const [openWhatsAppDirectly, setOpenWhatsAppDirectly] = useState(false);
  const [openPaymentDirectly, setOpenPaymentDirectly] = useState(false);
  const [openCardapioNovo, setOpenCardapioNovo] = useState(false);

  function handleMenuClick() {
    setNav("cardapio");
    setOpenCardapioNovo(true);
  }

  function handleWhatsAppClick() {
    setNav("negocio");
    setNegocioTab("geral");
    setOpenWhatsAppDirectly(true);
    setOpenPaymentDirectly(false);
  }

  function handlePaymentClick() {
    setNav("negocio");
    setNegocioTab("geral");
    setOpenPaymentDirectly(true);
    setOpenWhatsAppDirectly(false);
  }

  function handleAtendenteClick() {
    setNav("negocio");
    setNegocioTab("atendente");
    setOpenWhatsAppDirectly(false);
    setOpenPaymentDirectly(false);
  }
  const [liveEvent, setLiveEvent] = useState<WsEvent | null>(null);
  const [pendingOrderAlerts, setPendingOrderAlerts] = useState(0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );
  const wsRef = useRef<WebSocket | null>(null);
  const pendingOrderKeysRef = useRef<Set<string>>(new Set());
  const desktopNotificationsRef = useRef<Notification[]>([]);

  const orderAlertStorageKey = pizzaria
    ? `pizzabot:pending-order-alert:${pizzaria.id}`
    : null;

  function acknowledgeOrderAlerts() {
    setPendingOrderAlerts(0);
    pendingOrderKeysRef.current.clear();
    if (orderAlertStorageKey) localStorage.removeItem(orderAlertStorageKey);
    desktopNotificationsRef.current.forEach((notification) => notification.close());
    desktopNotificationsRef.current = [];
  }

  function registerNewOrderAlert(ev: WsEvent) {
    if (!pizzaria) return;
    const payload = ev.payload ?? {};
    const stableId = payload.pedido_id || payload.numero_pedido;
    const eventId = stableId || `${payload.telefone || "pedido"}-${Date.now()}`;
    const key = `${pizzaria.id}:${eventId}`;
    if (pendingOrderKeysRef.current.has(key)) return;
    pendingOrderKeysRef.current.add(key);
    setPendingOrderAlerts((current) => {
      const next = current + 1;
      if (orderAlertStorageKey) {
        localStorage.setItem(orderAlertStorageKey, JSON.stringify({
          count: next,
          keys: [...pendingOrderKeysRef.current],
          updatedAt: Date.now(),
        }));
      }
      return next;
    });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notification = new Notification("Novo pedido recebido", {
        body: payload.numero_pedido
          ? `Pedido #${payload.numero_pedido} aguardando atendimento.`
          : "Há um novo pedido aguardando atendimento.",
        tag: `novo-pedido-${eventId}`,
        requireInteraction: true,
      });
      notification.onclick = () => {
        window.focus();
        acknowledgeOrderAlerts();
        setNav("pedidos");
        notification.close();
      };
      desktopNotificationsRef.current.push(notification);
    }
  }

  async function handleEnableNotifications() {
    unlockNotificationSound();
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
  }

  // O navegador só libera áudio depois de uma interação do usuário.
  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Recupera um alerta não atendido caso o painel seja recarregado.
  useEffect(() => {
    pendingOrderKeysRef.current.clear();
    setPendingOrderAlerts(0);
    desktopNotificationsRef.current.forEach((notification) => notification.close());
    desktopNotificationsRef.current = [];
    if (!orderAlertStorageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(orderAlertStorageKey) || "null");
      const isRecent = saved?.updatedAt && Date.now() - saved.updatedAt < 86_400_000;
      if (isRecent && saved.count > 0) {
        pendingOrderKeysRef.current = new Set(saved.keys || []);
        setPendingOrderAlerts(saved.count);
      } else {
        localStorage.removeItem(orderAlertStorageKey);
      }
    } catch {
      localStorage.removeItem(orderAlertStorageKey);
    }
  }, [orderAlertStorageKey]);

  // Repete o toque até o operador atender o alerta ou abrir uma conversa.
  useEffect(() => {
    if (pendingOrderAlerts <= 0) return;
    playNotificationSound("novo");
    const alarm = window.setInterval(() => playNotificationSound("novo"), 3000);
    return () => window.clearInterval(alarm);
  }, [pendingOrderAlerts]);

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
      // Novo pedido → inicia alerta persistente e atualiza a fila.
      if (ev.tipo === "pedido.novo") {
        registerNewOrderAlert(ev);
        pedidosApi.list(pizzaria.id).then((p) => setOrders(p.map(backendToOrder))).catch(() => {});
      } else if (ev.tipo === "pedido.atualizado") {
        const statusNovo = ev.payload?.status_novo;
        if (statusNovo === "novo") registerNewOrderAlert(ev);
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

  async function handleSetLojaStatus(status: boolean | null) {
    if (!pizzaria) return;
    const nextAberto = calcEstaAberto(pizzaria.horario_funcionamento, status);
    setPizzaria({
      ...pizzaria,
      aberto_manual: status,
      aberto_agora: nextAberto,
    });
    try {
      const updated = await pizzariasApi.update(pizzaria.id, { aberto_manual: status });
      setPizzaria(updated);
    } catch (e) {
      console.error("Erro ao atualizar status da loja:", e);
    }
  }

  // Recalcula o status da loja automaticamente conforme o relógio e os horários programados
  useEffect(() => {
    if (!pizzaria) return;
    const interval = setInterval(() => {
      setPizzaria((prev) => {
        if (!prev) return prev;
        const calc = calcEstaAberto(prev.horario_funcionamento, prev.aberto_manual);
        if (calc !== prev.aberto_agora) {
          return { ...prev, aberto_agora: calc };
        }
        return prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, [pizzaria?.id, pizzaria?.aberto_manual, pizzaria?.horario_funcionamento]);

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
    if (authMode === "signup") {
      return (
        <SignupScreen
          onDone={(u) => setUser(u)}
          onBackToLogin={() => setAuthMode("login")}
        />
      );
    }
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
        onSignup={() => setAuthMode("signup")}
      />
    );
  }

  // ============================================
  // Render: painel do entregador (conta de entregador)
  // ============================================
  if (user.entregador) {
    return <DriverApp user={user} onLogout={handleLogout} />;
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
        if (k !== "negocio") {
          setOpenWhatsAppDirectly(false);
          setOpenPaymentDirectly(false);
        }
        if (k !== "cardapio") {
          setOpenCardapioNovo(false);
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
      lojaAberta={pizzaria.aberto_agora ?? true}
      lojaStatusManual={pizzaria.aberto_manual ?? null}
      onSetLojaStatus={handleSetLojaStatus}
      whatsappEstado={pizzaria.instancia ? pizzaria.whatsapp_estado ?? null : null}
      onWhatsAppClick={handleWhatsAppClick}
      isTrial={pizzaria.plano === "trial" && !(pizzaria.suspensa ?? false)}
      onTrialClick={() => setNav("assinatura")}
      isPlatformAdmin={user.is_platform_admin}
      onLogout={handleLogout}
      notifPermission={notifPermission}
      onEnableNotifications={handleEnableNotifications}
      orderAlertCount={pendingOrderAlerts}
      onOrderAlertClick={() => {
        acknowledgeOrderAlerts();
        setNav("pedidos");
      }}
    >
      <AssinaturaAviso
        venceEm={pizzaria.plano_vence_em ?? null}
        suspensa={pizzaria.suspensa ?? false}
        suspensaMotivo={pizzaria.suspensa_motivo ?? null}
      />

      <TrialBanner
        plano={pizzaria.plano}
        venceEm={pizzaria.trial_fim ?? pizzaria.plano_vence_em ?? null}
        suspensa={pizzaria.suspensa ?? false}
        onAssinar={() => setNav("assinatura")}
      />

      {nav === "conversas" && (
        <ConversasViewV2
          pizzariaId={pizzaria.id}
          liveEvent={liveEvent}
          onConversationOpen={acknowledgeOrderAlerts}
        />
      )}
      {nav === "analise"   && <MetricasView pizzariaId={pizzaria.id}/>}
      {nav === "pedidos"   && (
        <PedidosViewV2
          pizzariaId={pizzaria.id}
          columnNames={pizzaria.nomes_colunas ?? undefined}
          liveEvent={liveEvent}
          onNavigate={(k) => setNav(k as NavKey)}
          onboardingKey={pizzaria.id}
          onboarding={[
            {
              id: "menu", title: "Cadastre seu cardápio",
              description: "Adicione pelo menos 3 produtos",
              done: productCount >= 3, action: handleMenuClick,
              actionLabel: "Cadastrar",
            },
            {
              id: "wpp", title: "Conecte o WhatsApp",
              description: "Escaneie o QR code em Meu Negócio para ativar o atendimento",
              // Só conta como feito quando a conexão está ATIVA ('open') — ter o
              // nome da instância salvo não significa que o QR foi lido.
              done: pizzaria.whatsapp_estado === "open", action: handleWhatsAppClick,
              actionLabel: "Conectar",
            },
            {
              id: "pay", title: "Configure pagamento",
              description: "Mercado Pago ou Asaas (opcional — pode pular)",
              done: pizzaria.gateway_pagamento !== "manual" && Boolean(pizzaria.mp_access_token || pizzaria.asaas_api_key),
              action: handlePaymentClick,
              actionLabel: "Configurar",
            },
            {
              id: "atendente", title: "Personalize a atendente",
              description: "Defina nome, estilo e diferenciais",
              done: atendenteOk, action: handleAtendenteClick,
              actionLabel: "Personalizar",
            },
          ]}
        />
      )}
      {nav === "clientes" && <ClientesView pizzariaId={pizzaria.id}/>}
      {nav === "cardapio"  && (
        <CardapioViewV2
          pizzariaId={pizzaria.id}
          pizzaria={pizzaria}
          onPizzariaUpdated={setPizzaria}
          autoCreate={openCardapioNovo}
          onAutoCreated={() => setOpenCardapioNovo(false)}
        />
      )}
      {nav === "temas"     && <TemasView pizzaria={pizzaria} onUpdated={setPizzaria}/>}
      {nav === "negocio"   && (
        <MeuNegocioViewV2
          pizzaria={pizzaria}
          onUpdated={setPizzaria}
          initialTab={negocioTab}
          openWhatsApp={openWhatsAppDirectly}
          onWhatsAppOpened={() => setOpenWhatsAppDirectly(false)}
          openPayment={openPaymentDirectly}
          onPaymentOpened={() => setOpenPaymentDirectly(false)}
        />
      )}
      {nav === "entregadores" && <EntregadoresView pizzariaId={pizzaria.id}/>}
      {nav === "assinatura" && <AssinaturaView pizzariaId={pizzaria.id}/>}
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
// Banner de período de teste (trial) — informa o status e oferece assinar.
// ============================================
function TrialBanner({ plano, venceEm, suspensa, onAssinar }: {
  plano: string;
  venceEm: string | null;
  suspensa: boolean;
  onAssinar: () => void;
}) {
  // Só no trial e quando não está suspensa (suspensão tem aviso próprio acima).
  if (plano !== "trial" || suspensa) return null;

  const dias = venceEm
    ? Math.ceil((new Date(venceEm).getTime() - Date.now()) / 86_400_000)
    : null;
  const venceu = dias !== null && dias < 0;
  const restante =
    dias === null ? "" : venceu
      ? `expirou há ${Math.abs(dias)} dia(s)`
      : dias === 0
        ? "expira hoje"
        : `${dias} dia(s) restante(s)`;

  return (
    <div className="mx-4 md:mx-6 mt-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50/60 px-4 py-3 flex items-center gap-3">
      <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100">
        <Sparkles className="w-4 h-4 text-violet-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-violet-900">
          Você está no período de teste{restante ? ` · ${restante}` : ""}
        </p>
        <p className="text-xs text-violet-700/90 mt-0.5 leading-snug">
          {venceu
            ? "Seu teste acabou. Assine um plano para manter o atendimento ativo."
            : "Aproveite tudo do PizzaBot. Assine um plano quando quiser para não interromper o atendimento."}
        </p>
      </div>
      <button
        type="button"
        onClick={onAssinar}
        className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-xs md:text-sm font-semibold px-3.5 py-2 rounded-lg"
      >
        Assinar um plano
      </button>
    </div>
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
      <div className="mx-3 md:mx-6 mt-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3.5 flex items-start gap-3 shadow-sm">
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
  onSignup?: () => void;
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
        {props.onSignup && (
          <p className="mt-5 text-center text-xs text-slate-400">
            Ainda não tem conta?{" "}
            <button
              type="button"
              onClick={props.onSignup}
              className="text-orange-400 hover:text-orange-300 font-semibold transition-colors"
            >
              Teste grátis por 14 dias
            </button>
          </p>
        )}
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
// Tela de cadastro público (trial 14 dias)
// ============================================
function SignupScreen({ onDone, onBackToLogin }: {
  onDone: (u: UserMe) => void;
  onBackToLogin: () => void;
}) {
  const [nomePizzaria, setNomePizzaria] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const u = await authApi.signup({
        nome_pizzaria: nomePizzaria.trim(),
        email: email.trim(),
        senha,
      });
      onDone(u);
    } catch (e: any) {
      setErr(
        e.status === 409 ? "Este e-mail já tem conta. Faça login." :
        e.status === 429 ? "Muitos cadastros agora. Tente novamente mais tarde." :
        (e.message || "Erro ao criar conta.")
      );
      setLoading(false);
    }
  }

  const inputCls = "w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none transition-all";

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-slate-950 overflow-hidden font-sans">
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-3xl shadow-2xl p-10 w-full max-w-md mx-4">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-orange-500/25 mb-4">
            <Pizza className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Teste grátis por 14 dias</h1>
          <p className="text-sm text-slate-400 mt-1">
            Sua atendente de IA no WhatsApp em minutos. Sem cartão de crédito.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs text-slate-300 font-semibold tracking-wider uppercase">Nome da pizzaria</span>
            <input required minLength={2} maxLength={80} value={nomePizzaria}
              onChange={(e) => setNomePizzaria(e.target.value)}
              className={inputCls} placeholder="Pizzaria do João" />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-slate-300 font-semibold tracking-wider uppercase">E-mail</span>
            <input type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls} placeholder="voce@suapizzaria.com" />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-slate-300 font-semibold tracking-wider uppercase">Senha</span>
            <input type="password" required minLength={8} value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={inputCls} placeholder="Mínimo 8 caracteres" />
          </div>

          {err && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2.5 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-orange-950/40 transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar minha conta grátis"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-400">
          Já tem conta?{" "}
          <button type="button" onClick={onBackToLogin}
            className="text-orange-400 hover:text-orange-300 font-semibold transition-colors">
            Entrar
          </button>
        </p>
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
