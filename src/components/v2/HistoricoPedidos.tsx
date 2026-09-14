import React, { useEffect, useMemo, useState } from "react";
import {
  History, RefreshCw, Search, Loader2, AlertCircle, Package,
  ClipboardList, DollarSign, PackageCheck, TrendingUp,
  Phone, MapPin, Calendar, CreditCard, ChevronRight, X, Eye,
  MessageCircle,
} from "lucide-react";
import { pedidosApi, BackendPedido, PedidoEvento } from "../../lib/api";
import { ORDER_STATUS_LIST, orderStatusLabel } from "../../lib/orderStatus";
import { Modal, Button } from "../ui";

interface Props {
  pizzariaId: string;
}

const brl = (val: number) =>
  val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  novo:           { label: "Novo", cls: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
  confirmado:     { label: "Confirmado", cls: "bg-amber-500/15 text-amber-400 border border-amber-500/30" },
  no_forno:       { label: "No forno", cls: "bg-orange-500/15 text-orange-400 border border-orange-500/30" },
  pronto_entrega: { label: "Pronto", cls: "bg-purple-500/15 text-purple-400 border border-purple-500/30" },
  a_caminho:      { label: "Em rota", cls: "bg-sky-500/15 text-sky-400 border border-sky-500/30" },
  entregue:       { label: "Entregue", cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
  cancelado:      { label: "Cancelado", cls: "bg-rose-500/15 text-rose-400 border border-rose-500/30" },
};

const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "CL";

export function HistoricoPedidos({ pizzariaId }: Props) {
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [pedidoSelecionado, setPedidoSelecionado] = useState<BackendPedido | null>(null);
  const [eventos, setEventos] = useState<PedidoEvento[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(false);

  function load(isSilent = false) {
    if (isSilent) setRefreshing(true);
    else setLoading(true);
    setErr(null);

    pedidosApi
      .list(pizzariaId, { limit: 500 })
      .then(setPedidos)
      .catch((e) => setErr(e.message || "Erro ao carregar histórico de pedidos."))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    load();
  }, [pizzariaId]);

  async function abrirDetalhes(p: BackendPedido) {
    setPedidoSelecionado(p);
    setEventos([]);
    setLoadingEventos(true);
    try {
      const historico = await pedidosApi.historico(pizzariaId, p.id);
      setEventos(historico);
    } catch {
      // silencioso se não houver histórico
    } finally {
      setLoadingEventos(false);
    }
  }

  // Métricas consolidadas
  const metrics = useMemo(() => {
    const total = pedidos.length;
    const validos = pedidos.filter((p) => p.status !== "cancelado");
    const faturamento = validos.reduce((acc, p) => acc + Number(p.valor_total || 0), 0);
    const entregues = pedidos.filter((p) => p.status === "entregue").length;
    const ticketMedio = validos.length > 0 ? faturamento / validos.length : 0;
    return { total, faturamento, entregues, ticketMedio };
  }, [pedidos]);

  // Lista filtrada
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
      if (!termo) return true;

      const num = String(p.numero_pedido || "");
      const clienteNome = (p.cliente?.nome || p.cliente_nome || "").toLowerCase();
      const clienteTel = (p.cliente?.telefone || p.cliente_telefone || "");
      const endereco = (p.endereco_entrega || "").toLowerCase();
      const itens = (p.itens || []).map((i) => (i.nome || "").toLowerCase()).join(" ");

      return (
        num.includes(termo) ||
        clienteNome.includes(termo) ||
        clienteTel.includes(termo) ||
        endereco.includes(termo) ||
        itens.includes(termo)
      );
    });
  }, [pedidos, filtroStatus, busca]);

  if (loading && pedidos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        <p className="text-xs text-slate-400">Carregando histórico de pedidos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 w-full min-w-0">
      {/* Header direct on canvas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-orange-500 text-xs font-black uppercase tracking-wider">
            <History className="w-4 h-4" /> REGISTROS HISTÓRICOS
          </div>
          <h2 className="mt-1 text-xl font-bold text-white tracking-tight">Histórico de Pedidos</h2>
          <p className="mt-0.5 text-xs text-slate-400 max-w-2xl">
            Consulte todos os pedidos já realizados, status de entrega e faturamento consolidado.
          </p>
        </div>

        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#111622] hover:bg-[#161f30] text-slate-200 border border-[#1e293b] rounded-xl transition disabled:opacity-50 self-start sm:self-auto shrink-0 shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-orange-400" : "text-slate-400"}`} />
          Atualizar
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl text-xs shadow-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{err}</span>
        </div>
      )}

      {/* 4 StatCards de Métricas - padronizados com Clientes.png */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#241a12] border border-amber-900/30 text-orange-400">
            <ClipboardList className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{metrics.total}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">TOTAL DE PEDIDOS</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#0e2720] border border-emerald-900/30 text-emerald-400">
            <DollarSign className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{brl(metrics.faturamento)}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">FATURAMENTO CONSOLIDADO</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#13233a] border border-blue-900/30 text-sky-400">
            <PackageCheck className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{metrics.entregues}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">ENTREGUES COM SUCESSO</small>
        </div>

        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
          <span className="w-10 h-10 grid place-items-center rounded-xl bg-[#221634] border border-purple-900/30 text-purple-400">
            <TrendingUp className="w-5 h-5" />
          </span>
          <b className="mt-4 block text-2xl font-black text-white tracking-tight">{brl(metrics.ticketMedio)}</b>
          <small className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">TICKET MÉDIO GERAL</small>
        </div>
      </section>

      {/* Tabela de Pedidos */}
      <section className="bg-[#111622] border border-[#1e293b] rounded-2xl overflow-hidden shadow-sm">
        {/* Header e Busca */}
        <div className="p-4 md:p-5 border-b border-[#1e293b] flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Base de pedidos</h3>
            <p className="text-xs text-slate-400">
              Mostrando {filtrados.length} de {pedidos.length} pedidos arquivados.
            </p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nº, cliente, telefone..."
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white placeholder:text-slate-500 outline-none focus:border-orange-500/50 transition"
            />
          </div>
        </div>

        {/* Abas de Filtros de Status */}
        <div className="px-5 py-3 border-b border-[#1e293b] bg-[#0d1117] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {["todos", ...ORDER_STATUS_LIST].map((st) => {
            const isActive = filtroStatus === st;
            const label = st === "todos" ? "Todos" : orderStatusLabel(st);
            const count = st === "todos" ? pedidos.length : pedidos.filter((p) => p.status === st).length;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setFiltroStatus(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                  isActive
                    ? "bg-orange-500 text-white shadow-xs"
                    : "bg-[#161f30] text-slate-400 hover:text-white border border-[#1e293b] hover:bg-[#1c273c]"
                }`}
              >
                <span>{label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-[#111622] text-slate-500"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table Header */}
        <div className="hidden lg:grid grid-cols-[90px_140px_1.6fr_1.6fr_130px_120px_32px] px-6 py-3.5 border-b border-[#1e293b] text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span>PEDIDO</span>
          <span>DATA / HORA</span>
          <span>CLIENTE</span>
          <span>ITENS & TIPO</span>
          <span>STATUS</span>
          <span className="text-right">VALOR</span>
          <span></span>
        </div>

        {/* Lista de Registros */}
        {filtrados.length === 0 ? (
          <div className="py-20 text-center px-4">
            <Package className="w-12 h-12 text-slate-600 mx-auto stroke-1 mb-3" />
            <h4 className="text-base font-bold text-white">Nenhum pedido arquivado</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {busca || filtroStatus !== "todos"
                ? "Nenhum pedido corresponde aos critérios de pesquisa ou status selecionados."
                : "Os pedidos registrados aparecerão listados aqui automaticamente conforme forem processados."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {filtrados.map((p) => {
              const badge = STATUS_BADGES[p.status] || { label: orderStatusLabel(p.status), cls: "bg-slate-800 text-slate-300" };
              const clienteNome = p.cliente?.nome || p.cliente_nome || "Cliente";
              const clienteTel = p.cliente?.telefone || p.cliente_telefone || "";
              const itensQtd = (p.itens || []).length;
              const itensResumo = (p.itens || []).map((i) => `${i.quantidade || 1}× ${i.nome}`).join(", ");
              const isDelivery = p.tipo === "delivery" || p.tipo === "entrega";

              return (
                <div
                  key={p.id}
                  onClick={() => abrirDetalhes(p)}
                  className="grid grid-cols-1 lg:grid-cols-[90px_140px_1.6fr_1.6fr_130px_120px_32px] items-center px-4 md:px-6 py-4 hover:bg-[#161f30]/40 transition-colors cursor-pointer gap-2 lg:gap-4 text-xs"
                >
                  {/* Número */}
                  <span className="w-12 h-8 rounded-lg bg-[#241a12] border border-amber-900/30 text-orange-400 font-bold font-mono grid place-items-center shrink-0 text-xs">
                    #{p.numero_pedido ?? "—"}
                  </span>

                  {/* Data e Hora */}
                  <div className="text-slate-400 font-medium">
                    <span className="block text-white font-semibold">
                      {new Date(p.created_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {new Date(p.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Cliente */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-[#2a1c14] border border-amber-900/30 text-orange-400 font-bold text-xs grid place-items-center shrink-0">
                      {initials(clienteNome)}
                    </span>
                    <div className="min-w-0">
                      <strong className="block text-white font-semibold truncate">{clienteNome}</strong>
                      {clienteTel ? (
                        <span className="block text-[11px] text-slate-400 truncate">{clienteTel}</span>
                      ) : (
                        <span className="block text-[11px] text-slate-500 italic truncate">Sem telefone</span>
                      )}
                    </div>
                  </div>

                  {/* Itens e Tipo */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                        isDelivery ? "bg-sky-500/15 text-sky-400 border border-sky-500/30" : "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                      }`}>
                        {isDelivery ? "Entrega" : "Retirada"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-300">{itensQtd} {itensQtd === 1 ? "item" : "itens"}</span>
                    </div>
                    {itensResumo && <p className="text-[11px] text-slate-400 truncate mt-1">{itensResumo}</p>}
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`inline-flex items-center text-[10px] font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Valor Total */}
                  <div className="lg:text-right">
                    <strong className="text-sm font-bold text-emerald-400">{brl(Number(p.valor_total || 0))}</strong>
                  </div>

                  {/* Chevron */}
                  <ChevronRight className="w-4 h-4 text-slate-600 justify-self-end hidden lg:block" />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal de Detalhes do Pedido */}
      {pedidoSelecionado && (
        <Modal
          open={!!pedidoSelecionado}
          onClose={() => setPedidoSelecionado(null)}
          size="lg"
          title={`Pedido #${pedidoSelecionado.numero_pedido ?? "—"}`}
          subtitle={`Realizado em ${new Date(pedidoSelecionado.created_at).toLocaleDateString("pt-BR")} às ${new Date(pedidoSelecionado.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
          icon={Package}
          footer={
            <div className="w-full flex items-center justify-between">
              {pedidoSelecionado.cliente?.telefone || pedidoSelecionado.cliente_telefone ? (
                <a
                  href={`https://wa.me/55${String(pedidoSelecionado.cliente?.telefone || pedidoSelecionado.cliente_telefone).replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#161f30] hover:bg-[#1e293b] text-emerald-400 border border-emerald-500/30 transition shadow-xs"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                  Chamar no WhatsApp
                </a>
              ) : (
                <div />
              )}
              <Button variant="outline" size="sm" onClick={() => setPedidoSelecionado(null)}>
                Fechar
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Status e Valor */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#161f30] p-4.5 rounded-2xl border border-[#1e293b] shadow-sm">
              <div className="flex items-center gap-3">
                <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                  pedidoSelecionado.tipo === "delivery" || pedidoSelecionado.tipo === "entrega"
                    ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                    : "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                }`}>
                  {pedidoSelecionado.tipo === "delivery" || pedidoSelecionado.tipo === "entrega" ? (
                    <MapPin className="w-5 h-5" />
                  ) : (
                    <Package className="w-5 h-5" />
                  )}
                </span>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Status do Pedido</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${
                      STATUS_BADGES[pedidoSelecionado.status]?.cls || "bg-slate-800 text-slate-300"
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {STATUS_BADGES[pedidoSelecionado.status]?.label || orderStatusLabel(pedidoSelecionado.status)}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                      pedidoSelecionado.tipo === "delivery" || pedidoSelecionado.tipo === "entrega"
                        ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                        : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                    }`}>
                      {pedidoSelecionado.tipo === "delivery" || pedidoSelecionado.tipo === "entrega" ? "Entrega" : "Retirada"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-[#1e293b]/60">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Valor Total</p>
                <p className="text-2xl font-black text-emerald-400 mt-0.5 tracking-tight">
                  {brl(Number(pedidoSelecionado.valor_total || 0))}
                </p>
              </div>
            </div>

            {/* Dados do Cliente */}
            <div className="bg-[#161f30] p-4.5 rounded-2xl border border-[#1e293b] space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#1e293b]/70 pb-2.5">
                <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-orange-400" />
                  Dados do Cliente
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-[#241a12] border border-amber-900/30 text-orange-400 font-bold text-xs grid place-items-center shrink-0">
                    {initials(pedidoSelecionado.cliente?.nome || pedidoSelecionado.cliente_nome || "Cliente")}
                  </span>
                  <div className="min-w-0">
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Nome</span>
                    <strong className="text-white text-sm font-bold block truncate">
                      {pedidoSelecionado.cliente?.nome || pedidoSelecionado.cliente_nome || "Não informado"}
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Telefone / WhatsApp</span>
                  {pedidoSelecionado.cliente?.telefone || pedidoSelecionado.cliente_telefone ? (
                    <span className="text-slate-200 font-medium block mt-1 font-mono">
                      {pedidoSelecionado.cliente?.telefone || pedidoSelecionado.cliente_telefone}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic mt-1 block">Não informado</span>
                  )}
                </div>
                {pedidoSelecionado.endereco_entrega && (
                  <div className="sm:col-span-2 pt-2.5 border-t border-[#1e293b]/60 flex items-start gap-2.5 bg-[#111622]/50 p-3 rounded-xl border border-[#1e293b]">
                    <MapPin className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Endereço de Entrega</span>
                      <p className="text-xs text-slate-200 font-medium mt-0.5 leading-relaxed">
                        {pedidoSelecionado.endereco_entrega}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Itens do Pedido */}
            <div className="bg-[#161f30] p-4.5 rounded-2xl border border-[#1e293b] space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#1e293b]/70 pb-2.5">
                <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5 text-orange-400" />
                  Itens do Pedido ({(pedidoSelecionado.itens || []).length})
                </h4>
                <span className="text-xs font-semibold text-slate-400">
                  {(pedidoSelecionado.itens || []).reduce((sum, item) => sum + (item.quantidade || 1), 0)} unidades
                </span>
              </div>
              <div className="divide-y divide-[#1e293b]/60">
                {(pedidoSelecionado.itens || []).map((item, idx) => (
                  <div key={idx} className="py-3 flex items-start justify-between gap-3 text-xs first:pt-1 last:pb-1">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-[#111622] border border-[#1e293b] text-orange-400 font-black text-xs grid place-items-center shrink-0 mt-0.5">
                        {item.quantidade || 1}×
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-white">{item.nome}</p>
                        {item.adicionais && item.adicionais.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {item.adicionais.map((a: any, aIdx: number) => (
                              <span key={aIdx} className="text-[10px] font-semibold bg-[#111622] text-slate-300 border border-[#1e293b] px-2 py-0.5 rounded-md">
                                + {typeof a === "string" ? a : a.nome}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.observacao && (
                          <p className="text-[11px] text-amber-300/90 font-medium italic mt-1.5 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg inline-block">
                            Obs: {item.observacao}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="font-black text-sm text-slate-200 shrink-0">
                      {brl(Number(item.preco_total || item.preco_unitario || 0))}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Eventos / Linha do Tempo */}
            <div className="bg-[#161f30] p-4.5 rounded-2xl border border-[#1e293b] space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#1e293b]/70 pb-2.5">
                <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-orange-400" />
                  Histórico de Eventos
                </h4>
              </div>
              {loadingEventos ? (
                <div className="py-6 text-center">
                  <Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto" />
                  <p className="text-xs text-slate-400 mt-2">Carregando eventos...</p>
                </div>
              ) : eventos.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">Nenhum evento adicional registrado para este pedido.</p>
              ) : (
                <ol className="space-y-3 relative before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-0.5 before:bg-[#1e293b] mt-2">
                  {eventos.map((ev) => (
                    <li key={ev.id} className="relative pl-7 text-xs">
                      <span className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-orange-500 border-2 border-[#161f30] shrink-0" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white text-xs capitalize">{ev.tipo.replaceAll("_", " ")}</span>
                        <span className="text-[11px] font-semibold text-slate-400 shrink-0">
                          {new Date(ev.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {ev.motivo && (
                        <p className="text-[11px] text-slate-300 mt-1 bg-[#111622] p-2 rounded-lg border border-[#1e293b]">
                          Motivo: {ev.motivo}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
