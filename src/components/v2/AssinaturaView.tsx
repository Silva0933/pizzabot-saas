
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, Check, CheckCircle2,
  CircleOff, Copy, CreditCard, ExternalLink, Gauge, Loader2, Mail, Package,
  Pizza, QrCode, RefreshCw, ShieldCheck, Sparkles, Users, WalletCards, X, XCircle,
} from "lucide-react";
import { AssinaturaInfo, FaturaInfo, PixCheckout, UsoPizzaria, pizzariasApi } from "../../lib/api";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
const STATUS_FATURA: Record<string, { label: string; cls: string }> = {
  paga: { label: "Paga", cls: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
  pendente: { label: "Em aberto", cls: "border-amber-400/20 bg-amber-400/10 text-amber-300" },
  vencida: { label: "Vencida", cls: "border-rose-400/20 bg-rose-400/10 text-rose-300" },
  cancelada: { label: "Cancelada", cls: "border-white/10 bg-white/5 text-slate-500" },
};

export function AssinaturaView({ pizzariaId }: { pizzariaId: string }) {
  const [info, setInfo] = useState<AssinaturaInfo | null>(null);
  const [uso, setUso] = useState<UsoPizzaria | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planoEscolhido, setPlanoEscolhido] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [contratando, setContratando] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checkoutFatura, setCheckoutFatura] = useState<{ id: string; valor: number } | null>(null);

  async function load(silent = false) {
    if (silent) setRefreshing(true); else setLoading(true);
    setErr(null);
    try {
      const [assinatura, consumo] = await Promise.all([
        pizzariasApi.assinatura(pizzariaId),
        pizzariasApi.uso(pizzariaId).catch(() => null),
      ]);
      setInfo(assinatura);
      setUso(consumo);
      setEmail(assinatura.cobranca_email || "");
      setCpfCnpj(assinatura.cobranca_cpf_cnpj || "");
    } catch (e: any) {
      setErr(e.message || "Não foi possível carregar sua assinatura.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [pizzariaId]);

  const selecionado = useMemo(
    () => info?.planos.find((plano) => plano.id === planoEscolhido) ?? null,
    [info, planoEscolhido],
  );

  async function contratar() {
    if (!selecionado) return;
    setContratando(true);
    setMsg(null);
    try {
      const result = await pizzariasApi.contratarAssinatura(pizzariaId, {
        plano: selecionado.id,
        cobranca_email: email.trim(),
        cobranca_cpf_cnpj: cpfCnpj.trim(),
      });
      const fatura = result.primeira_fatura;
      const venceAgora = !!fatura && (!fatura.vencimento || new Date(fatura.vencimento).getTime() <= Date.now() + 2 * 86400000);
      setMsg({
        ok: true,
        text: !fatura
          ? "Assinatura criada. A cobrança aparecerá aqui e também será enviada por e-mail."
          : venceAgora
            ? "Assinatura criada. Conclua o primeiro pagamento para ativar o novo ciclo."
            : `Renovação programada. A próxima cobrança será em ${fmtData(fatura.vencimento)}.`,
      });
      if (fatura?.id && venceAgora) setCheckoutFatura({ id: fatura.id, valor: fatura.valor });
      setPlanoEscolhido(null);
      await load(true);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Não foi possível atualizar a assinatura." });
    } finally {
      setContratando(false);
    }
  }

  async function cancelarRenovacao() {
    setCancelando(true);
    setMsg(null);
    try {
      const result = await pizzariasApi.cancelarAssinatura(pizzariaId);
      setCancelModal(false);
      setPlanoEscolhido(null);
      setMsg({ ok: true, text: result.acesso_ate ? `Renovação cancelada. Seu acesso continua ativo até ${fmtData(result.acesso_ate)}.` : "Renovação cancelada. Não serão geradas novas cobranças." });
      await load(true);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Não foi possível cancelar a renovação." });
    } finally {
      setCancelando(false);
    }
  }

  if (loading && !info) return <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-orange-400" /></div>;
  if (err || !info) return <div className="m-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-300">{err || "Assinatura indisponível."}</div>;

  const trialDias = info.trial_fim ? Math.max(0, Math.ceil((new Date(info.trial_fim).getTime() - Date.now()) / 86400000)) : null;
  const renovacaoCancelada = !info.tem_assinatura && info.plano !== "trial" && !!info.vence_em;
  const proxima = info.fatura_aberta || info.proxima_cobranca;
  const percentual = uso?.percentual ?? 0;
  const statusLabel = info.status === "trial" ? "Período de teste" : info.status === "em_dia" ? "Em dia" : info.status === "vence_breve" ? "Vence em breve" : info.status === "vencida" ? "Em atraso" : info.status === "suspensa" ? "Suspensa" : "Sem assinatura";

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 pb-24 md:p-6 md:pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,.25),transparent_40%),linear-gradient(135deg,#17120f_0%,#0b1018_70%)] p-5 md:p-7">
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-slate-300"><span className={`w-2 h-2 rounded-full ${info.status === "vencida" || info.status === "suspensa" ? "bg-rose-400" : "bg-emerald-400"}`} />{statusLabel}</div>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-orange-300">Sua assinatura</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1"><h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">Plano {info.plano_info.nome}</h1>{info.plano !== "trial" && <p className="pb-1 text-sm font-semibold text-slate-400">{brl(info.plano_info.preco_mensal)} por mês</p>}</div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">Atendimento, cardápio e equipe protegidos por uma cobrança recorrente processada pelo Asaas.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Renovação</p><p className={`mt-1 text-sm font-black ${info.tem_assinatura ? "text-emerald-300" : "text-amber-300"}`}>{info.tem_assinatura ? "Automática ativa" : renovacaoCancelada ? "Automática cancelada" : "Ainda não configurada"}</p></div><ShieldCheck className="w-5 h-5 text-emerald-400" /></div>
            <div className="mt-4 border-t border-white/10 pt-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{info.tem_assinatura ? "Próxima renovação" : "Acesso disponível até"}</p><p className="mt-1 text-lg font-black text-white">{fmtData(info.vence_em || info.trial_fim)}</p></div>
          </div>
        </div>
      </section>

      <SubscriptionNotice info={info} trialDias={trialDias} onPay={() => info.fatura_aberta && setCheckoutFatura({ id: info.fatura_aberta.id, valor: info.fatura_aberta.valor })} />
      {msg && <div className={`rounded-2xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-rose-400/20 bg-rose-400/10 text-rose-300"}`}>{msg.text}</div>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric icon={Gauge} label="Atendimentos usados" value={uso ? `${uso.atendimentos}/${uso.atendimentos_limite}` : "—"} detail={uso ? `${uso.atendimentos_restante} restantes` : "Consumo do mês"} />
        <Metric icon={Package} label="Produtos" value={String(info.plano_info.limites.produtos)} detail="Limite no cardápio" />
        <Metric icon={Users} label="Equipe" value={String(info.plano_info.limites.equipe)} detail="Acessos ao painel" />
        <Metric icon={CalendarClock} label={info.tem_assinatura ? "Próxima cobrança" : "Validade atual"} value={fmtData(proxima?.vencimento || info.vence_em)} detail={proxima ? brl(proxima.valor) : "Sem cobrança aberta"} />
      </section>

      {uso && <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-300">Uso do plano neste mês</span><strong className={percentual >= 80 ? "text-amber-300" : "text-emerald-300"}>{Math.round(percentual)}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]"><span className={`block h-full rounded-full ${percentual >= 80 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(percentual, 100)}%` }} /></div></section>}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Como funciona</p><h2 className="mt-1 text-lg font-black text-white">Ciclo da sua assinatura</h2><p className="mt-1 text-xs text-slate-500">Você acompanha tudo aqui; o Asaas processa e confirma o pagamento.</p></div><button type="button" onClick={() => load(true)} disabled={refreshing} className="rounded-xl border border-white/10 p-2.5 text-slate-500 hover:bg-white/5 hover:text-white"><RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /></button></div>
          <div className="mt-5 grid gap-3 md:grid-cols-3"><Step number="01" title="Cobrança emitida" text="A fatura mensal é gerada com Pix, boleto ou cartão." /><Step number="02" title="Confirmação automática" text="O webhook do Asaas informa o pagamento ao PizzaBot." /><Step number="03" title="Plano renovado" text="O novo ciclo é liberado sem ação manual do suporte." /></div>
          <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2"><InfoRow icon={Mail} label="E-mail de cobrança" value={info.cobranca_email || "Ainda não informado"} /><InfoRow icon={CreditCard} label="Formas disponíveis" value="Pix, boleto ou cartão" /></div>
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => document.getElementById("planos-assinatura")?.scrollIntoView({ behavior: "smooth" })} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-white hover:bg-orange-400">{info.tem_assinatura ? "Trocar de plano" : renovacaoCancelada ? "Reativar assinatura" : "Escolher um plano"} <ArrowRight className="w-4 h-4" /></button>{info.tem_assinatura && <button type="button" onClick={() => setCancelModal(true)} className="inline-flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-2.5 text-sm font-bold text-rose-300 hover:bg-rose-400/10"><CircleOff className="w-4 h-4" />Cancelar renovação</button>}</div>
        </div>

        <div className={`rounded-3xl border p-5 md:p-6 ${info.fatura_aberta ? "border-amber-400/25 bg-amber-400/[0.07]" : "border-white/10 bg-white/[0.035]"}`}>
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{info.fatura_aberta ? "Ação necessária" : "Situação financeira"}</p><h2 className="mt-1 text-lg font-black text-white">{info.fatura_aberta ? "Fatura em aberto" : info.proxima_cobranca ? "Próxima cobrança" : "Nenhuma pendência"}</h2></div><WalletCards className={info.fatura_aberta ? "w-5 h-5 text-amber-300" : "w-5 h-5 text-emerald-300"} /></div>
          {proxima ? <div className="mt-6"><p className="text-3xl font-black text-white">{brl(proxima.valor)}</p><p className="mt-1 text-xs text-slate-500">Vencimento em {fmtData(proxima.vencimento)}</p><button type="button" onClick={() => setCheckoutFatura({ id: proxima.id, valor: proxima.valor })} className={`mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${info.fatura_aberta ? "bg-amber-400 text-amber-950" : "border border-white/10 bg-white/5 text-white hover:bg-white/10"}`}><QrCode className="w-4 h-4" />{info.fatura_aberta ? "Pagar agora" : "Pagar antecipado"}</button></div> : <div className="mt-6 rounded-2xl bg-emerald-400/[0.07] p-4 text-sm text-emerald-300"><CheckCircle2 className="mb-2 w-5 h-5" /><strong>Tudo certo.</strong><p className="mt-1 text-xs leading-relaxed text-slate-500">Não há cobrança aguardando pagamento neste momento.</p></div>}
          <p className="mt-4 text-[10px] leading-relaxed text-slate-600">Pagamento processado em ambiente seguro pelo Asaas. A confirmação pode levar alguns instantes.</p>
        </div>
      </section>

      <section id="planos-assinatura" className="scroll-mt-24 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Planos disponíveis</p><h2 className="mt-1 text-lg font-black text-white">{info.tem_assinatura ? "Mude conforme sua operação crescer" : renovacaoCancelada ? "Reative a renovação automática" : "Escolha o melhor começo"}</h2><p className="mt-1 text-xs text-slate-500">Compare preço e capacidade antes de confirmar.</p></div>
        {!info.billing_disponivel ? <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-300"><AlertTriangle className="mr-2 inline w-4 h-4" />A cobrança Asaas ainda não foi configurada pelo administrador da plataforma.</div> : <>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {info.planos.map((plano) => {
              const atual = plano.id === info.plano;
              const recorrente = atual && info.tem_assinatura;
              const escolhido = planoEscolhido === plano.id;
              return <button key={plano.id} type="button" disabled={recorrente} onClick={() => setPlanoEscolhido(escolhido ? null : plano.id)} className={`relative rounded-2xl border p-4 text-left transition ${escolhido ? "border-orange-400 bg-orange-400/[0.08] ring-2 ring-orange-400/10" : "border-white/10 bg-black/20 hover:border-white/20"} disabled:cursor-default`}>
                {atual && <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${info.tem_assinatura ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{info.tem_assinatura ? "Plano atual" : "Acesso atual"}</span>}
                <p className="font-black text-white">{plano.nome}</p><p className="mt-2 text-2xl font-black text-white">{brl(plano.preco_mensal)}<span className="text-xs font-medium text-slate-600">/mês</span></p>
                <ul className="mt-4 space-y-2 text-xs text-slate-400"><li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400" />{plano.limites.conversas_mes} atendimentos/mês</li><li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400" />{plano.limites.produtos} produtos</li><li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400" />{plano.limites.equipe} acessos de equipe</li></ul>
              </button>;
            })}
          </div>
          {selecionado && <div className="mt-5 rounded-2xl border border-orange-400/20 bg-orange-400/[0.06] p-4 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end"><div className="grid flex-1 gap-3 md:grid-cols-2"><label><span className="text-xs font-bold text-slate-400">E-mail de cobrança</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="financeiro@suaempresa.com" className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400/50" /></label><label><span className="text-xs font-bold text-slate-400">CPF ou CNPJ</span><input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400/50" /></label></div><button type="button" onClick={contratar} disabled={contratando || !email.trim() || ![11, 14].includes(cpfCnpj.replace(/\D/g, "").length)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{contratando ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}{renovacaoCancelada && selecionado.id === info.plano ? "Reativar" : info.tem_assinatura ? "Confirmar troca" : "Assinar"} {selecionado.nome}</button></div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{info.tem_assinatura ? "Ao trocar, a recorrência anterior é encerrada e uma nova assinatura é criada no Asaas. Se o plano for diferente, a primeira cobrança é emitida agora." : renovacaoCancelada && selecionado.id === info.plano ? `A próxima cobrança será programada para o fim do acesso atual, em ${fmtData(info.vence_em)}.` : "O plano é ativado após a confirmação do primeiro pagamento."}</p>
          </div>}
        </>}
      </section>

      <section id="faturas" className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">Financeiro</p><h2 className="mt-1 text-lg font-black text-white">Histórico de faturas</h2></div><span className="text-xs text-slate-600">{info.faturas.length} registro{info.faturas.length === 1 ? "" : "s"}</span></div>
        {info.faturas.length === 0 ? <div className="py-10 text-center text-sm text-slate-600">As cobranças aparecerão aqui após a contratação.</div> : <div className="mt-4 divide-y divide-white/[0.07]">
          {info.faturas.map((fatura: FaturaInfo) => {
            const status = STATUS_FATURA[fatura.status] || STATUS_FATURA.pendente;
            const podePagar = fatura.status === "pendente" || fatura.status === "vencida";
            return <div key={fatura.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"><span className="grid w-10 h-10 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-500"><CreditCard className="w-4 h-4" /></span><div className="min-w-0 flex-1"><p className="font-black text-white">{brl(fatura.valor)}</p><p className="mt-0.5 text-xs text-slate-600">Vencimento {fmtData(fatura.vencimento)}{fatura.pago_em ? ` • pago em ${fmtData(fatura.pago_em)}` : ""}</p></div><div className="flex items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${status.cls}`}>{status.label}</span>{podePagar && <button type="button" onClick={() => setCheckoutFatura({ id: fatura.id, valor: fatura.valor })} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-black text-white"><QrCode className="w-3.5 h-3.5" />Pagar</button>}{fatura.link_pagamento && podePagar && <a href={fatura.link_pagamento} target="_blank" rel="noopener noreferrer" title="Abrir no Asaas" className="rounded-lg border border-white/10 p-2 text-slate-500 hover:text-white"><ExternalLink className="w-3.5 h-3.5" /></a>}</div></div>;
          })}
        </div>}
      </section>

      {checkoutFatura && <PixCheckoutModal pizzariaId={pizzariaId} fatura={checkoutFatura} onClose={() => { setCheckoutFatura(null); load(true); }} onPaid={() => load(true)} />}
      {cancelModal && <CancelModal accessUntil={info.vence_em} busy={cancelando} onClose={() => setCancelModal(false)} onConfirm={cancelarRenovacao} />}
    </div>
  );
}

function SubscriptionNotice({ info, trialDias, onPay }: { info: AssinaturaInfo; trialDias: number | null; onPay: () => void }) {
  if (info.status === "em_dia" && info.tem_assinatura) return null;
  const config = info.status === "trial"
    ? { icon: Sparkles, tone: "border-violet-400/20 bg-violet-400/[0.07] text-violet-300", title: "Você está no período de teste", text: trialDias !== null ? `Restam ${trialDias} dias, até ${fmtData(info.trial_fim)}.` : "Teste ativo." }
    : info.status === "vencida"
      ? { icon: AlertTriangle, tone: "border-rose-400/20 bg-rose-400/[0.07] text-rose-300", title: "Assinatura em atraso", text: `Venceu em ${fmtData(info.vence_em)}. O atendimento pode ser suspenso após ${info.carencia_dias} dias.` }
      : info.status === "suspensa"
        ? { icon: XCircle, tone: "border-rose-400/20 bg-rose-400/[0.07] text-rose-300", title: "Atendimento suspenso", text: "Regularize a assinatura para reativar automaticamente." }
        : info.status === "vence_breve"
          ? { icon: CalendarClock, tone: "border-amber-400/20 bg-amber-400/[0.07] text-amber-300", title: "Vencimento próximo", text: `Seu ciclo vence em ${fmtData(info.vence_em)}.` }
          : { icon: CircleOff, tone: "border-amber-400/20 bg-amber-400/[0.07] text-amber-300", title: "Renovação automática desativada", text: `Seu acesso atual continua até ${fmtData(info.vence_em)}.` };
  const Icon = config.icon;
  return <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${config.tone}`}><Icon className="w-5 h-5 shrink-0" /><div className="flex-1"><p className="text-sm font-black">{config.title}</p><p className="mt-0.5 text-xs text-slate-400">{config.text}</p></div>{info.fatura_aberta && <button type="button" onClick={onPay} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white">Pagar agora</button>}</div>;
}
function Metric({ icon: Icon, label, value, detail }: { icon: any; label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><span className="grid w-8 h-8 place-items-center rounded-xl bg-orange-400/10 text-orange-300"><Icon className="w-4 h-4" /></span><p className="mt-3 text-lg font-black text-white">{value}</p><p className="mt-1 text-xs font-bold text-slate-300">{label}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></div>;
}
function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3.5"><span className="text-[10px] font-black text-orange-400">{number}</span><p className="mt-2 text-xs font-black text-white">{title}</p><p className="mt-1 text-[11px] leading-relaxed text-slate-600">{text}</p></div>;
}
function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl bg-black/20 p-3"><Icon className="w-4 h-4 text-slate-500" /><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</p><p className="mt-0.5 truncate text-xs font-bold text-slate-300">{value}</p></div></div>;
}
function CancelModal({ accessUntil, busy, onClose, onConfirm }: { accessUntil: string | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}><div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111722] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}><span className="grid w-11 h-11 place-items-center rounded-2xl bg-rose-400/10 text-rose-300"><CircleOff className="w-5 h-5" /></span><h2 className="mt-4 text-lg font-black text-white">Cancelar renovação automática?</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">O Asaas deixará de gerar novas cobranças e removerá as faturas pendentes desta recorrência. Pagamentos já realizados continuam no histórico.</p><div className="mt-4 rounded-2xl border border-amber-400/15 bg-amber-400/[0.07] p-3 text-xs text-amber-200">Seu acesso não será cortado agora. Ele continua disponível até <strong>{fmtData(accessUntil)}</strong>.</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-400 hover:bg-white/5">Voltar</button><button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleOff className="w-4 h-4" />}Cancelar renovação</button></div></div></div>;
}


// ============================================
// Checkout Pix da assinatura
// ============================================
function PixCheckoutModal({
  pizzariaId,
  fatura,
  onClose,
  onPaid,
}: {
  pizzariaId: string;
  fatura: { id: string; valor: number };
  onClose: () => void;
  onPaid: () => void;
}) {
  const [pix, setPix] = useState<PixCheckout | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    let alive = true;
    pizzariasApi
      .faturaPix(pizzariaId, fatura.id)
      .then((p) => alive && setPix(p))
      .catch(() => alive && setPix({ ok: false }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pizzariaId, fatura.id]);

  // Polling de confirmação (a fatura vira "paga" via webhook do Asaas).
  useEffect(() => {
    if (paid) return;
    const t = setInterval(async () => {
      try {
        const a = await pizzariasApi.assinatura(pizzariaId);
        const f = a.faturas.find((x) => x.id === fatura.id);
        if (f && f.status === "paga") {
          setPaid(true);
          onPaid();
        }
      } catch {
        /* segue tentando */
      }
    }, 6000);
    return () => clearInterval(t);
  }, [pizzariaId, fatura.id, paid, onPaid]);

  function copiar() {
    if (!pix?.copia_cola) return;
    navigator.clipboard?.writeText(pix.copia_cola).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho com a marca */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-4 flex items-center gap-2.5 rounded-t-2xl">
          <span className="w-8 h-8 rounded-lg bg-white/20 grid place-items-center">
            <Pizza className="w-5 h-5 text-white" />
          </span>
          <div className="text-white">
            <p className="font-bold leading-tight">PizzaBot</p>
            <p className="text-[11px] text-white/80 leading-tight">Pagamento da assinatura</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/15"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {paid ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="font-bold text-slate-800">Pagamento confirmado!</p>
              <p className="text-sm text-slate-500 mt-1">Seu plano já está ativo. 🎉</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                Fechar
              </button>
            </div>
          ) : loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : pix?.ok ? (
            <>
              <div className="text-center">
                <p className="text-xs text-slate-500">Valor</p>
                <p className="text-2xl font-extrabold text-slate-900">{brl(pix.valor ?? fatura.valor)}</p>
                <p className="text-sm font-semibold text-slate-700 mt-1">Pague com Pix</p>
              </div>

              {pix.qr_base64 && (
                <div className="flex justify-center">
                  <img
                    src={`data:image/png;base64,${pix.qr_base64}`}
                    alt="QR Code Pix"
                    className="w-52 h-52 rounded-xl border border-slate-200"
                  />
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Pix copia e cola</p>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 truncate bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600">
                    {pix.copia_cola}
                  </code>
                  <button
                    type="button"
                    onClick={copiar}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold px-3 rounded-lg ${
                      copied
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-orange-500 hover:bg-orange-600 text-white"
                    }`}
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500 shrink-0" />
                Aguardando o pagamento — o plano ativa automaticamente assim que cair.
              </div>

              {pix.link_pagamento && (
                <div className="pt-1 text-center">
                  <a
                    href={pix.link_pagamento}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                  >
                    Prefere boleto ou cartão? <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </>
          ) : (
            // Sem Pix disponível → cai no link do Asaas (boleto/cartão).
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-slate-600">
                Não consegui gerar o Pix agora. Você pode pagar pela página segura do Asaas.
              </p>
              {pix?.link_pagamento ? (
                <a
                  href={pix.link_pagamento}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                >
                  Abrir pagamento <ExternalLink className="w-4 h-4" />
                </a>
              ) : (
                <p className="text-xs text-slate-400">A fatura também chega no seu e-mail.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
