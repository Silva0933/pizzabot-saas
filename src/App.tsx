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
import { Pizza, Loader2, AlertCircle, LogOut } from "lucide-react";
import {
  AppShell, NAV_PAGE_META, InicioDashboard,
} from "./components/v2";
import type { NavKey } from "./components/v2/Sidebar";
import { ConversasViewV2 } from "./components/v2/ConversasViewV2";
import { PedidosViewV2 } from "./components/v2/PedidosViewV2";
import { CardapioViewV2 } from "./components/v2/CardapioViewV2";
import { MeuNegocioViewV2 } from "./components/v2/MeuNegocioViewV2";
import { PlatformAdminView } from "./components/v2/PlatformAdminView";
import {
  authApi, pizzariasApi, cardapioApi, pedidosApi, conversasApi,
  connectWebSocket, BackendPizzaria, UserMe, WsEvent,
  backendToPizzeria, backendToOrder, backendToConversation,
  clearTokens, getToken, ApiError,
} from "./lib/api";

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
  const [nav, setNav] = useState<NavKey>("inicio");
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
      const [prods, peds, convs] = await Promise.all([
        cardapioApi.list(p.id),
        pedidosApi.list(p.id),
        conversasApi.list(p.id),
      ]);
      setProductCount(prods.length);
      setOrders(peds.map(backendToOrder));
      setConversations(convs.map(backendToConversation));
    } catch (e) { console.warn("refreshData:", e); }
  }

  useEffect(() => {
    if (pizzaria) refreshData(pizzaria);
  }, [pizzaria?.id]);

  // ============================================
  // WebSocket
  // ============================================
  useEffect(() => {
    if (!pizzaria) return;
    const ws = connectWebSocket(pizzaria.id, (ev) => {
      setLiveEvent(ev);
      // Eventos que mexem em dados gerais → refresh
      if (ev.tipo === "pedido.novo" || ev.tipo === "pedido.atualizado") {
        pedidosApi.list(pizzaria.id).then((p) => setOrders(p.map(backendToOrder))).catch(() => {});
      }
      if (ev.tipo === "conversa.atualizada" || ev.tipo === "mensagem.nova") {
        conversasApi.list(pizzaria.id).then((c) => setConversations(c.map(backendToConversation))).catch(() => {});
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
  if (!user) return (
    <LoginScreen
      email={authEmail} setEmail={setAuthEmail}
      senha={authSenha} setSenha={setAuthSenha}
      loading={authLoading} err={authErr}
      onSubmit={handleLogin}
    />
  );

  // ============================================
  // Render: painel da plataforma (admin sem pizzaria ativa)
  // ============================================
  if (user.is_platform_admin && !pizzaria) return (
    <PlatformAdminView
      userName={user.nome}
      pizzarias={pizzarias}
      onRefresh={() => loadPizzarias().then(() => {})}
      onEnter={(p) => setPizzaria(p)}
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
  const pizzeriaOld = backendToPizzeria(pizzaria);

  return (
    <AppShell
      activeNav={nav}
      onNavChange={(k) => {
        // Admin: a aba "Admin" volta para o painel da plataforma
        if (k === "admin" && user.is_platform_admin) {
          setPizzaria(null);
          loadPizzarias();
          setNav("inicio");
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
      isPlatformAdmin={user.is_platform_admin}
      onLogout={handleLogout}
      notifPermission={"default" as NotificationPermission}
      onEnableNotifications={() => {}}
    >
      {nav === "inicio" && (
        <InicioDashboard
          pizzeria={pizzeriaOld}
          orders={orders}
          conversations={conversations}
          productCount={productCount}
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
              done: false, action: () => setNav("negocio"),
            },
          ]}
        />
      )}

      {nav === "conversas" && <ConversasViewV2 pizzariaId={pizzaria.id} liveEvent={liveEvent}/>}
      {nav === "pedidos"   && <PedidosViewV2 pizzariaId={pizzaria.id} columnNames={pizzaria.nomes_colunas ?? undefined} liveEvent={liveEvent}/>}
      {nav === "cardapio"  && <CardapioViewV2 pizzariaId={pizzaria.id}/>}
      {nav === "negocio"   && (
        <MeuNegocioViewV2 pizzaria={pizzaria} onUpdated={setPizzaria}/>
      )}
      {nav === "admin" && user.is_platform_admin && (
        <div className="p-6 text-center text-slate-500">
          Painel SaaS admin — em breve via API nova.
        </div>
      )}
    </AppShell>
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
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center">
            <Pizza className="w-5 h-5 text-white"/>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">PizzaBot</h1>
            <p className="text-xs text-slate-500">Painel da pizzaria</p>
          </div>
        </div>
        <form onSubmit={props.onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-600 font-medium">Email</span>
            <input
              type="email" required value={props.email}
              onChange={(e) => props.setEmail(e.target.value)}
              className="mt-0.5 w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none"
              placeholder="voce@email.com"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600 font-medium">Senha</span>
            <input
              type="password" required value={props.senha}
              onChange={(e) => props.setSenha(e.target.value)}
              className="mt-0.5 w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none"
            />
          </label>
          {props.err && (
            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 px-2.5 py-2 rounded text-xs">
              <AlertCircle className="w-3.5 h-3.5"/> {props.err}
            </div>
          )}
          <button
            type="submit" disabled={props.loading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-md py-2 font-medium text-sm disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {props.loading && <Loader2 className="w-4 h-4 animate-spin"/>}
            Entrar
          </button>
        </form>
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
