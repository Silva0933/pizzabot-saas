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
  Store, Power, TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  Receipt, Ban, MessageSquare, Users, Sparkles, Trophy,
  Building2, User, Mail, Phone, MapPin, Smartphone, KeyRound, Eye, EyeOff, Wand2, Check,
  QrCode, Wifi, WifiOff, RefreshCw, CheckCircle2, Cpu, Zap, ChevronDown, Coins,
} from "lucide-react";
import { BackendPizzaria, pizzariasApi, adminApi, AdminOverview, LLMConfig, LLMUsage, WhatsAppConnect } from "../../lib/api";

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

  async function changePlan(p: BackendPizzaria, plano: string) {
    setBusyId(p.id);
    setErr(null);
    try {
      await adminApi.alterarPlano(p.id, plano);
      await refreshAll();
    } catch (e: any) { setErr(e.message || "Erro ao alterar plano."); }
    setBusyId(null);
  }

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

        <AssinaturasCard catalogo={ov?.catalogo ?? []} />

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

            {/* Novas assinaturas por dia */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Novas assinaturas por dia</h3>
              {ov.serie_novas.length === 0 ? (
                <Empty msg="Sem novas assinaturas no período." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={ov.serie_novas} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <RTooltip labelFormatter={(l) => `Dia ${l}`} formatter={(v: any) => [v, "Novas"]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                    <Line type="monotone" dataKey="qtd" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        ) : null}

        {/* ====== Inteligência Artificial (provider/modelo/chaves) ====== */}
        <LLMConfigCard />

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

        {/* ====== Modal criar/editar pizzaria ====== */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={cancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-[fadeIn_.15s_ease-out]"
              onClick={(e) => e.stopPropagation()}>
              {/* Cabeçalho */}
              <div className="relative px-5 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white">
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
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {(() => { const a = assinaturaById(p.id); return a ? `${brl(a.preco_mensal)}/mês · ${a.uso.produtos} produtos · ${a.uso.conversas} conversas` : (p.instancia ? `Instância: ${p.instancia}` : "Sem instância Evolution"); })()}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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

const CUSTOM_MODEL = "__custom__";

function LLMConfigCard() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usage, setUsage] = useState<LLMUsage | null>(null);

  function applyCfg(c: LLMConfig) {
    setCfg(c); setProvider(c.provider); setKeys({});
    const modelos = c.providers[c.provider]?.modelos || [];
    setModel(c.model);
    setCustomMode(!modelos.includes(c.model));
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
      await adminApi.salvarLlm({ provider, model: model.trim(), keys });
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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Cabeçalho clicável (ícone de configuração de IA) */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white grid place-items-center shrink-0">
          <Cpu className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-slate-800">Configuração de IA</h2>
          <p className="text-xs text-slate-500 truncate">
            {cfg ? `${cfg.providers[cfg.provider]?.nome || cfg.provider} · ${cfg.model}` : "Provedor, modelo e chaves que atendem as pizzarias."}
          </p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        loading && !cfg ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>
        ) : cfg ? (
          <div className="px-4 pb-4 md:px-5 md:pb-5 space-y-4 border-t border-slate-100 pt-4">
            <div className="grid md:grid-cols-2 gap-3">
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

            <div className="space-y-2.5">
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

            <div className="flex gap-2 justify-end">
              <button onClick={test} disabled={testing || saving}
                className="px-3.5 py-2 text-sm font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center gap-1.5 disabled:opacity-50">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Testar
              </button>
              <button onClick={save} disabled={saving || !model.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white inline-flex items-center gap-1.5 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Salvar
              </button>
            </div>

            {/* Consumo de tokens */}
            {usage && (
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
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
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 inline-flex items-center gap-1"
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
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
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

const inputIcon =
  "w-full pl-9 pr-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition";

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
// Assinaturas & Vencimentos (ciclo de 30 dias, suspensão manual)
// ============================================
function AssinaturasCard({ catalogo }: { catalogo: import("../../lib/api").PlanCatalogo[] }) {
  const [data, setData] = useState<import("../../lib/api").AssinaturasResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try { setData(await adminApi.assinaturas()); } catch { /* silencioso */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function ativarPlano(id: string, plano: string) {
    setBusy(id);
    try { await adminApi.alterarPlano(id, plano); await load(); } finally { setBusy(null); }
  }
  async function renovar(id: string) {
    setBusy(id);
    try { await adminApi.renovar(id); await load(); } finally { setBusy(null); }
  }
  async function toggleSuspensao(id: string, suspender: boolean) {
    if (suspender && !window.confirm("Suspender esta pizzaria? O atendimento será totalmente desligado (sem excluir dados).")) return;
    setBusy(id);
    try { await adminApi.suspender(id, suspender, suspender ? "Inadimplência" : undefined); await load(); } finally { setBusy(null); }
  }

  const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

  if (loading) return null;
  if (!data) return null;

  const { assinaturas, alertas } = data;
  const temAlerta = alertas.vence_amanha > 0 || alertas.vencida > 0;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-slate-800">Assinaturas & Vencimentos</h3>
        <span className="text-xs text-slate-400">Ciclo de {data.ciclo_dias} dias · suspensão manual</span>
      </div>

      {temAlerta && (
        <div className="mb-3 flex flex-wrap gap-2">
          {alertas.vencida > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-100 text-red-700">
              {alertas.vencida} vencida(s)
            </span>
          )}
          {alertas.vence_amanha > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700">
              {alertas.vence_amanha} vence(m) em ≤1 dia
            </span>
          )}
          {alertas.suspensas > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-200 text-slate-600">
              {alertas.suspensas} suspensa(s)
            </span>
          )}
        </div>
      )}

      {assinaturas.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhuma assinatura ainda.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {assinaturas.map((a) => {
            const cor = a.suspensa ? "bg-slate-100 text-slate-500"
              : a.alerta === "vencida" ? "bg-red-100 text-red-700"
              : a.alerta === "vence_amanha" ? "bg-amber-100 text-amber-700"
              : a.alerta === "sem_plano" ? "bg-slate-100 text-slate-500"
              : "bg-emerald-100 text-emerald-700";
            const label = a.suspensa ? "Suspensa"
              : a.alerta === "vencida" ? `Vencida há ${Math.abs(a.dias_restantes ?? 0)}d`
              : a.alerta === "sem_plano" ? "Sem plano"
              : a.dias_restantes != null ? `Vence em ${a.dias_restantes}d` : "—";
            return (
              <div key={a.pizzaria_id} className="py-2.5 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{a.nome}</p>
                  <p className="text-[11px] text-slate-400">{a.plano_nome} · vence {fmt(a.vence_em)}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cor}`}>{label}</span>
                <select
                  value={a.alerta === "sem_plano" ? "" : a.plano}
                  disabled={busy === a.pizzaria_id}
                  onChange={(e) => { if (e.target.value) ativarPlano(a.pizzaria_id, e.target.value); }}
                  title={a.alerta === "sem_plano" ? "Ativar plano (inicia ciclo de 30 dias)" : "Trocar plano (reinicia o ciclo)"}
                  className={`text-xs px-2 py-1 rounded-lg border outline-none cursor-pointer disabled:opacity-50 font-medium ${
                    a.alerta === "sem_plano"
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-violet-50 text-violet-700 border-violet-200"
                  }`}
                >
                  {a.alerta === "sem_plano" && <option value="" disabled>Ativar plano…</option>}
                  {(catalogo.length ? catalogo : [{ id: a.plano, nome: a.plano_nome }]).map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
                <button onClick={() => renovar(a.pizzaria_id)} disabled={busy === a.pizzaria_id}
                  className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium disabled:opacity-50">
                  Renovar +30d
                </button>
                <button onClick={() => toggleSuspensao(a.pizzaria_id, !a.suspensa)} disabled={busy === a.pizzaria_id}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium disabled:opacity-50 ${
                    a.suspensa ? "bg-sky-50 text-sky-700 hover:bg-sky-100" : "bg-red-50 text-red-700 hover:bg-red-100"
                  }`}>
                  {a.suspensa ? "Reativar" : "Suspender"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
