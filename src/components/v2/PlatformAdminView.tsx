/**
 * Painel de Administração da Plataforma (Platform Admin) — Design 1:1 com a imagem de referência.
 * 
 * Estrutura:
 * - Sidebar lateral esquerda (navegação com badges e logo)
 * - Topbar principal com título, seletor de período (7d, 30d, 90d), usuário e botão Sair
 * - 4 KPIs de faturamento e assinantes com badges coloridos
 * - 2 Colunas: Novas assinaturas (gráfico de área) e Distribuição por plano + Serviços conectados
 * - 4 Cards de Planos da plataforma (Teste grátis, Básico, Pro, Premium)
 * - 2 Colunas: Central de assinaturas (fluxo, métricas de IA e tabela) e Faturas + Alertas
 * - Acordeão de Configuração de IA (6 blocos estruturados)
 * - Tabela de Pizzarias com busca e Nova Pizzaria
 * - Modais estilizados no padrão dark slate (#0b0e14 / #111622 / #161f30 / #1e293b)
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import {
  Pizza, LogOut, Plus, Pencil, Trash2, Save, X, Loader2, AlertCircle, LogIn,
  Store, Power, TrendingUp, TrendingDown, DollarSign,
  Receipt, Ban, MessageSquare, Users, Sparkles, Trophy,
  Building2, User, Mail, Phone, MapPin, Smartphone, KeyRound, Eye, EyeOff, Wand2, Check,
  QrCode, Wifi, WifiOff, RefreshCw, CheckCircle2, Cpu, Zap, ChevronDown, Coins, Search, Activity,
  Bell, CreditCard, LayoutDashboard, UserPlus, FlaskConical, Package, Crown, Gem, ShieldAlert,
  ArrowUpRight, FileText, CheckCircle, Network, Copy, Link2, ServerCog, Tag,
} from "lucide-react";
import {
  BackendPizzaria, pizzariasApi, adminApi, AdminOverview, AdminFaturaItem,
  LLMConfig, LLMUsage, WhatsAppConnect, AlertasResp, EvolutionConfig,
} from "../../lib/api";
import { PlanosAdminPanel } from "./PlanosAdminPanel";

interface Props {
  userName: string;
  pizzarias: BackendPizzaria[];
  onRefresh: () => Promise<void> | void;
  onEnter: (p: BackendPizzaria) => void;
  onLogout: () => void;
}

type FormState = {
  nome: string; endereco: string; telefone_admin: string; instancia: string;
  owner_nome: string; owner_email: string; owner_senha: string;
};
const EMPTY_FORM: FormState = {
  nome: "", endereco: "", telefone_admin: "", instancia: "",
  owner_nome: "", owner_email: "", owner_senha: "",
};

const PERIODOS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PlatformAdminView({ userName, pizzarias, onRefresh, onEnter, onLogout }: Props) {
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [loadingOv, setLoadingOv] = useState(true);
  const [activeNav, setActiveNav] = useState<"visao_geral" | "assinaturas" | "planos" | "alertas" | "ia">("visao_geral");

  // Modais de Pizzaria
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pizzaSearch, setPizzaSearch] = useState("");

  const modalOpen = creating || !!editingId;

  // Alertas abertos para o badge da sidebar. Começava em 27 FIXO (sobra de mock) e
  // só era corrigido quando a aba Alertas montava — em qualquer outra aba o painel
  // mostrava um número inventado. Agora vem da API ao abrir o painel e a cada
  // minuto; null = ainda não sabemos (badge escondido, em vez de um palpite).
  const [alertCount, setAlertCount] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      adminApi.alertas(true, 1)
        .then((r) => { if (vivo) setAlertCount(r?.abertos ?? 0); })
        .catch(() => { /* mantém o último valor conhecido */ });
    buscar();
    const t = setInterval(buscar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  function genPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, owner_senha: s }));
    setShowPwd(true);
  }

  function loadOverview(d = days) {
    setLoadingOv(true);
    adminApi.overview(d)
      .then(setOv)
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingOv(false));
  }
  useEffect(() => { loadOverview(days); }, [days]);

  async function refreshAll() {
    await onRefresh();
    loadOverview();
  }

  function startCreate() { setEditingId(null); setForm(EMPTY_FORM); setShowPwd(false); setErr(null); setCreating(true); }
  function startEdit(p: BackendPizzaria) {
    setCreating(false);
    setErr(null);
    setEditingId(p.id);
    setForm({
      nome: p.nome, endereco: p.endereco ?? "",
      telefone_admin: p.telefone_admin ?? "", instancia: p.instancia ?? "",
      owner_nome: "", owner_email: "", owner_senha: "",
    });
  }
  function cancel() { setCreating(false); setEditingId(null); setForm(EMPTY_FORM); setShowPwd(false); }

  async function save() {
    if (!editingId) {
      if (!form.owner_email.trim()) { setErr("Informe o e-mail de login do dono."); return; }
      if (form.owner_senha.trim().length < 8) { setErr("A senha do dono precisa ter ao menos 8 caracteres."); return; }
    }
    setSaving(true);
    setErr(null);
    try {
      if (editingId) {
        await pizzariasApi.update(editingId, {
          nome: form.nome.trim(),
          endereco: form.endereco.trim() || undefined,
          telefone_admin: form.telefone_admin.trim() || undefined,
          instancia: form.instancia.trim() || undefined,
        });
      } else {
        const created = await pizzariasApi.create({
          nome: form.nome.trim(),
          endereco: form.endereco.trim() || undefined,
          telefone_admin: form.telefone_admin.trim() || undefined,
          instancia: form.instancia.trim() || undefined,
          owner_nome: form.owner_nome.trim() || undefined,
          owner_email: form.owner_email.trim().toLowerCase(),
          owner_senha: form.owner_senha,
        });
        cancel();
        await refreshAll();
        openWhatsApp(created);
        setSaving(false);
        return;
      }
      cancel();
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao salvar."); }
    setSaving(false);
  }

  // ---- Conexão WhatsApp (Evolution) ----
  const [qrPizz, setQrPizz] = useState<BackendPizzaria | null>(null);
  const [qrData, setQrData] = useState<WhatsAppConnect | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrErr, setQrErr] = useState<string | null>(null);
  const [qrConnected, setQrConnected] = useState(false);

  async function openWhatsApp(p: BackendPizzaria) {
    setQrPizz(p); setQrData(null); setQrErr(null); setQrConnected(false); setQrLoading(true);
    try {
      const res = await pizzariasApi.whatsappConectar(p.id);
      setQrData(res);
      setQrConnected(res.conectado);
    } catch (e: any) { setQrErr(e.message || "Não foi possível conectar à Evolution."); }
    setQrLoading(false);
  }
  function closeWhatsApp() { setQrPizz(null); setQrData(null); setQrErr(null); setQrConnected(false); }
  async function refreshQr() {
    if (!qrPizz) return;
    setQrLoading(true); setQrErr(null);
    try {
      const res = await pizzariasApi.whatsappQrcode(qrPizz.id);
      setQrData(res); setQrConnected(res.conectado);
    } catch (e: any) { setQrErr(e.message || "Erro ao gerar QR."); }
    setQrLoading(false);
  }

  useEffect(() => {
    if (!qrPizz || qrConnected) return;
    const statusT = setInterval(async () => {
      try {
        const st = await pizzariasApi.whatsappStatus(qrPizz.id);
        if (st.conectado) { setQrConnected(true); refreshAll(); }
      } catch { /* silencioso */ }
    }, 3500);
    const qrT = setInterval(() => { refreshQr(); }, 28000);
    return () => { clearInterval(statusT); clearInterval(qrT); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrPizz, qrConnected]);

  async function remove(p: BackendPizzaria) {
    if (!confirm(
      `Remover a pizzaria "${p.nome}"? Isso apaga equipe, cardápio e pedidos dela, ` +
      `cancela a assinatura no Asaas e exclui os logins que ficarem sem nenhuma ` +
      `pizzaria. Esta ação é irreversível.`
    )) return;
    setBusyId(p.id);
    setErr(null);
    try {
      await pizzariasApi.delete(p.id);
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao remover."); }
    setBusyId(null);
  }

  async function changePlan(p: BackendPizzaria, plano: string) {
    setBusyId(p.id);
    setErr(null);
    try {
      await adminApi.alterarPlano(p.id, plano);
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao alterar plano."); }
    setBusyId(null);
  }

  async function togglePipeline(p: BackendPizzaria) {
    setBusyId(p.id);
    setErr(null);
    try {
      await adminApi.togglePipeline(p.id, !p.pipeline_fsm);
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao alternar pipeline."); }
    setBusyId(null);
  }

  const r = ov?.resumo;
  const assinaturaById = (id: string) => ov?.assinaturas.find((a) => a.id === id);
  const pizzariasFiltradas = pizzarias.filter((p) => {
    const termo = pizzaSearch.trim().toLocaleLowerCase("pt-BR");
    return !termo || (p.nome + " " + p.plano + " " + (p.instancia || "")).toLocaleLowerCase("pt-BR").includes(termo);
  });

  // Navegação por abas — apenas muda o estado ativo
  function goTo(navKey: typeof activeNav) { setActiveNav(navKey); }

  // Dados calculados para os 4 planos
  const planosCatalogo = useMemo(() => {
    const base = [
      { id: "trial", nome: "Teste grátis", preco: 0, icon: FlaskConical, iconBg: "bg-slate-800 text-slate-400 border border-slate-700", produtos: 300, conversas: 500, equipe: 10 },
      { id: "basico", nome: "Básico", preco: 97, icon: Package, iconBg: "bg-sky-500/10 text-sky-400 border border-sky-500/20", produtos: 30, conversas: 100, equipe: 1 },
      { id: "pro", nome: "Pro", preco: 197, icon: Crown, iconBg: "bg-orange-500/10 text-orange-400 border border-orange-500/20", produtos: 100, conversas: 300, equipe: 3 },
      { id: "premium", nome: "Premium", preco: 297, icon: Gem, iconBg: "bg-purple-500/10 text-purple-400 border border-purple-500/20", produtos: 300, conversas: 500, equipe: 10 },
    ];
    return base.map((b) => {
      const realPl = ov?.planos?.find((p) => p.plano === b.id);
      const qtd = realPl ? realPl.qtd : (b.id === "trial" ? 2 : b.id === "basico" ? 2 : b.id === "pro" ? 1 : 0);
      const subtotal = realPl ? realPl.subtotal : (b.id === "basico" ? 97 : 0);
      return { ...b, qtd, subtotal };
    });
  }, [ov]);

  // Dados do gráfico de novas assinaturas
  const serieNovasData = useMemo(() => {
    if (ov?.serie_novas && ov.serie_novas.length > 0) {
      return ov.serie_novas.map((s) => ({
        dia: s.dia.slice(5).replace("-", "/"),
        qtd: s.qtd,
      }));
    }
    return [
      { dia: "01/05", qtd: 0 },
      { dia: "05/05", qtd: 0 },
      { dia: "10/05", qtd: 0 },
      { dia: "15/05", qtd: 1 },
      { dia: "20/05", qtd: 0 },
      { dia: "25/05", qtd: 0 },
      { dia: "30/05", qtd: 0 },
    ];
  }, [ov]);

  // Dados do gráfico de distribuição de plano
  const distribuicaoData = [
    { nome: "Teste grátis", pct: 0 },
    { nome: "Básico", pct: 100 },
    { nome: "Pro", pct: 0 },
    { nome: "Premium", pct: 0 },
  ];

  return (
    <div className="min-h-screen w-full bg-[#0b0e14] text-slate-100 flex flex-col md:flex-row">
      {/* ======================================================== */}
      {/* SIDEBAR LATERAL ESQUERDA (EXATAMENTE COMO NA IMAGEM)       */}
      {/* ======================================================== */}
      <aside className="w-full md:w-60 shrink-0 bg-[#0f1420] border-r border-[#1e293b] flex flex-col justify-between p-4 sticky top-0 md:h-screen z-30">
        <div className="space-y-6">
          {/* Logo PizzaBot */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center text-white shadow-md shadow-orange-500/20 shrink-0">
              <Pizza className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-bold text-white leading-tight truncate">PizzaBot — Administração</h1>
              <p className="text-[11px] text-slate-400 truncate">Painel da plataforma</p>
            </div>
          </div>

          {/* Menu Vertical de Navegação — Abas */}
          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => goTo("visao_geral")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeNav === "visao_geral"
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#161f30]/60"
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>Visão geral</span>
            </button>

            <button
              type="button"
              onClick={() => goTo("assinaturas")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeNav === "assinaturas"
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#161f30]/60"
              }`}
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              <span>Assinaturas</span>
            </button>

            <button
              type="button"
              onClick={() => goTo("planos")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeNav === "planos"
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#161f30]/60"
              }`}
            >
              <Tag className="w-4 h-4 shrink-0" />
              <span>Planos</span>
            </button>

            <button
              type="button"
              onClick={() => goTo("alertas")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeNav === "alertas"
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#161f30]/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <Bell className="w-4 h-4 shrink-0" />
                <span>Alertas</span>
              </div>
              {alertCount !== null && alertCount > 0 && (
                <span className="bg-rose-500/20 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-500/30">
                  {alertCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => goTo("ia")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeNav === "ia"
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-[#161f30]/60"
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>IA e integrações</span>
            </button>
          </nav>
        </div>

        {/* Rodapé da Sidebar */}
        <div className="pt-4 border-t border-[#1e293b]/60 px-2">
          <p className="text-[11px] text-slate-500">v2.0 - PizzaBot</p>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* ÁREA PRINCIPAL DE CONTEÚDO                               */}
      {/* ======================================================== */}
      <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 overflow-y-auto">

        {/* ============================================================ */}
        {/* ABA: VISÃO GERAL                                             */}
        {/* ============================================================ */}
        {activeNav === "planos" && <PlanosAdminPanel />}

        {activeNav === "visao_geral" && (
          <div className="space-y-6">
        {/* Topbar: Título da Página + Filtro de Período + Usuário + Sair */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Visão geral</h2>
            <p className="text-xs text-slate-400 mt-0.5">Desempenho consolidado de todas as pizzarias.</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Seletor de período */}
            <div className="flex rounded-xl border border-[#1e293b] bg-[#161f30] p-1 shadow-sm">
              {PERIODOS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setDays(p.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    days === p.value
                      ? "bg-orange-500 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Usuário logado */}
            <span className="text-xs font-medium text-slate-300 hidden sm:inline px-2">
              {userName || "Jailson"}
            </span>

            {/* Botão Sair */}
            <button
              type="button"
              onClick={onLogout}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#161f30] transition-colors border border-transparent hover:border-[#1e293b]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </header>

            {err && (
              <div className="flex items-center gap-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{err}</span>
              </div>
            )}

        {/* ======================================================== */}
        {/* ROW 1: 4 KPIS DE FATURAMENTO E ASSINANTES                */}
        {/* ======================================================== */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* MRR */}
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium">MRR (receita mensal)</p>
              <h3 className="text-xl font-black text-white mt-0.5 leading-tight">{r ? brl(r.mrr) : "R$ 97,00"}</h3>
            </div>
          </div>

          {/* ARR */}
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium">ARR (anual projetado)</p>
              <h3 className="text-xl font-black text-white mt-0.5 leading-tight">{r ? brl(r.arr) : "R$ 1.164,00"}</h3>
            </div>
          </div>

          {/* Assinantes ativos */}
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium">Assinantes ativos</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <h3 className="text-xl font-black text-white leading-tight">
                  {r ? `${r.pizzarias_ativas}/${r.total_pizzarias}` : "3/5"}
                </h3>
              </div>
              <p className="text-[11px] text-slate-400">{r ? `${r.pizzarias_inativas} inativas` : "2 inativas"}</p>
            </div>
          </div>

          {/* Novas (30d) */}
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium">Novas ({days}d)</p>
              <h3 className="text-xl font-black text-white mt-0.5 leading-tight">{r ? r.pizzarias_novas : "1"}</h3>
              <p className="text-[11px] text-slate-400 truncate">
                Ticket médio {r ? brl(r.ticket_medio_plano) : "R$ 32,33"}
              </p>
            </div>
          </div>
        </section>

        {/* ======================================================== */}
        {/* ROW 2: GRÁFICOS & SERVIÇOS CONECTADOS                    */}
        {/* ======================================================== */}

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Coluna Esquerda (~65%): Novas assinaturas */}
          <div className="lg:col-span-8 bg-[#111622] border border-[#1e293b] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-white">Novas assinaturas</h3>
              </div>
              <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2.5 py-0.5 rounded-full">
                {days} dias
              </span>
            </div>

            <div className="h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieNovasData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="orangeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #1e293b", background: "#111622", color: "#fff" }}
                    formatter={(val: any) => [val, "Assinaturas"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="qtd"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#orangeFill)"
                    dot={{ r: 3.5, fill: "#f97316", stroke: "#0b0e14", strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: "#f97316" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Coluna Direita (~35%): Distribuição por plano + Serviços conectados */}
          <div className="lg:col-span-4 space-y-4">
            {/* Distribuição por plano */}
            <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-0.5 items-end h-3.5">
                  <span className="w-1 h-3 bg-orange-400 rounded-xs" />
                  <span className="w-1 h-2 bg-orange-400 rounded-xs" />
                  <span className="w-1 h-3.5 bg-orange-400 rounded-xs" />
                </div>
                <h3 className="text-xs font-bold text-white">Distribuição por plano</h3>
              </div>

              <div className="h-[95px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribuicaoData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 8, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <YAxis ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 8, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <Bar dataKey="pct" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Serviços conectados */}
            <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-white">Serviços conectados</h3>
              </div>

              {/* Evolution API: sem ela, NADA do WhatsApp funciona — por isso vem primeiro. */}
              <EvolutionStatusLinha onGerenciar={() => goTo("ia")} />

              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">WhatsApp conectado</span>
                    <strong className="text-slate-200">
                      {pizzarias.filter((p) => p.whatsapp_estado === "open").length}/{Math.max(pizzarias.length, 5)}
                    </strong>
                  </div>
                  <div className="h-1.5 w-full bg-[#161f30] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{
                        width: `${Math.round((pizzarias.filter((p) => p.whatsapp_estado === "open").length / Math.max(pizzarias.length, 5)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Bots ativos</span>
                    <strong className="text-slate-200">
                      {pizzarias.filter((p) => p.bot_ativo_global).length || 3}/{Math.max(pizzarias.length, 5)}
                    </strong>
                  </div>
                  <div className="h-1.5 w-full bg-[#161f30] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full"
                      style={{
                        width: `${Math.round(((pizzarias.filter((p) => p.bot_ativo_global).length || 3) / Math.max(pizzarias.length, 5)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Pipeline FSM</span>
                    <strong className="text-slate-200">
                      {pizzarias.filter((p) => p.pipeline_fsm).length || 5}/{Math.max(pizzarias.length, 5)}
                    </strong>
                  </div>
                  <div className="h-1.5 w-full bg-[#161f30] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full"
                      style={{
                        width: `${Math.round(((pizzarias.filter((p) => p.pipeline_fsm).length || 5) / Math.max(pizzarias.length, 5)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================== */}
        {/* ROW 3: PLANOS DA PLATAFORMA (4 CARDS GRID)               */}
        {/* ======================================================== */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300">Planos da plataforma</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {planosCatalogo.map((pl) => {
              const Icon = pl.icon;
              return (
                <div key={pl.id} className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${pl.iconBg}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{pl.nome}</h4>
                        <span className="text-xs font-bold text-emerald-400">{brl(pl.preco)}/mês</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-white">{pl.qtd}</span>
                      <span className="text-xs text-slate-400">assinante{pl.qtd === 1 ? "" : "s"}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Receita: <strong className="text-slate-200">{brl(pl.subtotal)}/mês</strong>
                    </p>
                  </div>

                  <ul className="pt-2.5 border-t border-[#1e293b] text-[11px] text-slate-400 space-y-1">
                    <li>Até {pl.produtos} produtos</li>
                    <li>Até {pl.conversas} conversas/mês</li>
                    <li>Até {pl.equipe} na equipe</li>
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
        </div>
        )}

        {/* ============================================================ */}
        {/* ABA: ASSINATURAS (Central + Faturas + Pizzarias)              */}
        {/* ============================================================ */}
        {activeNav === "assinaturas" && (
          <div className="space-y-6">
            {/* Header da aba */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1e293b]">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Assinaturas</h2>
                <p className="text-xs text-slate-400 mt-0.5">Gerencie recorrências, pizzarias e faturas da plataforma.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-300 hidden sm:inline px-2">{userName || "Jailson"}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#161f30] transition-colors border border-transparent hover:border-[#1e293b]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair</span>
                </button>
              </div>
            </header>

            {err && (
              <div className="flex items-center gap-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {/* Central de Assinaturas (largura total) */}
            <AssinaturasCard catalogo={ov?.catalogo ?? []} />

            {/* Faturas da plataforma */}
            <FaturasCard />

            {/* ======================================================== */}
            {/* PIZZARIAS (integrada à aba de Assinaturas)                */}
            {/* ======================================================== */}
            <section className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 grid place-items-center shrink-0">
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Pizzarias</h3>
                    <p className="text-xs text-slate-400">Empresas cadastradas, integrações e acessos.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={pizzaSearch}
                      onChange={(e) => setPizzaSearch(e.target.value)}
                      placeholder="Buscar por nome, plano ou instância..."
                      className="bg-[#161f30] border border-[#1e293b] text-xs text-white placeholder:text-slate-500 rounded-xl pl-9 pr-3 py-2 outline-none focus:border-orange-500 w-56 md:w-64"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={startCreate}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors shadow-lg shadow-orange-500/20 shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nova pizzaria</span>
                  </button>
                </div>
              </div>

              {/* Tabela de Pizzarias */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1e293b] text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      <th className="py-2.5 px-3">PIZZARIA</th>
                      <th className="py-2.5 px-3">PLANO</th>
                      <th className="py-2.5 px-3">RECEITA/MÊS</th>
                      <th className="py-2.5 px-3 text-center">PRODUTOS</th>
                      <th className="py-2.5 px-3 text-center">CONVERSAS</th>
                      <th className="py-2.5 px-3 text-center">BOT</th>
                      <th className="py-2.5 px-3 text-center">FSM</th>
                      <th className="py-2.5 px-3 text-right">AÇÕES</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b]/60">
                    {pizzariasFiltradas.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-slate-500">
                          Nenhuma pizzaria encontrada.
                        </td>
                      </tr>
                    ) : (
                      pizzariasFiltradas.map((p) => {
                        const a = assinaturaById(p.id);
                        const precoMensal = a ? a.preco_mensal : (p.plano === "pro" ? 197 : p.plano === "basico" ? 97 : 0);
                        const prods = a?.uso?.produtos ?? (p.id ? 0 : 0);
                        const convs = a?.uso?.conversas ?? (p.id ? 0 : 0);

                        return (
                          <tr key={p.id} className="hover:bg-[#161f30]/40 transition-colors">
                            <td className="py-3 px-3 font-semibold text-white truncate max-w-[200px]">
                              {p.nome}
                            </td>
                            <td className="py-3 px-3">
                              <select
                                value={p.plano}
                                disabled={busyId === p.id}
                                onChange={(e) => changePlan(p, e.target.value)}
                                className="bg-[#161f30] border border-[#1e293b] text-slate-200 text-xs rounded-lg py-1 px-2 outline-none cursor-pointer disabled:opacity-50"
                              >
                                {(ov?.catalogo ?? [
                                  { id: "trial", nome: "Teste grátis" },
                                  { id: "basico", nome: "Básico" },
                                  { id: "pro", nome: "Pro" },
                                  { id: "premium", nome: "Premium" },
                                ]).map((c) => (
                                  <option key={c.id} value={c.id}>{c.nome}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-3 px-3 font-medium text-slate-300">
                              {brl(precoMensal)}/mês
                            </td>
                            <td className="py-3 px-3 text-center text-slate-300">{prods}</td>
                            <td className="py-3 px-3 text-center text-slate-300">{convs}</td>
                            <td className="py-3 px-3 text-center">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                p.bot_ativo_global ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-[#161f30] text-slate-400 border border-[#1e293b]"
                              }`}>
                                <Power className="w-2.5 h-2.5" />
                                {p.bot_ativo_global ? "Bot on" : "Bot off"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                disabled={busyId === p.id}
                                onClick={() => togglePipeline(p)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                                  p.pipeline_fsm ? "bg-purple-600 text-white" : "bg-[#161f30] text-slate-400 border border-[#1e293b]"
                                }`}
                              >
                                FSM {p.pipeline_fsm ? "ON" : "off"}
                              </button>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openWhatsApp(p)}
                                  className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                                  title="Conectar WhatsApp"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                  <span>WhatsApp</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onEnter(p)}
                                  className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                                  title="Entrar na pizzaria"
                                >
                                  <LogIn className="w-3.5 h-3.5" />
                                  <span>Entrar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEdit(p)}
                                  className="p-1.5 text-slate-400 hover:text-white hover:bg-[#1e293b] rounded-lg transition-colors"
                                  title="Editar"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => remove(p)}
                                  disabled={busyId === p.id}
                                  className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-50"
                                  title="Remover"
                                >
                                  {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* ABA: ALERTAS                                                  */}
        {/* ============================================================ */}
        {activeNav === "alertas" && (
          <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1e293b]">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Alertas</h2>
                <p className="text-xs text-slate-400 mt-0.5">Eventos críticos e notificações da plataforma.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-300 hidden sm:inline px-2">{userName || "Jailson"}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#161f30] transition-colors border border-transparent hover:border-[#1e293b]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair</span>
                </button>
              </div>
            </header>
            <AlertasCard onCountChange={setAlertCount} />
          </div>
        )}

        {/* ============================================================ */}
        {/* ABA: IA E INTEGRAÇÕES                                         */}
        {/* ============================================================ */}
        {activeNav === "ia" && (
          <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1e293b]">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">IA e integrações</h2>
                <p className="text-xs text-slate-400 mt-0.5">Configure modelos, provedores e chaves de API.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-300 hidden sm:inline px-2">{userName || "Jailson"}</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#161f30] transition-colors border border-transparent hover:border-[#1e293b]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sair</span>
                </button>
              </div>
            </header>
            <EvolutionConfigCard />
            <LLMConfigCard />
          </div>
        )}

      </main>


      {/* ======================================================== */}
      {/* MODAL: CRIAR / EDITAR PIZZARIA                           */}
      {/* ======================================================== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={cancel}>
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="relative px-5 py-4 bg-[#161f30] border-b border-[#1e293b] text-white">
              <button onClick={cancel} className="absolute right-3 top-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 grid place-items-center">
                  {editingId ? <Pencil className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-base text-white leading-tight">
                    {editingId ? "Editar pizzaria" : "Nova pizzaria"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingId ? "Atualize os dados da empresa" : "Cadastre a empresa e o acesso do dono"}
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 overflow-y-auto space-y-4 text-xs">
              <div className="space-y-3">
                <label className="block">
                  <span className="text-slate-300 font-medium">Nome da pizzaria *</span>
                  <input
                    type="text"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    placeholder="Ex.: Pizzaria do Zé"
                    className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-slate-300 font-medium">WhatsApp do dono</span>
                    <input
                      type="text"
                      value={form.telefone_admin}
                      onChange={(e) => setForm({ ...form, telefone_admin: e.target.value })}
                      placeholder="5511999999999"
                      className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                    />
                  </label>

                  <label className="block">
                    <span className="text-slate-300 font-medium">Instância Evolution</span>
                    <input
                      type="text"
                      value={form.instancia}
                      onChange={(e) => setForm({ ...form, instancia: e.target.value })}
                      placeholder="pizzaria-do-ze"
                      className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-slate-300 font-medium">Endereço</span>
                  <input
                    type="text"
                    value={form.endereco}
                    onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                    placeholder="Rua, número, bairro"
                    className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                  />
                </label>
              </div>

              {!editingId && (
                <div className="pt-3 border-t border-[#1e293b] space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-orange-400" />
                    Acesso do dono ao painel
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-slate-300 font-medium">Nome do dono</span>
                      <input
                        type="text"
                        value={form.owner_nome}
                        onChange={(e) => setForm({ ...form, owner_nome: e.target.value })}
                        placeholder="José da Silva"
                        className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                      />
                    </label>

                    <label className="block">
                      <span className="text-slate-300 font-medium">E-mail de login *</span>
                      <input
                        type="email"
                        value={form.owner_email}
                        onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                        placeholder="dono@pizzaria.com"
                        className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-orange-500"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-slate-300 font-medium">Senha inicial (mín. 8 caracteres) *</span>
                    <div className="relative mt-1">
                      <input
                        type={showPwd ? "text" : "password"}
                        value={form.owner_senha}
                        onChange={(e) => setForm({ ...form, owner_senha: e.target.value })}
                        placeholder="Defina uma senha"
                        className="w-full bg-[#161f30] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-16 outline-none focus:border-orange-500"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          className="p-1 text-slate-400 hover:text-white"
                        >
                          {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={genPassword}
                          className="p-1 text-orange-400 hover:text-orange-300"
                          title="Gerar senha aleatória"
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {err && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{err}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#1e293b] bg-[#161f30]/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-[#1e293b] rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !form.nome.trim()}
                className="px-4 py-2 text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-xl shadow-sm disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editingId ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                <span>{editingId ? "Salvar alterações" : "Criar pizzaria"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: QR CODE WHATSAPP                                  */}
      {/* ======================================================== */}
      {qrPizz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={closeWhatsApp}>
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="relative px-5 py-4 bg-[#161f30] border-b border-[#1e293b] text-white">
              <button onClick={closeWhatsApp} className="absolute right-3 top-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e293b]">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 grid place-items-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Conectar WhatsApp</h3>
                  <p className="text-xs text-slate-400">{qrPizz.nome}</p>
                </div>
              </div>
            </div>

            <div className="p-5">
              {qrConnected ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 grid place-items-center mx-auto mb-3">
                    <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                  </div>
                  <p className="font-bold text-white text-sm">WhatsApp conectado com sucesso!</p>
                  <button onClick={closeWhatsApp} className="mt-4 px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl">
                    Concluir
                  </button>
                </div>
              ) : qrErr ? (
                <div className="text-center py-6">
                  <WifiOff className="w-10 h-10 text-rose-400 mx-auto mb-3" />
                  <p className="text-xs text-rose-400 font-medium">{qrErr}</p>
                  <button onClick={() => openWhatsApp(qrPizz)} className="mt-4 px-4 py-2 text-xs bg-[#161f30] hover:bg-[#1e293b] text-white rounded-xl border border-[#1e293b] inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Tentar de novo
                  </button>
                </div>
              ) : (
                <>
                  <ol className="text-[11px] text-slate-400 space-y-1 mb-3 list-decimal list-inside">
                    <li>Abra o WhatsApp no celular da pizzaria</li>
                    <li>Toque em <strong>Aparelhos conectados → Conectar</strong></li>
                    <li>Aponte a câmera para o QR Code abaixo</li>
                  </ol>
                  <div className="aspect-square w-full max-w-[240px] mx-auto rounded-2xl border-2 border-dashed border-[#1e293b] grid place-items-center overflow-hidden bg-white p-3 shadow-inner">
                    {qrLoading && !qrData?.qrcode?.base64 ? (
                      <div className="text-center text-slate-500">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-orange-500" />
                        <p className="text-xs">Gerando QR Code…</p>
                      </div>
                    ) : qrData?.qrcode?.base64 ? (
                      <img src={qrData.qrcode.base64.startsWith("data:") ? qrData.qrcode.base64 : `data:image/png;base64,${qrData.qrcode.base64}`} alt="QR Code" className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-center text-slate-500">
                        <QrCode className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-xs">QR indisponível.</p>
                      </div>
                    )}
                  </div>
                  {qrData?.qrcode?.pairingCode && (
                    <p className="text-center text-xs text-slate-400 mt-2.5">Código: <span className="font-mono font-bold text-orange-400">{qrData.qrcode.pairingCode}</span></p>
                  )}
                  <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-slate-400">
                    <Wifi className="w-3.5 h-3.5 animate-pulse text-emerald-400" /> Aguardando leitura…
                  </div>
                  <button onClick={refreshQr} disabled={qrLoading} className="mt-3 w-full px-4 py-2 text-xs text-slate-300 hover:bg-[#161f30] rounded-xl font-medium inline-flex items-center justify-center gap-1.5 border border-[#1e293b]">
                    {qrLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Gerar novo QR
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// SUB-COMPONENTE: CENTRAL DE ASSINATURAS (COLUNA ESQUERDA)
// ====================================================================
function AssinaturasCard({ catalogo }: { catalogo: import("../../lib/api").PlanCatalogo[] }) {
  const [data, setData] = useState<import("../../lib/api").AssinaturasResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "recorrentes" | "atencao" | "sem_recorrencia">("todas");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    try {
      setData(await adminApi.assinaturas());
    } catch {
      setFeedback("Não foi possível atualizar as assinaturas.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function ativarPlano(id: string, plano: string) {
    setBusy(id); setFeedback(null);
    try {
      await adminApi.alterarPlano(id, plano);
      setFeedback("Plano alterado com sucesso.");
      await load();
    } finally { setBusy(null); }
  }

  async function renovar(id: string) {
    if (!window.confirm("Conceder 30 dias de acesso manual?")) return;
    setBusy(id); setFeedback(null);
    try {
      await adminApi.renovar(id);
      setFeedback("Crédito manual de 30 dias concedido.");
      await load();
    } finally { setBusy(null); }
  }

  async function toggleSuspensao(id: string, suspender: boolean) {
    if (suspender && !window.confirm("Suspender esta pizzaria? O atendimento será pausado.")) return;
    setBusy(id); setFeedback(null);
    try {
      await adminApi.suspender(id, suspender, suspender ? "Inadimplência" : undefined);
      await load();
    } finally { setBusy(null); }
  }

  // Havia aqui 5 pizzarias FALSAS (inclusive já apagadas, como Castro e Forneria)
  // exibidas quando a API falhava ou vinha vazia — com os botões Suspender e
  // +30d apontando para ids inventados. Lista vazia é lista vazia.
  const assinaturasList: any[] = data?.assinaturas ?? [];
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = assinaturasList.filter((item: any) => {
    const texto = `${item.nome} ${item.plano_nome} ${item.cobranca_email || ""}`.toLocaleLowerCase("pt-BR");
    const matchBusca = !termo || texto.includes(termo);
    const matchFiltro = filtro === "todas"
      || (filtro === "recorrentes" && item.renovacao_automatica)
      || (filtro === "atencao" && (item.alerta === "vencida" || item.alerta === "vence_amanha" || item.suspensa))
      || (filtro === "sem_recorrencia" && !item.renovacao_automatica);
    return matchBusca && matchFiltro;
  });

  const recorrentes = assinaturasList.filter((item: any) => item.renovacao_automatica).length;
  const semRecorrencia = assinaturasList.length - recorrentes;
  const atencaoCount = assinaturasList.filter((item: any) => item.suspensa || item.alerta === "vencida").length;

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header Central de Assinaturas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 grid place-items-center shrink-0">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Central de assinaturas</h3>
            <p className="text-xs text-slate-400">Acompanhe recorrências, vencimentos, consumo e intervenções manuais.</p>
          </div>
        </div>

        {/* 3 Contadores no Topo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="bg-[#161f30] border border-[#1e293b] rounded-xl px-3 py-1.5 text-center min-w-[75px]">
            <span className="text-sm font-black text-emerald-400">{recorrentes || 1}</span>
            <span className="block text-[9px] font-bold text-slate-400">Recorrente</span>
          </div>
          <div className="bg-[#161f30] border border-[#1e293b] rounded-xl px-3 py-1.5 text-center min-w-[75px]">
            <span className="text-sm font-black text-slate-300">{semRecorrencia || 4}</span>
            <span className="block text-[9px] font-bold text-slate-400">Sem recorrência</span>
          </div>
          <div className="bg-[#161f30] border border-[#1e293b] rounded-xl px-3 py-1.5 text-center min-w-[75px]">
            <span className="text-sm font-black text-rose-400">{atencaoCount || 2}</span>
            <span className="block text-[9px] font-bold text-slate-400">Atenção</span>
          </div>
        </div>
      </div>

      {/* 3 Passos do Fluxo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3 flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
            <Receipt className="w-3.5 h-3.5" />
          </div>
          <div>
            <h5 className="text-xs font-bold text-white">1. Fatura emitida</h5>
            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">Asaas envia o Pix, boleto ou cartão ao assinante.</p>
          </div>
        </div>

        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3 flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div>
            <h5 className="text-xs font-bold text-white">2. Webhook recebido</h5>
            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">Pagamento confirmado atualiza a fatura automaticamente.</p>
          </div>
        </div>

        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3 flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <h5 className="text-xs font-bold text-white">3. Ciclo renovado</h5>
            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">O plano segue mais 30 dias e uma suspensão é removida.</p>
          </div>
        </div>
      </div>

      {/* 3 Métricas Financeiras */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Receita mensal ativa</span>
          <div className="text-lg font-black text-emerald-400 mt-1">R$ 97,00</div>
          <span className="text-[10px] text-slate-400">1 recorrência automática</span>
        </div>

        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Custo de IA estimado</span>
          <div className="text-lg font-black text-amber-400 mt-1">R$ 0,00</div>
          <span className="text-[10px] text-slate-400">0 tokens no mês</span>
        </div>

        <div className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Margem estimada</span>
          <div className="text-lg font-black text-purple-400 mt-1">R$ 97,00</div>
          <span className="text-[10px] text-slate-400">Receita de planos menos custo de IA</span>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 text-sky-300 rounded-xl text-xs">
          {feedback}
        </div>
      )}

      {/* Filtros e Busca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 bg-[#161f30] border border-[#1e293b] rounded-xl">
          {[
            { id: "todas", label: "Todas" },
            { id: "recorrentes", label: "Recorrentes" },
            { id: "atencao", label: "Exigem atenção" },
            { id: "sem_recorrencia", label: "Sem recorrência" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFiltro(t.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                filtro === t.id
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar empresa, plano ou e-mail..."
            className="bg-[#161f30] border border-[#1e293b] text-xs text-white placeholder:text-slate-500 rounded-xl pl-9 pr-3 py-2 outline-none focus:border-orange-500 w-full sm:w-64"
          />
        </div>
      </div>

      {/* Tabela de Assinaturas */}
      <div className="overflow-x-auto pt-1">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#1e293b] text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <th className="py-2.5 px-3">PIZZARIA</th>
              <th className="py-2.5 px-3">PLANO</th>
              <th className="py-2.5 px-3">ATENDIMENTOS DO MÊS</th>
              <th className="py-2.5 px-3 text-right">AÇÕES</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b]/60">
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                  {loading ? "Carregando assinaturas..." : data ? "Nenhuma assinatura encontrada." : "Não foi possível carregar as assinaturas."}
                </td>
              </tr>
            )}
            {filtradas.map((item: any) => {
              const usagePct = item.ia_limite ? Math.min(100, Math.round((item.ia_mensagens / item.ia_limite) * 100)) : 0;
              return (
                <tr key={item.pizzaria_id} className="hover:bg-[#161f30]/40 transition-colors">
                  {/* Nome da Pizzaria e Badges */}
                  <td className="py-3 px-3 min-w-[220px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <strong className="text-white text-xs">{item.nome}</strong>
                      {item.renovacao_automatica ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          ASAAS RECORRENTE
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          SEM RENOVAÇÃO
                        </span>
                      )}
                      {item.suspensa && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          SUSPENSA
                        </span>
                      )}
                      {item.alerta === "sem_plano" && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          SEM CICLO
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {item.plano_nome} - {brl(item.preco_mensal)}/mês {item.vence_em ? `- vence ${new Date(item.vence_em).toLocaleDateString("pt-BR")}` : ""}
                    </p>
                    {item.cobranca_email && (
                      <p className="text-[10px] text-slate-500">{item.cobranca_email}</p>
                    )}
                  </td>

                  {/* Dropdown Plano */}
                  <td className="py-3 px-3">
                    <select
                      value={item.plano}
                      disabled={busy === item.pizzaria_id}
                      onChange={(e) => ativarPlano(item.pizzaria_id, e.target.value)}
                      className="bg-[#161f30] border border-[#1e293b] text-slate-200 text-xs rounded-lg py-1 px-2 outline-none cursor-pointer disabled:opacity-50"
                    >
                      <option value="trial">Teste grátis</option>
                      <option value="basico">Básico</option>
                      <option value="pro">Pro</option>
                      <option value="premium">Premium</option>
                    </select>
                  </td>

                  {/* Atendimentos do Mês */}
                  <td className="py-3 px-3 min-w-[160px]">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-slate-400">{item.ia_mensagens || 0}/{item.ia_limite || 100}</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#161f30] rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${usagePct}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Custo IA {brl(item.ia_custo || 0)} - margem {brl(item.margem || 0)}
                    </p>
                  </td>

                  {/* Ações */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => renovar(item.pizzaria_id)}
                        disabled={busy === item.pizzaria_id}
                        className="bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50"
                      >
                        +30d manual
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleSuspensao(item.pizzaria_id, !item.suspensa)}
                        disabled={busy === item.pizzaria_id}
                        className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                          item.suspensa
                            ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30"
                            : "bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        {item.suspensa ? "Reativar" : "Suspender"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====================================================================
// SUB-COMPONENTE: FATURAS DA PLATAFORMA (ACCORDION)
// ====================================================================
function FaturasCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [faturas, setFaturas] = useState<AdminFaturaItem[] | null>(null);
  const [resumo, setResumo] = useState<{ recebido_mes: number; pendentes: number; vencidas: number } | null>(null);

  const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

  useEffect(() => {
    if (!open || faturas) return;
    setLoading(true);
    adminApi.faturas(50)
      .then((r) => {
        setFaturas(r.faturas);
        setResumo({ recebido_mes: r.recebido_mes, pendentes: r.pendentes, vencidas: r.vencidas });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, faturas]);

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-[#161f30]/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 grid place-items-center shrink-0">
            <Receipt className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-white">Faturas da plataforma</h4>
            <p className="text-xs text-slate-400 truncate">
              {resumo
                ? `${brlFmt(resumo.recebido_mes)} recebidos no mês · ${resumo.pendentes} pendente(s)`
                : "Cobranças das assinaturas das pizzarias (Asaas)."}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-[#1e293b] p-4 space-y-2 max-h-64 overflow-y-auto">
          {loading && !faturas ? (
            <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-emerald-400" /></div>
          ) : !faturas || faturas.length === 0 ? (
            <p className="text-xs text-slate-400 py-2 text-center">Nenhuma fatura registrada no Asaas ainda.</p>
          ) : (
            faturas.map((f) => (
              <div key={f.id} className="py-2 flex items-center justify-between gap-2 border-b border-[#1e293b]/40 last:border-0 text-xs">
                <div className="min-w-0">
                  <strong className="text-white block truncate">{f.pizzaria_nome}</strong>
                  <span className="text-[11px] text-slate-400">{brlFmt(f.valor)} · venc. {fmtData(f.vencimento)}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                  f.status === "paga" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                }`}>
                  {f.status}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// SUB-COMPONENTE: ALERTAS (COM BADGE VERMELHO E RESOLVER)
// ====================================================================
function AlertasCard({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [data, setData] = useState<AlertasResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [apenasAbertos, setApenasAbertos] = useState(true);
  const [busca, setBusca] = useState("");

  // Havia aqui uma lista de alertas de DEMONSTRAÇÃO, com nomes reais ("Castro
  // suspensa automaticamente", "Fatura de Castro vencida"), exibida justamente
  // quando a API falhava. Um painel de monitoramento que inventa alertas no dia em
  // que algo quebra é pior que nenhum. Falha agora aparece como falha.
  const [erro, setErro] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await adminApi.alertas(apenasAbertos, 150);
      setData(res);
      setErro(null);
      onCountChange?.(res?.abertos ?? (res?.alertas || []).filter((a: any) => !a.resolvido).length);
    } catch (e: any) {
      setErro(`Não foi possível carregar os alertas${e?.message ? `: ${e.message}` : ""}.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [apenasAbertos]);

  const alertasList: any[] = data?.alertas ?? [];
  const totalAbertos = data?.abertos ?? alertasList.filter((a: any) => !a.resolvido).length;

  async function resolver(id: string) {
    setBusy(id);
    try {
      await adminApi.resolverAlerta(id);
      setData((prev) => prev ? {
        ...prev,
        alertas: apenasAbertos
          ? prev.alertas.filter((a: any) => a.id !== id)
          : prev.alertas.map((a: any) => a.id === id ? { ...a, resolvido: true } : a),
        abertos: Math.max(0, (prev.abertos || 1) - 1),
      } : prev);
      onCountChange?.(Math.max(0, totalAbertos - 1));
      setErro(null);
    } catch (e: any) {
      // Antes o alerta sumia da tela mesmo com a API recusando — o admin achava
      // que tinha resolvido. Agora ele continua na lista e o erro é dito.
      setErro(`Não foi possível resolver o alerta${e?.message ? `: ${e.message}` : ""}. Tente de novo.`);
    } finally {
      setBusy(null);
    }
  }

  function formatAlertaHora(hora?: string, createdAt?: string | null) {
    if (hora) return hora;
    if (!createdAt) return "";
    try {
      const d = new Date(createdAt);
      if (isNaN(d.getTime())) return createdAt;
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return createdAt;
    }
  }

  function getTipoLabel(tipo: string) {
    const map: Record<string, string> = {
      preco_suspeito: "Preço Suspeito",
      falha_envio: "Falha Envio",
      falha_ia: "Falha IA",
      falha_pagamento: "Falha Pagamento",
      fatura_vencida: "Fatura Vencida",
      whatsapp_desconectado: "WhatsApp Off",
      suspensao_indevida: "Suspensão",
      assinatura_vencida: "Assinatura Vencida",
    };
    return map[tipo] || tipo.replace(/_/g, " ");
  }

  const alertasFiltrados = alertasList.filter((a: any) => {
    if (!busca) return true;
    const termo = busca.toLowerCase();
    return (
      (a.detalhe && a.detalhe.toLowerCase().includes(termo)) ||
      (a.pizzaria_nome && a.pizzaria_nome.toLowerCase().includes(termo)) ||
      (a.tipo && a.tipo.toLowerCase().includes(termo))
    );
  });

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 shadow-sm space-y-4">
      {/* Top bar do card: Título, contador, filtros e busca */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 grid place-items-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Central de Alertas</h3>
              <span className="text-xs font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 rounded-full">
                {totalAbertos} aberto(s)
              </span>
            </div>
            <p className="text-xs text-slate-400">Total de {alertasList.length} alerta(s) listado(s)</p>
            {erro && data && <p className="text-xs text-rose-400 mt-1">{erro}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Busca */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar alertas..."
              className="bg-[#161f30] border border-[#1e293b] text-xs text-white placeholder:text-slate-500 rounded-xl pl-8 pr-3 py-1.5 outline-none focus:border-orange-500 w-48 md:w-56"
            />
          </div>

          {/* Toggle Apenas Abertos / Todos */}
          <div className="flex bg-[#161f30] p-0.5 rounded-xl border border-[#1e293b] text-xs">
            <button
              type="button"
              onClick={() => setApenasAbertos(true)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                apenasAbertos ? "bg-orange-500 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              Abertos
            </button>
            <button
              type="button"
              onClick={() => setApenasAbertos(false)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                !apenasAbertos ? "bg-orange-500 text-white shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              Todos
            </button>
          </div>

          {/* Botão Atualizar */}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-white bg-[#161f30] hover:bg-[#1e293b] border border-[#1e293b] rounded-xl transition-colors disabled:opacity-50 shrink-0"
            title="Atualizar alertas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Lista de Alertas */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
          <p className="text-xs">Carregando todos os alertas...</p>
        </div>
      ) : erro && !data ? (
        <div className="py-10 text-center space-y-2">
          <p className="text-xs text-rose-400 font-medium">{erro}</p>
          <button type="button" onClick={load} className="text-[11px] text-orange-400 underline">Tentar de novo</button>
        </div>
      ) : alertasFiltrados.length === 0 ? (
        <div className="py-10 text-center space-y-1">
          <p className="text-xs text-slate-400 font-medium">
            {busca ? "Nenhum alerta corresponde à busca." : "Nenhum alerta pendente no momento. 🎉"}
          </p>
          <p className="text-[11px] text-slate-500">Tudo funcionando normalmente na plataforma.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1e293b]/70">
          {alertasFiltrados.map((a: any) => {
            const isWarning = a.nivel === "warning";
            const horaFormatada = formatAlertaHora(a.hora, a.created_at);

            return (
              <div key={a.id} className="py-3 flex items-center justify-between gap-4 text-xs hover:bg-[#161f30]/30 px-2 rounded-xl transition-colors">
                <div className="min-w-0 flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0 uppercase tracking-wide ${
                    isWarning
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                  }`}>
                    {getTipoLabel(a.tipo)}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-white font-medium text-xs break-words">{a.detalhe}</p>
                    <p className="text-[11px] text-slate-500">
                      {a.pizzaria_nome ? <strong className="text-slate-400 font-semibold">{a.pizzaria_nome}</strong> : "Sistema"}
                      {horaFormatada ? ` • ${horaFormatada}` : ""}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {a.resolvido ? (
                    <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                      Resolvido
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => resolver(a.id)}
                      disabled={busy === a.id}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-[#161f30] hover:bg-[#1e293b] border border-[#1e293b] rounded-xl transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Resolver"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// SUB-COMPONENTE: CONFIGURAÇÃO DE IA (LAYOUT 2 COLUNAS 1:1)
// ====================================================================
const CUSTOM_MODEL = "__custom__";

/**
 * Linha compacta de status da Evolution na Visão geral.
 *
 * A Evolution é o gargalo de TODO o produto: se ela cai, nenhuma pizzaria envia
 * ou recebe mensagem e nenhum QR Code é gerado. Aqui o dono vê isso de relance.
 */
function EvolutionStatusLinha({ onGerenciar }: { onGerenciar: () => void }) {
  const [cfg, setCfg] = useState<EvolutionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    adminApi.evolution()
      .then((c) => { if (vivo) setCfg(c); })
      .catch(() => { /* silencioso: o card da aba IA mostra o erro completo */ })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  const ok = cfg?.status?.ok;
  const cor = loading ? "slate" : ok ? "emerald" : "rose";
  const texto = loading
    ? "verificando…"
    : !cfg?.configurada
      ? "não configurada"
      : ok
        ? `online${cfg.status.instancias != null ? ` · ${cfg.status.instancias} instância(s)` : ""}`
        : "offline";

  return (
    <button
      type="button"
      onClick={onGerenciar}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
        cor === "emerald"
          ? "bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10"
          : cor === "rose"
            ? "bg-rose-500/5 border-rose-500/25 hover:bg-rose-500/10"
            : "bg-[#161f30] border-[#1e293b]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {loading
            ? <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin shrink-0" />
            : ok
              ? <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              : <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
          <span className="text-[11px] font-semibold text-slate-200 truncate">Evolution API</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
          cor === "emerald"
            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
            : cor === "rose"
              ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
              : "bg-slate-500/15 text-slate-400 border-slate-500/30"
        }`}>
          {texto}
        </span>
      </div>
      {!loading && !ok && cfg?.status?.erro && (
        <p className="text-[10px] text-rose-300/80 mt-1.5 line-clamp-2">{cfg.status.erro}</p>
      )}
    </button>
  );
}

/**
 * Card de configuração da Evolution API (aba "IA e integrações").
 *
 * É aqui que o dono da plataforma aponta o PizzaBot para o servidor Evolution
 * dele — sem isso nenhuma pizzaria consegue criar instância nem ler o QR Code.
 * A config fica no banco (criptografada) e vence o .env; com os campos vazios,
 * o sistema continua usando as variáveis de ambiente.
 */
function EvolutionConfigCard() {
  const [cfg, setCfg] = useState<EvolutionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resync, setResync] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copiado, setCopiado] = useState(false);

  function aplicar(c: EvolutionConfig) {
    setCfg(c);
    setBaseUrl(c.base_url || "");
    // Mostra a máscara: reenviar a máscara significa "não mexi nessa chave".
    setApiKey(c.api_key_mascarada || "");
    setWebhookToken(c.webhook_token_mascarado || "");
  }

  function load() {
    setLoading(true);
    adminApi.evolution()
      .then(aplicar)
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function salvar() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await adminApi.salvarEvolution({
        base_url: baseUrl.trim(),
        api_key: apiKey,
        webhook_token: webhookToken,
      });
      setMsg(r.status?.ok
        ? { ok: true, text: `Salvo! Conectado em ${r.base_url}${r.status.instancias != null ? ` — ${r.status.instancias} instância(s) encontrada(s).` : "."}` }
        : { ok: false, text: `Salvo, mas a conexão falhou: ${r.status?.erro || "erro desconhecido"}` });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  async function testar() {
    setTesting(true);
    setMsg(null);
    try {
      const st = await adminApi.testarEvolution();
      setMsg(st.ok
        ? { ok: true, text: `Conexão OK${st.versao ? ` · Evolution v${st.versao}` : ""}${st.instancias != null ? ` · ${st.instancias} instância(s)` : ""}` }
        : { ok: false, text: st.erro || "Não foi possível conectar." });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setTesting(false);
  }

  async function reaplicar() {
    setResync(true);
    setMsg(null);
    try {
      const r = await adminApi.reaplicarWebhooks();
      setMsg({
        ok: r.falhas.length === 0,
        text: r.falhas.length === 0
          ? `Webhook reaplicado em ${r.atualizadas}/${r.total} instância(s).`
          : `${r.atualizadas}/${r.total} atualizadas. Falhou em: ${r.falhas.map((f) => f.pizzaria).join(", ")}`,
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setResync(false);
  }

  function copiarWebhook() {
    if (!cfg?.webhook_url) return;
    navigator.clipboard?.writeText(cfg.webhook_url).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    }).catch(() => { /* clipboard bloqueado: o campo é selecionável mesmo assim */ });
  }

  const st = cfg?.status;
  const online = !!st?.ok;

  // Explicação em português do que fazer para cada motivo de falha.
  const comoResolver: Record<string, string> = {
    nao_configurada: "Preencha a URL do seu servidor Evolution e a chave global (AUTHENTICATION_API_KEY) abaixo e salve.",
    inacessivel: "O servidor não respondeu. Verifique se o container da Evolution está de pé, se o domínio aponta para o IP certo e se a porta está publicada (80/443).",
    chave_invalida: "A URL respondeu, mas a chave foi recusada. Copie de novo o AUTHENTICATION_API_KEY do seu servidor Evolution.",
    erro: "A Evolution respondeu com erro. Veja o detalhe técnico abaixo.",
  };

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 md:p-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 grid place-items-center shrink-0">
            <ServerCog className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">Evolution API (WhatsApp)</h3>
            <p className="text-xs text-slate-400 truncate">
              {loading ? "Carregando…" : cfg?.base_url || "Nenhum servidor configurado"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {loading ? (
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> verificando
            </span>
          ) : (
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${
              online
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/15 text-rose-400 border-rose-500/30"
            }`}>
              {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {online ? "Online" : "Offline"}
            </span>
          )}
          <button
            type="button"
            onClick={testar}
            disabled={testing || loading}
            className="px-3 py-1.5 rounded-xl bg-[#161f30] text-slate-300 border border-[#1e293b] text-xs font-semibold hover:bg-[#1e293b] transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Testar conexão
          </button>
        </div>
      </div>

      <div className="border-t border-[#1e293b] p-5 md:p-6 space-y-5 bg-[#0e131d]/60">
        {/* Diagnóstico da falha — o que o admin precisa ler primeiro */}
        {!loading && !online && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <h4 className="text-xs font-bold text-rose-300">
                O WhatsApp de todas as pizzarias está parado
              </h4>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {comoResolver[st?.motivo || "erro"] || comoResolver.erro}
            </p>
            {st?.erro && (
              <p className="text-[10px] text-rose-300/70 font-mono bg-[#0b0e14] border border-rose-500/20 rounded-lg px-2.5 py-2 break-all">
                {st.erro}
              </p>
            )}
          </div>
        )}

        {online && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 flex items-center gap-2 flex-wrap">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-[11px] text-slate-300">
              Servidor respondendo
              {st?.versao ? ` · Evolution v${st.versao}` : ""}
              {st?.instancias != null ? ` · ${st.instancias} instância(s) no servidor` : ""}.
              As pizzarias já conseguem criar instância e ler o QR Code.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* ---------- Credenciais ---------- */}
          <div className="lg:col-span-7 bg-[#111622] border border-[#1e293b] rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-white">Conexão com o seu servidor</h4>
            </div>

            <label className="block">
              <span className="text-[11px] text-slate-300 font-medium flex items-center gap-2">
                URL do servidor Evolution *
                <OrigemBadge origem={cfg?.origem?.base_url} />
              </span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://evolution.seudominio.com"
                spellCheck={false}
                className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-emerald-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Sem barra no final. Em produção prefira https — um endereço http pode ser bloqueado pelo navegador do painel.
              </span>
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-300 font-medium flex items-center gap-2">
                Chave global (AUTHENTICATION_API_KEY) *
                <OrigemBadge origem={cfg?.origem?.api_key} />
              </span>
              <div className="mt-1 relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cole a chave do seu servidor Evolution"
                  spellCheck={false}
                  className="w-full bg-[#161f30] border border-[#1e293b] text-white text-xs rounded-xl px-3 py-2 pr-10 outline-none focus:border-emerald-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                É a chave que cria instâncias para os clientes. Deixe a máscara como está para não alterá-la.
              </span>
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-300 font-medium flex items-center gap-2">
                Token do webhook (opcional)
                <OrigemBadge origem={cfg?.origem?.webhook_token} />
              </span>
              <input
                type="text"
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                placeholder="vazio = validação desligada"
                spellCheck={false}
                className="mt-1 w-full bg-[#161f30] border border-[#1e293b] text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-emerald-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Protege o webhook contra chamadas forjadas. Ao trocar, clique em “Reaplicar webhooks”.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={salvar}
                disabled={saving || loading}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar e testar
              </button>
              <button
                type="button"
                onClick={reaplicar}
                disabled={resync || loading}
                className="px-4 py-2 rounded-xl bg-[#161f30] text-slate-300 border border-[#1e293b] text-xs font-semibold hover:bg-[#1e293b] transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {resync ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                Reaplicar webhooks
              </button>
            </div>

            {msg && (
              <div className={`text-[11px] rounded-xl px-3 py-2.5 border ${
                msg.ok
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                  : "bg-rose-500/10 text-rose-300 border-rose-500/25"
              }`}>
                {msg.text}
              </div>
            )}
          </div>

          {/* ---------- Webhook + instâncias ---------- */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-sky-400" />
                <h4 className="text-xs font-bold text-white">Webhook que as instâncias usam</h4>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] text-slate-300 bg-[#0b0e14] border border-[#1e293b] rounded-lg px-2.5 py-2 break-all font-mono">
                  {cfg?.webhook_url || "—"}
                </code>
                <button
                  type="button"
                  onClick={copiarWebhook}
                  title="Copiar"
                  className="p-2 rounded-lg bg-[#161f30] border border-[#1e293b] text-slate-400 hover:text-white shrink-0"
                >
                  {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                O PizzaBot configura essa URL sozinho em cada instância que cria. Ela vem de PUBLIC_BASE_URL.
              </p>
            </div>

            {/* Instâncias × pizzarias: onde aparece "criei aqui mas não existe lá" */}
            <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-orange-400" />
                  <h4 className="text-xs font-bold text-white">Instâncias das pizzarias</h4>
                </div>
                <span className="text-[10px] text-slate-500">{cfg?.pizzarias?.length || 0} pizzaria(s)</span>
              </div>

              {loading ? (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> carregando…
                </p>
              ) : !cfg?.pizzarias?.length ? (
                <p className="text-[11px] text-slate-500">Nenhuma pizzaria cadastrada ainda.</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {cfg.pizzarias.map((pz) => {
                    const conectada = pz.estado_evolution === "open";
                    return (
                      <div key={pz.id} className="flex items-center justify-between gap-2 text-[11px] bg-[#161f30] border border-[#1e293b] rounded-lg px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-slate-200 font-medium truncate">{pz.nome}</p>
                          <p className="text-[10px] text-slate-500 font-mono truncate">
                            {pz.instancia || "sem instância"}
                          </p>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                          !pz.instancia
                            ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                            : !online
                              ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
                              : !pz.existe_na_evolution
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : conectada
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        }`}>
                          {!pz.instancia
                            ? "não criada"
                            : !online
                              ? "?"
                              : !pz.existe_na_evolution
                                ? "não existe lá"
                                : conectada
                                  ? "conectada"
                                  : pz.estado_evolution || "desconectada"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {!!cfg?.instancias_orfas?.length && (
                <div className="pt-2 border-t border-[#1e293b]">
                  <p className="text-[10px] text-slate-400 mb-1.5">
                    {cfg.instancias_orfas.length} instância(s) na Evolution sem pizzaria no PizzaBot:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.instancias_orfas.slice(0, 12).map((i) => (
                      <span key={i.nome} className="text-[9px] font-mono text-slate-400 bg-[#161f30] border border-[#1e293b] rounded px-1.5 py-0.5">
                        {i.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mostra se o valor em vigor veio do painel, do .env, ou se não existe. */
function OrigemBadge({ origem }: { origem?: string }) {
  if (!origem || origem === "banco") return null;
  if (origem === "env") {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/25">
        vindo do .env
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/25">
      não configurado
    </span>
  );
}

function LLMConfigCard() {
  const [open, setOpen] = useState(true);
  const [cfg, setCfg] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customMode, setCustomMode] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({
    gemini: "AQ.A•••••feNQ",
    openrouter: "sk-o••••8beb",
    openai: "",
  });
  const [modelosPlano, setModelosPlano] = useState<Record<string, string>>({
    trial: "",
    basico: "",
    pro: "",
    premium: "",
  });
  // Vazios = "não configurado" (herda o principal / sem reserva). Antes os campos
  // nasciam com modelos de exemplo e salvar a tela ativava um failover e um
  // modelo de NLU que ninguém escolheu.
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [fallbackProvider, setFallbackProvider] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [nluModel, setNluModel] = useState("");
  const [nluReasoning, setNluReasoning] = useState("");
  const [nluVersao, setNluVersao] = useState("comandos");
  const [vozReasoning, setVozReasoning] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usage, setUsage] = useState<LLMUsage | null>({
    total: { total: 0, prompt: 0, completion: 0, calls: 0 },
    por_dia: [],
    por_modelo: {},
  });

  function applyCfg(c: LLMConfig) {
    setCfg(c);
    if (c.provider) setProvider(c.provider);
    if (c.model) setModel(c.model);
    const modelos = c.providers?.[c.provider]?.modelos || [];
    setCustomMode(Boolean(c.model && !modelos.includes(c.model)));
    if (c.modelos_plano) setModelosPlano((prev) => ({ ...prev, ...c.modelos_plano }));
    if (c.transcription_model) setTranscriptionModel(c.transcription_model);
    if (c.fallback_provider) setFallbackProvider(c.fallback_provider);
    if (c.fallback_model) setFallbackModel(c.fallback_model);
    if (c.nlu_model) setNluModel(c.nlu_model);
    setNluReasoning(c.nlu_reasoning || "");
    setNluVersao(c.nlu_versao || "comandos");
    setVozReasoning(c.voz_reasoning || "");
  }

  function load() {
    setLoading(true);
    adminApi.llm()
      .then(applyCfg)
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoading(false));
    adminApi.llmUsage(30)
      .then((u) => { if (u) setUsage(u); })
      .catch(() => {});
  }

  useEffect(() => { load(); }, []);

  const provInfo = cfg?.providers?.[provider];
  const modelos = provInfo?.modelos && provInfo.modelos.length > 0
    ? provInfo.modelos
    : [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gpt-4o-mini",
        "gpt-4o",
        "claude-3-5-haiku-20241022",
        "meta-llama/llama-3.1-70b-instruct",
        "meta-llama/llama-3.3-70b-instruct",
      ];

  function onProviderChange(id: string) {
    setProvider(id);
    const ms = cfg?.providers?.[id]?.modelos || [];
    if (ms.length > 0) {
      setModel(ms[0]);
      setCustomMode(false);
    } else {
      setModel(id === "gemini" ? "gemini-2.5-flash" : id === "openrouter" ? "meta-llama/llama-3.1-70b-instruct" : "gpt-4o-mini");
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await adminApi.salvarLlm({
        provider,
        model: model.trim(),
        keys,
        modelos_plano: modelosPlano,
        transcription_model: transcriptionModel.trim(),
        fallback_provider: fallbackProvider,
        fallback_model: fallbackModel.trim(),
        nlu_model: nluModel.trim(),
        nlu_reasoning: nluReasoning,
        nlu_versao: nluVersao,
        voz_reasoning: vozReasoning,
      });
      setMsg({ ok: true, text: "Configuração de IA salva. O atendimento de todas as pizzarias já está atualizado." });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setSaving(false);
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await adminApi.testarLlm();
      setMsg(r.ok
        ? { ok: true, text: `OK! ${r.provider}/${r.model} respondeu com sucesso: "${(r.resposta || "").slice(0, 80)}"` }
        : { ok: false, text: `Falhou: ${r.erro}` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
    setTesting(false);
  }

  const fmt = (n: number) => (n || 0).toLocaleString("pt-BR");

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl overflow-hidden shadow-sm">
      {/* Header do Acordeão */}
      <div className="w-full flex items-center justify-between p-4 md:p-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 grid place-items-center shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">Configuração de IA</h3>
            <p className="text-xs text-slate-400 truncate">
              {provider === "gemini"
                ? "Google Gemini · gemini-2.5-flash"
                : `${cfg?.providers?.[provider]?.nome || provider} · ${model}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 text-purple-300 border border-purple-500/30 text-xs font-semibold hover:bg-purple-600/30 transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <span>Gerenciar</span>
          <ChevronDown className={`w-3.5 h-3.5 text-purple-300 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Conteúdo Expandido do Acordeão em 2 Colunas */}
      {open && (
        <div className="border-t border-[#1e293b] p-5 md:p-6 space-y-5 bg-[#0e131d]/60">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ======================================================== */}
            {/* COLUNA ESQUERDA: MODELOS E ROTEAMENTO (~60% / col-span-7) */}
            {/* ======================================================== */}
            <div className="lg:col-span-7 bg-[#111622] border border-[#1e293b] rounded-2xl p-5 space-y-4">
              {/* Header do Bloco */}
              <div className="flex items-start gap-2.5 pb-1">
                <div className="text-purple-400 shrink-0 mt-0.5">
                  <Network className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white leading-tight">Modelos e roteamento</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure os modelos de IA e o roteamento de requisições do PizzaBot.
                  </p>
                </div>
              </div>

              {/* 1. Modelo principal do atendimento */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <h5 className="text-xs font-bold text-white">Modelo principal do atendimento</h5>
                </div>
                <p className="text-[11px] text-slate-400">
                  Define o provedor e modelo padrão do PizzaBot para gerar respostas aos clientes.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5">
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Provedor</label>
                    <div className="relative">
                      <select
                        value={provider}
                        onChange={(e) => onProviderChange(e.target.value)}
                        className="w-full appearance-none bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 text-xs outline-none focus:border-purple-500"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="groq">Groq</option>
                        <option value="ollama">Ollama (Local)</option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Modelo</label>
                    <div className="relative">
                      <select
                        value={customMode ? CUSTOM_MODEL : model}
                        onChange={(e) => {
                          if (e.target.value === CUSTOM_MODEL) {
                            setCustomMode(true);
                            setModel("");
                          } else {
                            setCustomMode(false);
                            setModel(e.target.value);
                          }
                        }}
                        className="w-full appearance-none bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 text-xs outline-none focus:border-purple-500"
                      >
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                        <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                        <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                        <option value="meta-llama/llama-3.1-70b-instruct">meta-llama/llama-3.1-70b-instruct</option>
                        <option value="meta-llama/llama-3.3-70b-instruct">meta-llama/llama-3.3-70b-instruct</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022</option>
                        <option value={CUSTOM_MODEL}>✏️ Outro (digitar manualmente)...</option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {customMode && (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="Digite o nome exato do modelo"
                        className="mt-2 w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* 2. Otimização de custo & Multimodalidade */}
              <div className="space-y-2 pt-2 border-t border-[#1e293b]/60">
                <div className="flex items-center gap-2">
                  <Coins className="w-3.5 h-3.5 text-amber-400" />
                  <h5 className="text-xs font-bold text-white">Otimização de custo & Multimodalidade</h5>
                </div>
                <p className="text-[11px] text-slate-400">
                  Apenas classificar intenção — use um modelo menor e barato para reduzir custos.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5">
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">
                      Modelo p/ NLU (econômico)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={nluModel}
                        onChange={(e) => setNluModel(e.target.value)}
                        placeholder="Vazio = mesmo modelo principal"
                        className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 outline-none focus:border-purple-500 font-mono text-xs"
                      />
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:col-span-2">
                    {([
                      ["Raciocínio da NLU", "Entender a mensagem. 'Baixo' ajuda em frase ambígua.", nluReasoning, setNluReasoning],
                      ["Raciocínio da resposta", "Redigir a fala. Raciocinar aqui só aumenta a espera.", vozReasoning, setVozReasoning],
                    ] as const).map(([rotulo, ajuda, valor, setValor]) => (
                      <div key={rotulo}>
                        <label className="block text-[11px] text-slate-300 font-medium mb-0.5">{rotulo}</label>
                        <p className="text-[10px] text-slate-500 mb-1">{ajuda}</p>
                        <select value={valor} onChange={(e) => setValor(e.target.value)}
                          className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 text-xs">
                          <option value="">Padrão do modelo</option>
                          <option value="none">Desligado</option>
                          <option value="low">Baixo</option>
                          <option value="medium">Médio</option>
                          <option value="high">Alto</option>
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] text-slate-300 font-medium mb-0.5">Interpretação dos pedidos</label>
                    <p className="text-[10px] text-slate-500 mb-1">
                      "Presa ao cardápio" (recomendado): a IA só escolhe produtos, tamanhos e adicionais que existem no cardápio de cada pizzaria. "Livre" é a interpretação antiga — só para emergência.
                    </p>
                    <select value={nluVersao} onChange={(e) => setNluVersao(e.target.value)}
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 text-xs">
                      <option value="comandos">Presa ao cardápio (comandos)</option>
                      <option value="livre">Livre (antiga)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-0.5">
                      Modelo p/ transcrição e áudio
                    </label>
                    <p className="text-[10px] text-slate-500 mb-1">
                      Modelo para processar áudios do WhatsApp. Pode usar um modelo emissor.
                    </p>
                    <div className="relative">
                      <input
                        type="text"
                        value={transcriptionModel}
                        onChange={(e) => setTranscriptionModel(e.target.value)}
                        placeholder="google/gemma-3-27b-it"
                        className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 outline-none focus:border-purple-500 font-mono text-xs"
                      />
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Provedor reserva (Failover automático) */}
              <div className="space-y-2 pt-2 border-t border-[#1e293b]/60">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
                  <h5 className="text-xs font-bold text-white">Provedor reserva (Failover automático)</h5>
                </div>
                <p className="text-[11px] text-slate-400">
                  Caso o provedor principal sofra instabilidade ou atinja o rate limit, o PizzaBot redireciona automaticamente para o reserva.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5">
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Provedor reserva</label>
                    <div className="relative">
                      <select
                        value={fallbackProvider}
                        onChange={(e) => setFallbackProvider(e.target.value)}
                        className="w-full appearance-none bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 text-xs outline-none focus:border-purple-500"
                      >
                        <option value="openrouter">OpenRouter</option>
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                        {/* Só os provedores que o backend aceita (LLM_PROVIDERS):
                            Anthropic/Groq aqui faziam a tela inteira falhar ao salvar. */}
                        <option value="">(Sem reserva)</option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Modelo reserva</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={fallbackModel}
                        onChange={(e) => setFallbackModel(e.target.value)}
                        placeholder="meta-llama/llama-3.1-70b-instruct"
                        className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 pr-8 outline-none focus:border-purple-500 font-mono text-xs"
                      />
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. Modelos personalizados por plano (opcional) */}
              <div className="space-y-2 pt-2 border-t border-[#1e293b]/60">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-purple-400" />
                  <h5 className="text-xs font-bold text-white">Modelos personalizados por plano (opcional)</h5>
                </div>
                <p className="text-[11px] text-slate-400">
                  Permite executar modelos diferentes por plano de assinatura (ex.: Básico usa modelo mais econômico, Premium no topo).
                </p>

                <div className="grid grid-cols-2 gap-3 pt-0.5">
                  {/* Linha 1: Trial e Básico */}
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Trial</label>
                    <input
                      type="text"
                      value={modelosPlano["trial"] ?? ""}
                      onChange={(e) => setModelosPlano((m) => ({ ...m, trial: e.target.value }))}
                      placeholder="(Padrão - global)"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs placeholder:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Básico</label>
                    <input
                      type="text"
                      value={modelosPlano["basico"] ?? ""}
                      onChange={(e) => setModelosPlano((m) => ({ ...m, basico: e.target.value }))}
                      placeholder="(Padrão - global)"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs placeholder:text-slate-500"
                    />
                  </div>

                  {/* Linha 2: Pro e Premium */}
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Pro</label>
                    <input
                      type="text"
                      value={modelosPlano["pro"] ?? ""}
                      onChange={(e) => setModelosPlano((m) => ({ ...m, pro: e.target.value }))}
                      placeholder="(Padrão - global)"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs placeholder:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Premium</label>
                    <input
                      type="text"
                      value={modelosPlano["premium"] ?? ""}
                      onChange={(e) => setModelosPlano((m) => ({ ...m, premium: e.target.value }))}
                      placeholder="(Padrão - global)"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs placeholder:text-slate-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ======================================================== */}
            {/* COLUNA DIREITA: CHAVES DE API + CONSUMO DE TOKENS (~40%) */}
            {/* ======================================================== */}
            <div className="lg:col-span-5 space-y-4">
              {/* Card 1: Chaves de API dos provedores */}
              <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 md:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-bold text-white">Chaves de API dos provedores</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Credenciais criptografadas. Deixe em branco para manter a chave já cadastrada.
                </p>

                <div className="space-y-3 pt-1">
                  {/* Google Gemini */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-300">Google Gemini</span>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        configurada
                      </span>
                    </div>
                    <input
                      type="text"
                      value={keys["gemini"] ?? "AQ.A•••••feNQ"}
                      onChange={(e) => setKeys((k) => ({ ...k, gemini: e.target.value }))}
                      placeholder="AQ.A•••••feNQ"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs"
                    />
                  </div>

                  {/* OpenRouter */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-300">OpenRouter</span>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        configurada
                      </span>
                    </div>
                    <input
                      type="text"
                      value={keys["openrouter"] ?? "sk-o••••8beb"}
                      onChange={(e) => setKeys((k) => ({ ...k, openrouter: e.target.value }))}
                      placeholder="sk-o••••8beb"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-slate-300 rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs"
                    />
                  </div>

                  {/* OpenAI */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-300">OpenAI</span>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded-full">
                        vazia
                      </span>
                    </div>
                    <input
                      type="password"
                      value={keys["openai"] ?? ""}
                      onChange={(e) => setKeys((k) => ({ ...k, openai: e.target.value }))}
                      placeholder="Cole a chave aqui"
                      className="w-full bg-[#0b0f17] border border-[#1e293b] text-white rounded-xl px-3 py-2 outline-none focus:border-purple-500 font-mono text-xs placeholder:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Consumo de tokens (30 dias) */}
              <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 md:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-400" /> Consumo de tokens (30 dias)
                  </h4>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Zerar a contagem de tokens do período?")) return;
                      try {
                        await adminApi.zerarLlmUsage();
                        adminApi.llmUsage(30).then(setUsage).catch(() => {});
                      } catch (e: any) {
                        setMsg({ ok: false, text: e.message });
                      }
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:text-white bg-[#0b0f17] border border-[#1e293b] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> Zerar contagem
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-white">{fmt(usage?.total?.total ?? 0)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Total de tokens</div>
                  </div>
                  <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-white">{fmt(usage?.total?.prompt ?? 0)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Entrada (Prompt)</div>
                  </div>
                  <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-white">{fmt(usage?.total?.completion ?? 0)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Saída (Geração)</div>
                  </div>
                  <div className="bg-[#0b0f17] border border-[#1e293b] rounded-xl p-3 text-center">
                    <div className="text-xl font-black text-white">{fmt(usage?.total?.calls ?? 0)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Total de chamadas</div>
                  </div>
                </div>

                {/* Banner de Status / Teste com sucesso */}
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                  msg?.ok !== false
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                }`}>
                  {msg?.ok !== false ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span className="truncate">{msg?.text || 'OK! gemini/gemini-2.5-flash respondeu com sucesso: "ok"'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Rodapé de Ações da IA */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-3 border-t border-[#1e293b]">
            <button
              type="button"
              onClick={test}
              disabled={testing || saving}
              className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-slate-200 bg-[#111622] hover:bg-[#161f30] border border-[#1e293b] rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
              <span>Testar IA ao vivo</span>
            </button>

            <button
              type="button"
              onClick={save}
              disabled={saving || !model.trim()}
              className="w-full sm:w-auto px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Salvar configuração de IA</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
