import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChevronDown, ChevronRight, CircleDollarSign, Copy, CreditCard, Heart, KeyRound, Loader2,
  Mail, MapPin, MessageCircle, PackageCheck, Phone, Receipt, Search, Settings2, ShieldCheck, ShoppingBag,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import {
  ApiError, ClientePainel, ClientePainelDetalhe, ClientePainelPedido, clientesApi,
} from "../../lib/api";

type Props = { pizzariaId: string };

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "Ainda não";
const dateTime = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "CL";

const PAGAMENTO: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
const pagamentoLabel = (forma?: string | null) => (forma ? PAGAMENTO[forma] ?? forma : "—");

const STATUS_COR: Record<string, string> = {
  novo: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  confirmado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  no_forno: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pronto_entrega: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  a_caminho: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  entregue: "bg-slate-500/15 text-ink-muted border-slate-500/30",
  cancelado: "bg-red-500/15 text-red-300 border-red-500/30",
};

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
  const [gerenciarAberto, setGerenciarAberto] = useState(false);
  const [pedidoAberto, setPedidoAberto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

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
    setGerenciarAberto(false);
    setPedidoAberto(null);
    try {
      setDetail(await clientesApi.get(pizzariaId, clienteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível abrir o cliente.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetail(null);
    setNovaSenha("");
    setDeleteArmed(false);
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

  async function copiarTelefone(telefone: string) {
    try {
      await navigator.clipboard.writeText(telefone);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sem permissão de área de transferência: ignora */
    }
  }

  return (
    <div className="pzb-page w-full min-w-0 space-y-6">
      {/* Header direct on canvas */}
      <div className="pzb-page-header">
        <div>
          <h2 className="text-base font-semibold text-ink">Clientes do cardápio</h2>
          <p className="pzb-page-description max-w-2xl">
            Consulte quem criou uma conta, veja o histórico de compras e gerencie o acesso com segurança.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-2 text-xs font-bold text-emerald-400 self-start md:self-auto">
          <ShieldCheck className="w-4 h-4 text-emerald-400" /> Dados isolados por pizzaria
        </div>
      </div>

      {/* Stat Cards */}
      <section className="pzb-section grid grid-cols-2 lg:grid-cols-4 overflow-hidden">
        <StatBox icon={Users} cor="bg-brand-500/10 text-brand-400" valor={String(total)} label="CONTAS ATIVAS" />
        <StatBox icon={ShoppingBag} cor="bg-surface-muted text-ink-muted" valor={String(stats.pedidos)} label="PEDIDOS REGISTRADOS" />
        <StatBox icon={CircleDollarSign} cor="bg-surface-muted text-ink-muted" valor={money(stats.receita)} label="RECEITA DA BASE" />
        <StatBox icon={PackageCheck} cor="bg-surface-muted text-ink-muted" valor={String(stats.recorrentes)} label="CLIENTES RECORRENTES" />
      </section>

      {/* Base de clientes */}
      <section className="pzb-section overflow-hidden">
        <div className="p-4 md:p-5 border-b border-line flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Base de clientes</h2>
            <p className="text-xs text-ink-muted">Somente contas criadas no cardápio digital.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
            {/* Sem autocomplete: com o campo de senha do detalhe na página, o Chrome
                tratava a tela como login e escrevia o e-mail do dono aqui — a lista
                sumia ao fechar o cliente e só voltava atualizando a página. */}
            <input
              type="search"
              name="busca-clientes"
              autoComplete="off"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              aria-label="Buscar clientes por nome, e-mail ou telefone"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-line bg-surface-muted text-xs text-white placeholder:text-ink-subtle outline-none focus:border-orange-500/50 transition"
            />
          </div>
        </div>

        {error && <div className="m-4 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">{error}</div>}
        {feedback && !detail && <div className="m-4 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-300">{feedback}</div>}

        {/* Table header */}
        <div className="hidden sm:grid grid-cols-[1.8fr_1.4fr_1fr_1fr_32px] px-6 py-3.5 border-b border-line text-xs font-bold text-ink-subtle">
          <span>CLIENTE</span>
          <span>CONTATO</span>
          <span>PEDIDOS</span>
          <span>TOTAL GASTO</span>
          <span></span>
        </div>

        {loading ? (
          <div className="min-h-64 grid place-items-center text-ink-subtle"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
        ) : clientes.length === 0 ? (
          <div className="min-h-72 grid place-items-center text-center p-8">
            <div>
              <UserRound className="w-12 h-12 text-ink-subtle mx-auto" />
              <h3 className="mt-3 font-bold text-white">Nenhum cliente encontrado</h3>
              <p className="mt-1 text-xs text-ink-muted">{busca ? "Tente outro termo de busca." : "As novas contas criadas no cardápio aparecerão aqui."}</p>
              {busca && (
                <button type="button" onClick={() => setBusca("")} className="mt-3 h-8 px-3.5 rounded-xl border border-line text-xs font-bold text-ink-muted hover:bg-surface-muted">
                  Limpar busca
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {clientes.map((cliente) => (
              <div
                key={cliente.id}
                role="button"
                tabIndex={0}
                aria-label={`Abrir detalhes de ${cliente.nome}`}
                onClick={() => openDetail(cliente.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(cliente.id); } }}
                className="grid grid-cols-1 sm:grid-cols-[1.8fr_1.4fr_1fr_1fr_32px] items-center px-4 md:px-6 py-4 hover:bg-surface-muted/40 transition-colors cursor-pointer gap-2 sm:gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 text-orange-400 font-bold text-sm grid place-items-center shrink-0">
                    {initials(cliente.nome)}
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-sm font-bold text-white truncate">{cliente.nome}</strong>
                    <span className="block text-xs text-ink-muted truncate">{cliente.email}</span>
                  </div>
                </div>
                <div className="text-xs text-ink-muted flex items-center gap-2 min-w-0">
                  <Phone className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                  <span className="truncate">{cliente.telefone || "—"}</span>
                </div>
                <div className="text-xs font-semibold text-ink-muted">
                  {cliente.total_pedidos} {cliente.total_pedidos === 1 ? "pedido" : "pedidos"}
                </div>
                <div className="text-sm font-bold text-emerald-400">
                  {money(Number(cliente.total_gasto))}
                </div>
                <ChevronRight className="w-4 h-4 text-ink-subtle justify-self-end hidden sm:block" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Drawer de detalhes do cliente */}
      {detailLoading && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80"><Loader2 className="w-9 h-9 animate-spin text-orange-500" /></div>}
      {detail && (() => {
        const c = detail.cliente;
        const r = detail.resumo;
        const nPedidos = r?.pedidos ?? c.total_pedidos;
        const gasto = r?.total_gasto ?? c.total_gasto;
        const recorrente = nPedidos > 1;
        const whatsapp = (c.telefone || "").replace(/\D/g, "");
        return (
          <div className="fixed inset-0 z-[90] bg-black/80 p-0 md:p-5 flex justify-end animate-in fade-in" onClick={closeDetail}>
            <aside role="dialog" aria-modal="true" aria-labelledby="cliente-detalhe-title" className="w-full md:max-w-2xl h-full rounded-none md:rounded-xl border-l md:border border-line bg-surface overflow-y-auto shadow-2xl" onClick={(event) => event.stopPropagation()}>
              {/* Cabeçalho: quem é + ações rápidas */}
              <header className="sticky top-0 z-10 p-5 border-b border-line bg-surface/95">
                <div className="flex items-start gap-3">
                  <span className="w-12 h-12 grid place-items-center rounded-xl bg-brand-500/10 text-brand-400 font-semibold shrink-0">{initials(c.nome)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 id="cliente-detalhe-title" className="text-base font-semibold text-ink truncate">{c.nome}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${recorrente ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-sky-500/15 text-sky-300 border-sky-500/30"}`}>
                        {recorrente ? "Recorrente" : nPedidos === 1 ? "1º pedido" : "Sem pedidos"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted">Conta criada em {date(c.criado_em)}</p>
                  </div>
                  <button type="button" onClick={closeDetail} aria-label="Fechar" className="w-9 h-9 grid place-items-center rounded-xl bg-surface-muted text-ink-muted hover:text-ink border border-line transition shrink-0"><X className="w-4 h-4" /></button>
                </div>
                {whatsapp && (
                  <div className="mt-3 flex gap-2">
                    <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"
                      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition">
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </a>
                    <button type="button" onClick={() => copiarTelefone(c.telefone)}
                      className="h-8 px-3 inline-flex items-center gap-1.5 rounded-xl border border-line text-xs font-bold text-ink-muted hover:bg-surface-muted transition">
                      <Copy className="w-3.5 h-3.5" /> {copiado ? "Copiado!" : "Copiar telefone"}
                    </button>
                  </div>
                )}
              </header>

              <div className="p-5 space-y-5">
                {/* Números */}
                <section className="grid grid-cols-3 border-b border-line pb-4">
                  <Numero label="Pedidos" valor={String(nPedidos)} />
                  <Numero label="Total gasto" valor={money(Number(gasto))} destaque />
                  <Numero label="Ticket médio" valor={money(Number(r?.ticket_medio ?? (nPedidos ? gasto / nPedidos : 0)))} />
                </section>

                {/* Contato e preferências */}
                <section className="divide-y divide-line">
                  <Linha icon={Phone} label="WhatsApp" valor={c.telefone || "—"} />
                  <Linha icon={Mail} label="E-mail" valor={c.email || "—"} />
                  <Linha icon={MapPin} label="Endereço salvo" valor={c.endereco_padrao || "Não informado"} />
                  <Linha icon={CalendarDays} label="Último pedido" valor={date(c.ultima_visita)} />
                  <Linha icon={CreditCard} label="Paga normalmente com" valor={pagamentoLabel(r?.pagamento_preferido)} />
                </section>

                {r && r.favoritos.length > 0 && (
                  <section>
                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-ink-muted mb-2">
                      <Heart className="w-3.5 h-3.5 text-rose-400" /> Mais pedidos
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {r.favoritos.map((f) => (
                        <span key={f.nome} className="rounded-xl border border-line bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink">
                          {f.nome} <span className="text-orange-400 font-bold">×{f.quantidade}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {/* Histórico */}
                <section>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <h3 className="flex items-center gap-1.5 font-bold text-white text-sm"><Receipt className="w-4 h-4 text-orange-400" /> Histórico de pedidos</h3>
                      <p className="text-xs text-ink-muted">
                        {detail.pedidos.length} {detail.pedidos.length === 1 ? "pedido" : "pedidos"}
                        {r && r.cancelados > 0 ? ` · ${r.cancelados} cancelado(s)` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {detail.pedidos.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-line p-6 text-center text-xs text-ink-muted">
                        Nenhum pedido vinculado a esta conta.
                      </div>
                    ) : (
                      detail.pedidos.map((pedido) => (
                        <div key={pedido.id}>
                          <PedidoItem
                            pedido={pedido}
                            aberto={pedidoAberto === pedido.id}
                            onToggle={() => setPedidoAberto(pedidoAberto === pedido.id ? null : pedido.id)}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {feedback && <div role="status" className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink-muted">{feedback}</div>}

                {/* Gerenciar conta: senha e exclusão ficam recolhidas, longe do dia a dia */}
                <section className="rounded-xl border border-line">
                  <button type="button" onClick={() => setGerenciarAberto(!gerenciarAberto)}
                    aria-expanded={gerenciarAberto}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-ink-muted hover:bg-surface-muted rounded-xl">
                    <span className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-ink-muted" /> Gerenciar conta</span>
                    <ChevronDown className={`w-4 h-4 text-ink-subtle transition-transform ${gerenciarAberto ? "rotate-180" : ""}`} />
                  </button>
                  {gerenciarAberto && (
                    <div className="p-4 pt-1 space-y-4">
                      {/* Formulário próprio com o usuário DO CLIENTE e "new-password":
                          antes o Chrome preenchia a senha salva do dono aqui. */}
                      <form className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4" autoComplete="off"
                        onSubmit={(event) => { event.preventDefault(); resetPassword(); }}>
                        <input type="text" name="username" autoComplete="username" value={c.email} readOnly hidden />
                        <div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /><h3 className="font-bold text-white text-sm">Redefinir senha</h3></div>
                        <p className="mt-1 text-xs text-ink-muted">Defina uma senha temporária com pelo menos 10 caracteres. Todas as sessões anteriores serão encerradas.</p>
                        <div className="mt-3 flex flex-col sm:flex-row gap-2">
                          <input type="password" name="nova-senha-cliente" autoComplete="new-password" value={novaSenha} onChange={(event) => setNovaSenha(event.target.value)} placeholder="Nova senha temporária" aria-label="Nova senha temporária do cliente" className="flex-1 h-10 rounded-lg border border-line bg-surface-muted px-3.5 text-sm text-ink outline-none focus:border-amber-400" />
                          <button type="submit" disabled={novaSenha.length < 10 || savingPassword} className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-amber-950 text-xs font-bold disabled:opacity-40 transition">
                            {savingPassword ? "Salvando..." : "Redefinir senha"}
                          </button>
                        </div>
                      </form>

                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                        <div className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-400" /><h3 className="font-bold text-white text-sm">Excluir conta</h3></div>
                        <p className="mt-1 text-xs text-ink-muted">Remove o acesso e anonimiza os dados pessoais. Os pedidos permanecem no histórico da pizzaria.</p>
                        {!deleteArmed ? (
                          <button type="button" onClick={() => setDeleteArmed(true)} className="mt-3 h-9 px-4 rounded-xl border border-red-500/30 text-xs font-bold text-red-400 hover:bg-red-500/10 transition">Iniciar exclusão</button>
                        ) : (
                          <div className="mt-3 rounded-xl bg-red-950/60 border border-red-800/40 p-3">
                            <p className="text-xs font-bold text-red-300">Tem certeza? Esta conta perderá o acesso imediatamente.</p>
                            <div className="mt-3 flex gap-2">
                              <button type="button" onClick={() => setDeleteArmed(false)} className="h-9 px-4 rounded-xl border border-line text-xs font-bold text-ink-muted hover:bg-surface-muted">Cancelar</button>
                              <button type="button" disabled={deleting} onClick={removeAccount} className="h-9 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-xs font-bold text-white disabled:opacity-50">
                                {deleting ? "Excluindo..." : "Confirmar exclusão"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </aside>
          </div>
        );
      })()}
    </div>
  );
}

function StatBox({ icon: Icon, cor, valor, label }: { icon: React.ComponentType<{ className?: string }>; cor: string; valor: string; label: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className={`w-9 h-9 grid place-items-center rounded-lg ${cor}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <small className="block text-xs text-ink-muted">{label}</small>
        <b className="mt-1 block text-base font-semibold text-ink tabular-nums">{valor}</b>
      </div>
    </div>
  );
}

function Numero({ label, valor, destaque = false }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="px-2 py-2 text-center">
      <b className={`block text-base font-bold tracking-tight ${destaque ? "text-emerald-400" : "text-white"}`}>{valor}</b>
      <span className="mt-0.5 block text-xs font-bold text-ink-muted">{label}</span>
    </div>
  );
}

function Linha({ icon: Icon, label, valor }: { icon: React.ComponentType<{ className?: string }>; label: string; valor: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-ink-subtle mt-0.5 shrink-0" />
      <span className="w-24 sm:w-40 shrink-0 text-xs text-ink-muted">{label}</span>
      <b className="min-w-0 flex-1 text-xs font-semibold text-white break-words">{valor}</b>
    </div>
  );
}

function PedidoItem({ pedido, aberto, onToggle }: { pedido: ClientePainelPedido; aberto: boolean; onToggle: () => void }) {
  const itens = pedido.itens || [];
  const resumoItens = itens.map((item) => `${item.quantidade || 1}× ${item.nome || "Item"}`).join(" · ");
  return (
    <article className="border-b border-line last:border-b-0 overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={aberto} className="w-full text-left p-3.5 hover:bg-surface-muted transition">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <b className="text-xs font-bold text-white">Pedido #{pedido.numero_pedido ?? "—"}</b>
            <p className="text-xs text-ink-muted mt-0.5">
              {dateTime(pedido.criado_em)} · {pedido.tipo === "delivery" ? "Entrega" : "Retirada"}
              {pedido.origem ? ` · ${pedido.origem === "cardapio_digital" ? "Cardápio digital" : "WhatsApp"}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_COR[pedido.status] ?? "bg-surface text-ink-muted border-line"}`}>{pedido.status_label}</span>
            <b className="text-sm font-bold text-orange-400">{money(Number(pedido.valor_total))}</b>
            <ChevronDown className={`w-4 h-4 text-ink-subtle transition-transform ${aberto ? "rotate-180" : ""}`} />
          </div>
        </div>
        {!aberto && <p className="mt-2 text-xs text-ink-muted truncate">{resumoItens}</p>}
      </button>
      {aberto && (
        <div className="px-3.5 pb-3.5 space-y-2 border-t border-line pt-3">
          {itens.map((item, i) => {
            const qtd = Number(item.quantidade || 1);
            const unit = Number(item.preco_unit || 0);
            return (
              <div key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-ink">
                  <b className="text-orange-400">{qtd}×</b> {item.nome || "Item"}
                  {item.adicionais && item.adicionais.length > 0 && (
                    <span className="block text-xs text-ink-muted">+ {item.adicionais.join(", ")}</span>
                  )}
                </span>
                <span className="font-semibold text-ink shrink-0">{unit > 0 ? money(unit * qtd) : "—"}</span>
              </div>
            );
          })}
          {Number(pedido.taxa_entrega || 0) > 0 && (
            <div className="flex justify-between text-xs text-ink-muted">
              <span>Entrega</span><span>{money(Number(pedido.taxa_entrega))}</span>
            </div>
          )}
          <div className="flex justify-between text-xs font-bold text-white border-t border-line pt-2">
            <span>Total · {pagamentoLabel(pedido.forma_pagamento)}</span><span>{money(Number(pedido.valor_total))}</span>
          </div>
          {pedido.endereco_entrega && (
            <p className="flex items-start gap-1.5 text-xs text-ink-muted"><MapPin className="w-3.5 h-3.5 shrink-0 mt-px" /> {pedido.endereco_entrega}</p>
          )}
        </div>
      )}
    </article>
  );
}
