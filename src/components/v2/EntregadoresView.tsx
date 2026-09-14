import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Bike, CircleDot, Clock3, Copy, Loader2, Lock, Mail, Navigation,
  PackageCheck, Pencil, Phone, Plus, Radio, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Trash2, User, Users,
} from "lucide-react";
import { BackendEntregador, BackendPedido, entregadoresApi, pedidosApi } from "../../lib/api";
import { Badge, Button, Field, Input, Modal } from "../ui";

interface FormState {
  id: string | null;
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  ativo: boolean;
}
type Filter = "todos" | "disponiveis" | "em_rota" | "inativos";

const EMPTY: FormState = { id: null, nome: "", email: "", senha: "", telefone: "", ativo: true };
const ACTIVE_DELIVERY = new Set(["pronto_entrega", "a_caminho"]);

export function EntregadoresView({ pizzariaId }: { pizzariaId: string }) {
  const [lista, setLista] = useState<BackendEntregador[]>([]);
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [autoatribuicao, setAutoatribuicao] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filter>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [togglingConfig, setTogglingConfig] = useState(false);

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    setErr(null);
    try {
      const [drivers, today] = await Promise.all([
        entregadoresApi.list(pizzariaId),
        pedidosApi.list(pizzariaId, { hoje: true, limit: 500 }),
      ]);
      setLista(drivers.entregadores);
      setAutoatribuicao(drivers.permitir_autoatribuicao);
      setPedidos(today);
    } catch (e: any) {
      setErr(e.message || "Não foi possível atualizar a operação.");
    } finally {
      if (silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [pizzariaId]);

  function openCreate() {
    setForm(EMPTY);
    setFormErr(null);
    setModalOpen(true);
  }
  function openEdit(e: BackendEntregador) {
    setForm({ id: e.id, nome: e.nome, email: e.email, senha: "", telefone: e.telefone || "", ativo: e.ativo });
    setFormErr(null);
    setModalOpen(true);
  }
  async function save() {
    setSaving(true);
    setFormErr(null);
    try {
      if (form.id) {
        await entregadoresApi.update(pizzariaId, form.id, {
          nome: form.nome, telefone: form.telefone || undefined, ativo: form.ativo,
          nova_senha: form.senha || undefined,
        });
      } else {
        await entregadoresApi.create(pizzariaId, {
          nome: form.nome, email: form.email.trim().toLowerCase(), senha: form.senha,
          telefone: form.telefone || undefined,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFormErr(e.status === 409 ? "Este e-mail já está em uso." : (e.message || "Erro ao salvar."));
    } finally {
      setSaving(false);
    }
  }
  async function remover(e: BackendEntregador) {
    if (!window.confirm(`Remover o entregador ${e.nome}? A conta de acesso dele será excluída.`)) return;
    try {
      await entregadoresApi.remove(pizzariaId, e.id);
      await load();
    } catch (error: any) {
      setErr(error.message);
    }
  }
  async function toggleAutoatribuicao() {
    const novo = !autoatribuicao;
    setAutoatribuicao(novo);
    setTogglingConfig(true);
    try {
      await entregadoresApi.setConfig(pizzariaId, novo);
    } catch {
      setAutoatribuicao(!novo);
    } finally {
      setTogglingConfig(false);
    }
  }

  const stats = useMemo(() => {
    const ativos = lista.filter((e) => e.ativo);
    return {
      ativos: ativos.length,
      disponiveis: ativos.filter((e) => e.disponivel).length,
      emRota: pedidos.filter((p) => p.status === "a_caminho").length,
      entregues: pedidos.filter((p) => p.status === "entregue").length,
      livres: pedidos.filter((p) => p.tipo === "entrega" && p.status === "pronto_entrega" && !p.entregador_id).length,
    };
  }, [lista, pedidos]);

  const carga = useMemo(() => {
    const map = new Map<string, { ativas: BackendPedido[]; concluidas: number }>();
    lista.forEach((e) => map.set(e.id, { ativas: [], concluidas: 0 }));
    pedidos.forEach((p) => {
      if (!p.entregador_id) return;
      const item = map.get(p.entregador_id);
      if (!item) return;
      if (ACTIVE_DELIVERY.has(p.status)) item.ativas.push(p);
      if (p.status === "entregue") item.concluidas += 1;
    });
    return map;
  }, [lista, pedidos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return lista.filter((e) => {
      const item = carga.get(e.id);
      const texto = `${e.nome} ${e.email} ${e.telefone || ""}`.toLocaleLowerCase("pt-BR");
      const matchBusca = !termo || texto.includes(termo);
      const matchFiltro = filtro === "todos"
        || (filtro === "disponiveis" && e.ativo && e.disponivel)
        || (filtro === "em_rota" && !!item?.ativas.some((p) => p.status === "a_caminho"))
        || (filtro === "inativos" && !e.ativo);
      return matchBusca && matchFiltro;
    });
  }, [busca, carga, filtro, lista]);

  const podeSalvar = form.nome.trim() && (form.id || (form.email.trim() && form.senha.length >= 6));

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-8 max-w-7xl mx-auto space-y-5">
      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {err}
        </div>
      )}

      {/* Hero Banner Header */}
      <section className="relative overflow-hidden rounded-2xl border border-[#1e293b] bg-gradient-to-r from-[#141b2a] via-[#111622] to-[#0f1420] p-5 md:p-6 shadow-xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-orange-400">
              <Radio className="w-3.5 h-3.5 animate-pulse text-orange-400" />
              Operação em tempo real
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-white">
              Central de entregas
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-slate-400">
              Acompanhe disponibilidade, carga e desempenho da equipe em uma única visão.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-[#1e293b] bg-[#161f30] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-[#1e293b] hover:text-white transition-all disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-orange-400" : "text-slate-400"}`} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Novo entregador
            </button>
          </div>
        </div>
      </section>

      {/* 4 Stat Cards */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric icon={Users} label="Equipe ativa" value={stats.ativos} detail={`${lista.length} cadastros`} tone="orange" />
        <Metric icon={CircleDot} label="Disponíveis agora" value={stats.disponiveis} detail={stats.disponiveis ? "Prontos para receber" : "Ninguém disponível"} tone="green" />
        <Metric icon={Navigation} label="Em rota" value={stats.emRota} detail={`${stats.livres} aguardando entregador`} tone="blue" />
        <Metric icon={PackageCheck} label="Entregues hoje" value={stats.entregues} detail="Pedidos concluídos" tone="violet" />
      </section>

      {/* Main Grid: Equipe e Capacidade + Aside */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Drivers List Card */}
        <div className="overflow-hidden rounded-2xl border border-[#1e293b] bg-[#111622] shadow-sm">
          <div className="border-b border-[#1e293b] p-4 md:p-5">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <h2 className="text-base font-bold text-white">Equipe e capacidade</h2>
                <p className="mt-0.5 text-xs text-slate-400">Status operacional e entregas do dia.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 sm:w-64">
                  <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar entregador..."
                    className="w-full rounded-xl border border-[#1e293b] bg-[#161f30] py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-orange-500 transition-colors"
                  />
                </label>
                <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[#1e293b] bg-[#161f30] p-1">
                  <SlidersHorizontal className="mx-1 w-3.5 h-3.5 shrink-0 text-slate-500" />
                  {([["todos", "Todos"], ["disponiveis", "Livres"], ["em_rota", "Em rota"], ["inativos", "Inativos"]] as Array<[Filter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFiltro(value)}
                      className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                        filtro === value ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : filtrados.length === 0 ? (
            <div className="px-5 py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#161f30] border border-[#1e293b] flex items-center justify-center mx-auto mb-4 text-slate-500">
                <Bike className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-sm font-bold text-slate-200">
                {lista.length ? "Nenhum entregador corresponde ao filtro." : "Sua equipe ainda está vazia."}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {lista.length ? "Tente alterar os termos de busca ou filtros." : "Cadastre os entregadores da sua pizzaria para distribuir pedidos e acompanhar rotas."}
              </p>
              {!lista.length && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-xs font-bold text-orange-400 hover:bg-orange-500/20 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Cadastrar primeiro entregador
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#1e293b]">
              {filtrados.map((e) => {
                const item = carga.get(e.id) ?? { ativas: [], concluidas: 0 };
                const emRota = item.ativas.some((p) => p.status === "a_caminho");
                const status = !e.ativo ? "inativo" : emRota ? "rota" : e.disponivel ? "disponivel" : "offline";
                return (
                  <article key={e.id} className="p-4 transition-colors hover:bg-[#161f30]/40 md:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex min-w-0 items-center gap-3 md:flex-1">
                        <div className="relative shrink-0">
                          <span className="grid w-11 h-11 place-items-center rounded-xl border border-orange-500/20 bg-orange-500/10 font-black text-orange-400 text-sm">
                            {e.nome.slice(0, 1).toUpperCase()}
                          </span>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111622] ${
                              status === "disponivel" ? "bg-emerald-400" : status === "rota" ? "animate-pulse bg-sky-400" : "bg-slate-600"
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-bold text-white text-sm">{e.nome}</h3>
                            <DriverStatus value={status} />
                          </div>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(e.email)}
                            className="group mt-0.5 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
                            title="Copiar login"
                          >
                            <span className="truncate">{e.email}</span>
                            <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                          {e.telefone && (
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                              <Phone className="w-3 h-3" />
                              {e.telefone}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 md:w-[280px]">
                        <SmallStat label="Ativas" value={item.ativas.length} />
                        <SmallStat label="Hoje" value={item.concluidas} />
                        <SmallStat label="Total" value={e.entregas_concluidas ?? 0} />
                      </div>
                      <div className="flex items-center gap-1 md:ml-1">
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-[#161f30] hover:text-white transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(e)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Aside Sidebar */}
        <aside className="space-y-4">
          {/* Distribuição de pedidos */}
          <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid w-9 h-9 shrink-0 place-items-center rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
                <ShieldCheck className="w-4.5 h-4.5" />
              </span>
              <div>
                <h2 className="font-bold text-white text-sm">Distribuição de pedidos</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                  Defina como a equipe assume as entregas prontas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAutoatribuicao}
              disabled={togglingConfig}
              className={`mt-4 w-full rounded-xl border p-3.5 text-left transition-all ${
                autoatribuicao
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-[#1e293b] bg-[#161f30] hover:bg-[#1a253a]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-white">Autoatribuição</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {autoatribuicao ? "Entregadores podem pegar pedidos livres." : "Somente a pizzaria distribui os pedidos."}
                  </p>
                </div>
                <span
                  className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                    autoatribuicao ? "bg-emerald-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                      autoatribuicao ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </div>
            </button>
          </div>

          {/* Pulso da operação */}
          <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-white text-sm">Pulso da operação</h2>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Ao vivo
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <PulseRow icon={Clock3} label="Prontos sem entregador" value={stats.livres} alert={stats.livres > 0} />
              <PulseRow icon={Navigation} label="Em deslocamento" value={stats.emRota} />
              <PulseRow icon={PackageCheck} label="Concluídos hoje" value={stats.entregues} />
            </div>
            <p className="mt-4 border-t border-[#1e293b] pt-3 text-[11px] leading-relaxed text-slate-500">
              Atualização automática a cada 30 segundos.
            </p>
          </div>
        </aside>
      </section>

      {/* Driver Form Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        icon={Bike}
        title={form.id ? "Editar entregador" : "Novo entregador"}
        subtitle={form.id ? form.email : "Crie o acesso do entregador ao painel"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={save} isLoading={saving} disabled={!podeSalvar}>
              {form.id ? "Salvar alterações" : "Cadastrar entregador"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {formErr && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formErr}
            </div>
          )}
          <Field label="Nome completo" required>
            <Input icon={User} value={form.nome} onChange={(e: any) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do entregador" />
          </Field>
          {!form.id && (
            <Field label="E-mail (login)" required>
              <Input icon={Mail} type="email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} placeholder="entregador@email.com" />
            </Field>
          )}
          <Field label={form.id ? "Nova senha (deixe em branco para manter)" : "Senha de acesso"} required={!form.id} hint="Mínimo 6 caracteres">
            <Input icon={Lock} type="password" value={form.senha} onChange={(e: any) => setForm({ ...form, senha: e.target.value })} placeholder="••••••" />
          </Field>
          <Field label="WhatsApp / Telefone (opcional)">
            <Input icon={Phone} value={form.telefone} onChange={(e: any) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
          </Field>
          {form.id && (
            <label className="flex items-center gap-2.5 text-xs text-slate-300 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                className="w-4 h-4 accent-orange-500 rounded"
              />
              Conta ativa (pode fazer login e receber pedidos)
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  detail: string;
  tone: "orange" | "green" | "blue" | "violet";
}) {
  const tones = {
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    blue: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  };
  return (
    <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-4 md:p-5 shadow-sm">
      <div className={`grid w-9 h-9 place-items-center rounded-xl border ${tones[tone]}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <p className="mt-3 text-2xl font-black text-white tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-200">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#1e293b] bg-[#161f30] px-3 py-2 text-center">
      <p className="text-base font-black text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
    </div>
  );
}

function DriverStatus({ value }: { value: string }) {
  if (value === "rota") return <Badge tone="info" dot>Em rota</Badge>;
  if (value === "disponivel") return <Badge tone="success" dot>Disponível</Badge>;
  if (value === "inativo") return <Badge tone="danger">Inativo</Badge>;
  return <Badge tone="neutral" dot>Offline</Badge>;
}

function PulseRow({ icon: Icon, label, value, alert }: { icon: any; label: string; value: number; alert?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid w-8 h-8 place-items-center rounded-xl ${alert ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "bg-[#161f30] text-slate-400 border border-[#1e293b]"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 text-xs text-slate-400">{label}</span>
      <strong className={`text-sm ${alert ? "text-amber-400 font-bold" : "text-white font-bold"}`}>{value}</strong>
    </div>
  );
}
