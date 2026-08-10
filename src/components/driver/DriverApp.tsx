
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Bike, CheckCircle2, Clock3, Hand, Loader2, LogOut, MapPin,
  Navigation, PackageCheck, Phone, Power, RefreshCw, Route, Signal, WalletCards,
} from "lucide-react";
import { BackendPedido, connectWebSocket, entregadorApi, UserMe } from "../../lib/api";
import { OrderStatusBadge } from "../ui";
import { cn } from "../../lib/cn";
import { brl, itemCount } from "../v2/pedidos/pedidoUtils";

const REFRESH_EVENTS = ["pedido.atualizado", "pedido.novo", "entregador.atribuicao", "pedidos.limpos"];
const PRIORITY: Record<string, number> = { a_caminho: 0, pronto_entrega: 1, em_preparo: 2, pendente: 3 };

const mapsUrl = (endereco: string, lat?: number | null, lon?: number | null) =>
  lat != null && lon != null
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;

export function DriverApp({ user, onLogout }: { user: UserMe; onLogout: () => void }) {
  const ent = user.entregador!;
  const pid = ent.pizzaria_id;
  const [tab, setTab] = useState<"minhas" | "disponiveis">("minhas");
  const [minhas, setMinhas] = useState<BackendPedido[]>([]);
  const [disponiveis, setDisponiveis] = useState<BackendPedido[]>([]);
  const [disponivel, setDisponivel] = useState(!!ent.disponivel);
  const [resumo, setResumo] = useState<{ entregas_total: number; entregas_hoje: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAvailability, setBusyAvailability] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wsOnline, setWsOnline] = useState(false);

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    await Promise.all([
      entregadorApi.minhasEntregas(pid).then(setMinhas).catch(() => {}),
      entregadorApi.disponiveis(pid).then(setDisponiveis).catch(() => {}),
      entregadorApi.resumo(pid).then(setResumo).catch(() => {}),
    ]);
    if (silent) setRefreshing(false);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pid]);

  useEffect(() => {
    const ws = connectWebSocket(pid, (ev) => {
      if (REFRESH_EVENTS.includes(ev.tipo)) load(true);
    });
    ws.addEventListener("open", () => setWsOnline(true));
    ws.addEventListener("close", () => setWsOnline(false));
    ws.addEventListener("error", () => setWsOnline(false));
    return () => { ws.close(); setWsOnline(false); };
  }, [pid]);

  useEffect(() => {
    const interval = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [pid]);

  async function toggleDisponivel() {
    const novo = !disponivel;
    setDisponivel(novo);
    setBusyAvailability(true);
    setErr(null);
    try {
      await entregadorApi.setDisponibilidade(pid, novo);
    } catch {
      setDisponivel(!novo);
      setErr("Não foi possível alterar sua disponibilidade.");
    } finally {
      setBusyAvailability(false);
    }
  }

  async function avancar(p: BackendPedido) {
    const novo = p.status === "a_caminho" ? "entregue" : "a_caminho";
    setBusyId(p.id);
    setErr(null);
    if (novo === "entregue") setMinhas((m) => m.filter((x) => x.id !== p.id));
    else setMinhas((m) => m.map((x) => x.id === p.id ? { ...x, status: novo } : x));
    try {
      await entregadorApi.updateStatus(pid, p.id, novo);
      await load(true);
    } catch (e: any) {
      setErr(e.message || "Erro ao atualizar o pedido.");
      await load(true);
    } finally {
      setBusyId(null);
    }
  }

  async function pegar(p: BackendPedido) {
    if (!disponivel) return;
    setBusyId(p.id);
    setErr(null);
    setDisponiveis((d) => d.filter((x) => x.id !== p.id));
    setMinhas((m) => [{ ...p, entregador_id: ent.id }, ...m]);
    setTab("minhas");
    try {
      await entregadorApi.pegar(pid, p.id);
      await load(true);
    } catch (e: any) {
      setErr(e.message || "Não foi possível assumir este pedido.");
      await load(true);
    } finally {
      setBusyId(null);
    }
  }

  const minhasOrdenadas = useMemo(
    () => [...minhas].sort((a, b) => (PRIORITY[a.status] ?? 10) - (PRIORITY[b.status] ?? 10)),
    [minhas],
  );
  const lista = tab === "minhas" ? minhasOrdenadas : disponiveis;
  const emRota = minhas.filter((p) => p.status === "a_caminho").length;
  const prontas = minhas.filter((p) => p.status === "pronto_entrega").length;

  return (
    <div className="min-h-screen bg-[#080b10] text-white">
      <div className="mx-auto min-h-screen max-w-2xl pb-12">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0f16]/95 px-4 pb-4 pt-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid w-11 h-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-950/50"><Bike className="w-5 h-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300">Central do entregador</p>
                <h1 className="truncate text-lg font-black leading-tight">{ent.nome}</h1>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span title={wsOnline ? "Atualizações ao vivo" : "Atualização automática"} className={`mr-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${wsOnline ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-slate-500"}`}>
                <Signal className="w-3 h-3" />{wsOnline ? "Ao vivo" : "30 s"}
              </span>
              <button type="button" onClick={onLogout} className="rounded-xl p-2.5 text-slate-500 hover:bg-white/10 hover:text-white" title="Sair"><LogOut className="w-4.5 h-4.5" /></button>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleDisponivel}
            disabled={busyAvailability}
            className={cn(
              "mt-4 flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-all",
              disponivel
                ? "border-emerald-400/25 bg-emerald-400/[0.09] shadow-[0_0_30px_rgba(52,211,153,.06)]"
                : "border-white/10 bg-white/[0.035]",
            )}
          >
            <div className="flex items-center gap-3">
              <span className={cn("grid w-9 h-9 place-items-center rounded-xl", disponivel ? "bg-emerald-400 text-emerald-950" : "bg-white/5 text-slate-500")}>
                {busyAvailability ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              </span>
              <div><p className="text-sm font-black">{disponivel ? "Você está disponível" : "Você está indisponível"}</p><p className="mt-0.5 text-[11px] text-slate-500">{disponivel ? "Pronto para receber novas entregas" : "Toque para iniciar seu turno"}</p></div>
            </div>
            <span className={cn("relative w-12 h-7 shrink-0 rounded-full", disponivel ? "bg-emerald-500" : "bg-slate-700")}><span className={cn("absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all", disponivel ? "left-6" : "left-1")} /></span>
          </button>
        </header>

        <main className="space-y-4 px-4 pt-4 sm:px-6">
          <section className="grid grid-cols-3 gap-2.5">
            <Summary icon={PackageCheck} label="Hoje" value={resumo?.entregas_hoje ?? 0} tone="orange" />
            <Summary icon={Navigation} label="Em rota" value={emRota} tone="blue" />
            <Summary icon={CheckCircle2} label="Total" value={resumo?.entregas_total ?? 0} tone="green" />
          </section>

          {err && <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 w-4 h-4 shrink-0" />{err}</div>}

          {(emRota > 0 || prontas > 0) && (
            <section className="rounded-2xl border border-orange-400/20 bg-gradient-to-r from-orange-400/10 to-transparent px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="grid w-9 h-9 place-items-center rounded-xl bg-orange-400/15 text-orange-300"><Route className="w-4 h-4" /></span>
                <div className="min-w-0"><p className="text-sm font-bold">{emRota ? `${emRota} entrega${emRota > 1 ? "s" : ""} em andamento` : `${prontas} pedido${prontas > 1 ? "s" : ""} pronto${prontas > 1 ? "s" : ""}`}</p><p className="mt-0.5 text-[11px] text-slate-500">{emRota ? "Conclua a rota atual antes de seguir." : "Retire na pizzaria e inicie a rota."}</p></div>
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center gap-2">
              <div className="grid flex-1 grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.035] p-1">
                <Tab active={tab === "minhas"} onClick={() => setTab("minhas")} label="Minha rota" count={minhas.length} />
                <Tab active={tab === "disponiveis"} onClick={() => setTab("disponiveis")} label="Disponíveis" count={disponiveis.length} />
              </div>
              <button type="button" onClick={() => load(true)} disabled={refreshing} className="grid w-11 h-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.035] text-slate-400 hover:bg-white/10 hover:text-white" title="Atualizar">
                <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              </button>
            </div>
            {tab === "disponiveis" && !disponivel && <p className="mt-2 rounded-xl bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-300">Fique disponível para poder assumir uma entrega.</p>}
          </section>

          <section className="space-y-3">
            {loading ? <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-orange-400" /></div>
            : lista.length === 0 ? <Empty tab={tab} />
            : lista.map((p, index) => (
                <div key={p.id}>
                  <DriverCard
                  pedido={p}
                  mode={tab}
                  position={index + 1}
                  busy={busyId === p.id}
                  canClaim={disponivel}
                  onAvancar={() => avancar(p)}
                  onPegar={() => pegar(p)}
                />
                  </div>
              ))}
          </section>
        </main>
      </div>
    </div>
  );
}

function Summary({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "orange" | "blue" | "green" }) {
  const color = { orange: "text-orange-300 bg-orange-400/10", blue: "text-sky-300 bg-sky-400/10", green: "text-emerald-300 bg-emerald-400/10" }[tone];
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><span className={cn("grid w-7 h-7 place-items-center rounded-lg", color)}><Icon className="w-3.5 h-3.5" /></span><p className="mt-3 text-xl font-black">{value}</p><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</p></div>;
}

function Tab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return <button type="button" onClick={onClick} className={cn("flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition", active ? "bg-orange-500 text-white shadow-lg shadow-orange-950/30" : "text-slate-500 hover:text-slate-300")}><span>{label}</span><span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", active ? "bg-white/20" : "bg-white/5")}>{count}</span></button>;
}

function Empty({ tab }: { tab: "minhas" | "disponiveis" }) {
  return <div className="rounded-3xl border border-dashed border-white/10 px-6 py-16 text-center"><span className="mx-auto grid w-14 h-14 place-items-center rounded-2xl bg-white/[0.035] text-slate-700"><Bike className="w-6 h-6" /></span><p className="mt-4 text-sm font-bold text-slate-300">{tab === "minhas" ? "Sua rota está livre" : "Nenhuma entrega disponível"}</p><p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-600">{tab === "minhas" ? "Novas entregas atribuídas aparecerão aqui automaticamente." : "Assim que um pedido estiver pronto, ele aparecerá nesta lista."}</p></div>;
}

function DriverCard({ pedido: p, mode, position, busy, canClaim, onAvancar, onPegar }: {
  pedido: BackendPedido;
  mode: "minhas" | "disponiveis";
  position: number;
  busy: boolean;
  canClaim: boolean;
  onAvancar: () => void;
  onPegar: () => void;
}) {
  const tel = p.cliente?.telefone;
  const endereco = p.endereco_entrega || "Endereço não informado";
  const aCaminho = p.status === "a_caminho";
  const pronto = p.status === "pronto_entrega";
  const aguardando = mode === "minhas" && !aCaminho && !pronto;
  const pagamento = (p.forma_pagamento || "Não informado").replaceAll("_", " ");

  return (
    <article className={cn("overflow-hidden rounded-3xl border bg-white/[0.035]", aCaminho ? "border-sky-400/30 shadow-[0_0_35px_rgba(56,189,248,.06)]" : "border-white/10")}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3.5">
        <div className="flex items-center gap-2.5"><span className={cn("grid w-7 h-7 place-items-center rounded-lg text-xs font-black", aCaminho ? "bg-sky-400 text-sky-950" : "bg-orange-400/15 text-orange-300")}>{position}</span><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Pedido</p><p className="text-sm font-black">#{p.numero_pedido ?? "—"}</p></div></div>
        <OrderStatusBadge status={p.status} />
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-base font-black">{p.cliente?.nome || "Cliente"}</p><p className="mt-1 text-xs text-slate-500">{itemCount(p.itens)} item{itemCount(p.itens) === 1 ? "" : "s"} no pedido</p></div>
          {tel && <a href={`tel:${tel}`} className="grid w-10 h-10 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300" aria-label="Ligar para cliente"><Phone className="w-4 h-4" /></a>}
        </div>

        <div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.06] p-3.5">
          <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 w-4 h-4 shrink-0 text-sky-300" /><p className="flex-1 break-words text-sm font-semibold leading-snug text-slate-200">{endereco}</p></div>
          <a href={mapsUrl(endereco, p.endereco_lat, p.endereco_lon)} target="_blank" rel="noopener noreferrer" className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-3 py-2.5 text-xs font-black text-sky-950"><Navigation className="w-4 h-4" />Abrir rota no mapa</a>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Info icon={WalletCards} label="Pagamento" value={pagamento} />
          <Info icon={PackageCheck} label="Total" value={brl(p.valor_total)} accent />
        </div>

        <details className="group rounded-2xl border border-white/[0.07] bg-black/20">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-xs font-bold text-slate-300"><span>Ver itens do pedido</span><span className="text-slate-600 group-open:rotate-180">⌄</span></summary>
          <ul className="space-y-2 border-t border-white/[0.07] px-3.5 py-3">
            {(p.itens || []).map((it, idx) => <li key={idx} className="flex items-start gap-2 text-sm"><span className="font-black text-orange-300">{Number(it.quantidade ?? 1)}×</span><span className="text-slate-300">{it.nome}</span></li>)}
          </ul>
        </details>

        {p.observacoes && <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.07] px-3 py-2.5 text-xs leading-relaxed text-amber-200"><strong>Observação:</strong> {p.observacoes}</div>}

        <DeliveryProgress status={p.status} />

        {mode === "disponiveis" ? (
          <ActionButton icon={Hand} label={canClaim ? "Assumir esta entrega" : "Fique disponível para assumir"} busy={busy} disabled={!canClaim} onClick={onPegar} tone="orange" />
        ) : aCaminho ? (
          <ActionButton icon={CheckCircle2} label="Confirmar entrega" busy={busy} onClick={onAvancar} tone="green" />
        ) : pronto ? (
          <ActionButton icon={Bike} label="Iniciar rota" busy={busy} onClick={onAvancar} tone="blue" />
        ) : (
          <ActionButton icon={Clock3} label="Aguardando ficar pronto" busy={false} disabled onClick={onAvancar} tone="neutral" />
        )}
        {aguardando && <p className="-mt-2 text-center text-[10px] text-slate-600">A cozinha atualizará o pedido quando ele estiver liberado.</p>}
      </div>
    </article>
  );
}

function Info({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><Icon className={cn("w-3.5 h-3.5", accent ? "text-emerald-300" : "text-slate-500")} /><p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</p><p className={cn("mt-0.5 truncate text-xs font-black capitalize", accent ? "text-emerald-300" : "text-slate-200")}>{value}</p></div>;
}

function DeliveryProgress({ status }: { status: string }) {
  const step = status === "a_caminho" ? 2 : status === "pronto_entrega" ? 1 : 0;
  return <div><div className="flex items-center"><ProgressDot active done={step > 0} /><span className={cn("h-px flex-1", step > 0 ? "bg-orange-400" : "bg-white/10")} /><ProgressDot active={step >= 1} done={step > 1} /><span className={cn("h-px flex-1", step > 1 ? "bg-orange-400" : "bg-white/10")} /><ProgressDot active={step >= 2} /></div><div className="mt-2 grid grid-cols-3 text-center text-[9px] font-bold uppercase tracking-wide text-slate-600"><span>Preparando</span><span>Pronto</span><span>Em rota</span></div></div>;
}
function ProgressDot({ active, done }: { active: boolean; done?: boolean }) {
  return <span className={cn("grid w-5 h-5 place-items-center rounded-full border-2", active ? "border-orange-400 bg-orange-400 text-orange-950" : "border-slate-700 bg-[#0b0f16]")} >{done && <CheckCircle2 className="w-3 h-3" />}</span>;
}
function ActionButton({ icon: Icon, label, busy, disabled, onClick, tone }: { icon: any; label: string; busy: boolean; disabled?: boolean; onClick: () => void; tone: "orange" | "blue" | "green" | "neutral" }) {
  const colors = { orange: "bg-orange-500 text-white", blue: "bg-sky-400 text-sky-950", green: "bg-emerald-400 text-emerald-950", neutral: "bg-white/5 text-slate-600" };
  return <button type="button" onClick={onClick} disabled={disabled || busy} className={cn("flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-black shadow-lg disabled:cursor-not-allowed disabled:shadow-none", colors[tone], (disabled || busy) && "opacity-60")}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{label}</button>;
}
