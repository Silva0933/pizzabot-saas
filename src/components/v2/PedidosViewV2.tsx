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
  History, TriangleAlert, Wrench, CircleCheck,
} from "lucide-react";
import { pedidosApi, pizzariasApi, entregadoresApi, BackendPedido, BackendEntregador, PedidoEvento, UsoPizzaria } from "../../lib/api";
import { OnboardingChecklist, OnboardingItem } from "./OnboardingChecklist";
import { Button, Modal, StatCard } from "../ui";
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
  const [payingIds, setPayingIds] = useState<Set<string>>(new Set());
  // Pedidos cujo comprovante já chegou nesta sessão (destaque mais forte no card).
  const [comprovanteIds, setComprovanteIds] = useState<Set<string>>(new Set());
  // Cota de atendimentos do plano (contador discreto + aviso).
  const [uso, setUso] = useState<UsoPizzaria | null>(null);
  // Entregadores ativos (para o seletor de atribuição nos cards de delivery).
  const [entregadores, setEntregadores] = useState<BackendEntregador[]>([]);
  const [assigningIds, setAssigningIds] = useState<Set<string>>(new Set());
  const [modoProblemas, setModoProblemas] = useState(false);
  const [pedidosProblema, setPedidosProblema] = useState<BackendPedido[]>([]);
  const [historico, setHistorico] = useState<{ pedido: BackendPedido; eventos: PedidoEvento[] } | null>(null);
  const [acao, setAcao] = useState<{ tipo: "corrigir" | "problema" | "resolver"; pedido: BackendPedido } | null>(null);
  const [statusCorrecao, setStatusCorrecao] = useState("confirmado");
  const [justificativa, setJustificativa] = useState("");
  const [salvandoAcao, setSalvandoAcao] = useState(false);

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

  function loadProblemas() {
    return pedidosApi.problemas(pizzariaId).then(setPedidosProblema).catch((e) => setErr(e.message));
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
      if (modoProblemas) loadProblemas();
      loadUso();  // novos pedidos podem refletir um novo atendimento contabilizado
    }
  }, [liveEvent, modoProblemas]);

  // Lista filtrada por status apenas — data já é filtrada no backend (hoje).
  const filtrados = useMemo(() => {
    const origem = modoProblemas ? pedidosProblema : pedidos;
    return origem.filter((p) => {
      if (statusFiltro && p.status !== statusFiltro) return false;
      return true;
    });
  }, [pedidos, pedidosProblema, modoProblemas, statusFiltro]);

  // Métricas (sobre a lista filtrada).
  const stats = useMemo(() => {
    const total = filtrados.length;
    const pendentes = filtrados.filter((p) => p.status === "novo" || p.status === "confirmado").length;
    const preparando = filtrados.filter((p) => p.status === "no_forno" || p.status === "pronto_entrega" || p.status === "a_caminho").length;
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

  async function abrirHistorico(pedido: BackendPedido) {
    setErr(null);
    try {
      const eventos = await pedidosApi.historico(pizzariaId, pedido.id);
      setHistorico({ pedido, eventos });
    } catch (e: any) {
      setErr(e.message);
    }
  }

  function abrirAcao(tipo: "corrigir" | "problema" | "resolver", pedido: BackendPedido) {
    setAcao({ tipo, pedido });
    setStatusCorrecao(pedido.status);
    setJustificativa("");
  }

  function atualizarPedidoLocal(updated: BackendPedido) {
    setPedidos((ps) => ps.map((p) => p.id === updated.id ? updated : p));
    setPedidosProblema((ps) => {
      const semAtual = ps.filter((p) => p.id !== updated.id);
      return updated.em_problema ? [updated, ...semAtual] : semAtual;
    });
  }

  async function confirmarAcao() {
    if (!acao) return;
    const motivo = justificativa.trim();
    if (acao.tipo !== "resolver" && motivo.length < 5) {
      setErr("Explique o motivo com pelo menos 5 caracteres para registrar esta acao.");
      return;
    }
    setSalvandoAcao(true);
    setErr(null);
    try {
      let updated: BackendPedido;
      if (acao.tipo === "corrigir") {
        updated = await pedidosApi.corrigir(pizzariaId, acao.pedido.id, statusCorrecao, motivo);
      } else if (acao.tipo === "problema") {
        updated = await pedidosApi.sinalizarProblema(pizzariaId, acao.pedido.id, motivo);
      } else {
        updated = await pedidosApi.resolverProblema(pizzariaId, acao.pedido.id, motivo || undefined);
      }
      atualizarPedidoLocal(updated);
      setAcao(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSalvandoAcao(false);
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
      paying={payingIds.has(p.id)}
      comprovante={comprovanteIds.has(p.id)}
      onStatus={(s) => moveStatus(p.id, s)}
      onHistory={() => abrirHistorico(p)}
      onCorrect={() => abrirAcao("corrigir", p)}
      onProblem={() => abrirAcao("problema", p)}
      onResolveProblem={() => abrirAcao("resolver", p)}
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
      <div className="bg-[#111622] border border-[#1e293b] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e293b] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/25 text-orange-400 grid place-items-center shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Gerenciamento de Pedidos</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {modoProblemas ? "Pedidos que precisam de revisão manual." : "Avance os pedidos etapa por etapa; correcoes ficam registradas."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {uso && uso.atendimentos_limite > 0 && (
              <span
                title={`Atendimentos da IA neste mês (cota do plano ${uso.plano}). Faltam ${uso.atendimentos_restante}.`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#161f30] border border-[#1e293b] text-slate-300 rounded-xl px-3 py-1.5"
              >
                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                {uso.atendimentos}/{uso.atendimentos_limite} atendimentos
              </span>
            )}
            <button
              onClick={() => { const proximo = !modoProblemas; setModoProblemas(proximo); if (proximo) loadProblemas(); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                modoProblemas
                  ? "bg-rose-600 border-rose-500 text-white"
                  : "bg-[#161f30] border-[#1e293b] text-slate-300 hover:bg-[#1c273c]"
              }`}
            >
              <TriangleAlert className="w-3.5 h-3.5 text-slate-400" />
              {modoProblemas ? "Voltar aos pedidos" : "Pedidos com problema"}
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-[#1e293b] flex flex-row gap-3 items-center">
          <div className="flex items-center gap-2 text-xs font-semibold bg-[#064e3b]/50 border border-emerald-500/30 text-emerald-400 rounded-xl px-3.5 py-2 shrink-0">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Pedidos de hoje</span>
          </div>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="flex-1 max-w-xs px-3.5 py-2 border border-[#1e293b] rounded-xl text-xs font-medium text-slate-200 outline-none focus:border-orange-500 bg-[#161f30]"
          >
            <option value="">Todos os status</option>
            {ORDER_STATUS_LIST.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>

        {/* Quadro de pedidos */}
        <div className="p-4">
          {filtrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#1e293b] bg-[#0b0e14]/40 py-24 px-4 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 text-slate-600 mb-3 grid place-items-center">
                <svg className="w-12 h-12 stroke-[1.2]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m7.5 4.27 9 5.15" />
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
              </div>
              <p className="text-sm font-bold text-white">
                {statusFiltro
                  ? "Nenhum pedido com este status hoje."
                  : modoProblemas
                    ? "Nenhum pedido com problema aberto."
                    : "Nenhum pedido hoje ainda."}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Eles aparecerão aqui conforme chegarem!
              </p>
            </div>
          ) : (
            <OrderBoard pedidos={filtrados} statusLabel={statusLabel} renderCard={renderCard} />
          )}
        </div>
      </div>

      <Modal
        open={!!historico}
        onClose={() => setHistorico(null)}
        title={historico ? `Histórico do pedido #${historico.pedido.numero_pedido ?? "-"}` : ""}
        subtitle="Todas as mudanças ficam registradas"
        icon={History}
        footer={
          <Button variant="outline" size="sm" onClick={() => setHistorico(null)}>
            Fechar
          </Button>
        }
      >
        {!historico || historico.eventos.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Este pedido ainda não possui eventos registrados.</p>
        ) : (
          <ol className="space-y-3">
            {historico.eventos.map((evento) => (
              <li key={evento.id} className="bg-[#161f30] border border-[#1e293b] rounded-xl p-3.5 shadow-sm">
                <div className="flex justify-between gap-2 text-sm font-bold text-white">
                  <span className="capitalize">{evento.tipo.replaceAll("_", " ")}</span>
                  <time className="text-[11px] font-medium text-slate-400 shrink-0">{new Date(evento.created_at).toLocaleString("pt-BR")}</time>
                </div>
                {(evento.status_anterior || evento.status_novo) && (
                  <p className="text-xs text-slate-300 mt-1">{statusLabel(evento.status_anterior || "novo")} {" → "} {statusLabel(evento.status_novo || "novo")}</p>
                )}
                {evento.motivo && <p className="text-xs text-slate-200 mt-1.5"><span className="font-semibold text-orange-400">Motivo:</span> {evento.motivo}</p>}
                <p className="text-[11px] text-slate-500 mt-1">Por {evento.ator_nome || "Sistema"} · {evento.ator_tipo}</p>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      <Modal
        open={!!acao}
        onClose={() => !salvandoAcao && setAcao(null)}
        title={acao?.tipo === "corrigir" ? "Corrigir pedido" : acao?.tipo === "resolver" ? "Resolver problema" : "Sinalizar problema"}
        subtitle={acao ? `Pedido #${acao.pedido.numero_pedido ?? "-"}` : ""}
        icon={acao?.tipo === "corrigir" ? Wrench : acao?.tipo === "resolver" ? CircleCheck : TriangleAlert}
        footer={<>
          <Button variant="outline" size="sm" disabled={salvandoAcao} onClick={() => setAcao(null)}>Cancelar</Button>
          <Button variant={acao?.tipo === "problema" ? "danger" : "primary"} size="sm" isLoading={salvandoAcao} onClick={confirmarAcao}>
            {acao?.tipo === "corrigir" ? "Registrar correção" : acao?.tipo === "resolver" ? "Resolver pedido" : "Enviar para problemas"}
          </Button>
        </>}
      >
        <div className="space-y-4">
          {acao?.tipo === "corrigir" && (
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              Novo status
              <select value={statusCorrecao} onChange={(e) => setStatusCorrecao(e.target.value)} className="mt-1.5 w-full h-10 px-3 border border-[#1e293b] rounded-xl bg-[#161f30] text-xs text-white font-medium outline-none focus:border-orange-500/50">
                {ORDER_STATUS_LIST.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
          )}
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            {acao?.tipo === "resolver" ? "Como o problema foi resolvido? (opcional)" : "Justificativa obrigatória"}
            <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={4} maxLength={800}
              placeholder={acao?.tipo === "corrigir" ? "Ex.: pedido foi marcado como entregue por engano" : "Descreva o que aconteceu"}
              className="mt-1.5 w-full p-3 border border-[#1e293b] rounded-xl bg-[#161f30] text-xs text-white placeholder:text-slate-500 font-normal resize-y outline-none focus:border-orange-500/50" />
          </label>
        </div>
      </Modal>
    </div>
  );
}
