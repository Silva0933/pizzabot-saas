import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Bike, CircleDot, Clock3, Copy, Download, ExternalLink, Link2, Loader2, Lock, Mail, Navigation,
  PackageCheck, Pencil, Phone, Plus, Radio, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Smartphone, Trash2, User, Users, Wallet,
} from "lucide-react";
import { BackendEntregador, BackendPedido, EntregadoresResp, entregadoresApi, pedidosApi } from "../../lib/api";
import { APK_URL } from "../../lib/nativo";
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
  const [repasse, setRepasse] = useState<{ ativo: boolean; valor: number | null }>({ ativo: false, valor: null });

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
      setRepasse({ ativo: !!drivers.repasse_ativo, valor: drivers.repasse_valor ?? null });
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
    <div className="pzb-page max-w-7xl mx-auto space-y-6">
      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {err}
        </div>
      )}

      {/* Hero Banner Header */}
      <section className="pzb-page-header">
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Central de entregas
            </h2>
            <p className="pzb-page-description max-w-2xl">
              Acompanhe disponibilidade, carga e desempenho da equipe em tempo real.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-muted px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-elevated hover:text-ink transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-orange-400" : "text-ink-muted"}`} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Novo entregador
            </button>
          </div>
        </div>
      </section>

      {/* 4 Stat Cards */}
      <section className="pzb-section grid grid-cols-2 xl:grid-cols-4 overflow-hidden">
        <Metric icon={Users} label="Equipe ativa" value={stats.ativos} detail={`${lista.length} cadastros`} tone="orange" />
        <Metric icon={CircleDot} label="Disponíveis agora" value={stats.disponiveis} detail={stats.disponiveis ? "Prontos para receber" : "Ninguém disponível"} tone="green" />
        <Metric icon={Navigation} label="Em rota" value={stats.emRota} detail={`${stats.livres} aguardando entregador`} tone="blue" />
        <Metric icon={PackageCheck} label="Entregues hoje" value={stats.entregues} detail="Pedidos concluídos" tone="violet" />
      </section>

      {/* Main Grid: Equipe e Capacidade + Aside */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Drivers List Card */}
        <div className="pzb-section overflow-hidden">
          <div className="border-b border-line p-4 md:p-5">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <h2 className="text-base font-bold text-white">Equipe e capacidade</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Status operacional e entregas do dia.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 sm:w-64">
                  <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-ink-subtle" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar entregador..."
                    aria-label="Buscar entregador"
                    className="w-full rounded-xl border border-line bg-surface-muted py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-ink-subtle focus:border-orange-500 transition-colors"
                  />
                </label>
                <div className="pzb-tablist overflow-x-auto" aria-label="Filtrar entregadores">
                  <SlidersHorizontal className="mx-1 w-3.5 h-3.5 shrink-0 text-ink-subtle" />
                  {([["todos", "Todos"], ["disponiveis", "Livres"], ["em_rota", "Em rota"], ["inativos", "Inativos"]] as Array<[Filter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filtro === value}
                      onClick={() => setFiltro(value)}
                      className={`pzb-tab whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors ${
                        filtro === value ? "bg-brand-700 text-white" : "text-ink-muted hover:text-ink"
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
              <div className="w-16 h-16 rounded-xl bg-surface-muted border border-line flex items-center justify-center mx-auto mb-4 text-ink-subtle">
                <Bike className="w-8 h-8 text-ink-subtle" />
              </div>
              <p className="text-sm font-bold text-ink">
                {lista.length ? "Nenhum entregador corresponde ao filtro." : "Sua equipe ainda está vazia."}
              </p>
              <p className="text-xs text-ink-subtle mt-1 max-w-sm mx-auto">
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
            <div className="divide-y divide-line">
              {filtrados.map((e) => {
                const item = carga.get(e.id) ?? { ativas: [], concluidas: 0 };
                const emRota = item.ativas.some((p) => p.status === "a_caminho");
                const status = !e.ativo ? "inativo" : emRota ? "rota" : e.disponivel ? "disponivel" : "offline";
                return (
                  <article key={e.id} className="p-4 transition-colors hover:bg-surface-muted/40 md:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex min-w-0 items-center gap-3 md:flex-1">
                        <div className="relative shrink-0">
                          <span className="grid w-11 h-11 place-items-center rounded-xl border border-orange-500/20 bg-orange-500/10 font-bold text-orange-400 text-sm">
                            {e.nome.slice(0, 1).toUpperCase()}
                          </span>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface ${
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
                            className="group mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
                            title="Copiar login"
                          aria-label={`Copiar login de ${e.nome}`}
                          >
                            <span className="truncate">{e.email}</span>
                            <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                          {e.telefone && (
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
                              <Phone className="w-3 h-3" />
                              {e.telefone}
                            </p>
                          )}
                          <UltimaPosicao entregador={e} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 md:w-[280px]">
                        <SmallStat label="Ativas" value={item.ativas.length} />
                        <SmallStat label="Hoje" value={item.concluidas} />
                        {repasse.ativo
                          ? <SmallStat label="Ganhos hoje" value={brl(e.ganhos_hoje ?? 0)} />
                          : <SmallStat label="Total" value={e.entregas_concluidas ?? 0} />}
                      </div>
                      <div className="flex items-center gap-1 md:ml-1">
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
                          title="Editar"
                          aria-label={`Editar ${e.nome}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(e)}
                          className="rounded-lg p-2 text-ink-subtle hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                          title="Remover"
                          aria-label={`Remover ${e.nome}`}
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
          <AppEntregador />
          <LinkAcessoEntregador />

          <ValorPorEntrega
            pizzariaId={pizzariaId}
            ativo={repasse.ativo}
            valor={repasse.valor}
            onSalvo={(r) => setRepasse({ ativo: !!r.repasse_ativo, valor: r.repasse_valor ?? null })}
          />

          {/* Distribuição de pedidos */}
          <div className="pzb-section p-5">
            <div className="flex items-start gap-3">
              <span className="grid w-9 h-9 shrink-0 place-items-center rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
                <ShieldCheck className="w-4.5 h-4.5" />
              </span>
              <div>
                <h2 className="font-bold text-white text-sm">Distribuição de pedidos</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  Defina como a equipe assume as entregas prontas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAutoatribuicao}
              aria-pressed={autoatribuicao}
              disabled={togglingConfig}
              className={`mt-4 w-full rounded-xl border p-3.5 text-left transition-all ${
                autoatribuicao
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-line bg-surface-muted hover:bg-surface-elevated"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-white">Autoatribuição</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {autoatribuicao ? "Entregadores podem pegar pedidos livres." : "Somente a pizzaria distribui os pedidos."}
                  </p>
                </div>
                <span
                  className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
                    autoatribuicao ? "bg-emerald-500" : "bg-surface-elevated"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white  transition-transform ${
                      autoatribuicao ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </div>
            </button>
          </div>

          {/* Pulso da operação */}
          <div className="pzb-section p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-white text-sm">Pulso da operação</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Ao vivo
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <PulseRow icon={Clock3} label="Prontos sem entregador" value={stats.livres} alert={stats.livres > 0} />
              <PulseRow icon={Navigation} label="Em deslocamento" value={stats.emRota} />
              <PulseRow icon={PackageCheck} label="Concluídos hoje" value={stats.entregues} />
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
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
            <label className="flex items-center gap-2.5 text-xs text-ink-muted pt-1 cursor-pointer">
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

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Valor fixo pago ao entregador por entrega. Ligado, o app mostra ganhos e
 *  histórico com valores; o valor fica congelado em cada entrega concluída. */
function ValorPorEntrega({ pizzariaId, ativo, valor, onSalvo }: {
  pizzariaId: string;
  ativo: boolean;
  valor: number | null;
  onSalvo: (r: EntregadoresResp) => void;
}) {
  const [texto, setTexto] = useState(valor != null ? valor.toFixed(2).replace(".", ",") : "");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => { setTexto(valor != null ? valor.toFixed(2).replace(".", ",") : ""); }, [valor]);

  const numero = Number(texto.replace(/\./g, "").replace(",", "."));
  const valido = texto.trim() !== "" && Number.isFinite(numero) && numero >= 0 && numero <= 1000;
  const mudou = valido && (valor == null || Math.abs(numero - valor) > 0.001);

  async function salvar(novoAtivo: boolean) {
    if (novoAtivo && !valido) {
      setMsg({ ok: false, texto: "Informe o valor por entrega antes de ativar." });
      return;
    }
    setSalvando(true);
    setMsg(null);
    try {
      const r = await entregadoresApi.setRepasse(pizzariaId, novoAtivo, valido ? numero : undefined);
      onSalvo(r);
      setMsg({ ok: true, texto: novoAtivo ? "Salvo. Os entregadores já veem os ganhos no app." : "Desativado. O app não mostra mais valores." });
    } catch (e: any) {
      setMsg({ ok: false, texto: e.message || "Não foi possível salvar." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="pzb-section p-5">
      <div className="flex items-start gap-3">
        <span className="grid w-9 h-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <Wallet className="w-4.5 h-4.5" />
        </span>
        <div>
          <h2 className="font-bold text-white text-sm">Valor por entrega</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Quanto o entregador ganha em cada entrega concluída. Ligado, ele vê os ganhos e o histórico no app.
          </p>
        </div>
      </div>
      <label htmlFor="valor-entrega" className="mt-4 block text-xs font-semibold text-ink-muted">Valor fixo por entrega</label>
      <div className="mt-1.5 flex gap-2">
        <div className="flex flex-1 items-center rounded-xl border border-line bg-surface-muted px-3 focus-within:border-emerald-500/50">
          <span className="text-sm text-ink-muted">R$</span>
          <input
            id="valor-entrega"
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(e.target.value.replace(/[^\d,.]/g, ""))}
            placeholder="7,00"
            className="h-10 w-full bg-transparent px-2 text-sm font-semibold text-white outline-none"
          />
        </div>
        {ativo && mudou && (
          <button type="button" onClick={() => salvar(true)} disabled={salvando}
            className="h-10 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            Salvar
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => salvar(!ativo)}
        aria-pressed={ativo}
        disabled={salvando}
        className={`mt-3 w-full rounded-xl border p-3.5 text-left transition-all ${
          ativo ? "border-emerald-500/30 bg-emerald-500/10" : "border-line bg-surface-muted hover:bg-surface-elevated"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-white">{ativo ? "Ativado" : "Desativado"}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {ativo ? `Cada entrega rende ${brl(valor ?? 0)} ao entregador.` : "O app do entregador não mostra valores."}
            </p>
          </div>
          <span className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${ativo ? "bg-emerald-500" : "bg-surface-elevated"}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white  transition-transform ${ativo ? "translate-x-5" : "translate-x-0.5"}`} />
          </span>
        </div>
      </button>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.texto}</p>}
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
        Mudar o valor vale para as próximas entregas; as já concluídas mantêm o valor da época.
      </p>
    </div>
  );
}

/** Onde o entregador estava na última posição enviada pelo app (turno ligado). */
function UltimaPosicao({ entregador: e }: { entregador: BackendEntregador }) {
  if (e.lat == null || e.lon == null || !e.localizacao_em) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(e.localizacao_em).getTime()) / 60_000));
  if (min > 24 * 60) return null;
  const quando = min < 1 ? "agora" : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${min <= 5 ? "text-sky-300" : "text-ink-subtle"} hover:underline`}
    >
      <Navigation className="w-3 h-3" />
      Localização {quando} · ver no mapa
    </a>
  );
}

// App Android do entregador (APK publicado pelo CI no GitHub Releases).
function AppEntregador() {
  const [copied, setCopied] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(APK_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o link do app:", APK_URL);
    }
  }
  return (
    <div className="pzb-section p-5">
      <div className="flex items-start gap-3">
        <span className="grid w-9 h-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <Smartphone className="w-4.5 h-4.5" />
        </span>
        <div>
          <h2 className="font-bold text-white text-sm">App do entregador (Android)</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Avisa de entrega nova com a tela desligada, monta a rota e mostra aqui onde o entregador está.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copiar}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? "Copiado!" : "Copiar link"}
        </button>
        <a
          href={APK_URL}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar APK
        </a>
      </div>
      <ol className="mt-3 list-decimal space-y-1 border-t border-line pt-3 pl-4 text-xs leading-relaxed text-ink-subtle">
        <li>Envie o link ao entregador e peça para abrir no celular Android.</li>
        <li>Na instalação, permita "instalar apps desta fonte".</li>
        <li>No app, entrar com o e-mail e a senha cadastrados aqui e ligar o turno.</li>
        <li>Permitir localização e notificações quando o app pedir.</li>
      </ol>
    </div>
  );
}

// Link da área do entregador. Morava em Meu Negócio → Logística, longe de onde
// o dono cria os acessos; aqui fica ao lado do cadastro que ele usa.
function LinkAcessoEntregador() {
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/entregador`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o link da área do entregador:", link);
    }
  }

  return (
    <div className="pzb-section p-5">
      <div className="flex items-start gap-3">
        <span className="grid w-9 h-9 shrink-0 place-items-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
          <Link2 className="w-4.5 h-4.5" />
        </span>
        <div>
          <h2 className="font-bold text-white text-sm">Link do entregador</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Envie para cada entregador entrar com o e-mail e a senha cadastrados aqui.
          </p>
        </div>
      </div>
      <div className="mt-4 select-all truncate rounded-xl border border-line bg-surface-muted px-3 py-2 font-mono text-xs text-ink-muted">
        {link}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? "Copiado!" : "Copiar"}
        </button>
        <a
          href="/entregador"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Abrir
        </a>
      </div>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
        Para testar sem sair do seu painel, abra o link numa janela anônima ou em outro aparelho.
      </p>
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
    orange: "bg-brand-500/10 text-brand-400",
    green: "bg-surface-muted text-ink-muted",
    blue: "bg-surface-muted text-ink-muted",
    violet: "bg-surface-muted text-ink-muted",
  };
  return (
    <div className="flex items-start gap-3 p-4">
      <div className={`grid w-9 h-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="mt-1 text-base font-semibold text-ink tabular-nums">{value}</p>
        <p className="mt-0.5 text-xs text-ink-subtle">{detail}</p>
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-3 py-2 text-center">
      <p className="text-base font-bold text-white">{value}</p>
      <p className="text-xs text-ink-subtle font-semibold">{label}</p>
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
      <span className={`grid w-8 h-8 place-items-center rounded-xl ${alert ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "bg-surface-muted text-ink-muted border border-line"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 text-xs text-ink-muted">{label}</span>
      <strong className={`text-sm ${alert ? "text-amber-400 font-bold" : "text-white font-bold"}`}>{value}</strong>
    </div>
  );
}
