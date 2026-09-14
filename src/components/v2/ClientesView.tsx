import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronRight, CircleDollarSign, KeyRound, Loader2,
  Mail, MapPin, PackageCheck, Phone, Search, ShieldCheck, ShoppingBag,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import {
  ApiError, ClientePainel, ClientePainelDetalhe, clientesApi,
} from "../../lib/api";
import { StatCard } from "../ui";

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
    <div className="w-full min-w-0 p-4 md:p-6 pb-24 md:pb-8 space-y-6">
      {/* Header direct on canvas */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-orange-500 text-xs font-black uppercase tracking-wider">
            <Users className="w-4 h-4" /> RELACIONAMENTO
          </div>
          <h2 className="mt-1 text-xl font-bold text-white tracking-tight">Clientes do cardápio</h2>
          <p className="mt-0.5 text-xs text-slate-400 max-w-2xl">
            Consulte quem criou uma conta, veja o histórico de compras e gerencie o acesso com segurança.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-2 text-xs font-bold text-emerald-400 self-start md:self-auto shadow-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-400" /> Dados isolados por pizzaria
        </div>
      </div>

      {/* Stat Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#241a12] border border-amber-900/30 text-orange-400">
            <Users className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{total}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">CONTAS ATIVAS</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#13233a] border border-blue-900/30 text-sky-400">
            <ShoppingBag className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{stats.pedidos}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">PEDIDOS REGISTRADOS</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#0e2720] border border-emerald-900/30 text-emerald-400">
            <CircleDollarSign className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{money(stats.receita)}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">RECEITA DA BASE</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#221634] border border-purple-900/30 text-purple-400">
            <PackageCheck className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{stats.recorrentes}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">CLIENTES RECORRENTES</small>
        </div>
      </section>

      {/* Base de clientes */}
      <section className="rounded-2xl border border-[#1e293b] bg-[#111622] overflow-hidden shadow-sm">
        <div className="p-4 md:p-5 border-b border-[#1e293b] flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Base de clientes</h2>
            <p className="text-xs text-slate-400">Somente contas criadas no cardápio digital.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white placeholder:text-slate-500 outline-none focus:border-orange-500/50 transition"
            />
          </div>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">{error}</div>}
        {feedback && !detail && <div className="m-4 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-300">{feedback}</div>}

        {/* Table header */}
        <div className="hidden sm:grid grid-cols-[1.8fr_1.4fr_1fr_1fr_32px] px-6 py-3.5 border-b border-[#1e293b] text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span>CLIENTE</span>
          <span>CONTATO</span>
          <span>PEDIDOS</span>
          <span>TOTAL GASTO</span>
          <span></span>
        </div>

        {loading ? (
          <div className="min-h-64 grid place-items-center text-slate-500"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
        ) : clientes.length === 0 ? (
          <div className="min-h-72 grid place-items-center text-center p-8">
            <div>
              <UserRound className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="mt-3 font-bold text-white">Nenhum cliente encontrado</h3>
              <p className="mt-1 text-xs text-slate-400">{busca ? "Tente outro termo de busca." : "As novas contas criadas no cardápio aparecerão aqui."}</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {clientes.map((cliente) => (
              <div
                key={cliente.id}
                onClick={() => openDetail(cliente.id)}
                className="grid grid-cols-1 sm:grid-cols-[1.8fr_1.4fr_1fr_1fr_32px] items-center px-4 md:px-6 py-4 hover:bg-[#161f30]/40 transition-colors cursor-pointer gap-2 sm:gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-[#2a1c14] border border-amber-900/30 text-orange-400 font-bold text-sm grid place-items-center shrink-0">
                    {initials(cliente.nome)}
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-sm font-bold text-white truncate">{cliente.nome}</strong>
                    <span className="block text-xs text-slate-400 truncate">{cliente.email}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2 min-w-0">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">{cliente.telefone || "—"}</span>
                </div>
                <div className="text-xs font-semibold text-slate-300">
                  {cliente.total_pedidos} {cliente.total_pedidos === 1 ? "pedido" : "pedidos"}
                </div>
                <div className="text-sm font-bold text-emerald-400">
                  {money(Number(cliente.total_gasto))}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 justify-self-end hidden sm:block" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal / Drawer de Detalhes */}
      {detailLoading && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80"><Loader2 className="w-9 h-9 animate-spin text-orange-500" /></div>}
      {detail && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm p-0 md:p-5 flex justify-end animate-in fade-in" onClick={() => setDetail(null)}>
          <aside className="w-full md:max-w-2xl h-full rounded-none md:rounded-2xl border-l md:border border-[#1e293b] bg-[#111622] overflow-y-auto shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="sticky top-0 z-10 p-5 border-b border-[#1e293b] bg-[#111622]/95 backdrop-blur flex items-start gap-3">
              <span className="w-12 h-12 grid place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white font-bold shadow-sm">{initials(detail.cliente.nome)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white truncate">{detail.cliente.nome}</h2>
                <p className="text-xs text-slate-400">Cliente desde {date(detail.cliente.criado_em)}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="w-9 h-9 grid place-items-center rounded-xl bg-[#161f30] text-slate-400 hover:text-white border border-[#1e293b] transition"><X className="w-4 h-4" /></button>
            </header>

            <div className="p-5 space-y-5">
              <section className="grid grid-cols-2 gap-3">
                <Info icon={Mail} label="E-mail" value={detail.cliente.email} wide />
                <Info icon={Phone} label="WhatsApp" value={detail.cliente.telefone} />
                <Info icon={CalendarDays} label="Último pedido" value={date(detail.cliente.ultima_visita)} />
                <Info icon={MapPin} label="Endereço salvo" value={detail.cliente.endereco_padrao || "Não informado"} wide />
              </section>

              <section>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-white text-sm">Histórico de pedidos</h3>
                    <p className="text-xs text-slate-400">{detail.pedidos.length} pedidos mais recentes</p>
                  </div>
                  <b className="text-emerald-400 font-bold text-sm">{money(Number(detail.cliente.total_gasto))}</b>
                </div>
                <div className="space-y-2">
                  {detail.pedidos.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#1e293b] p-6 text-center text-xs text-slate-400">
                      Nenhum pedido vinculado a esta conta.
                    </div>
                  ) : (
                    detail.pedidos.map((pedido) => (
                      <article key={pedido.id} className="rounded-xl border border-[#1e293b] bg-[#161f30] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <b className="text-xs font-bold text-white">Pedido #{pedido.numero_pedido ?? "—"}</b>
                            <p className="text-[11px] text-slate-400 mt-0.5">{date(pedido.criado_em)} · {pedido.tipo === "delivery" ? "Entrega" : "Retirada"}</p>
                          </div>
                          <span className="rounded-full bg-[#111622] border border-[#1e293b] px-2.5 py-0.5 text-[10px] font-bold text-slate-300">{pedido.status_label}</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-300 truncate">{pedido.itens.map((item) => `${item.quantidade || 1}× ${item.nome || "Item"}`).join(" · ")}</p>
                        <b className="mt-2 block text-xs font-bold text-orange-400">{money(Number(pedido.valor_total))}</b>
                      </article>
                    ))
                  )}
                </div>
              </section>

              {/* Redefinir senha */}
              <section className="rounded-xl border border-amber-500/20 bg-[#1c1808] p-4">
                <div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /><h3 className="font-bold text-white text-sm">Redefinir senha</h3></div>
                <p className="mt-1 text-xs text-slate-400">Defina uma senha temporária com pelo menos 10 caracteres. Todas as sessões anteriores serão encerradas.</p>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input type="password" value={novaSenha} onChange={(event) => setNovaSenha(event.target.value)} placeholder="Nova senha temporária" className="flex-1 h-10 rounded-xl border border-[#1e293b] bg-[#161f30] px-3.5 text-xs text-white outline-none focus:border-amber-400" />
                  <button type="button" disabled={novaSenha.length < 10 || savingPassword} onClick={resetPassword} className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold disabled:opacity-40 transition">
                    {savingPassword ? "Salvando..." : "Redefinir senha"}
                  </button>
                </div>
              </section>

              {feedback && <div className="rounded-xl border border-blue-500/20 bg-blue-950/40 p-3 text-xs text-blue-300">{feedback}</div>}

              {/* Excluir conta */}
              <section className="rounded-xl border border-red-500/20 bg-[#220d0f] p-4">
                <div className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-400" /><h3 className="font-bold text-white text-sm">Excluir conta</h3></div>
                <p className="mt-1 text-xs text-slate-400">Remove o acesso e anonimiza os dados pessoais. Os pedidos permanecem no histórico da pizzaria.</p>
                {!deleteArmed ? (
                  <button type="button" onClick={() => setDeleteArmed(true)} className="mt-3 h-9 px-4 rounded-xl border border-red-500/30 text-xs font-bold text-red-400 hover:bg-red-500/10 transition">Iniciar exclusão</button>
                ) : (
                  <div className="mt-3 rounded-xl bg-red-950/60 border border-red-800/40 p-3">
                    <p className="text-xs font-bold text-red-300">Tem certeza? Esta conta perderá o acesso imediatamente.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => setDeleteArmed(false)} className="h-9 px-4 rounded-xl border border-[#1e293b] text-xs font-bold text-slate-300 hover:bg-[#161f30]">Cancelar</button>
                      <button type="button" disabled={deleting} onClick={removeAccount} className="h-9 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-xs font-bold text-white disabled:opacity-50">
                        {deleting ? "Excluindo..." : "Confirmar exclusão"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Info({ icon: Icon, label, value, wide = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-[#1e293b] bg-[#161f30] p-3.5 ${wide ? "col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <Icon className="w-3.5 h-3.5 text-slate-400" />{label}
      </span>
      <b className="mt-1.5 block text-xs font-bold text-white break-words">{value}</b>
    </div>
  );
}
