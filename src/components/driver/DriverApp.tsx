/**
 * DriverApp — painel do entregador (mobile-first).
 *
 * Conta de entregador (user.entregador) cai aqui em vez do AppShell do dono.
 * Mostra "Minhas entregas" (atribuídas a ele) e, se a pizzaria permitir,
 * "Disponíveis" (pedidos livres para pegar). Cada card traz endereço (com link
 * pro mapa), itens, observações e pagamento, e botões de avanço de status.
 */
import { useEffect, useState } from "react";
import {
  MapPin, Phone, LogOut, Bike, PackageCheck, Hand, Loader2, RefreshCw, Power,
} from "lucide-react";
import { entregadorApi, connectWebSocket, BackendPedido, UserMe } from "../../lib/api";
import { Button, OrderStatusBadge } from "../ui";
import { cn } from "../../lib/cn";
import { brl, itemCount } from "../v2/pedidos/pedidoUtils";

const REFRESH_EVENTS = ["pedido.atualizado", "pedido.novo", "entregador.atribuicao", "pedidos.limpos"];

const mapsUrl = (endereco: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;

export function DriverApp({ user, onLogout }: { user: UserMe; onLogout: () => void }) {
  const ent = user.entregador!;
  const pid = ent.pizzaria_id;

  const [tab, setTab] = useState<"minhas" | "disponiveis">("minhas");
  const [minhas, setMinhas] = useState<BackendPedido[]>([]);
  const [disponiveis, setDisponiveis] = useState<BackendPedido[]>([]);
  const [disponivel, setDisponivel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    return Promise.all([
      entregadorApi.minhasEntregas(pid).then(setMinhas).catch(() => {}),
      entregadorApi.disponiveis(pid).then(setDisponiveis).catch(() => {}),
    ]);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pid]);

  useEffect(() => {
    const ws = connectWebSocket(pid, (ev) => {
      if (REFRESH_EVENTS.includes(ev.tipo)) load();
    });
    return () => ws.close();
  }, [pid]);

  async function toggleDisponivel() {
    const novo = !disponivel;
    setDisponivel(novo);
    try {
      await entregadorApi.setDisponibilidade(pid, novo);
    } catch {
      setDisponivel(!novo);
    }
  }

  async function avancar(p: BackendPedido) {
    const novo = p.status === "a_caminho" ? "entregue" : "a_caminho";
    setBusyId(p.id);
    setErr(null);
    try {
      await entregadorApi.updateStatus(pid, p.id, novo);
      await load();
    } catch (e: any) {
      setErr(e.message || "Erro ao atualizar status");
    } finally {
      setBusyId(null);
    }
  }

  async function pegar(p: BackendPedido) {
    setBusyId(p.id);
    setErr(null);
    try {
      await entregadorApi.pegar(pid, p.id);
      setTab("minhas");
      await load();
    } catch (e: any) {
      setErr(e.message || "Não foi possível pegar o pedido");
    } finally {
      setBusyId(null);
    }
  }

  const lista = tab === "minhas" ? minhas : disponiveis;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-md mx-auto pb-10">
        {/* Header */}
        <header className="bg-brand-gradient text-white px-4 pt-5 pb-4 sticky top-0 z-10 shadow-brand">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-white/20 grid place-items-center shrink-0">
                <Bike className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-white/80 uppercase tracking-wide leading-none">Entregador</p>
                <h1 className="font-bold text-base truncate leading-tight">{ent.nome}</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-lg hover:bg-white/15 transition-colors shrink-0"
              title="Sair"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>

          {/* Disponibilidade */}
          <button
            type="button"
            onClick={toggleDisponivel}
            className={cn(
              "mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold transition-colors",
              disponivel ? "bg-white text-emerald-600" : "bg-white/15 text-white hover:bg-white/25",
            )}
          >
            <Power className="w-4 h-4" />
            {disponivel ? "Disponível para entregas" : "Indisponível — toque para ficar disponível"}
          </button>
        </header>

        {/* Tabs */}
        <div className="flex gap-2 p-3">
          <TabBtn active={tab === "minhas"} onClick={() => setTab("minhas")} label="Minhas entregas" count={minhas.length} />
          <TabBtn active={tab === "disponiveis"} onClick={() => setTab("disponiveis")} label="Disponíveis" count={disponiveis.length} />
          <button
            type="button"
            onClick={() => load()}
            className="px-3 rounded-xl border border-line bg-surface text-ink-muted hover:bg-surface-muted transition-colors"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {err && (
          <div className="mx-3 mb-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 rounded-lg">
            {err}
          </div>
        )}

        {/* Lista */}
        <div className="px-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
            </div>
          ) : lista.length === 0 ? (
            <div className="text-center text-ink-subtle py-16">
              <Bike className="w-8 h-8 mx-auto mb-2 opacity-40" />
              {tab === "minhas" ? "Nenhuma entrega atribuída a você agora." : "Nenhum pedido disponível no momento."}
            </div>
          ) : (
            lista.map((p) => (
              <div key={p.id}>
                <DriverCard
                  pedido={p}
                  mode={tab}
                  busy={busyId === p.id}
                  onAvancar={() => avancar(p)}
                  onPegar={() => pegar(p)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors",
        active ? "bg-brand-500 text-white shadow-sm" : "bg-surface border border-line text-ink-muted hover:bg-surface-muted",
      )}
    >
      {label}
      <span className={cn("text-[11px] font-bold rounded-full px-1.5", active ? "bg-white/25" : "bg-surface-muted text-ink-muted")}>
        {count}
      </span>
    </button>
  );
}

function DriverCard({
  pedido: p, mode, busy, onAvancar, onPegar,
}: {
  pedido: BackendPedido;
  mode: "minhas" | "disponiveis";
  busy: boolean;
  onAvancar: () => void;
  onPegar: () => void;
}) {
  const tel = p.cliente?.telefone;
  const endereco = p.endereco_entrega || "Endereço não informado";
  const aCaminho = p.status === "a_caminho";

  return (
    <article className="bg-surface border border-line rounded-2xl shadow-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-line">
        <span className="text-sm font-extrabold text-ink">Pedido #{p.numero_pedido ?? "—"}</span>
        <OrderStatusBadge status={p.status} />
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Cliente */}
        <div>
          <p className="text-sm font-bold text-ink">{p.cliente?.nome || "Cliente"}</p>
          {tel && (
            <a href={`tel:${tel}`} className="inline-flex items-center gap-1.5 text-xs text-brand-600 mt-0.5">
              <Phone className="w-3.5 h-3.5" /> {tel}
            </a>
          )}
        </div>

        {/* Endereço + mapa */}
        <div className="bg-brand-50 border border-brand-100 rounded-xl px-3 py-2.5">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
            <p className="text-sm text-ink leading-snug break-words flex-1">{endereco}</p>
          </div>
          <a
            href={mapsUrl(endereco)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 bg-white border border-brand-200 rounded-lg px-3 py-1.5"
          >
            <MapPin className="w-3.5 h-3.5" /> Abrir no mapa
          </a>
        </div>

        {/* Itens */}
        <div>
          <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1">Itens · {itemCount(p.itens)}</p>
          <ul className="space-y-1 text-sm">
            {(p.itens || []).map((it, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="text-brand-600 font-bold shrink-0">{Number(it.quantidade ?? 1)}×</span>
                <span className="text-ink leading-snug break-words">{it.nome}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Observações */}
        {p.observacoes && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold">Obs:</span> {p.observacoes}
          </p>
        )}

        {/* Total + pagamento */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-line">
          <div className="pt-2">
            <p className="text-[11px] text-ink-subtle">Total</p>
            <p className="text-lg font-extrabold text-emerald-600 leading-none">{brl(p.valor_total)}</p>
          </div>
          <span className="pt-2 text-xs font-semibold text-ink capitalize">{p.forma_pagamento || "—"}</span>
        </div>
      </div>

      {/* Ação */}
      <div className="px-4 pb-4">
        {mode === "disponiveis" ? (
          <Button variant="primary" size="lg" fullWidth icon={Hand} isLoading={busy} onClick={onPegar}>
            Pegar esta entrega
          </Button>
        ) : aCaminho ? (
          <Button variant="success" size="lg" fullWidth icon={PackageCheck} isLoading={busy} onClick={onAvancar}>
            Marcar como entregue
          </Button>
        ) : (
          <Button variant="primary" size="lg" fullWidth icon={Bike} isLoading={busy} onClick={onAvancar}>
            Saí para entrega
          </Button>
        )}
      </div>
    </article>
  );
}
