import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronRight, CircleDollarSign, Eye, KeyRound, Loader2,
  Mail, MapPin, PackageCheck, Phone, Search, ShieldCheck, ShoppingBag,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import {
  ApiError, ClientePainel, ClientePainelDetalhe, clientesApi,
} from "../../lib/api";

type Props = { pizzariaId: string };

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "Ainda não";
const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "CL";

export function ClientesView({ pizzariaId }: Props) {
  const [clientes, setClientes] = useState<ClientePainel[]>([]);
  const [total, setTotal] = useState(0);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientePainelDetalhe | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [novaSenha, setNovaSenha] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load(query = busca) {
    setLoading(true);
    setError(null);
    try {
      const result = await clientesApi.list(pizzariaId, query);
      setClientes(result.clientes);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os clientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load(busca), 280);
    return () => window.clearTimeout(timer);
  }, [pizzariaId, busca]);

  const stats = useMemo(() => ({
    pedidos: clientes.reduce((sum, item) => sum + Number(item.total_pedidos || 0), 0),
    receita: clientes.reduce((sum, item) => sum + Number(item.total_gasto || 0), 0),
    recorrentes: clientes.filter((item) => Number(item.total_pedidos || 0) > 1).length,
  }), [clientes]);

  async function openDetail(clienteId: string) {
    setDetailLoading(true);
    setFeedback(null);
    setDeleteArmed(false);
    setNovaSenha("");
    try {
      setDetail(await clientesApi.get(pizzariaId, clienteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível abrir o cliente.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function resetPassword() {
    if (!detail || novaSenha.length < 10) return;
    setSavingPassword(true);
    setFeedback(null);
    try {
      const result = await clientesApi.resetPassword(pizzariaId, detail.cliente.id, novaSenha);
      setFeedback(result.mensagem);
      setNovaSenha("");
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : "Não foi possível redefinir a senha.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function removeAccount() {
    if (!detail || !deleteArmed) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const result = await clientesApi.remove(pizzariaId, detail.cliente.id);
      setDetail(null);
      await load();
      setFeedback(result.mensagem);
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : "Não foi possível excluir a conta.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-8 max-w-[1500px] mx-auto space-y-5">
      <section className="rounded-2xl border border-orange-400/20 bg-gradient-to-br from-[#17110d] to-[#0d0c0b] p-5 md:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-orange-400 text-[11px] font-black uppercase tracking-[.2em]">
              <Users className="w-4 h-4" /> Relacionamento
            </div>
            <h2 className="mt-2 text-2xl md:text-3xl font-black text-white">Clientes do cardápio</h2>
            <p className="mt-1 text-sm text-slate-400 max-w-2xl">
              Consulte quem criou uma conta, veja o histórico de compras e gerencie o acesso com segurança.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
            <ShieldCheck className="w-4 h-4" /> Dados isolados por pizzaria
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={Users} label="Contas ativas" value={String(total)} tone="orange" />
        <Metric icon={ShoppingBag} label="Pedidos registrados" value={String(stats.pedidos)} tone="blue" />
        <Metric icon={CircleDollarSign} label="Receita da base" value={money(stats.receita)} tone="emerald" />
        <Metric icon={PackageCheck} label="Clientes recorrentes" value={String(stats.recorrentes)} tone="violet" />
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#11100f] overflow-hidden shadow-xl">
        <div className="p-4 md:p-5 border-b border-white/10 flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Base de clientes</h3>
            <p className="text-xs text-slate-500">Somente contas criadas no cardápio digital.</p>
          </div>
          <label className="relative block w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-white/10 bg-black/20 text-sm text-white placeholder:text-slate-600 outline-none focus:border-orange-500"
            />
          </label>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{error}</div>}
        {feedback && !detail && <div className="m-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{feedback}</div>}

        {loading ? (
          <div className="min-h-64 grid place-items-center text-slate-500"><Loader2 className="w-7 h-7 animate-spin" /></div>
        ) : clientes.length === 0 ? (
          <div className="min-h-72 grid place-items-center text-center p-8">
            <div><UserRound className="w-12 h-12 text-slate-700 mx-auto" /><h3 className="mt-3 font-bold text-white">Nenhum cliente encontrado</h3><p className="mt-1 text-sm text-slate-500">{busca ? "Tente outro termo de busca." : "As novas contas criadas no cardápio aparecerão aqui."}</p></div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {clientes.map((cliente) => (
              <button key={cliente.id} type="button" onClick={() => openDetail(cliente.id)} className="w-full p-4 md:px-5 flex items-center gap-3 md:gap-4 text-left hover:bg-white/[.035] transition-colors">
                <span className="w-11 h-11 grid place-items-center shrink-0 rounded-xl bg-orange-500/15 text-orange-300 text-xs font-black">{initials(cliente.nome)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-white">{cliente.nome}</strong>
                  <span className="block truncate text-xs text-slate-500">{cliente.email}</span>
                </span>
                <span className="hidden lg:block w-40 text-xs text-slate-400"><Phone className="inline w-3.5 h-3.5 mr-1.5" />{cliente.telefone}</span>
                <span className="hidden md:block w-28"><b className="block text-sm text-white">{cliente.total_pedidos}</b><small className="text-[10px] text-slate-500">pedidos</small></span>
                <span className="w-24 md:w-32 text-right"><b className="block text-sm text-emerald-300">{money(Number(cliente.total_gasto))}</b><small className="text-[10px] text-slate-500">total gasto</small></span>
                <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </section>

      {detailLoading && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70"><Loader2 className="w-9 h-9 animate-spin text-orange-400" /></div>}
      {detail && (
        <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm p-0 md:p-5 flex justify-end" onClick={() => setDetail(null)}>
          <aside className="w-full md:max-w-2xl h-full rounded-none md:rounded-2xl border-l md:border border-white/10 bg-[#11100f] overflow-y-auto shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="sticky top-0 z-10 p-4 md:p-5 border-b border-white/10 bg-[#11100f]/95 backdrop-blur flex items-start gap-3">
              <span className="w-12 h-12 grid place-items-center rounded-xl bg-orange-500/15 text-orange-300 font-black">{initials(detail.cliente.nome)}</span>
              <div className="min-w-0 flex-1"><h2 className="text-lg font-black text-white truncate">{detail.cliente.nome}</h2><p className="text-xs text-slate-500">Cliente desde {date(detail.cliente.criado_em)}</p></div>
              <button type="button" onClick={() => setDetail(null)} className="w-10 h-10 grid place-items-center rounded-xl bg-white/5 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </header>

            <div className="p-4 md:p-5 space-y-5">
              <section className="grid grid-cols-2 gap-3">
                <Info icon={Mail} label="E-mail" value={detail.cliente.email} wide />
                <Info icon={Phone} label="WhatsApp" value={detail.cliente.telefone} />
                <Info icon={CalendarDays} label="Último pedido" value={date(detail.cliente.ultima_visita)} />
                <Info icon={MapPin} label="Endereço salvo" value={detail.cliente.endereco_padrao || "Não informado"} wide />
              </section>

              <section>
                <div className="flex items-end justify-between mb-3"><div><h3 className="font-bold text-white">Histórico de pedidos</h3><p className="text-xs text-slate-500">{detail.pedidos.length} pedidos mais recentes</p></div><b className="text-emerald-300">{money(Number(detail.cliente.total_gasto))}</b></div>
                <div className="space-y-2">
                  {detail.pedidos.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">Nenhum pedido vinculado a esta conta.</div> : detail.pedidos.map((pedido) => (
                    <article key={pedido.id} className="rounded-xl border border-white/10 bg-black/15 p-3">
                      <div className="flex items-center justify-between gap-3"><div><b className="text-sm text-white">Pedido #{pedido.numero_pedido ?? "—"}</b><p className="text-[11px] text-slate-500">{date(pedido.criado_em)} · {pedido.tipo === "delivery" ? "Entrega" : "Retirada"}</p></div><span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">{pedido.status_label}</span></div>
                      <p className="mt-2 text-xs text-slate-400 truncate">{pedido.itens.map((item) => `${item.quantidade || 1}× ${item.nome || "Item"}`).join(" · ")}</p>
                      <b className="mt-2 block text-sm text-orange-300">{money(Number(pedido.valor_total))}</b>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[.06] p-4">
                <div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-300" /><h3 className="font-bold text-white">Redefinir senha</h3></div>
                <p className="mt-1 text-xs text-slate-400">Defina uma senha temporária com pelo menos 10 caracteres. Todas as sessões anteriores serão encerradas.</p>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input type="password" value={novaSenha} onChange={(event) => setNovaSenha(event.target.value)} placeholder="Nova senha temporária" className="flex-1 h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-amber-400" />
                  <button type="button" disabled={novaSenha.length < 10 || savingPassword} onClick={resetPassword} className="h-11 px-4 rounded-xl bg-amber-400 text-amber-950 text-xs font-black disabled:opacity-40">{savingPassword ? "Salvando..." : "Redefinir senha"}</button>
                </div>
              </section>

              {feedback && <div className="rounded-xl border border-blue-400/20 bg-blue-400/10 p-3 text-sm text-blue-200">{feedback}</div>}

              <section className="rounded-2xl border border-red-400/20 bg-red-400/[.06] p-4">
                <div className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-300" /><h3 className="font-bold text-white">Excluir conta</h3></div>
                <p className="mt-1 text-xs text-slate-400">Remove o acesso e anonimiza os dados pessoais. Os pedidos permanecem no histórico da pizzaria.</p>
                {!deleteArmed ? (
                  <button type="button" onClick={() => setDeleteArmed(true)} className="mt-3 h-10 px-4 rounded-xl border border-red-400/30 text-xs font-bold text-red-300 hover:bg-red-400/10">Iniciar exclusão</button>
                ) : (
                  <div className="mt-3 rounded-xl bg-red-500/10 p-3"><p className="text-xs font-bold text-red-200">Tem certeza? Esta conta perderá o acesso imediatamente.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setDeleteArmed(false)} className="h-10 px-4 rounded-xl border border-white/10 text-xs font-bold text-slate-300">Cancelar</button><button type="button" disabled={deleting} onClick={removeAccount} className="h-10 px-4 rounded-xl bg-red-500 text-xs font-black text-white disabled:opacity-50">{deleting ? "Excluindo..." : "Confirmar exclusão"}</button></div></div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone: "orange" | "blue" | "emerald" | "violet" }) {
  const colors = { orange: "bg-orange-400/10 text-orange-300", blue: "bg-blue-400/10 text-blue-300", emerald: "bg-emerald-400/10 text-emerald-300", violet: "bg-violet-400/10 text-violet-300" };
  return <div className="rounded-2xl border border-white/10 bg-[#11100f] p-4"><span className={`w-9 h-9 grid place-items-center rounded-xl ${colors[tone]}`}><Icon className="w-4 h-4" /></span><b className="mt-3 block text-lg md:text-xl text-white truncate">{value}</b><small className="text-[10px] uppercase tracking-wide text-slate-500">{label}</small></div>;
}

function Info({ icon: Icon, label, value, wide = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; wide?: boolean }) {
  return <div className={`rounded-xl border border-white/10 bg-black/15 p-3 ${wide ? "col-span-2" : ""}`}><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><Icon className="w-3.5 h-3.5" />{label}</span><b className="mt-1.5 block text-sm text-white break-words">{value}</b></div>;
}
