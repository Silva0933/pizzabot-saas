/**
 * Pedidos v2 — "Gerenciamento de Pedidos".
 *
 * Container: métricas + filtros + quadro Kanban de cards (OrderBoard/OrderCard).
 * Foco no que o dono precisa para despachar: itens sem truncar, endereço
 * destacado, pagamento claro e urgência por tempo. Conectado ao backend Python.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Loader2, AlertCircle, Package, ClipboardList, Hourglass,
  ChefHat, DollarSign, CalendarDays, Gauge,
} from "lucide-react";
import { pedidosApi, pizzariasApi, entregadoresApi, BackendPedido, BackendEntregador, UsoPizzaria } from "../../lib/api";
import { OnboardingChecklist, OnboardingItem } from "./OnboardingChecklist";
import { StatCard } from "../ui";
import { ORDER_STATUS_LIST, orderStatusLabel } from "../../lib/orderStatus";
import { OrderCard } from "./pedidos/OrderCard";
import { OrderBoard } from "./pedidos/OrderBoard";
import { QuotaBanner } from "./pedidos/QuotaBanner";
import { brl } from "./pedidos/pedidoUtils";

interface Props {
  pizzariaId: string;
  columnNames?: Record<string, string>;
  liveEvent?: { tipo: string; payload: any } | null;
  onboarding?: OnboardingItem[];
  onboardingKey?: string;
  onNavigate?: (key: string) => void;
}

export function PedidosViewV2({ pizzariaId, columnNames, liveEvent, onboarding, onboardingKey }: Props) {
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [payingIds, setPayingIds] = useState<Set<string>>(new Set());
  // Pedidos cujo comprovante já chegou nesta sessão (destaque mais forte no card).
  const [comprovanteIds, setComprovanteIds] = useState<Set<string>>(new Set());
  // Cota de atendimentos do plano (contador discreto + aviso).
  const [uso, setUso] = useState<UsoPizzaria | null>(null);
  // Entregadores ativos (para o seletor de atribuição nos cards de delivery).
  const [entregadores, setEntregadores] = useState<BackendEntregador[]>([]);
  const [assigningIds, setAssigningIds] = useState<Set<string>>(new Set());

  function loadUso() {
    return pizzariasApi.uso(pizzariaId).then(setUso).catch(() => {});
  }

  function loadEntregadores() {
    return entregadoresApi.list(pizzariaId)
      .then((r) => setEntregadores(r.entregadores.filter((e) => e.ativo)))
      .catch(() => {});
  }

  async function atribuir(pedidoId: string, entregadorId: string | null) {
    if (assigningIds.has(pedidoId)) return;
    setErr(null);
    setAssigningIds((s) => new Set(s).add(pedidoId));
    try {
      const updated = entregadorId
        ? await pedidosApi.atribuir(pizzariaId, pedidoId, entregadorId)
        : await pedidosApi.desatribuir(pizzariaId, pedidoId);
      setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? updated : p)));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAssigningIds((s) => { const n = new Set(s); n.delete(pedidoId); return n; });
    }
  }

  // Filtros
  const [statusFiltro, setStatusFiltro] = useState<string>("");

  const statusLabel = (key: string) => columnNames?.[key] || orderStatusLabel(key);

  function load() {
    return pedidosApi
      .list(pizzariaId, { hoje: true, limit: 500 })
      .then(setPedidos)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    loadUso();
    loadEntregadores();
  }, [pizzariaId]);

  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.tipo === "pedidos.limpos") { setPedidos([]); return; }
    if (liveEvent.tipo === "limite.ia") { loadUso(); return; }
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
      loadUso();  // novos pedidos podem refletir um novo atendimento contabilizado
    }
  }, [liveEvent]);

  // Lista filtrada por status apenas — data já é filtrada no backend (hoje).
  const filtrados = useMemo(() => {
    return pedidos.filter((p) => {
      if (statusFiltro && p.status !== statusFiltro) return false;
      return true;
    });
  }, [pedidos, statusFiltro]);

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
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    );
  }

  const renderCard = (p: BackendPedido) => (
    <OrderCard
      pedido={p}
      statusLabel={statusLabel}
      moving={movingIds.has(p.id)}
      deleting={deletingIds.has(p.id)}
      paying={payingIds.has(p.id)}
      comprovante={comprovanteIds.has(p.id)}
      onStatus={(s) => moveStatus(p.id, s)}
      onDelete={() => removerPedido(p)}
      onConferir={(acao) => conferirPagamento(p.id, acao)}
      entregadores={entregadores.map((e) => ({ id: e.id, nome: e.nome, disponivel: e.disponivel }))}
      onAtribuir={(eid) => atribuir(p.id, eid)}
      assigning={assigningIds.has(p.id)}
    />
  );

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 space-y-4">
      {onboarding && onboarding.length > 0 && (
        <OnboardingChecklist items={onboarding} storageKey={onboardingKey} />
      )}

      {err && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}

      <QuotaBanner uso={uso} />

      {/* Barra de métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={ClipboardList} accent="orange"  label="Total de Pedidos" value={String(stats.total)} />
        <StatCard icon={Hourglass}     accent="amber"   label="Pendentes"        value={String(stats.pendentes)} />
        <StatCard icon={ChefHat}       accent="violet"  label="Em preparo"       value={String(stats.preparando)} />
        <StatCard icon={DollarSign}    accent="emerald" label="Faturamento"      value={brl(stats.faturamento)} />
      </div>

      {/* Cabeçalho + filtros */}
      <div className="bg-surface border border-line rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 md:px-5 py-3.5 bg-brand-gradient text-white flex items-center gap-2.5">
          <ClipboardList className="w-5 h-5" />
          <h2 className="font-bold text-base md:text-lg">Gerenciamento de Pedidos</h2>
          {uso && uso.atendimentos_limite > 0 && (
            <span
              title={`Atendimentos da IA neste mês (cota do plano ${uso.plano}). Faltam ${uso.atendimentos_restante}.`}
              className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/15 rounded-full px-2.5 py-1"
            >
              <Gauge className="w-3.5 h-3.5" />
              {uso.atendimentos}/{uso.atendimentos_limite} atendimentos
            </span>
          )}
        </div>

        <div className="p-3 md:p-4 flex flex-row gap-2.5 border-b border-line items-center">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 shrink-0">
            <CalendarDays className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-emerald-700">Pedidos de hoje</span>
          </div>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="flex-1 px-3 py-2 border border-line rounded-lg text-sm text-ink outline-none focus:border-brand-400 bg-surface"
          >
            <option value="">Todos os status</option>
            {ORDER_STATUS_LIST.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>

        {/* Quadro de pedidos */}
        <div className="p-3 md:p-4">
          {filtrados.length === 0 ? (
            <div className="text-sm text-ink-subtle text-center py-14">
              <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
              {statusFiltro
                ? "Nenhum pedido com este status hoje."
                : "Nenhum pedido hoje ainda. Eles aparecerão aqui conforme chegarem!"}
            </div>
          ) : (
            <OrderBoard pedidos={filtrados} statusLabel={statusLabel} renderCard={renderCard} />
          )}
        </div>
      </div>
    </div>
  );
}
