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
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import {
  Pizza, LogOut, Plus, Pencil, Trash2, Save, X, Loader2, AlertCircle, LogIn,
  Store, Bot, Power, TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  Receipt, Ban, MessageSquare, Users, Sparkles, Trophy,
} from "lucide-react";
import { BackendPizzaria, pizzariasApi, adminApi, AdminOverview } from "../../lib/api";

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

  function startCreate() { setEditingId(null); setForm(EMPTY_FORM); setCreating(true); }
  function startEdit(p: BackendPizzaria) {
    setCreating(false);
    setEditingId(p.id);
    setForm({
      nome: p.nome, endereco: p.endereco ?? "",
      telefone_admin: p.telefone_admin ?? "", instancia: p.instancia ?? "",
      owner_nome: "", owner_email: "", owner_senha: "",
    });
  }
  function cancel() { setCreating(false); setEditingId(null); setForm(EMPTY_FORM); }

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
        await pizzariasApi.create({
          nome: form.nome.trim(),
          endereco: form.endereco.trim() || undefined,
          telefone_admin: form.telefone_admin.trim() || undefined,
          instancia: form.instancia.trim() || undefined,
          owner_nome: form.owner_nome.trim() || undefined,
          owner_email: form.owner_email.trim().toLowerCase(),
          owner_senha: form.owner_senha,
        });
      }
      cancel();
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao salvar."); }
    setSaving(false);
  }

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
  const c = ov?.comparativo;
  const maxRank = Math.max(1, ...(ov?.ranking_pizzarias ?? []).map((x) => x.vendido));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
            <Pizza className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">PizzaBot — Administração</h1>
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

      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto space-y-5">
        {/* Título + seletor de período */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Visão geral</h2>
            <p className="text-sm text-slate-500">Desempenho consolidado de todas as pizzarias.</p>
          </div>
          <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
            {PERIODOS.map((p) => (
              <button key={p.value} onClick={() => setDays(p.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === p.value ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-slate-50"
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
            {/* KPIs principais */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={<DollarSign className="w-4 h-4 text-emerald-500" />} label="Faturamento"
                value={brl(r.vendido)} delta={c?.pct_vendido ?? null} />
              <Kpi icon={<ShoppingBag className="w-4 h-4 text-blue-500" />} label="Pedidos"
                value={String(r.pedidos)} delta={c?.pct_pedidos ?? null} />
              <Kpi icon={<Receipt className="w-4 h-4 text-orange-500" />} label="Ticket médio"
                value={brl(r.ticket_medio)} />
              <Kpi icon={<Ban className="w-4 h-4 text-red-500" />} label="Cancelamento"
                value={`${r.taxa_cancelamento}%`} subtle={`${r.cancelados} pedidos`} />
            </div>

            {/* Indicadores da base */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MiniStat icon={<Store className="w-4 h-4 text-slate-500" />}
                value={`${r.pizzarias_ativas}/${r.total_pizzarias}`} label="Pizzarias ativas" />
              <MiniStat icon={<Sparkles className="w-4 h-4 text-violet-500" />}
                value={String(r.pizzarias_novas)} label={`Novas (${days}d)`} />
              <MiniStat icon={<MessageSquare className="w-4 h-4 text-blue-500" />}
                value={String(r.total_conversas)} label="Conversas" />
              <MiniStat icon={<Users className="w-4 h-4 text-emerald-500" />}
                value={String(r.total_clientes)} label="Clientes" />
            </div>

            {/* Gráfico + ranking */}
            <div className="grid lg:grid-cols-3 gap-4">
              {/* Faturamento por dia */}
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Faturamento por dia</h3>
                {(ov.serie_diaria.length === 0) ? (
                  <Empty msg="Sem pedidos no período." />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={ov.serie_diaria} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickFormatter={(d) => String(d).slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickFormatter={(v) => `R$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                      <RTooltip
                        formatter={(v: any) => [brl(Number(v)), "Faturamento"]}
                        labelFormatter={(l) => `Dia ${l}`}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                      <Line type="monotone" dataKey="vendido" stroke="#f97316" strokeWidth={2}
                        dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Ranking pizzarias */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-500" /> Top pizzarias
                </h3>
                {(ov.ranking_pizzarias.filter((x) => x.vendido > 0).length === 0) ? (
                  <Empty msg="Sem faturamento ainda." />
                ) : (
                  <div className="space-y-2.5">
                    {ov.ranking_pizzarias.filter((x) => x.vendido > 0).map((x, i) => (
                      <div key={x.id}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-700 truncate">{i + 1}. {x.nome}</span>
                          <span className="font-semibold text-slate-800 shrink-0 ml-2">{brl(x.vendido)}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-400 rounded-full"
                            style={{ width: `${(x.vendido / maxRank) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Distribuição por plano */}
                {ov.pizzarias_por_plano.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 mb-2">Por plano</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ov.pizzarias_por_plano.map((p) => (
                        <span key={p.plano} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {p.plano}: <strong>{p.qtd}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}

        {/* ====== Gestão de pizzarias ====== */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Pizzarias</h2>
            <p className="text-sm text-slate-500">Empresas cadastradas na plataforma.</p>
          </div>
          <button onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md font-medium">
            <Plus className="w-4 h-4" /> Nova pizzaria
          </button>
        </div>

        {(creating || editingId) && (
          <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3 shadow-sm">
            <h3 className="font-semibold text-sm text-slate-800">{editingId ? "Editar pizzaria" : "Nova pizzaria"}</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nome" required>
                <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className={inputCls} placeholder="Ex.: Pizzaria do Zé" />
              </Field>
              <Field label="WhatsApp do dono">
                <input value={form.telefone_admin} onChange={(e) => setForm({ ...form, telefone_admin: e.target.value })}
                  className={inputCls} placeholder="5511999999999" />
              </Field>
              <Field label="Endereço" full>
                <input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  className={inputCls} placeholder="Rua, número, bairro" />
              </Field>
              <Field label="Instância Evolution (opcional)" full>
                <input value={form.instancia} onChange={(e) => setForm({ ...form, instancia: e.target.value })}
                  className={inputCls} placeholder="pizzaria-do-ze" />
              </Field>
            </div>

            {/* Acesso do dono — só na criação */}
            {!editingId && (
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <LogIn className="w-3.5 h-3.5 text-orange-500" />
                  <h4 className="text-xs font-semibold text-slate-700">Acesso do dono ao painel</h4>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Crie o login que o dono desta pizzaria vai usar para entrar no painel dele.
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Nome do dono">
                    <input value={form.owner_nome} onChange={(e) => setForm({ ...form, owner_nome: e.target.value })}
                      className={inputCls} placeholder="Ex.: José da Silva" />
                  </Field>
                  <Field label="E-mail de login" required>
                    <input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                      className={inputCls} placeholder="dono@pizzaria.com" />
                  </Field>
                  <Field label="Senha inicial (mín. 8 caracteres)" required full>
                    <input type="text" value={form.owner_senha} onChange={(e) => setForm({ ...form, owner_senha: e.target.value })}
                      className={inputCls} placeholder="Defina uma senha para o dono" />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Anote e repasse essas credenciais ao dono. Ele poderá entrar em {window.location.host} com esse e-mail e senha.
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={cancel} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md flex items-center gap-1">
                <X className="w-4 h-4" /> Cancelar
              </button>
              <button onClick={save} disabled={saving || !form.nome.trim()}
                className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center gap-1 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {pizzarias.length === 0 && !creating && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
              Nenhuma pizzaria cadastrada ainda. Clique em <strong>Nova pizzaria</strong> para começar.
            </div>
          )}
          {pizzarias.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {p.logo_url ? <img src={p.logo_url} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-slate-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm truncate">{p.nome}</span>
                  <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{p.plano}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    p.bot_ativo_global ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    <Power className="w-2.5 h-2.5" /> {p.bot_ativo_global ? "Bot on" : "Bot off"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {p.instancia ? `Instância: ${p.instancia}` : "Sem instância Evolution"}
                  {p.endereco ? ` · ${p.endereco}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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

function Kpi({ icon, label, value, delta, subtle }: {
  icon: React.ReactNode; label: string; value: string; delta?: number | null; subtle?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
        <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center">{icon}</div>
        {label}
      </div>
      <div className="text-xl font-bold text-slate-800 leading-tight">{value}</div>
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
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-lg font-bold text-slate-800 leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-xs text-slate-400 text-center py-10">{msg}</div>;
}

const inputCls = "w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
