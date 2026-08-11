/**
 * Painel de Administração da Plataforma (platform admin).
 *
 * Dashboard do dono do SaaS — separado do operacional de cada pizzaria:
 *  - KPIs agregados (faturamento, pedidos, ticket, cancelamento) com Δ vs período anterior
 *  - Indicadores da base (pizzarias ativas, novas, conversas, clientes)
 *  - Gráfico de faturamento por dia (todas as pizzarias somadas)
 *  - Ranking de pizzarias por faturamento
 *  - Distribuição por plano
 *  - Gestão: listar / criar / editar / remover / "Entrar" em cada pizzaria
 */
import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import {
  Pizza, LogOut, Plus, Pencil, Trash2, Save, X, Loader2, AlertCircle, LogIn,
  Store, Power, TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  Receipt, Ban, MessageSquare, Users, Sparkles, Trophy,
  Building2, User, Mail, Phone, MapPin, Smartphone, KeyRound, Eye, EyeOff, Wand2, Check,
  QrCode, Wifi, WifiOff, RefreshCw, CheckCircle2, Cpu, Zap, ChevronDown, Coins, Search, Activity,
} from "lucide-react";
import { BackendPizzaria, pizzariasApi, adminApi, AdminOverview, AdminFaturaItem, LLMConfig, LLMUsage, WhatsAppConnect } from "../../lib/api";

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

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pizzaSearch, setPizzaSearch] = useState("");

  const modalOpen = creating || !!editingId;

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
    // Validação do login do dono (apenas na criação)
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
        // Onboarding: já abre o QR pra conectar o WhatsApp da nova pizzaria.
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

  // Polling de status enquanto o QR está aberto e ainda não conectou.
  useEffect(() => {
    if (!qrPizz || qrConnected) return;
    const statusT = setInterval(async () => {
      try {
        const st = await pizzariasApi.whatsappStatus(qrPizz.id);
        if (st.conectado) { setQrConnected(true); refreshAll(); }
      } catch { /* silencioso */ }
    }, 3500);
    // QR da Evolution expira rápido — regenera a cada 28s.
    const qrT = setInterval(() => { refreshQr(); }, 28000);
    return () => { clearInterval(statusT); clearInterval(qrT); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrPizz, qrConnected]);

  async function remove(p: BackendPizzaria) {
    if (!confirm(`Remover a pizzaria "${p.nome}"? Isso apaga equipe, cardápio e pedidos dela. Esta ação é irreversível.`)) return;
    setBusyId(p.id);
    setErr(null);
    try {
      await pizzariasApi.delete(p.id);
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao remover."); }
    setBusyId(null);
  }

  const r = ov?.resumo;
  const assinaturaById = (id: string) => ov?.assinaturas.find((a) => a.id === id);
  const pizzariasFiltradas = pizzarias.filter((p) => {
    const termo = pizzaSearch.trim().toLocaleLowerCase("pt-BR");
    return !termo || (p.nome + " " + p.plano + " " + (p.instancia || "")).toLocaleLowerCase("pt-BR").includes(termo);
  });

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

  return (
    <div className="pzb-platform-admin min-h-screen w-full min-w-0 max-w-full overflow-x-hidden bg-[#070b12] text-slate-100 flex flex-col">
      {/* Header */}
      <header className="pzb-platform-admin-header sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#090e16] px-4 py-3 md:bg-[#090e16]/95 md:px-6 md:backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
            <Pizza className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black text-white leading-tight">PizzaBot — Administração</h1>
            <p className="text-xs text-slate-500">Painel da plataforma</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-500">{userName}</span>
          <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </header>

      <main className="min-w-0 flex-1 p-4 md:p-6 max-w-[1500px] w-full mx-auto space-y-5">
        {/* Título + seletor de período */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Visão geral</h2>
            <p className="text-sm text-slate-500">Desempenho consolidado de todas as pizzarias.</p>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-white/[0.035] p-1">
            {PERIODOS.map((p) => (
              <button key={p.value} onClick={() => setDays(p.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === p.value ? "bg-orange-500 text-white shadow-lg shadow-orange-950/30" : "text-slate-500 hover:text-white"
                }`}>{p.label}</button>
            ))}
          </div>
        </div>

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}


        {loadingOv && !ov ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
        ) : r ? (
          <>
            {/* KPIs de faturamento recorrente */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={<DollarSign className="w-4 h-4 text-emerald-500" />} label="MRR (receita mensal)"
                value={brl(r.mrr)} />
              <Kpi icon={<TrendingUp className="w-4 h-4 text-violet-500" />} label="ARR (anual projetado)"
                value={brl(r.arr)} />
              <Kpi icon={<Store className="w-4 h-4 text-orange-500" />} label="Assinantes ativos"
                value={`${r.pizzarias_ativas}/${r.total_pizzarias}`} subtle={`${r.pizzarias_inativas} inativas`} />
              <Kpi icon={<Sparkles className="w-4 h-4 text-sky-500" />} label={`Novas (${days}d)`}
                value={String(r.pizzarias_novas)} subtle={`Ticket médio ${brl(r.ticket_medio_plano)}`} />
            </div>

            {/* Planos e receita por plano */}
            <div className="grid md:grid-cols-3 gap-3">
              {ov.planos.map((pl) => {
                const cat = ov.catalogo.find((c) => c.id === pl.plano);
                return (
                  <div key={pl.plano} className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-800">{pl.nome}</h3>
                      <span className="text-xs font-semibold text-emerald-600">{brl(pl.preco)}/mês</span>
                    </div>
                    <div className="flex items-end gap-1 mt-1">
                      <span className="text-2xl font-bold text-slate-800">{pl.qtd}</span>
                      <span className="text-xs text-slate-400 mb-1">assinante{pl.qtd === 1 ? "" : "s"}</span>
                    </div>
                    <p className="text-xs text-slate-500">Receita: <strong className="text-slate-700">{brl(pl.subtotal)}</strong>/mês</p>
                    {cat && (
                      <ul className="mt-2.5 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500 space-y-0.5">
                        <li>Até <strong>{cat.limites.produtos}</strong> produtos</li>
                        <li>Até <strong>{cat.limites.conversas_mes}</strong> conversas/mês</li>
                        <li>Até <strong>{cat.limites.equipe}</strong> na equipe</li>
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            <AdminInsights overview={ov} pizzarias={pizzarias} />
            <div className="grid gap-4 xl:grid-cols-2">
              <AssinaturasCard catalogo={ov?.catalogo ?? []} />
              <div className="space-y-4">
                <FaturasCard />
                <AlertasCard />
              </div>
            </div>
</>
        ) : null}

        {/* ====== Inteligência Artificial (provider/modelo/chaves) ====== */}
        <LLMConfigCard />

        {/* ====== Gestão de pizzarias ====== */}
        <div className="flex flex-col gap-3 pt-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Gestão da base</span>
            <h2 className="mt-1 text-lg font-black text-white">Pizzarias</h2>
            <p className="text-sm text-slate-500">Empresas cadastradas, integrações e acessos.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-500" />
              <input value={pizzaSearch} onChange={(e) => setPizzaSearch(e.target.value)} placeholder="Buscar por nome, plano ou instância" className="w-full rounded-xl border border-white/10 bg-white/[0.035] py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-orange-400/50" />
            </label>
            <button onClick={startCreate} className="flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-950/30 hover:bg-orange-400">
              <Plus className="w-4 h-4" /> Nova pizzaria
            </button>
          </div>
        </div>


        {/* ====== Modal criar/editar pizzaria ====== */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={cancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-[fadeIn_.15s_ease-out]"
              onClick={(e) => e.stopPropagation()}>
              {/* Cabeçalho */}
              <div className="relative px-5 py-4 bg-brand-gradient text-white">
                <button onClick={cancel} className="absolute right-3 top-3 p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    {editingId ? <Pencil className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="font-bold text-base leading-tight">{editingId ? "Editar pizzaria" : "Nova pizzaria"}</h3>
                    <p className="text-xs text-white/80">
                      {editingId ? "Atualize os dados da empresa" : "Cadastre a empresa e o acesso do dono"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Corpo (scroll) */}
              <div className="px-5 py-4 overflow-y-auto space-y-5">
                {/* Seção: Dados da pizzaria */}
                <section className="space-y-3">
                  <SectionTitle icon={<Store className="w-3.5 h-3.5" />} title="Dados da pizzaria" />
                  <IconField label="Nome da pizzaria" icon={<Building2 className="w-4 h-4" />} required>
                    <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      className={inputIcon} placeholder="Ex.: Pizzaria do Zé" />
                  </IconField>
                  <div className="grid md:grid-cols-2 gap-3">
                    <IconField label="WhatsApp do dono" icon={<Phone className="w-4 h-4" />}>
                      <input value={form.telefone_admin} onChange={(e) => setForm({ ...form, telefone_admin: e.target.value })}
                        className={inputIcon} placeholder="5511999999999" />
                    </IconField>
                    <IconField label="Instância Evolution" icon={<Smartphone className="w-4 h-4" />}>
                      <input value={form.instancia} onChange={(e) => setForm({ ...form, instancia: e.target.value })}
                        className={inputIcon} placeholder="pizzaria-do-ze" />
                    </IconField>
                  </div>
                  <IconField label="Endereço" icon={<MapPin className="w-4 h-4" />}>
                    <input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                      className={inputIcon} placeholder="Rua, número, bairro" />
                  </IconField>
                </section>

                {/* Seção: Acesso do dono — só na criação */}
                {!editingId && (
                  <section className="space-y-3">
                    <SectionTitle icon={<KeyRound className="w-3.5 h-3.5" />} title="Acesso do dono ao painel"
                      hint="Login que o dono vai usar para entrar" />
                    <div className="grid md:grid-cols-2 gap-3">
                      <IconField label="Nome do dono" icon={<User className="w-4 h-4" />}>
                        <input value={form.owner_nome} onChange={(e) => setForm({ ...form, owner_nome: e.target.value })}
                          className={inputIcon} placeholder="José da Silva" />
                      </IconField>
                      <IconField label="E-mail de login" icon={<Mail className="w-4 h-4" />} required>
                        <input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                          className={inputIcon} placeholder="dono@pizzaria.com" />
                      </IconField>
                    </div>
                    <IconField label="Senha inicial (mín. 8 caracteres)" icon={<KeyRound className="w-4 h-4" />} required>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><KeyRound className="w-4 h-4" /></span>
                        <input type={showPwd ? "text" : "password"} value={form.owner_senha}
                          onChange={(e) => setForm({ ...form, owner_senha: e.target.value })}
                          className="w-full pl-9 pr-20 py-2 border border-slate-200 rounded-lg text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
                          placeholder="Defina uma senha" />
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                          <button type="button" onClick={() => setShowPwd((v) => !v)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded" title={showPwd ? "Ocultar" : "Mostrar"}>
                            {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button type="button" onClick={genPassword}
                            className="p-1.5 text-orange-500 hover:bg-orange-50 rounded" title="Gerar senha">
                            <Wand2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </IconField>
                    <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>Anote e repasse essas credenciais ao dono. Ele entra em <strong>{window.location.host}</strong> com esse e-mail e senha.</span>
                    </div>
                  </section>
                )}

                {err && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {err}
                  </div>
                )}
              </div>

              {/* Rodapé */}
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
                <button onClick={cancel}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200/60 rounded-lg font-medium transition-colors">
                  Cancelar
                </button>
                <button onClick={save} disabled={saving || !form.nome.trim()}
                  className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg flex items-center gap-1.5 font-medium shadow-sm disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" />
                    : editingId ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  {editingId ? "Salvar alterações" : "Criar pizzaria"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====== Modal Conectar WhatsApp (QR) ====== */}
        {qrPizz && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={closeWhatsApp}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              {/* Cabeçalho */}
              <div className="relative px-5 py-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white">
                <button onClick={closeWhatsApp} className="absolute right-3 top-3 p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-base leading-tight truncate">Conectar WhatsApp</h3>
                    <p className="text-xs text-white/80 truncate">{qrPizz.nome}</p>
                  </div>
                </div>
              </div>

              <div className="p-5">
                {qrConnected ? (
                  <div className="text-center py-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-3">
                      <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                    </div>
                    <p className="font-semibold text-slate-800">WhatsApp conectado!</p>
                    <p className="text-xs text-slate-500 mt-1">
                      A pizzaria já está recebendo e respondendo mensagens.
                    </p>
                    <button onClick={closeWhatsApp}
                      className="mt-5 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium">
                      Concluir
                    </button>
                  </div>
                ) : qrErr ? (
                  <div className="text-center py-6">
                    <div className="w-14 h-14 rounded-full bg-red-100 grid place-items-center mx-auto mb-3">
                      <WifiOff className="w-7 h-7 text-red-500" />
                    </div>
                    <p className="text-sm text-red-600 font-medium">{qrErr}</p>
                    <button onClick={() => openWhatsApp(qrPizz)}
                      className="mt-4 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium inline-flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4" /> Tentar de novo
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Passo a passo */}
                    <ol className="text-xs text-slate-500 space-y-0.5 mb-3 list-decimal list-inside">
                      <li>Abra o WhatsApp no celular da pizzaria</li>
                      <li>Toque em <strong>Aparelhos conectados → Conectar</strong></li>
                      <li>Aponte a câmera para o QR Code abaixo</li>
                    </ol>

                    <div className="aspect-square w-full max-w-[260px] mx-auto rounded-xl border-2 border-dashed border-slate-200 grid place-items-center overflow-hidden bg-slate-50">
                      {qrLoading && !qrData?.qrcode?.base64 ? (
                        <div className="text-center text-slate-400">
                          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                          <p className="text-xs">Gerando QR Code…</p>
                        </div>
                      ) : qrData?.qrcode?.base64 ? (
                        <img
                          src={qrData.qrcode.base64.startsWith("data:")
                            ? qrData.qrcode.base64
                            : `data:image/png;base64,${qrData.qrcode.base64}`}
                          alt="QR Code do WhatsApp"
                          className="w-full h-full object-contain p-2"
                        />
                      ) : (
                        <div className="text-center text-slate-400 px-4">
                          <QrCode className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-xs">QR Code indisponível. Tente gerar novamente.</p>
                        </div>
                      )}
                    </div>

                    {qrData?.qrcode?.pairingCode && (
                      <p className="text-center text-xs text-slate-500 mt-3">
                        Ou use o código: <span className="font-mono font-bold text-slate-700 tracking-wider">{qrData.qrcode.pairingCode}</span>
                      </p>
                    )}

                    <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-slate-400">
                      <Wifi className="w-3.5 h-3.5 animate-pulse" />
                      Aguardando leitura…
                    </div>

                    <button onClick={refreshQr} disabled={qrLoading}
                      className="mt-3 w-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                      {qrLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Gerar novo QR
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {pizzariasFiltradas.length === 0 && !creating && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
              Nenhuma pizzaria cadastrada ainda. Clique em <strong>Nova pizzaria</strong> para começar.
            </div>
          )}
          {pizzariasFiltradas.map((p) => (
            <div key={p.id} className="pzb-platform-pizzeria-card bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-start gap-3 hover:shadow-sm transition-shadow sm:flex-nowrap sm:items-center">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {p.logo_url ? <img src={p.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-slate-400" />}
              </div>
              <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-auto">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm truncate">{p.nome}</span>
                  <select
                    value={p.plano}
                    disabled={busyId === p.id}
                    onChange={(e) => changePlan(p, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 outline-none cursor-pointer disabled:opacity-50"
                    title="Plano de assinatura"
                  >
                    {(ov?.catalogo ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    p.bot_ativo_global ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    <Power className="w-2.5 h-2.5" /> {p.bot_ativo_global ? "Bot on" : "Bot off"}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={(e) => { e.stopPropagation(); togglePipeline(p); }}
                    title="Pipeline FSM (experimental): NLU → backend → voz"
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer disabled:opacity-50 ${
                      p.pipeline_fsm ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}>
                    FSM {p.pipeline_fsm ? "ON" : "off"}
                  </button>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {(() => { const a = assinaturaById(p.id); return a ? `${brl(a.preco_mensal)}/mês · ${a.uso.produtos} produtos · ${a.uso.conversas} conversas` : (p.instancia ? `Instância: ${p.instancia}` : "Sem instância Evolution"); })()}
                </p>
              </div>
              <div className="flex w-full items-center justify-end gap-1 border-t border-white/10 pt-3 shrink-0 sm:w-auto sm:border-0 sm:pt-0">
                <button onClick={() => openWhatsApp(p)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md font-medium"
                  title="Conectar WhatsApp">
                  <QrCode className="w-3.5 h-3.5" /> <span className="hidden sm:inline">WhatsApp</span>
                </button>
                <button onClick={() => onEnter(p)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-md font-medium">
                  <LogIn className="w-3.5 h-3.5" /> Entrar
                </button>
                <button onClick={() => startEdit(p)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(p)} disabled={busyId === p.id}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-50" title="Remover">
                  {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

// ============================================

function AdminInsights({ overview, pizzarias }: { overview: AdminOverview; pizzarias: BackendPizzaria[] }) {
  const planos = overview.planos.map((pl) => ({ nome: pl.nome, receita: pl.subtotal, assinantes: pl.qtd }));
  const whatsapp = pizzarias.filter((p) => p.whatsapp_estado === "open").length;
  const bots = pizzarias.filter((p) => p.bot_ativo_global).length;
  const fsm = pizzarias.filter((p) => p.pipeline_fsm).length;
  const total = Math.max(pizzarias.length, 1);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.9fr)]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Crescimento</p><h3 className="mt-1 text-sm font-bold text-white">Novas assinaturas</h3></div>
          <span className="rounded-full bg-orange-400/10 px-2.5 py-1 text-[10px] font-bold text-orange-300">{overview.periodo_dias} dias</span>
        </div>
        {overview.serie_novas.length === 0 ? <Empty msg="Sem novas assinaturas no período." /> : (
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={overview.serie_novas} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
              <defs><linearGradient id="adminGrowth" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fb923c" stopOpacity={0.42} /><stop offset="100%" stopColor="#fb923c" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,.10)" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <RTooltip labelFormatter={(label) => "Dia " + label} formatter={(value: any) => [value, "Novas"]} contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,.10)", background: "#111722", color: "#fff" }} />
              <Area type="monotone" dataKey="qtd" stroke="#fb923c" strokeWidth={2.5} fill="url(#adminGrowth)" activeDot={{ r: 4, fill: "#fb923c" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">Receita recorrente</p><h3 className="mt-1 text-sm font-bold text-white">Distribuição por plano</h3>
          {planos.length === 0 ? <Empty msg="Sem planos ativos." /> : (
            <ResponsiveContainer width="100%" height={145}>
              <BarChart data={planos} margin={{ top: 18, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(148,163,184,.08)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={(v) => "R$" + Number(v) / 1000 + "k"} />
                <RTooltip formatter={(value: any) => [brl(Number(value)), "MRR"]} contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,.10)", background: "#111722", color: "#fff" }} />
                <Bar dataKey="receita" fill="#8b5cf6" radius={[7, 7, 2, 2]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-4">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Saúde operacional</p><h3 className="mt-1 text-sm font-bold text-white">Serviços conectados</h3></div><Activity className="w-5 h-5 text-emerald-400" /></div>
          <div className="mt-4 space-y-3"><OperationBar label="WhatsApp conectado" value={whatsapp} total={total} color="bg-emerald-400" /><OperationBar label="Bots ativos" value={bots} total={total} color="bg-orange-400" /><OperationBar label="Pipeline FSM" value={fsm} total={total} color="bg-violet-400" /></div>
        </div>
      </div>
    </section>
  );
}
function OperationBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.min(100, Math.round((value / total) * 100));
  return <div><div className="mb-1.5 flex items-center justify-between text-[11px]"><span className="text-slate-500">{label}</span><strong className="text-slate-200">{value}/{total}</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className={"block h-full rounded-full " + color} style={{ width: pct + "%" }} /></div></div>;
}
// Faturas da plataforma (assinaturas via Asaas)
// ============================================
const FATURA_BADGE: Record<string, string> = {
  paga: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pendente: "bg-amber-50 text-amber-700 border-amber-200",
  vencida: "bg-red-50 text-red-700 border-red-200",
  cancelada: "bg-slate-100 text-slate-500 border-slate-200",
};

function FaturasCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [faturas, setFaturas] = useState<AdminFaturaItem[] | null>(null);
  const [resumo, setResumo] = useState<{ recebido_mes: number; pendentes: number; vencidas: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line
  }, [open]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white grid place-items-center shrink-0">
          <Receipt className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-slate-800">Faturas da plataforma</h2>
          <p className="text-xs text-slate-500 truncate">
            {resumo
              ? `${brlFmt(resumo.recebido_mes)} recebidos no mês · ${resumo.pendentes} pendente(s) · ${resumo.vencidas} vencida(s)`
              : "Cobranças das assinaturas das pizzarias (Asaas)."}
          </p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
          {loading && !faturas ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
          ) : !faturas || faturas.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">
              Nenhuma fatura ainda. Elas aparecem quando as pizzarias contratam um plano na aba Assinatura.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {faturas.map((f) => (
                <div key={f.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800 truncate">{f.pizzaria_nome}</span>
                    <span className="text-slate-400"> · {brlFmt(f.valor)} · venc. {fmtData(f.vencimento)}</span>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${FATURA_BADGE[f.status] || FATURA_BADGE.pendente}`}>
                    {f.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CUSTOM_MODEL = "__custom__";

function LLMConfigCard() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [modelosPlano, setModelosPlano] = useState<Record<string, string>>({});
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [fallbackProvider, setFallbackProvider] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [nluModel, setNluModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usage, setUsage] = useState<LLMUsage | null>(null);

  function applyCfg(c: LLMConfig) {
    setCfg(c); setProvider(c.provider); setKeys({});
    const modelos = c.providers[c.provider]?.modelos || [];
    setModel(c.model);
    setCustomMode(!modelos.includes(c.model));
    setModelosPlano(c.modelos_plano || {});
    setTranscriptionModel(c.transcription_model || "");
    setFallbackProvider(c.fallback_provider || "");
    setFallbackModel(c.fallback_model || "");
    setNluModel(c.nlu_model || "");
  }

  function load() {
    setLoading(true);
    adminApi.llm()
      .then(applyCfg)
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoading(false));
    adminApi.llmUsage(30).then(setUsage).catch(() => {});
  }
  // Carrega só quando expande pela 1ª vez.
  useEffect(() => { if (open && !cfg) load(); /* eslint-disable-next-line */ }, [open]);

  const provInfo = cfg?.providers?.[provider];
  const modelos = provInfo?.modelos || [];

  function onProviderChange(id: string) {
    setProvider(id);
    const ms = cfg?.providers[id]?.modelos || [];
    setModel(ms[0] || "");
    setCustomMode(false);
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await adminApi.salvarLlm({ provider, model: model.trim(), keys, modelos_plano: modelosPlano, transcription_model: transcriptionModel.trim(), fallback_provider: fallbackProvider, fallback_model: fallbackModel.trim(), nlu_model: nluModel.trim() });
      setMsg({ ok: true, text: "Configuração salva. O atendimento das pizzarias já usa este provedor/modelo." });
      load();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  }
  async function test() {
    setTesting(true); setMsg(null);
    try {
      const r = await adminApi.testarLlm();
      setMsg(r.ok
        ? { ok: true, text: `OK! ${r.provider}/${r.model} respondeu: "${(r.resposta || "").slice(0, 80)}"` }
        : { ok: false, text: `Falhou: ${r.erro}` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setTesting(false);
  }

  const fmt = (n: number) => n.toLocaleString("pt-BR");

  return (
    <section className="pzb-ai-console relative min-w-0 overflow-hidden rounded-3xl border border-violet-400/15 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.16),transparent_38%),#111722] shadow-[0_22px_70px_rgba(0,0,0,.18)]">
      {/* Cabeçalho clicável (ícone de configuração de IA) */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="group flex w-full min-w-0 items-center gap-3 p-5 text-left transition-colors hover:bg-white/[0.025] md:p-6">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-950/40">
          <Cpu className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-slate-800">Configuração de IA</h2>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">IA operacional</span>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {cfg ? `${cfg.providers[cfg.provider]?.nome || cfg.provider} · ${cfg.model}` : "Provedor, modelo e chaves que atendem as pizzarias."}
          </p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
        <span className="hidden rounded-full border border-violet-400/15 bg-violet-400/[0.08] px-3 py-1 text-[10px] font-bold text-violet-300 sm:inline">{open ? "Fechar" : "Gerenciar"}</span>
      </button>

      {open && (
        loading && !cfg ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>
        ) : cfg ? (
          <div className="space-y-4 border-t border-white/10 bg-black/10 px-4 pb-5 pt-5 md:px-6 md:pb-6">
            <div className="flex items-start gap-3 rounded-2xl border border-violet-400/15 bg-violet-400/[0.06] p-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Sparkles className="h-4 w-4" /></span><div className="min-w-0"><p className="text-sm font-black text-white">Modelo principal de atendimento</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Defina o c&eacute;rebro padr&atilde;o do PizzaBot. As op&ccedil;&otilde;es de economia e conting&ecirc;ncia abaixo complementam esta escolha.</p></div></div>
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Provedor</span>
                <select value={provider} onChange={(e) => onProviderChange(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400">
                  {Object.entries(cfg.providers).map(([id, p]: [string, any]) => (
                    <option key={id} value={id}>{p.nome}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Modelo</span>
                <select
                  value={customMode ? CUSTOM_MODEL : model}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_MODEL) { setCustomMode(true); setModel(""); }
                    else { setCustomMode(false); setModel(e.target.value); }
                  }}
                  className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400">
                  {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value={CUSTOM_MODEL}>✏️ Outro (digitar)…</option>
                </select>
                {customMode && (
                  <input value={model} onChange={(e) => setModel(e.target.value)}
                    placeholder="Digite o nome exato do modelo"
                    className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400 font-mono" />
                )}
              </label>
            </div>

            {/* Modelo por plano (custo/escala) — opcional */}
            {(cfg.planos?.length ?? 0) > 0 && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-700 mb-1">Modelo por plano (opcional)</p>
                <p className="text-[11px] text-slate-400 mb-2">Deixe vazio pra usar o modelo padrão acima. Ex.: Básico num modelo mais barato, Premium num melhor.</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  {(cfg.planos || []).map((p) => (
                    <label key={p} className="block">
                      <span className="text-[11px] font-medium text-slate-600 capitalize">{p}</span>
                      <input
                        value={modelosPlano[p] ?? ""}
                        onChange={(e) => setModelosPlano((m) => ({ ...m, [p]: e.target.value }))}
                        placeholder="(padrão)"
                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-violet-400 font-mono" />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
            {/* Modelo barato para a NLU (economia) */}
            <label className="block rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <span className="text-xs font-semibold text-slate-700">Modelo p/ NLU (economia)</span>
              <p className="text-[11px] text-slate-400 mb-1.5">A NLU só extrai JSON — um modelo barato (ex.: gemini-2.0-flash-lite) corta o custo sem perder qualidade. Vazio = mesmo modelo principal.</p>
              <input value={nluModel} onChange={(e) => setNluModel(e.target.value)}
                placeholder="ex.: gemini-2.0-flash-lite"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400 font-mono" />
            </label>

            {/* Modelo de transcrição de áudio (separado) */}
            <label className="block rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <span className="text-xs font-semibold text-slate-700">Modelo p/ transcrever áudio</span>
              <p className="text-[11px] text-slate-400 mb-1.5">Use um modelo que "ouça" áudio quando o modelo de resposta não ouve (ex.: Gemma). Vazio = mesmo modelo de resposta.</p>
              <input value={transcriptionModel} onChange={(e) => setTranscriptionModel(e.target.value)}
                placeholder="ex.: google/gemini-2.5-flash-lite"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400 font-mono" />
            </label>
            </div>

            {/* Provedor reserva (failover) */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-700 mb-1">Provedor reserva (failover)</p>
              <p className="text-[11px] text-slate-400 mb-2">Se o provedor principal falhar (instabilidade, chave inválida), a atendente tenta este automaticamente. Precisa da chave de API configurada abaixo. Vazio = sem reserva.</p>
              <div className="grid md:grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">Provedor</span>
                  <select value={fallbackProvider}
                    onChange={(e) => setFallbackProvider(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400">
                    <option value="">(sem reserva)</option>
                    {Object.entries(cfg.providers).map(([id, p]: [string, any]) => (
                      <option key={id} value={id}>{p.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">Modelo</span>
                  <input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)}
                    placeholder="ex.: gpt-4o-mini"
                    disabled={!fallbackProvider}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400 font-mono disabled:opacity-50" />
                </label>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start gap-3 border-b border-white/10 pb-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><KeyRound className="h-4 w-4" /></span><div><p className="text-sm font-black text-white">Chaves e provedores</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Credenciais protegidas para os provedores dispon&iacute;veis. Campos vazios preservam as chaves atuais.</p></div></div>
              {Object.entries(cfg.providers).map(([id, p]: [string, any]) => (
                <label key={id} className="block">
                  <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    Chave de API — {p.nome}
                    {cfg.keys_configuradas[id]
                      ? <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">configurada</span>
                      : <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">vazia</span>}
                  </span>
                  <input type="password" value={keys[id] ?? ""}
                    onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
                    placeholder={cfg.keys_mascaradas[id] || "Cole a chave aqui"}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-violet-400 font-mono" />
                </label>
              ))}
              <p className="text-[11px] text-slate-400">
                Deixe em branco para manter a chave já salva. As chaves nunca são exibidas — só a máscara.
              </p>
            </div>

            {msg && (
              <div className={`text-sm px-3 py-2 rounded-lg ${msg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {msg.text}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
              <button onClick={test} disabled={testing || saving}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 sm:w-auto">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Testar
              </button>
              <button onClick={save} disabled={saving || !model.trim()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-950/30 hover:opacity-90 disabled:opacity-50 sm:w-auto">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Salvar
              </button>
            </div>

            {/* Consumo de tokens */}
            {usage && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-amber-500" /> Consumo de tokens (30 dias)
                  </h3>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Zerar a contagem de tokens? Os registros de consumo serão apagados.")) return;
                      try { await adminApi.zerarLlmUsage(); adminApi.llmUsage(30).then(setUsage).catch(() => {}); }
                      catch (e: any) { setMsg({ ok: false, text: e.message }); }
                    }}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-200 sm:w-auto"
                  >
                    <RefreshCw className="w-3 h-3" /> Zerar contagem
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  <UsageStat label="Total" value={fmt(usage.total.total)} />
                  <UsageStat label="Entrada" value={fmt(usage.total.prompt)} />
                  <UsageStat label="Saída" value={fmt(usage.total.completion)} />
                  <UsageStat label="Chamadas" value={fmt(usage.total.calls)} />
                </div>
                {usage.por_pizzaria.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500">Por pizzaria</p>
                    {usage.por_pizzaria.map((u, i) => (
                      <div key={u.pizzaria_id || i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                        <span className="text-slate-700 truncate">{u.nome}</span>
                        <span className="text-slate-500 shrink-0 ml-2">{fmt(u.tokens)} tokens · {u.calls} chamadas</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Sem consumo registrado ainda.</p>
                )}
              </div>
            )}
          </div>
        ) : null
      )}
    </section>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-50 p-3 text-center">
      <div className="text-base font-bold text-slate-800 leading-none">{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function Kpi({ icon, label, value, delta, subtle }: {
  icon: React.ReactNode; label: string; value: string; delta?: number | null; subtle?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="bg-surface border border-line rounded-2xl p-3.5 shadow-card">
      <div className="flex items-center gap-2 text-xs text-ink-muted mb-1.5">
        <div className="w-8 h-8 rounded-xl bg-surface-muted flex items-center justify-center">{icon}</div>
        {label}
      </div>
      <div className="text-xl font-bold text-ink leading-tight">{value}</div>
      {delta != null ? (
        <div className={`flex items-center gap-1 text-xs mt-1 ${up ? "text-emerald-600" : "text-red-500"}`}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(delta)}% <span className="text-slate-400">vs período anterior</span>
        </div>
      ) : subtle ? (
        <div className="text-xs text-slate-400 mt-1">{subtle}</div>
      ) : null}
    </div>
  );
}

function MiniStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-3 flex items-center gap-3 shadow-card">
      <div className="w-9 h-9 rounded-xl bg-surface-muted flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-lg font-bold text-ink leading-none">{value}</div>
        <div className="text-xs text-ink-muted mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-slate-400 text-center py-10">{msg}</div>;
}

const inputIcon =
  "w-full pl-9 pr-2.5 py-2 bg-surface border border-line rounded-xl text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition";

function SectionTitle({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5 mb-3">
      <span className="flex-shrink-0 grid place-items-center w-7 h-7 rounded-lg bg-orange-100 text-orange-600">
        {icon}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-slate-800 leading-tight">{title}</h4>
        {hint && <p className="text-xs text-slate-400 leading-snug mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function IconField({
  label,
  icon,
  required,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-orange-500"> *</span>}
      </span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </span>
        {children}
      </div>
    </label>
  );
}

// ============================================
// Alertas da plataforma (falhas + preços suspeitos) — Fase 2
// ============================================
function AlertasCard() {
  const [data, setData] = useState<import("../../lib/api").AlertasResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try { setData(await adminApi.alertas(true)); } catch { /* silencioso */ }
    setLoading(false);
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);

  async function resolver(id: string) {
    setBusy(id);
    try { await adminApi.resolverAlerta(id); await load(); } finally { setBusy(null); }
  }

  const LABELS: Record<string, string> = {
    preco_suspeito: "Preço suspeito", falha_envio: "Falha de envio",
    falha_ia: "Falha da IA", falha_pagamento: "Falha de pagamento",
  };
  const COR: Record<string, string> = {
    error: "bg-red-100 text-red-700", warning: "bg-amber-100 text-amber-700", info: "bg-sky-100 text-sky-700",
  };

  if (loading) return null;
  const alertas = data?.alertas ?? [];
  if (alertas.length === 0) return null; // só aparece quando há algo a tratar

  const fmt = (s: string | null) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">Alertas</h3>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-100 text-red-700">{data?.abertos ?? alertas.length} aberto(s)</span>
      </div>
      <div className="divide-y divide-slate-100">
        {alertas.slice(0, 12).map((a) => (
          <div key={a.id} className="py-2.5 flex items-start gap-3">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${COR[a.nivel] || COR.warning}`}>
              {LABELS[a.tipo] || a.tipo}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-700 break-words">{a.detalhe}</p>
              <p className="text-[10px] text-slate-400">{a.pizzaria_nome ? a.pizzaria_nome + " · " : ""}{fmt(a.created_at)}</p>
            </div>
            <button onClick={() => resolver(a.id)} disabled={busy === a.id}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium shrink-0 disabled:opacity-50">
              Resolver
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================
// Assinaturas & Vencimentos (ciclo de 30 dias, suspensão manual)
// ============================================

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
      setFeedback("Plano alterado manualmente. Esta ação não recria a recorrência no Asaas.");
      await load();
    } finally { setBusy(null); }
  }
  async function renovar(id: string) {
    if (!window.confirm("Conceder 30 dias de acesso manual? Use apenas para pagamento confirmado fora do fluxo automático.")) return;
    setBusy(id); setFeedback(null);
    try {
      await adminApi.renovar(id);
      setFeedback("Crédito manual de 30 dias aplicado.");
      await load();
    } finally { setBusy(null); }
  }
  async function toggleSuspensao(id: string, suspender: boolean) {
    if (suspender && !window.confirm("Suspender esta pizzaria? O atendimento será desligado sem excluir os dados.")) return;
    setBusy(id); setFeedback(null);
    try {
      await adminApi.suspender(id, suspender, suspender ? "Inadimplência" : undefined);
      await load();
    } finally { setBusy(null); }
  }
  async function cancelarRecorrencia(item: import("../../lib/api").AssinaturaItem) {
    if (!window.confirm(`Cancelar a renovação automática de "${item.nome}"? O acesso atual permanece até ${fmtAdminDate(item.vence_em)}.`)) return;
    setBusy(item.pizzaria_id); setFeedback(null);
    try {
      await pizzariasApi.cancelarAssinatura(item.pizzaria_id);
      setFeedback(`Renovação automática de ${item.nome} cancelada no Asaas.`);
      await load();
    } catch (e: any) {
      setFeedback(e.message || "Não foi possível cancelar a recorrência.");
    } finally { setBusy(null); }
  }

  if (loading) return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 text-center"><Loader2 className="mx-auto w-5 h-5 animate-spin text-orange-400" /></div>;
  if (!data) return null;

  const { assinaturas, alertas, custo } = data;
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = assinaturas.filter((item) => {
    const texto = `${item.nome} ${item.plano_nome} ${item.cobranca_email || ""}`.toLocaleLowerCase("pt-BR");
    const matchBusca = !termo || texto.includes(termo);
    const matchFiltro = filtro === "todas"
      || (filtro === "recorrentes" && item.renovacao_automatica)
      || (filtro === "atencao" && (item.alerta === "vencida" || item.alerta === "vence_amanha" || item.suspensa))
      || (filtro === "sem_recorrencia" && !item.renovacao_automatica);
    return matchBusca && matchFiltro;
  });
  const recorrentes = assinaturas.filter((item) => item.renovacao_automatica).length;
  const semRecorrencia = assinaturas.length - recorrentes;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.16),transparent_38%)] p-5 md:p-6">
        <div className="flex min-w-0 flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="pzb-billing-status min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-violet-300"><Coins className="w-3.5 h-3.5" />{data.billing_disponivel ? "Asaas conectado" : "Asaas não configurado"}</div>
            </div>
            <div className="pzb-billing-title min-w-0">
            <h3 className="mt-4 text-xl font-black text-white">Central de assinaturas</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">Acompanhe recorrências, vencimentos, consumo e intervenções manuais sem misturar pagamento automático com concessão administrativa.</p>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-2 lg:w-[390px]">
            <AdminMiniMetric label="Recorrentes" value={recorrentes} tone="emerald" />
            <AdminMiniMetric label="Sem recorrência" value={semRecorrencia} tone="amber" />
            <AdminMiniMetric label="Atenção" value={alertas.vencida + alertas.vence_amanha} tone="rose" />
          </div>
        </div>

        {!data.billing_disponivel && <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs text-amber-300"><AlertCircle className="mr-2 inline w-4 h-4" />Configure <strong>ASAAS_PLATFORM_API_KEY</strong>, o ambiente da API e o token do webhook para ativar cobranças reais.</div>}

        <div className="mt-5 grid gap-2 md:grid-cols-3">
          <BillingStep icon={Receipt} title="1. Fatura emitida" text="O Asaas oferece Pix, boleto ou cartão ao assinante." />
          <BillingStep icon={Zap} title="2. Webhook recebido" text="Pagamento confirmado atualiza a fatura automaticamente." />
          <BillingStep icon={CheckCircle2} title="3. Ciclo renovado" text="O plano ganha mais 30 dias e uma suspensão é removida." />
        </div>
      </div>

      {custo && (
        <div className="grid grid-cols-1 gap-3 border-b border-white/10 p-4 sm:grid-cols-3 md:p-5">
          <FinancialMetric label="Receita mensal ativa" value={brl(custo.receita_total)} detail={`${recorrentes} recorrência${recorrentes === 1 ? "" : "s"} automática${recorrentes === 1 ? "" : "s"}`} tone="emerald" />
          <FinancialMetric label="Custo de IA estimado" value={brl(custo.custo_total_estimado)} detail={`${custo.tokens_total.toLocaleString("pt-BR")} tokens no mês`} tone="amber" />
          <FinancialMetric label="Margem estimada" value={brl(custo.margem_estimada)} detail="Receita de planos menos custo de IA" tone={custo.margem_estimada >= 0 ? "violet" : "rose"} />
        </div>
      )}

      {feedback && <div className="mx-4 mt-4 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-300 md:mx-5">{feedback}</div>}

      <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1">
          {([
            ["todas", "Todas"],
            ["recorrentes", "Recorrentes"],
            ["atencao", "Exigem atenção"],
            ["sem_recorrencia", "Sem recorrência"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFiltro(value)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${filtro === value ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-300"}`}>{label}</button>
          ))}
        </div>
        <label className="relative lg:w-80"><Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-600" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa, plano ou e-mail" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-700 focus:border-orange-400/50" /></label>
      </div>

      {filtradas.length === 0 ? <div className="p-12 text-center text-sm text-slate-600">Nenhuma assinatura corresponde aos filtros.</div> : (
        <div className="divide-y divide-white/[0.07]">
          {filtradas.map((item) => {
            const emAtencao = item.alerta === "vencida" || item.alerta === "vence_amanha" || item.suspensa;
            const usagePct = item.ia_limite ? Math.min(100, Math.round(item.ia_mensagens / item.ia_limite * 100)) : 0;
            const status = item.suspensa ? "Suspensa" : item.alerta === "vencida" ? "Vencida" : item.alerta === "vence_amanha" ? "Vence em breve" : item.alerta === "sem_plano" ? "Sem ciclo" : "Em dia";
            return (
              <article key={item.pizzaria_id} className="p-4 transition-colors hover:bg-white/[0.02] md:p-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(240px,.8fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-black text-white">{item.nome}</h4>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${item.renovacao_automatica ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{item.renovacao_automatica ? "Asaas recorrente" : "Sem renovação"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${emAtencao ? "bg-rose-400/10 text-rose-300" : "bg-white/5 text-slate-500"}`}>{status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{item.plano_nome} • {brl(item.preco_mensal)}/mês • vence {fmtAdminDate(item.vence_em)}</p>
                    <p className="mt-1 text-[10px] text-slate-700">{item.cobranca_email || "E-mail de cobrança ainda não informado"}</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[10px]"><span className="font-bold uppercase tracking-wider text-slate-600">Atendimentos do mês</span><strong className={usagePct >= 90 ? "text-rose-300" : usagePct >= 75 ? "text-amber-300" : "text-slate-300"}>{item.ia_mensagens}/{item.ia_limite}</strong></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className={`block h-full rounded-full ${usagePct >= 90 ? "bg-rose-400" : usagePct >= 75 ? "bg-amber-400" : "bg-violet-400"}`} style={{ width: `${usagePct}%` }} /></div>
                    <p className="mt-2 text-[10px] text-slate-700">Custo IA {brl(item.ia_custo || 0)} • margem {brl(item.margem || 0)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <select
                      value={item.plano}
                      disabled={busy === item.pizzaria_id || !!item.renovacao_automatica}
                      onChange={(e) => ativarPlano(item.pizzaria_id, e.target.value)}
                      title={item.renovacao_automatica ? "Troque o plano pela aba Assinatura da pizzaria para sincronizar com o Asaas." : "Alteração manual de plano"}
                      className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-bold text-slate-300 disabled:opacity-40"
                    >
                      {catalogo.map((plano) => <option key={plano.id} value={plano.id}>{plano.nome}</option>)}
                    </select>
                    <button type="button" onClick={() => renovar(item.pizzaria_id)} disabled={busy === item.pizzaria_id} title="Crédito manual para pagamento confirmado fora do Asaas" className="rounded-lg border border-sky-400/15 bg-sky-400/[0.07] px-2.5 py-1.5 text-xs font-bold text-sky-300 disabled:opacity-40">+30d manual</button>
                    <button type="button" onClick={() => toggleSuspensao(item.pizzaria_id, !item.suspensa)} disabled={busy === item.pizzaria_id} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-40 ${item.suspensa ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/[0.07] text-rose-300"}`}>{item.suspensa ? "Reativar" : "Suspender"}</button>
                    {item.renovacao_automatica && <button type="button" onClick={() => cancelarRecorrencia(item)} disabled={busy === item.pizzaria_id} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:border-rose-400/20 hover:text-rose-300 disabled:opacity-40">{busy === item.pizzaria_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Cancelar Asaas"}</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function fmtAdminDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}
function AdminMiniMetric({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const color = { emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300" }[tone];
  return <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-2 py-3 text-center"><p className={`text-xl font-black ${color}`}>{value}</p><p className="mt-1 break-words text-[8px] font-bold uppercase leading-tight tracking-[0.08em] text-slate-600">{label}</p></div>;
}
function BillingStep({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3.5"><span className="grid w-8 h-8 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Icon className="w-4 h-4" /></span><div className="min-w-0"><p className="break-words text-xs font-black leading-snug text-white">{title}</p><p className="mt-1 break-words text-[10px] leading-relaxed text-slate-600">{text}</p></div></div>;
}
function FinancialMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "emerald" | "amber" | "violet" | "rose" }) {
  const color = { emerald: "text-emerald-300", amber: "text-amber-300", violet: "text-violet-300", rose: "text-rose-300" }[tone];
  return <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-black/20 p-4"><p className="break-words text-[9px] font-bold uppercase leading-tight tracking-[0.08em] text-slate-600">{label}</p><p className={`mt-2 break-words text-xl font-black ${color}`}>{value}</p><p className="mt-1 break-words text-[10px] leading-relaxed text-slate-700">{detail}</p></div>;
}
