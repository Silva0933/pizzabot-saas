import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap,
  Crown,
  Bot,
  MessageSquare,
  CreditCard,
} from "lucide-react";
import { supabase } from "../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaasPizzeriaRow = {
  id: string;
  name: string;
  instance: string;
  plan: string;
  gateway: string;
  botActive: boolean;
  createdAt: string;
  totalOrders: number;
  activeOrders: number;
  pendingPayments: number;
  customers: number;
  conversations: number;
  humanEscalations: number;
  approvedRevenue: number;
  todayRevenue: number;
  operators: number;
  gatewayConfigured: boolean;
};

type PlanCounts = { basico: number; pro: number; enterprise: number };

type SaasSnapshot = {
  generatedAt: string;
  metrics: {
    totalPizzerias: number;
    activePizzerias: number;
    newPizzerias30d: number;
    totalCustomers: number;
    totalOrders: number;
    ordersToday: number;
    approvedRevenue: number;
    revenueToday: number;
    pendingPayments: number;
    humanEscalations: number;
    planCounts?: PlanCounts;
  };
  pizzerias: SaasPizzeriaRow[];
};

// ─── Plan config ──────────────────────────────────────────────────────────────

const PLANS: Record<string, { label: string; price: number; color: string; icon: React.ElementType }> = {
  basico:     { label: "Básico",     price: 99,  color: "bg-slate-700 text-slate-200",          icon: Store   },
  pro:        { label: "Pro",        price: 199, color: "bg-indigo-600/80 text-indigo-100",      icon: Zap     },
  enterprise: { label: "Enterprise", price: 399, color: "bg-amber-600/80 text-amber-100",        icon: Crown   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Hoje";
  if (d === 1) return "Ontem";
  if (d < 30) return `${d} dias atrás`;
  const m = Math.floor(d / 30);
  return `${m} ${m === 1 ? "mês" : "meses"} atrás`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SaasAdminViewProps {
  userEmail: string;
  onSignOut: () => void;
}

export function SaasAdminView({ userEmail, onSignOut }: SaasAdminViewProps) {
  const [snapshot, setSnapshot] = useState<SaasSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstance, setCreateInstance] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createOwnerEmail, setCreateOwnerEmail] = useState("");
  const [createPlan, setCreatePlan] = useState("basico");

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SaasPizzeriaRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("basico");
  const [editBotActive, setEditBotActive] = useState(true);
  const [editInstance, setEditInstance] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadSnapshot = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("get_saas_admin_snapshot");
    if (error) {
      setError(error.message);
      setSnapshot(null);
    } else {
      setSnapshot(data as SaasSnapshot);
    }
    setLoading(false);
  };

  useEffect(() => { loadSnapshot(); }, []);

  // ── Derived values ──────────────────────────────────────────────────────────

  const filteredPizzerias = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = snapshot?.pizzerias || [];
    if (!term) return rows;
    return rows.filter((p) =>
      p.name.toLowerCase().includes(term) ||
      p.instance.toLowerCase().includes(term) ||
      p.plan.toLowerCase().includes(term)
    );
  }, [query, snapshot]);

  const metrics = snapshot?.metrics;

  const mrr = useMemo(() => {
    if (!snapshot?.pizzerias) return 0;
    return snapshot.pizzerias.reduce((sum, p) => sum + (PLANS[p.plan]?.price || 0), 0);
  }, [snapshot]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const suggestInstance = (name: string) =>
    "pizzabot-" + name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38);

  const resetCreateForm = () => {
    setCreateName(""); setCreateInstance(""); setCreatePhone("");
    setCreateOwnerEmail(""); setCreatePlan("basico");
  };

  const handleCreatePizzeria = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setActionError(null);
    const { error } = await supabase.rpc("platform_create_pizzeria", {
      p_nome: createName.trim(),
      p_instancia: createInstance.trim() || null,
      p_telefone_admin: createPhone.trim() || null,
      p_owner_email: createOwnerEmail.trim() || null,
      p_plano: createPlan,
    });
    setCreating(false);
    if (error) { setActionError(error.message); return; }
    setCreateOpen(false);
    resetCreateForm();
    await loadSnapshot();
  };

  const openEdit = (p: SaasPizzeriaRow) => {
    setEditTarget(p);
    setEditName(p.name);
    setEditPlan(p.plan);
    setEditBotActive(p.botActive);
    setEditInstance(p.instance || "");
    setEditOpen(true);
    setActionError(null);
  };

  const handleEditPizzeria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    const { error } = await supabase.rpc("platform_update_pizzeria", {
      p_pizzaria_id: editTarget.id,
      p_nome: editName.trim() || null,
      p_plano: editPlan,
      p_bot_ativo: editBotActive,
      p_instancia: editInstance.trim() || null,
    });
    setSaving(false);
    if (error) { setActionError(error.message); return; }
    setEditOpen(false);
    await loadSnapshot();
  };

  const handleToggleBot = async (p: SaasPizzeriaRow) => {
    setTogglingId(p.id);
    setActionError(null);
    const { error } = await supabase.rpc("platform_update_pizzeria", {
      p_pizzaria_id: p.id,
      p_bot_ativo: !p.botActive,
    });
    setTogglingId(null);
    if (error) { setActionError(error.message); return; }
    await loadSnapshot();
  };

  const deleteEvolutionInstance = async (instanceName: string) => {
    const evolutionUrl = (import.meta.env.VITE_EVOLUTION_API_URL as string | undefined)?.replace(/\/$/, "");
    const evolutionKey = import.meta.env.VITE_EVOLUTION_API_KEY as string | undefined;
    if (!evolutionUrl || !evolutionKey || !instanceName) return;
    try {
      await fetch(`${evolutionUrl}/instance/delete/${encodeURIComponent(instanceName)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
      });
    } catch (err) {
      console.warn("Falha ao excluir instância Evolution.", err);
    }
  };

  const handleDeletePizzeria = async (pizzeria: SaasPizzeriaRow) => {
    const typed = window.prompt(
      `Excluir permanentemente "${pizzeria.name}"?\n\nIsso remove cardápio, clientes, pedidos, conversas, equipe e dados do banco.\nDigite EXCLUIR para confirmar.`
    );
    if (typed !== "EXCLUIR") return;
    setDeletingId(pizzeria.id);
    setActionError(null);
    const { error } = await supabase.rpc("platform_delete_pizzeria", { p_pizzaria_id: pizzeria.id });
    if (error) { setActionError(error.message); setDeletingId(null); return; }
    await deleteEvolutionInstance(pizzeria.instance);
    setDeletingId(null);
    await loadSnapshot();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden font-sans">

      {/* Header */}
      <header className="px-6 py-3.5 border-b border-slate-800 bg-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-950/30">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight">PizzaBot Platform Admin</h1>
              <span className="px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 text-[9px] font-bold uppercase tracking-widest font-mono">owner</span>
            </div>
            <p className="text-[10px] text-slate-500">{userEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nova pizzaria
          </button>
          <button onClick={loadSnapshot} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-60 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
          <button onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6 space-y-6">

        {/* Alerts */}
        {error && (
          <div className="p-4 rounded-xl border border-red-900/60 bg-red-950/40 text-red-200 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-300 mt-0.5" />
            <div>
              <p className="font-bold">Erro ao carregar painel SaaS.</p>
              <p className="text-xs text-red-200/80 mt-1">{error}</p>
              <p className="text-xs text-red-200/60 mt-1">
                Execute o arquivo <code className="font-mono">supabase/migrations/saas_admin_improvements.sql</code> no Supabase Dashboard se acabou de configurar.
              </p>
            </div>
          </div>
        )}
        {actionError && (
          <div className="p-3 rounded-xl border border-amber-900/60 bg-amber-950/40 text-amber-100 text-sm flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300 mt-0.5" />
            <p className="text-xs">{actionError}</p>
          </div>
        )}

        {loading && !snapshot ? (
          <div className="h-[60vh] flex items-center justify-center text-slate-400">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-orange-400" />
              <p className="text-sm font-semibold">Carregando métricas da plataforma...</p>
            </div>
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard icon={Store}        label="Pizzarias"         value={metrics?.totalPizzerias || 0}          sub={`${metrics?.activePizzerias || 0} com bot ativo`} />
              <KpiCard icon={TrendingUp}   label="MRR Estimado"      value={money.format(mrr)}                     sub="Receita mensal recorrente" accent="emerald" />
              <KpiCard icon={ShoppingBag}  label="Pedidos"           value={metrics?.totalOrders || 0}             sub={`${metrics?.ordersToday || 0} hoje`} />
              <KpiCard icon={DollarSign}   label="Receita Total"     value={money.format(metrics?.approvedRevenue || 0)} sub={`${money.format(metrics?.revenueToday || 0)} hoje`} accent="emerald" />
              <KpiCard icon={Wallet}       label="Pgtos pendentes"   value={metrics?.pendingPayments || 0}         sub="Aguardando confirmação" />
              <KpiCard icon={AlertTriangle} label="Humano necessário" value={metrics?.humanEscalations || 0}       sub="Escalações abertas" accent="rose" />
            </div>

            {/* Plan Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(PLANS).map(([key, plan]) => {
                const count = (metrics?.planCounts as any)?.[key] ?? snapshot?.pizzerias.filter(p => p.plan === key).length ?? 0;
                const PlanIcon = plan.icon;
                return (
                  <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${plan.color}`}>
                      <PlanIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-white">{count}</span>
                        <span className="text-xs text-slate-400 font-mono">pizzarias</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wide">
                        Plano {plan.label} · {money.format(plan.price)}/mês
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-300 font-mono">{money.format(count * plan.price)}</div>
                      <div className="text-[9px] text-slate-500">MRR</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pizzeria Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">Pizzarias cadastradas</h2>
                  <p className="text-xs text-slate-400">{filteredPizzerias.length} tenant(s) · visão operacional completa</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por nome, identificador ou plano..."
                    className="w-full md:w-72 pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-200 outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-mono text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Pizzaria</th>
                      <th className="px-4 py-3">Plano</th>
                      <th className="px-4 py-3">Operação</th>
                      <th className="px-4 py-3">Clientes</th>
                      <th className="px-4 py-3">Receita</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredPizzerias.map((p) => {
                      const planCfg = PLANS[p.plan] || PLANS.basico;
                      const PlanIcon = planCfg.icon;
                      return (
                        <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                          {/* Name + instance */}
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-100">{p.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{p.instance || "sem instância"}</div>
                            <div className="text-[9px] text-slate-600 mt-0.5">{timeAgo(p.createdAt)}</div>
                          </td>

                          {/* Plan */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold font-mono ${planCfg.color}`}>
                              <PlanIcon className="w-3 h-3" />
                              {planCfg.label}
                            </span>
                            <div className="text-[9px] text-slate-500 mt-1">{money.format(planCfg.price)}/mês</div>
                          </td>

                          {/* Operation stats */}
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <ShoppingBag className="w-3 h-3 text-slate-500" />
                                <span className="font-mono font-bold text-slate-200">{p.totalOrders}</span>
                                <span className="text-slate-500">pedidos</span>
                                {p.activeOrders > 0 && <span className="text-orange-300 font-bold">({p.activeOrders} ativos)</span>}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <MessageSquare className="w-3 h-3 text-slate-500" />
                                <span className="font-mono font-bold text-slate-200">{p.conversations}</span>
                                <span className="text-slate-500">conversas</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <Users className="w-3 h-3 text-slate-500" />
                                <span className="font-mono font-bold text-slate-200">{p.operators}</span>
                                <span className="text-slate-500">operadores</span>
                              </div>
                            </div>
                          </td>

                          {/* Customers */}
                          <td className="px-4 py-3">
                            <div className="text-base font-bold font-mono text-slate-100">{p.customers}</div>
                            {p.pendingPayments > 0 && (
                              <div className="text-[9px] text-amber-300 font-mono">{p.pendingPayments} pgtos pendentes</div>
                            )}
                          </td>

                          {/* Revenue */}
                          <td className="px-4 py-3">
                            <div className="font-mono font-bold text-emerald-300">{money.format(p.approvedRevenue)}</div>
                            <div className="text-[10px] text-slate-500">{money.format(p.todayRevenue)} hoje</div>
                          </td>

                          {/* Status pills */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <StatusPill ok={p.botActive} label={p.botActive ? "bot ativo" : "bot pausado"} />
                              <StatusPill ok={p.gatewayConfigured} label={p.gatewayConfigured ? p.gateway : "sem gateway"} />
                              {p.humanEscalations > 0 && (
                                <span className="text-[9px] text-rose-300 font-bold animate-pulse">{p.humanEscalations} escalação{p.humanEscalations > 1 ? "ões" : ""}</span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Toggle Bot */}
                              <button
                                onClick={() => handleToggleBot(p)}
                                disabled={togglingId === p.id}
                                title={p.botActive ? "Pausar bot" : "Ativar bot"}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
                                  p.botActive
                                    ? "border-amber-700/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/60"
                                    : "border-emerald-700/50 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/60"
                                } disabled:opacity-50`}
                              >
                                {togglingId === p.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : p.botActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />
                                }
                              </button>

                              {/* Edit */}
                              <button
                                onClick={() => openEdit(p)}
                                title="Editar pizzaria"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete */}
                              <button
                                onClick={() => handleDeletePizzeria(p)}
                                disabled={deletingId === p.id}
                                title="Excluir pizzaria"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                              >
                                {deletingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPizzerias.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-xs">
                          {query ? "Nenhuma pizzaria encontrada para este filtro." : "Nenhuma pizzaria cadastrada ainda."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom info */}
            <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono">
              <Clock className="w-3 h-3" />
              Última sincronização: {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString("pt-BR") : "—"}
              <span className="mx-2 text-slate-700">·</span>
              Dados isolados por tenant · chaves de pagamento não expostas ao admin
            </div>
          </>
        )}
      </main>

      {/* ── Create Modal ──────────────────────────────────────────────────────── */}
      {createOpen && (
        <Modal title="Cadastrar nova pizzaria" subtitle="Cria o tenant no banco e vincula um admin inicial." onClose={() => { setCreateOpen(false); resetCreateForm(); }}>
          <form onSubmit={handleCreatePizzeria}>
            <div className="p-5 space-y-4">
              <Field label="Nome da pizzaria *">
                <input required value={createName}
                  onChange={(e) => { setCreateName(e.target.value); if (!createInstance) setCreateInstance(suggestInstance(e.target.value)); }}
                  className={inputCls} placeholder="Ex: Don Peppone Pizzaria" />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Identificador WhatsApp">
                  <input value={createInstance}
                    onChange={(e) => setCreateInstance(e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase())}
                    className={`${inputCls} font-mono`} placeholder="pizzabot-nome" />
                </Field>
                <Field label="Plano">
                  <PlanSelect value={createPlan} onChange={setCreatePlan} />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Telefone admin">
                  <input value={createPhone} onChange={(e) => setCreatePhone(e.target.value)}
                    className={inputCls} placeholder="+55 11 99999-9999" />
                </Field>
                <Field label="E-mail do dono">
                  <input type="email" value={createOwnerEmail} onChange={(e) => setCreateOwnerEmail(e.target.value)}
                    className={inputCls} placeholder="dono@pizzaria.com" />
                </Field>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                💡 O dono acessa o painel via login normal. Se o e-mail já tiver conta, a pizzaria aparece automaticamente.
              </div>
            </div>
            <ModalFooter onCancel={() => { setCreateOpen(false); resetCreateForm(); }} loading={creating} label="Criar pizzaria" />
          </form>
        </Modal>
      )}

      {/* ── Edit Modal ────────────────────────────────────────────────────────── */}
      {editOpen && editTarget && (
        <Modal title={`Editar · ${editTarget.name}`} subtitle="Altere plano, bot e instância desta pizzaria." onClose={() => setEditOpen(false)}>
          <form onSubmit={handleEditPizzeria}>
            <div className="p-5 space-y-4">
              {actionError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/40 text-red-200 text-xs">{actionError}</div>
              )}
              <Field label="Nome da pizzaria">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Plano">
                  <PlanSelect value={editPlan} onChange={setEditPlan} />
                </Field>
                <Field label="Identificador WhatsApp">
                  <input value={editInstance} onChange={(e) => setEditInstance(e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase())}
                    className={`${inputCls} font-mono`} />
                </Field>
              </div>

              <Field label="Status do Bot">
                <div className="flex items-center gap-3 mt-1">
                  <button type="button" onClick={() => setEditBotActive(true)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${editBotActive ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                    <Bot className="w-3.5 h-3.5" /> Bot Ativo
                  </button>
                  <button type="button" onClick={() => setEditBotActive(false)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${!editBotActive ? "bg-amber-600 border-amber-600 text-white" : "border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                    <Pause className="w-3.5 h-3.5" /> Bot Pausado
                  </button>
                </div>
              </Field>

              {/* Plan pricing preview */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">Valor do plano selecionado:</span>
                <span className="text-sm font-bold font-mono text-emerald-300">
                  {money.format(PLANS[editPlan]?.price || 0)}/mês
                </span>
              </div>
            </div>
            <ModalFooter onCancel={() => setEditOpen(false)} loading={saving} label="Salvar alterações" />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const inputCls = "w-full px-3 py-2 text-sm rounded-lg bg-slate-950 border border-slate-700 text-slate-100 outline-none focus:border-orange-500 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function PlanSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Object.entries(PLANS).map(([key, plan]) => {
        const PlanIcon = plan.icon;
        return (
          <button key={key} type="button" onClick={() => onChange(key)}
            className={`py-2 px-1 rounded-lg border text-[10px] font-bold transition-all flex flex-col items-center gap-0.5 ${
              value === key ? `${plan.color} border-transparent` : "border-slate-700 text-slate-400 hover:border-slate-600 bg-slate-950"
            }`}>
            <PlanIcon className="w-3.5 h-3.5" />
            {plan.label}
          </button>
        );
      })}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, loading, label }: { onCancel: () => void; loading: boolean; label: string }) {
  return (
    <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-950/50">
      <button type="button" onClick={onCancel} className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors">
        Cancelar
      </button>
      <button type="submit" disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50 transition-colors">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        {label}
      </button>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, accent = "slate" }: {
  icon: React.ElementType; label: string; value: string | number; sub: string; accent?: "slate" | "emerald" | "rose";
}) {
  const iconColor = accent === "emerald" ? "text-emerald-400 bg-emerald-500/10" : accent === "rose" ? "text-rose-400 bg-rose-500/10" : "text-slate-400 bg-slate-700/50";
  const valColor = accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white";
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 font-mono">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconColor}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className={`text-xl font-bold font-mono ${valColor}`}>{value}</div>
      <div className="text-[10px] text-slate-600">{sub}</div>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono w-fit ${
      ok ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/60 text-slate-400"
    }`}>
      {ok ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Building2 className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}
