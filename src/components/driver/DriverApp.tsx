import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Bike, CheckCircle2, ChevronDown, Clock3, Download, Hand, History, KeyRound, Loader2, LogOut,
  MapPin, MessageCircle, Navigation, Package, Phone, Power, RefreshCw, Route, Store, Wallet, X,
} from "lucide-react";
import {
  BackendPedido, connectWebSocket, EntregaHistorico, entregadorApi, HistoricoEntregador, ResumoEntregador,
  RotaEntregador, UserMe,
} from "../../lib/api";
import {
  abrirConfiguracoesDoApp, abrirExterno, APK_URL, ehApp, iniciarRastreamento, notificar,
  prepararNotificacoes, Rastreamento, versaoNovaDisponivel,
} from "../../lib/nativo";
import { cn } from "../../lib/cn";
import { brl, itemCount } from "../v2/pedidos/pedidoUtils";

// Redesenho após o teste no celular real (29/09): textos e botões pequenos demais,
// informação espalhada. Agora: navegação por abas embaixo (como os apps de
// entrega), turno em destaque, cards com uma ação principal grande e mínimo de
// texto abaixo de 14 px.

const REFRESH_EVENTS = ["pedido.atualizado", "pedido.novo", "entregador.atribuicao", "pedidos.limpos"];
const PRIORITY: Record<string, number> = { a_caminho: 0, pronto_entrega: 1, no_forno: 2, confirmado: 3 };

const mapsUrl = (endereco: string, lat?: number | null, lon?: number | null) =>
  lat != null && lon != null
    ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lon}`
    : `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(endereco)}`;

// Um botão só abria direto no Google Maps (teste real: o entregador usa Waze).
const wazeUrl = (endereco: string, lat?: number | null, lon?: number | null) =>
  lat != null && lon != null
    ? `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(endereco)}&navigate=yes`;

const PAGAMENTO: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
const pagamentoLabel = (f?: string | null) => (f ? PAGAMENTO[f] ?? f.replaceAll("_", " ") : "Não informado");

const STATUS: Record<string, { label: string; cor: string }> = {
  confirmado: { label: "Na cozinha", cor: "bg-slate-500/20 text-slate-200" },
  no_forno: { label: "No forno", cor: "bg-amber-400/15 text-amber-200" },
  pronto_entrega: { label: "Pronto para retirar", cor: "bg-orange-400/15 text-orange-200" },
  a_caminho: { label: "Em rota", cor: "bg-sky-400/15 text-sky-200" },
};

type Aba = "entregas" | "historico" | "ganhos";

export function DriverApp({ user, onLogout }: { user: UserMe; onLogout: () => void }) {
  const ent = user.entregador!;
  const pid = ent.pizzaria_id;
  const [aba, setAba] = useState<Aba>("entregas");
  const [lista, setLista] = useState<"minhas" | "disponiveis">("minhas");
  const [minhas, setMinhas] = useState<BackendPedido[]>([]);
  const [disponiveis, setDisponiveis] = useState<BackendPedido[]>([]);
  const [disponivel, setDisponivel] = useState(!!ent.disponivel);
  const [resumo, setResumo] = useState<ResumoEntregador | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAvailability, setBusyAvailability] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wsOnline, setWsOnline] = useState(false);
  const [gpsErro, setGpsErro] = useState<string | null>(null);
  const [rota, setRota] = useState<RotaEntregador | null>(null);
  const [rotaAberta, setRotaAberta] = useState(false);
  const [carregandoRota, setCarregandoRota] = useState(false);
  const [confirmando, setConfirmando] = useState<BackendPedido | null>(null);
  const [versaoNova, setVersaoNova] = useState<string | null>(null);
  // Pedidos já vistos: o que aparecer de novo vira notificação (a 1ª carga não avisa).
  const vistos = useRef<Set<string> | null>(null);
  const disponivelRef = useRef(disponivel);
  disponivelRef.current = disponivel;
  const repasseAtivo = !!resumo?.repasse_ativo;

  function avisarNovidades(mine: BackendPedido[], livres: BackendPedido[]) {
    const ids = new Set([...mine, ...livres].map((p) => p.id));
    if (vistos.current) {
      for (const p of mine) {
        if (!vistos.current.has(p.id)) {
          notificar(`Nova entrega #${p.numero_pedido ?? ""}`, p.endereco_entrega || "Abra o app para ver o endereço.");
        }
      }
      if (disponivelRef.current) {
        for (const p of livres) {
          if (!vistos.current.has(p.id)) {
            notificar(`Entrega disponível #${p.numero_pedido ?? ""}`, `${p.endereco_entrega || "Endereço no app"} · toque para assumir`);
          }
        }
      }
    }
    vistos.current = ids;
  }

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    const [mine, livres] = await Promise.all([
      entregadorApi.minhasEntregas(pid).catch(() => null),
      entregadorApi.disponiveis(pid).catch(() => null),
      entregadorApi.resumo(pid).then(setResumo).catch(() => {}),
    ]);
    if (mine) setMinhas(mine);
    if (livres) setDisponiveis(livres);
    if (mine && livres) avisarNovidades(mine, livres);
    if (silent) setRefreshing(false);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pid]);

  useEffect(() => {
    // O status vem do callback (vale para toda reconexão).
    const ws = connectWebSocket(pid, (ev) => {
      if (REFRESH_EVENTS.includes(ev.tipo)) load(true);
    }, setWsOnline);
    return () => { ws.close(); setWsOnline(false); };
  }, [pid]);

  useEffect(() => {
    const interval = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [pid]);

  // Turno ligado = GPS ligado. No app, a posição segue com a tela desligada (a
  // notificação fixa do Android mantém o app vivo e as entregas continuam chegando).
  useEffect(() => {
    if (!disponivel) return;
    let rastreio: Rastreamento | null = null;
    let cancelado = false;
    prepararNotificacoes().catch(() => {});
    iniciarRastreamento(
      (pos) => { entregadorApi.localizacao(pid, pos.lat, pos.lon, pos.precisao).catch(() => {}); },
      setGpsErro,
    ).then((r) => { if (cancelado) r.parar(); else rastreio = r; }).catch(() => {});
    return () => { cancelado = true; rastreio?.parar(); };
  }, [disponivel, pid]);

  useEffect(() => {
    versaoNovaDisponivel().then(setVersaoNova).catch(() => {});
  }, []);

  async function toggleDisponivel() {
    const novo = !disponivel;
    setDisponivel(novo);
    setBusyAvailability(true);
    setErr(null);
    try {
      await entregadorApi.setDisponibilidade(pid, novo);
    } catch {
      setDisponivel(!novo);
      setErr("Não foi possível alterar seu turno. Tente de novo.");
    } finally {
      setBusyAvailability(false);
    }
  }

  async function abrirRota() {
    setRotaAberta(true);
    setCarregandoRota(true);
    try {
      setRota(await entregadorApi.rota(pid));
    } catch (e: any) {
      setErr(e.message || "Não foi possível montar a rota.");
      setRotaAberta(false);
    } finally {
      setCarregandoRota(false);
    }
  }

  async function confirmarEntrega(p: BackendPedido, conf: { codigo?: string; sem_codigo_motivo?: string }) {
    await entregadorApi.updateStatus(pid, p.id, "entregue", conf);
    setConfirmando(null);
    setMinhas((m) => m.filter((x) => x.id !== p.id));
    await load(true);
  }

  async function avancar(p: BackendPedido) {
    const novo = p.status === "a_caminho" ? "entregue" : "a_caminho";
    // Confirmação com o código que o cliente recebeu no WhatsApp.
    if (novo === "entregue" && p.tem_codigo_entrega) {
      setConfirmando(p);
      return;
    }
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
    setLista("minhas");
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
  const cards = lista === "minhas" ? minhasOrdenadas : disponiveis;
  const emRota = minhas.filter((p) => p.status === "a_caminho").length;
  const prontas = minhas.filter((p) => p.status === "pronto_entrega").length;

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <div className="mx-auto min-h-screen max-w-lg pb-28">
        {/* Topo */}
        <header className="sticky top-0 z-20 bg-[#07090d]/95 px-4 pt-4 pb-3 backdrop-blur-xl" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-xl font-black">
              {ent.nome.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-400">Olá,</p>
              <h1 className="truncate text-xl font-black leading-tight">{ent.nome}</h1>
            </div>
            <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold", wsOnline ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-slate-400")}>
              <span className={cn("h-2 w-2 rounded-full", wsOnline ? "bg-emerald-400" : "bg-slate-500")} />
              {wsOnline ? "Ao vivo" : "Conectando"}
            </span>
            <button type="button" onClick={onLogout} className="grid h-11 w-11 place-items-center rounded-2xl text-slate-400 hover:bg-white/10" aria-label="Sair">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="space-y-4 px-4">
          {versaoNova && (
            <button type="button" onClick={() => abrirExterno(APK_URL)} className="flex w-full items-center gap-3 rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 text-left">
              <Download className="h-5 w-5 shrink-0 text-sky-300" />
              <span className="text-base"><strong>Nova versão do app ({versaoNova})</strong><span className="block text-sm text-slate-300">Toque para baixar e instalar.</span></span>
            </button>
          )}

          {err && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-base text-rose-100">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="flex-1">{err}</span>
              <button type="button" onClick={() => setErr(null)} aria-label="Fechar aviso"><X className="h-5 w-5" /></button>
            </div>
          )}

          {aba === "entregas" && (
            <>
              <Turno disponivel={disponivel} busy={busyAvailability} onToggle={toggleDisponivel} />

              {gpsErro && disponivel && (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-base text-amber-100">
                  <p className="flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0" />{gpsErro}</p>
                  {ehApp() && <button type="button" onClick={() => abrirConfiguracoesDoApp()} className="mt-3 h-11 rounded-xl bg-amber-400 px-4 text-sm font-black text-amber-950">Abrir configurações</button>}
                </div>
              )}

              <section className="grid grid-cols-3 gap-3">
                <Numero label="Hoje" valor={String(resumo?.entregas_hoje ?? 0)} sub={resumo?.entregas_hoje === 1 ? "entrega" : "entregas"} />
                <Numero label="Em rota" valor={String(emRota)} sub={emRota === 1 ? "pedido" : "pedidos"} destaque={emRota > 0} />
                {repasseAtivo
                  ? <Numero label="Ganhos hoje" valor={brl(resumo?.ganhos_hoje ?? 0)} verde />
                  : <Numero label="Total" valor={String(resumo?.entregas_total ?? 0)} sub="entregas" />}
              </section>

              {(emRota > 0 || prontas > 0) && (
                <section className="flex items-center gap-3 rounded-3xl border border-orange-400/25 bg-orange-400/10 p-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-400/20 text-orange-300"><Route className="h-6 w-6" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold">{emRota ? `${emRota} entrega${emRota > 1 ? "s" : ""} em rota` : `${prontas} pronta${prontas > 1 ? "s" : ""} para retirar`}</p>
                    <p className="text-sm text-slate-300">{emRota ? "Siga a ordem da rota." : "Retire na pizzaria e inicie a rota."}</p>
                  </div>
                  <button type="button" onClick={abrirRota} className="h-12 shrink-0 rounded-2xl bg-orange-500 px-4 text-base font-black">Ver rota</button>
                </section>
              )}

              <section className="flex items-center gap-2">
                <div className="grid flex-1 grid-cols-2 rounded-2xl bg-white/[0.05] p-1">
                  <Segmento ativo={lista === "minhas"} onClick={() => setLista("minhas")} label="Minhas" n={minhas.length} />
                  <Segmento ativo={lista === "disponiveis"} onClick={() => setLista("disponiveis")} label="Disponíveis" n={disponiveis.length} />
                </div>
                <button type="button" onClick={() => load(true)} disabled={refreshing} className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.05] text-slate-300" aria-label="Atualizar">
                  <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
                </button>
              </section>
              {lista === "disponiveis" && !disponivel && (
                <p className="rounded-2xl bg-amber-400/10 p-3 text-center text-base font-semibold text-amber-200">Comece o turno para assumir entregas.</p>
              )}

              <section className="space-y-4">
                {loading ? <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>
                  : cards.length === 0 ? <Vazio lista={lista} />
                  : cards.map((p) => (
                    <div key={p.id}>
                      <CardEntrega
                        pedido={p}
                        modo={lista}
                        busy={busyId === p.id}
                        podeAssumir={disponivel}
                        onAvancar={() => avancar(p)}
                        onPegar={() => pegar(p)}
                      />
                    </div>
                  ))}
              </section>
            </>
          )}

          {aba === "historico" && <Historico pid={pid} />}
          {aba === "ganhos" && <Ganhos resumo={resumo} pid={pid} />}

          <p className="pt-2 text-center text-xs text-slate-600">Versão da tela {__VERSAO_TELA__}</p>
        </main>
      </div>

      <NavInferior aba={aba} onAba={(a) => { setAba(a); window.scrollTo({ top: 0 }); }} mostrarGanhos={repasseAtivo} ativas={minhas.length} />

      {rotaAberta && <RotaSheet rota={rota} carregando={carregandoRota} onFechar={() => setRotaAberta(false)} />}
      {confirmando && (
        <ConfirmarEntrega pedido={confirmando} onFechar={() => setConfirmando(null)} onConfirmar={(c) => confirmarEntrega(confirmando, c)} />
      )}
    </div>
  );
}

function Turno({ disponivel, busy, onToggle }: { disponivel: boolean; busy: boolean; onToggle: () => void }) {
  if (!disponivel) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
        <p className="text-lg font-black">Você está fora do turno</p>
        <p className="mt-1 text-base text-slate-400">Comece o turno para receber entregas e aparecer para a pizzaria.</p>
        <button type="button" onClick={onToggle} disabled={busy} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 text-lg font-black disabled:opacity-60">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Power className="h-5 w-5" />}Começar turno
        </button>
      </section>
    );
  }
  return (
    <section className="flex items-center gap-4 rounded-3xl border border-emerald-400/25 bg-emerald-400/10 p-4">
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-400 text-emerald-950">
        <Bike className="h-6 w-6" />
        <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 animate-pulse rounded-full border-2 border-[#07090d] bg-emerald-300" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-black text-emerald-100">Você está online</p>
        <p className="text-sm text-emerald-200/80">Recebendo entregas</p>
      </div>
      <button type="button" onClick={onToggle} disabled={busy} className="h-11 shrink-0 rounded-xl border border-white/15 px-3 text-sm font-bold text-slate-200 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Encerrar"}
      </button>
    </section>
  );
}

function Numero({ label, valor, sub, destaque, verde }: { label: string; valor: string; sub?: string; destaque?: boolean; verde?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3.5", destaque ? "bg-sky-400/15" : "bg-white/[0.05]")}>
      <p className="text-sm text-slate-400">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-black leading-tight", verde && "text-emerald-300", destaque && "text-sky-200")}>{valor}</p>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

function Segmento({ ativo, onClick, label, n }: { ativo: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-12 items-center justify-center gap-2 rounded-xl text-base font-bold", ativo ? "bg-orange-500 text-white" : "text-slate-400")}>
      {label}
      <span className={cn("min-w-6 rounded-full px-1.5 text-sm", ativo ? "bg-white/25" : "bg-white/10")}>{n}</span>
    </button>
  );
}

function Vazio({ lista }: { lista: "minhas" | "disponiveis" }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 px-6 py-14 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.05] text-slate-500"><Package className="h-8 w-8" /></span>
      <p className="mt-4 text-lg font-bold text-slate-200">{lista === "minhas" ? "Nenhuma entrega com você" : "Nenhuma entrega disponível"}</p>
      <p className="mx-auto mt-1 max-w-xs text-base text-slate-400">
        {lista === "minhas" ? "As entregas atribuídas a você aparecem aqui na hora." : "Quando um pedido ficar pronto, ele aparece aqui."}
      </p>
    </div>
  );
}

function CardEntrega({ pedido: p, modo, busy, podeAssumir, onAvancar, onPegar }: {
  pedido: BackendPedido;
  modo: "minhas" | "disponiveis";
  busy: boolean;
  podeAssumir: boolean;
  onAvancar: () => void;
  onPegar: () => void;
}) {
  const [itensAbertos, setItensAbertos] = useState(false);
  const tel = p.cliente?.telefone;
  const endereco = p.endereco_entrega || "Endereço não informado";
  const aCaminho = p.status === "a_caminho";
  const pronto = p.status === "pronto_entrega";
  const status = STATUS[p.status] ?? { label: p.status, cor: "bg-white/10 text-slate-200" };
  const n = itemCount(p.itens);
  const cobrarNaEntrega = p.payment_status !== "paid" && p.payment_status !== "approved";

  return (
    <article className={cn("overflow-hidden rounded-3xl border bg-[#10141c]", aCaminho ? "border-sky-400/40" : "border-white/10")}>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <p className="text-2xl font-black">#{p.numero_pedido ?? "—"}</p>
        <span className={cn("rounded-full px-3 py-1.5 text-sm font-bold", status.cor)}>{status.label}</span>
      </div>

      <div className="space-y-4 p-5">
        <div>
          <p className="truncate text-lg font-bold">{p.cliente?.nome || "Cliente"}</p>
          <p className="text-base text-slate-400">{n} {n === 1 ? "item" : "itens"}</p>
          {tel && (
            // Ligação normal e WhatsApp separados: no teste real o único botão
            // abria a chamada pelo WhatsApp e o entregador queria a do telefone.
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => abrirExterno(`tel:+${tel.replace(/\D/g, "")}`)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 text-base font-bold" aria-label="Ligar para o cliente">
                <Phone className="h-5 w-5" />Ligar
              </button>
              <button type="button" onClick={() => abrirExterno(`https://wa.me/${tel.replace(/\D/g, "")}`)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-base font-bold text-emerald-300" aria-label="Chamar o cliente no WhatsApp">
                <MessageCircle className="h-5 w-5" />WhatsApp
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white/[0.05] p-4">
          <p className="flex items-start gap-2.5 text-base font-semibold leading-snug"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />{endereco}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => abrirExterno(mapsUrl(endereco, p.endereco_lat, p.endereco_lon))} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 text-base font-bold"><Navigation className="h-5 w-5" />Maps</button>
            <button type="button" onClick={() => abrirExterno(wazeUrl(endereco, p.endereco_lat, p.endereco_lon))} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#33ccff] text-base font-black text-[#062a3a]"><Navigation className="h-5 w-5" />Waze</button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/[0.05] p-4">
          <div>
            <p className="text-sm text-slate-400">{cobrarNaEntrega ? "Cobrar na entrega" : "Já pago"}</p>
            <p className="text-base font-bold">{pagamentoLabel(p.forma_pagamento)}</p>
          </div>
          <p className={cn("text-2xl font-black", cobrarNaEntrega ? "text-amber-200" : "text-emerald-300")}>{brl(p.valor_total)}</p>
        </div>

        {p.observacoes && (
          <p className="rounded-2xl bg-amber-400/10 p-4 text-base leading-snug text-amber-100"><strong>Observação:</strong> {p.observacoes}</p>
        )}

        <button type="button" onClick={() => setItensAbertos(!itensAbertos)} className="flex w-full items-center justify-between rounded-2xl bg-white/[0.03] px-4 py-3 text-base font-semibold text-slate-300">
          Itens do pedido
          <ChevronDown className={cn("h-5 w-5 transition-transform", itensAbertos && "rotate-180")} />
        </button>
        {itensAbertos && (
          <ul className="-mt-2 space-y-2 px-2">
            {(p.itens || []).map((it, idx) => (
              <li key={idx} className="flex gap-2 text-base"><span className="font-black text-orange-300">{Number(it.quantidade ?? 1)}×</span><span className="text-slate-200">{it.nome}</span></li>
            ))}
          </ul>
        )}

        {modo === "disponiveis" ? (
          <Acao icone={Hand} label={podeAssumir ? "Assumir esta entrega" : "Comece o turno para assumir"} busy={busy} disabled={!podeAssumir} onClick={onPegar} tom="laranja" />
        ) : aCaminho ? (
          <Acao icone={CheckCircle2} label="Confirmar entrega" busy={busy} onClick={onAvancar} tom="verde" />
        ) : pronto ? (
          <Acao icone={Bike} label="Retirei, iniciar rota" busy={busy} onClick={onAvancar} tom="azul" />
        ) : (
          <Acao icone={Clock3} label="Aguardando a cozinha" busy={false} disabled onClick={onAvancar} tom="neutro" />
        )}
      </div>
    </article>
  );
}

function Acao({ icone: Icone, label, busy, disabled, onClick, tom }: {
  icone: any; label: string; busy: boolean; disabled?: boolean; onClick: () => void; tom: "laranja" | "azul" | "verde" | "neutro";
}) {
  const cores = { laranja: "bg-orange-500 text-white", azul: "bg-sky-400 text-sky-950", verde: "bg-emerald-400 text-emerald-950", neutro: "bg-white/5 text-slate-400" };
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={cn("flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-black", cores[tom], (disabled || busy) && "opacity-60")}>
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icone className="h-5 w-5" />}{label}
    </button>
  );
}

function NavInferior({ aba, onAba, mostrarGanhos, ativas }: { aba: Aba; onAba: (a: Aba) => void; mostrarGanhos: boolean; ativas: number }) {
  const itens: Array<{ id: Aba; label: string; icone: any }> = [
    { id: "entregas", label: "Entregas", icone: Package },
    { id: "historico", label: "Histórico", icone: History },
    ...(mostrarGanhos ? [{ id: "ganhos" as Aba, label: "Ganhos", icone: Wallet }] : []),
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b0e14]/95 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto flex max-w-lg">
        {itens.map(({ id, label, icone: Icone }) => (
          <button key={id} type="button" onClick={() => onAba(id)} className={cn("relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-sm font-semibold", aba === id ? "text-orange-400" : "text-slate-400")}>
            <Icone className="h-6 w-6" />
            {label}
            {id === "entregas" && ativas > 0 && (
              <span className="absolute right-[calc(50%-1.6rem)] top-2 min-w-5 rounded-full bg-orange-500 px-1 text-center text-xs font-black text-white">{ativas}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

const diaDe = (iso: string | null) => {
  if (!iso) return "Sem data";
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
};

function Historico({ pid }: { pid: string }) {
  const [dados, setDados] = useState<HistoricoEntregador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    entregadorApi.historico(pid, 30).then(setDados).catch((e) => setErro(e.message || "Não foi possível carregar o histórico."));
  }, [pid]);

  const grupos = useMemo(() => {
    const m = new Map<string, EntregaHistorico[]>();
    for (const e of dados?.entregas ?? []) {
      const k = diaDe(e.entregue_em);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [dados]);

  if (erro) return <p className="rounded-2xl bg-rose-400/10 p-4 text-base text-rose-100">{erro}</p>;
  if (!dados) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>;

  const total = dados.entregas.reduce((s, e) => s + (e.repasse ?? 0), 0);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-black">Histórico</h2>
        <p className="text-base text-slate-400">
          Últimos 30 dias · {dados.entregas.length} {dados.entregas.length === 1 ? "entrega" : "entregas"}
          {dados.repasse_ativo && ` · ${brl(total)}`}
        </p>
      </div>
      {grupos.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 px-6 py-14 text-center">
          <History className="mx-auto h-10 w-10 text-slate-500" />
          <p className="mt-3 text-lg font-bold text-slate-200">Nenhuma entrega ainda</p>
          <p className="mt-1 text-base text-slate-400">As entregas que você concluir aparecem aqui.</p>
        </div>
      ) : grupos.map(([dia, itens]) => (
        <div key={dia}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <p className="text-base font-bold capitalize text-slate-200">{dia}</p>
            <p className="text-sm text-slate-400">
              {itens.length} {itens.length === 1 ? "entrega" : "entregas"}
              {dados.repasse_ativo && ` · ${brl(itens.reduce((s, e) => s + (e.repasse ?? 0), 0))}`}
            </p>
          </div>
          <ul className="divide-y divide-white/10 overflow-hidden rounded-3xl bg-[#10141c]">
            {itens.map((e) => (
              <li key={e.pedido_id} className="flex items-center gap-3 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold">#{e.numero_pedido ?? "—"} · {e.cliente || "Cliente"}</p>
                  <p className="truncate text-sm text-slate-400">{e.endereco || "Sem endereço"}</p>
                  <p className="text-sm text-slate-500">
                    {e.entregue_em ? new Date(e.entregue_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} · {pagamentoLabel(e.forma_pagamento)} {brl(e.valor_total)}
                  </p>
                </div>
                {dados.repasse_ativo && e.repasse != null && (
                  <p className="shrink-0 text-lg font-black text-emerald-300">+{brl(e.repasse)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Ganhos({ resumo, pid }: { resumo: ResumoEntregador | null; pid: string }) {
  const [atual, setAtual] = useState(resumo);
  useEffect(() => { entregadorApi.resumo(pid).then(setAtual).catch(() => {}); }, [pid]);
  const r = atual ?? resumo;
  if (!r?.repasse_ativo) {
    return <p className="rounded-2xl bg-white/[0.05] p-5 text-base text-slate-300">A pizzaria não usa valor por entrega no app.</p>;
  }
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-black">Ganhos</h2>
      <div className="rounded-3xl bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 p-6">
        <p className="text-base text-emerald-100/80">Hoje</p>
        <p className="mt-1 text-4xl font-black text-emerald-200">{brl(r.ganhos_hoje ?? 0)}</p>
        <p className="mt-1 text-base text-emerald-100/80">{r.entregas_hoje} {r.entregas_hoje === 1 ? "entrega" : "entregas"}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/[0.05] p-4">
          <p className="text-sm text-slate-400">Últimos 7 dias</p>
          <p className="mt-1 text-2xl font-black">{brl(r.ganhos_semana ?? 0)}</p>
          <p className="text-sm text-slate-500">{r.entregas_semana ?? 0} entregas</p>
        </div>
        <div className="rounded-2xl bg-white/[0.05] p-4">
          <p className="text-sm text-slate-400">Total</p>
          <p className="mt-1 text-2xl font-black">{brl(r.ganhos_total ?? 0)}</p>
          <p className="text-sm text-slate-500">{r.entregas_total} entregas</p>
        </div>
      </div>
      <div className="rounded-2xl bg-white/[0.05] p-4 text-base text-slate-300">
        <p>Valor por entrega: <strong className="text-white">{brl(r.repasse_valor ?? 0)}</strong></p>
        <p className="mt-1 text-sm text-slate-400">O acerto dos valores é feito com a pizzaria.</p>
      </div>
    </section>
  );
}

/** Paradas em ordem (coleta primeiro, se houver) e os atalhos para o Maps/Waze. */
function RotaSheet({ rota, carregando, onFechar }: { rota: RotaEntregador | null; carregando: boolean; onFechar: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={onFechar}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#0e131b] p-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-orange-300">Sua rota</p>
            <h2 className="text-2xl font-black">{rota ? `${rota.paradas.length} parada${rota.paradas.length === 1 ? "" : "s"} · ~${rota.distancia_km} km` : "Montando a rota…"}</h2>
          </div>
          <button type="button" onClick={onFechar} className="grid h-11 w-11 place-items-center rounded-2xl text-slate-300 hover:bg-white/10" aria-label="Fechar"><X className="h-6 w-6" /></button>
        </div>
        {carregando || !rota ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>
        ) : rota.paradas.length === 0 ? (
          <p className="py-10 text-center text-base text-slate-400">Nenhuma entrega pronta ou em rota agora.</p>
        ) : (
          <>
            <ol className="mt-4 space-y-3">
              {rota.paradas.map((p, i) => (
                <li key={p.pedido_id || `coleta-${i}`} className="flex items-start gap-3 rounded-2xl bg-white/[0.05] p-4">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-black", p.tipo === "coleta" ? "bg-orange-500 text-white" : "bg-sky-400 text-sky-950")}>
                    {p.tipo === "coleta" ? <Store className="h-5 w-5" /> : i + (rota.paradas[0]?.tipo === "coleta" ? 0 : 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold">{p.tipo === "coleta" ? `Retirar na ${p.nome}` : `#${p.numero_pedido ?? "—"} · ${p.cliente || "Cliente"}`}</p>
                    <p className="mt-0.5 break-words text-sm text-slate-300">{p.endereco || "Endereço não informado"}</p>
                    {p.distancia_km != null && <p className="mt-0.5 text-sm text-slate-500">~{p.distancia_km} km da parada anterior</p>}
                  </div>
                  {p.waze_url && (
                    <button type="button" onClick={() => abrirExterno(p.waze_url!)} className="h-11 shrink-0 rounded-xl bg-[#33ccff] px-3 text-sm font-black text-[#062a3a]">Waze</button>
                  )}
                </li>
              ))}
            </ol>
            {rota.sem_coordenada > 0 && (
              <p className="mt-3 text-sm text-amber-200">{rota.sem_coordenada} endereço(s) sem localização exata: ficaram no fim da lista.</p>
            )}
            {rota.google_maps_url && (
              <button type="button" onClick={() => abrirExterno(rota.google_maps_url!)} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky-400 text-lg font-black text-sky-950">
                <Navigation className="h-5 w-5" />Rota completa no Google Maps
              </button>
            )}
            <p className="mt-2 text-center text-sm text-slate-500">
              {rota.origem === "posicao_atual" ? "Ordem calculada a partir de onde você está." : "Ordem calculada a partir da pizzaria."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Confirmação da entrega com o código de 4 dígitos que o cliente recebeu no WhatsApp. */
function ConfirmarEntrega({ pedido, onFechar, onConfirmar }: {
  pedido: BackendPedido;
  onFechar: () => void;
  onConfirmar: (c: { codigo?: string; sem_codigo_motivo?: string }) => Promise<void>;
}) {
  const [codigo, setCodigo] = useState("");
  const [semCodigo, setSemCodigo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = semCodigo ? motivo.trim().length >= 3 : codigo.length === 4;

  async function enviar() {
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar(semCodigo ? { sem_codigo_motivo: motivo.trim() } : { codigo });
    } catch (e: any) {
      setErro(e.message || "Não foi possível confirmar a entrega.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={onFechar}>
      <form className="w-full max-w-lg rounded-t-3xl bg-[#0e131b] p-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-emerald-300">Confirmar entrega</p>
            <h2 className="text-2xl font-black">#{pedido.numero_pedido ?? "—"} · {pedido.cliente?.nome || "Cliente"}</h2>
          </div>
          <button type="button" onClick={onFechar} className="grid h-11 w-11 place-items-center rounded-2xl text-slate-300 hover:bg-white/10" aria-label="Fechar"><X className="h-6 w-6" /></button>
        </div>
        {!semCodigo ? (
          <>
            <label htmlFor="codigo-entrega" className="mt-5 flex items-start gap-2 text-base text-slate-200"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />Peça ao cliente o código de 4 números que ele recebeu no WhatsApp.</label>
            <input id="codigo-entrega" inputMode="numeric" autoComplete="one-time-code" maxLength={4} autoFocus value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="mt-3 w-full rounded-2xl border border-white/15 bg-black/30 py-5 text-center font-mono text-4xl font-black tracking-[0.6em] text-white outline-none focus:border-emerald-400" placeholder="····" />
            <button type="button" onClick={() => setSemCodigo(true)} className="mt-3 h-11 text-base font-semibold text-slate-300 underline">O cliente não tem o código</button>
          </>
        ) : (
          <>
            <label htmlFor="motivo-sem-codigo" className="mt-5 block text-base text-slate-200">Por que está confirmando sem o código? Fica registrado no pedido.</label>
            <textarea id="motivo-sem-codigo" autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: cliente sem celular, entreguei para o porteiro"
              className="mt-3 w-full rounded-2xl border border-white/15 bg-black/30 p-4 text-base text-white outline-none focus:border-amber-400" />
            <button type="button" onClick={() => setSemCodigo(false)} className="mt-2 h-11 text-base font-semibold text-slate-300 underline">Voltar e digitar o código</button>
          </>
        )}
        {erro && <p className="mt-3 rounded-2xl bg-rose-400/10 p-3 text-base text-rose-100">{erro}</p>}
        <button type="submit" disabled={!pronto || enviando} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 text-lg font-black text-emerald-950 disabled:opacity-50">
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}Confirmar entrega
        </button>
      </form>
    </div>
  );
}
