/**
 * Pedidos v2 — "Gerenciamento de Pedidos".
 *
 * Tela inicial do painel: barra de métricas + filtros (status/data) + grid de
 * cards com dropdown de status, botão de WhatsApp e excluir. Conectada ao
 * backend Python. O checklist de onboarding aparece no topo enquanto houver
 * passos pendentes.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Loader2, AlertCircle, Package, Store as StoreIcon, Clock,
  Phone, MapPin, CreditCard, Trash2, ClipboardList, Hourglass,
  ChefHat, DollarSign, Filter, MessageCircle, User, Receipt, Check, X,
} from "lucide-react";
import { pedidosApi, BackendPedido } from "../../lib/api";
import { OnboardingChecklist, OnboardingItem } from "./OnboardingChecklist";

interface Props {
  pizzariaId: string;
  columnNames?: Record<string, string>;
  liveEvent?: { tipo: string; payload: any } | null;
  onboarding?: OnboardingItem[];
  onNavigate?: (key: string) => void;
}

const STATUS_LIST = ["novo", "confirmado", "no_forno", "a_caminho", "entregue", "cancelado"];

const STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  novo:       { label: "Novo",       badge: "bg-blue-50 text-blue-700 border-blue-200",       dot: "bg-blue-500" },
  confirmado: { label: "Confirmado", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  no_forno:   { label: "No forno",   badge: "bg-amber-50 text-amber-700 border-amber-200",     dot: "bg-amber-500" },
  a_caminho:  { label: "A caminho",  badge: "bg-violet-50 text-violet-700 border-violet-200",   dot: "bg-violet-500" },
  entregue:   { label: "Entregue",   badge: "bg-green-50 text-green-700 border-green-200",      dot: "bg-green-500" },
  cancelado:  { label: "Cancelado",  badge: "bg-rose-50 text-rose-700 border-rose-200",         dot: "bg-rose-500" },
};

const brl = (n: number | string) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PedidosViewV2({ pizzariaId, columnNames, liveEvent, onboarding, onNavigate }: Props) {
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [payingIds, setPayingIds] = useState<Set<string>>(new Set());
  // Pedidos cujo comprovante já chegou nesta sessão (destaque mais forte no card).
  const [comprovanteIds, setComprovanteIds] = useState<Set<string>>(new Set());

  // Filtros
  const [statusFiltro, setStatusFiltro] = useState<string>("");
  const [dataDe, setDataDe] = useState<string>("");
  const [dataAte, setDataAte] = useState<string>("");

  const statusLabel = (key: string) => columnNames?.[key] || STATUS_META[key]?.label || key;

  function load() {
    return pedidosApi
      .list(pizzariaId, { limit: 200 })
      .then(setPedidos)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pizzariaId]);

  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.tipo === "pedidos.limpos") { setPedidos([]); return; }
    if (liveEvent.tipo === "pedido.comprovante" || liveEvent.tipo === "pagamento.comprovante") {
      const pid = liveEvent.payload?.pedido_id;
      if (pid) setComprovanteIds((s) => new Set(s).add(pid));
      load();
      return;
    }
    if (
      liveEvent.tipo === "pedido.novo" ||
      liveEvent.tipo === "pedido.atualizado" ||
      liveEvent.tipo === "pagamento.manual_pendente"
    ) {
      load();
    }
  }, [liveEvent]);

  // Lista filtrada (status + intervalo de datas), client-side.
  const filtrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (statusFiltro && p.status !== statusFiltro) return false;
      if (dataDe || dataAte) {
        const d = new Date(p.created_at);
        if (dataDe && d < new Date(`${dataDe}T00:00:00`)) return false;
        if (dataAte && d > new Date(`${dataAte}T23:59:59`)) return false;
      }
      return true;
    });
  }, [pedidos, statusFiltro, dataDe, dataAte]);

  // Métricas (sobre a lista filtrada).
  const stats = useMemo(() => {
    const total = filtrados.length;
    const pendentes = filtrados.filter((p) => p.status === "novo" || p.status === "confirmado").length;
    const preparando = filtrados.filter((p) => p.status === "no_forno" || p.status === "a_caminho").length;
    const faturamento = filtrados
      .filter((p) => p.status !== "cancelado")
      .reduce((acc, p) => acc + Number(p.valor_total || 0), 0);
    return { total, pendentes, preparando, faturamento };
  }, [filtrados]);

  async function moveStatus(pedidoId: string, novoStatus: string) {
    if (movingIds.has(pedidoId)) return;
    const anterior = pedidos.find((p) => p.id === pedidoId);
    if (!anterior || anterior.status === novoStatus) return;

    setErr(null);
    setMovingIds((s) => new Set(s).add(pedidoId));
    // Otimista
    setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? { ...p, status: novoStatus } : p)));
    try {
      const updated = await pedidosApi.updateStatus(pizzariaId, pedidoId, novoStatus);
      setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? updated : p)));
    } catch (e: any) {
      setErr(e.message);
      setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? anterior : p)));
    } finally {
      setMovingIds((s) => { const n = new Set(s); n.delete(pedidoId); return n; });
    }
  }

  async function removerPedido(p: BackendPedido) {
    if (deletingIds.has(p.id)) return;
    const ok = window.confirm(`Excluir o Pedido #${p.numero_pedido ?? "—"}? Esta ação é irreversível.`);
    if (!ok) return;

    setErr(null);
    setDeletingIds((s) => new Set(s).add(p.id));
    const snapshot = pedidos;
    // Otimista: remove já
    setPedidos((ps) => ps.filter((x) => x.id !== p.id));
    try {
      await pedidosApi.remover(pizzariaId, p.id);
    } catch (e: any) {
      setErr(e.message);
      setPedidos(snapshot); // reverte
    } finally {
      setDeletingIds((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  }

  // Conferência do Pix manual: confirma (aprova + avisa cliente) ou rejeita.
  async function conferirPagamento(pedidoId: string, acao: "confirmar" | "rejeitar") {
    if (payingIds.has(pedidoId)) return;
    if (acao === "rejeitar" && !window.confirm("Rejeitar este pagamento? O cliente será avisado para tentar de novo ou pagar na entrega.")) return;
    setErr(null);
    setPayingIds((s) => new Set(s).add(pedidoId));
    try {
      const updated = acao === "confirmar"
        ? await pedidosApi.confirmarPagamento(pizzariaId, pedidoId)
        : await pedidosApi.rejeitarPagamento(pizzariaId, pedidoId);
      setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? updated : p)));
      setComprovanteIds((s) => { const n = new Set(s); n.delete(pedidoId); return n; });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPayingIds((s) => { const n = new Set(s); n.delete(pedidoId); return n; });
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 space-y-4">
      {/* Onboarding (só enquanto houver pendências) */}
      {onboarding && onboarding.length > 0 && (
        <OnboardingChecklist
          items={onboarding.map((it) => ({
            ...it,
            action: it.action,
          }))}
        />
      )}

      {err && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}

      {/* Barra de métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={ClipboardList} tone="orange" label="Total de Pedidos" value={String(stats.total)} />
        <StatCard icon={Hourglass} tone="amber" label="Pendentes" value={String(stats.pendentes)} />
        <StatCard icon={ChefHat} tone="violet" label="Em preparo" value={String(stats.preparando)} />
        <StatCard icon={DollarSign} tone="emerald" label="Faturamento" value={brl(stats.faturamento)} />
      </div>

      {/* Cabeçalho + filtros */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 md:px-5 py-3.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white flex items-center gap-2.5">
          <ClipboardList className="w-5 h-5" />
          <h2 className="font-bold text-base md:text-lg">Gerenciamento de Pedidos</h2>
        </div>

        <div className="p-3 md:p-4 flex flex-col sm:flex-row gap-2.5 border-b border-slate-100">
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-orange-400 bg-white"
          >
            <option value="">Todos os status</option>
            {STATUS_LIST.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input
            type="date"
            value={dataDe}
            onChange={(e) => setDataDe(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-orange-400"
          />
          <input
            type="date"
            value={dataAte}
            onChange={(e) => setDataAte(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-orange-400"
          />
          <button
            type="button"
            onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 text-white rounded-lg text-sm font-semibold transition-opacity shadow-sm shadow-orange-500/20 shrink-0 cursor-pointer"
          >
            <Filter className="w-4 h-4" /> Filtrar
          </button>
        </div>

        {/* Grid de cards */}
        <div className="p-3 md:p-4">
          {filtrados.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-14">
              <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
              Nenhum pedido encontrado para os filtros selecionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtrados.map((p) => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  statusLabel={statusLabel}
                  moving={movingIds.has(p.id)}
                  deleting={deletingIds.has(p.id)}
                  paying={payingIds.has(p.id)}
                  comprovante={comprovanteIds.has(p.id)}
                  onStatus={(s) => moveStatus(p.id, s)}
                  onDelete={() => removerPedido(p)}
                  onConferir={(acao) => conferirPagamento(p.id, acao)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Card de métrica
// ============================================
const TONE: Record<string, { bg: string; text: string }> = {
  orange:  { bg: "bg-orange-50",  text: "text-orange-600" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-600" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600" },
};

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: string; label: string; value: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, tone, label, value }) => {
  const t = TONE[tone] || TONE.orange;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl ${t.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-5 h-5 ${t.text}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide truncate">{label}</p>
        <p className="text-lg font-bold text-slate-800 leading-tight truncate">{value}</p>
      </div>
    </div>
  );
}

// ============================================
// Card de pedido
// ============================================
interface PedidoCardProps {
  pedido: BackendPedido;
  statusLabel: (k: string) => string;
  moving: boolean;
  deleting: boolean;
  paying: boolean;
  comprovante: boolean;
  onStatus: (s: string) => void;
  onDelete: () => void;
  onConferir: (acao: "confirmar" | "rejeitar") => void;
}

const PedidoCard: React.FC<PedidoCardProps> = ({ pedido: p, statusLabel, moving, deleting, paying, comprovante, onStatus, onDelete, onConferir }) => {
  const isDelivery = (p.tipo || "").toLowerCase().includes("deliv") || (p.tipo || "").toLowerCase().includes("entrega");
  const meta = STATUS_META[p.status] || STATUS_META.novo;
  const tel = p.cliente?.telefone;
  // Pix manual aguardando conferência da equipe.
  const aguardandoConferencia = p.payment_status === "em_analise";

  return (
    <article className={`relative bg-white border rounded-2xl shadow-sm overflow-hidden flex flex-col ${aguardandoConferencia ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-200"}`}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between gap-2 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-slate-400" />
          Pedido #{p.numero_pedido ?? "—"}
        </span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {statusLabel(p.status)}
        </span>
      </div>

      {/* Faixa de conferência do Pix manual */}
      {aguardandoConferencia && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
          <Receipt className="w-3.5 h-3.5" />
          {comprovante ? "Comprovante recebido — confira o pagamento" : "Pix manual — aguardando comprovante"}
        </div>
      )}

      <div className="px-4 py-3 space-y-2.5 flex-1">
        {/* Cliente / contato */}
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 text-slate-700">
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="font-semibold truncate">{p.cliente?.nome || "Cliente novo"}</span>
          </p>
          <p className="flex items-center gap-1.5 text-slate-500 text-xs">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {tel ? (
              <a href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">{tel}</a>
            ) : "—"}
          </p>
          <p className="flex items-start gap-1.5 text-slate-500 text-xs">
            {isDelivery ? <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" /> : <StoreIcon className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />}
            <span className="break-words">
              {isDelivery ? (p.endereco_entrega || "Endereço não informado") : "Retirada no balcão"}
            </span>
          </p>
        </div>

        {/* Itens */}
        <div className="pt-2 border-t border-slate-100">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Itens</p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {(p.itens || []).length === 0 && (
              <li className="text-slate-400 italic">Rascunho (sem itens)</li>
            )}
            {(p.itens || []).map((it, idx) => {
              const q = Number(it.quantidade ?? (it as any).qtd ?? 1);
              const pu = Number((it as any).preco_unit ?? (it as any).preco ?? 0);
              return (
                <li key={idx} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-orange-500 font-semibold">{q}×</span> {it.nome}
                  </span>
                  {pu > 0 && <span className="text-slate-500 shrink-0">{brl(pu * q)}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Total / pagamento */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] text-slate-400">Total</p>
            <p className="text-base font-bold text-emerald-600">{brl(p.valor_total)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-400">Pagamento</p>
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1 justify-end capitalize">
              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
              {p.forma_pagamento || "—"}
            </p>
          </div>
        </div>

        {/* Observações */}
        {p.observacoes && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            <span className="font-semibold">Obs:</span> {p.observacoes}
          </p>
        )}
      </div>

      {/* Footer: status + WhatsApp + excluir */}
      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
        {/* Conferência do Pix manual: confirmar / rejeitar o pagamento */}
        {aguardandoConferencia && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onConferir("confirmar")}
              disabled={paying}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {paying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Confirmar pagamento
            </button>
            <button
              type="button"
              onClick={() => onConferir("rejeitar")}
              disabled={paying}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Rejeitar
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={p.status}
            disabled={moving}
            onChange={(e) => onStatus(e.target.value)}
            className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white outline-none focus:border-orange-400 disabled:opacity-50 cursor-pointer"
          >
            {STATUS_LIST.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          {moving && <Loader2 className="w-4 h-4 animate-spin text-orange-500 shrink-0" />}
        </div>

        <div className="flex items-center gap-2">
          {tel && (
            <a
              href={`https://wa.me/${tel}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Excluir
          </button>
        </div>

        <p className="text-[10px] text-slate-400 flex items-center gap-1 pt-0.5">
          <Clock className="w-3 h-3" />
          {new Date(p.created_at).toLocaleString("pt-BR")}
        </p>
      </div>
    </article>
  );
}
