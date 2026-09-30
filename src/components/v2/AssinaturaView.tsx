import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, Check, CheckCircle2,
  CircleOff, Copy, CreditCard, ExternalLink, Gauge, Loader2, Mail, Package,
  Pizza, QrCode, RefreshCw, ShieldCheck, Sparkles, Users, WalletCards, X, XCircle,
  Headphones,
} from "lucide-react";
import { AssinaturaInfo, FaturaInfo, PixCheckout, UsoPizzaria, pizzariasApi } from "../../lib/api";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const STATUS_FATURA: Record<string, { label: string; cls: string }> = {
  paga: { label: "Paga", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  pendente: { label: "Em aberto", cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  vencida: { label: "Vencida", cls: "border-rose-500/30 bg-rose-500/10 text-rose-400" },
  cancelada: { label: "Cancelada", cls: "border-line bg-surface-muted text-ink-subtle" },
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
    if (silent) setRefreshing(true);
    else setLoading(true);
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

  useEffect(() => {
    load();
  }, [pizzariaId]);

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
      const venceAgora =
        !!fatura &&
        (!fatura.vencimento ||
          new Date(fatura.vencimento).getTime() <= Date.now() + 2 * 86400000);
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
      setMsg({
        ok: true,
        text: result.acesso_ate
          ? `Renovação cancelada. Seu acesso continua ativo até ${fmtData(result.acesso_ate)}.`
          : "Renovação cancelada. Não serão geradas novas cobranças.",
      });
      await load(true);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Não foi possível cancelar a renovação." });
    } finally {
      setCancelando(false);
    }
  }

  if (loading && !info) {
    return (
      <div className="flex justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }
  if (err || !info) {
    return (
      <div className="m-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-300">
        {err || "Assinatura indisponível."}
      </div>
    );
  }

  const trialDias = info.trial_fim
    ? Math.max(0, Math.ceil((new Date(info.trial_fim).getTime() - Date.now()) / 86400000))
    : null;
  const renovacaoCancelada = !info.tem_assinatura && info.plano !== "trial" && !!info.vence_em;
  const proxima = info.fatura_aberta || info.proxima_cobranca;
  const percentual = uso?.percentual ?? 0;
  const statusLabel =
    info.status === "trial"
      ? "Período de teste"
      : info.status === "em_dia"
      ? "Em dia"
      : info.status === "vence_breve"
      ? "Vence em breve"
      : info.status === "vencida"
      ? "Em atraso"
      : info.status === "suspensa"
      ? "Suspensa"
      : "Sem assinatura";

  return (
    <div className="pzb-page mx-auto max-w-6xl space-y-6">
      {/* Hero Banner Header */}
      <section className="pzb-page-header">
        <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-ink-muted">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  info.status === "vencida" || info.status === "suspensa"
                    ? "bg-rose-400 animate-pulse"
                    : info.status === "trial"
                    ? "bg-violet-400"
                    : "bg-emerald-400"
                }`}
              />
              {statusLabel}
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-base font-semibold text-ink">
                Plano {info.plano_info.nome}
              </h2>
              {info.plano !== "trial" && (
                <p className="text-xs font-semibold text-ink-muted">
                  {brl(info.plano_info.preco_mensal)} por mês
                </p>
              )}
            </div>
            <p className="pzb-page-description max-w-xl">
              Atendimento, cardápio e equipe protegidos por uma cobrança recorrente processada pelo Asaas.
            </p>
          </div>

          <div className="border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-ink-subtle">
                  Renovação
                </p>
                <p
                  className={`mt-0.5 text-xs font-bold ${
                    info.tem_assinatura
                      ? "text-emerald-400"
                      : renovacaoCancelada
                      ? "text-amber-400"
                      : "text-amber-400"
                  }`}
                >
                  {info.tem_assinatura
                    ? "Automática ativa"
                    : renovacaoCancelada
                    ? "Automática cancelada"
                    : "Ainda não configurada"}
                </p>
              </div>
              <ShieldCheck
                className={`w-4 h-4 ${info.tem_assinatura ? "text-emerald-400" : "text-emerald-400"}`}
              />
            </div>
            <div className="mt-2.5 border-t border-line pt-2">
              <p className="text-xs font-bold text-ink-subtle">
                {info.tem_assinatura ? "Próxima renovação" : "Acesso disponível até"}
              </p>
              <p className="mt-0.5 text-sm font-bold text-white">
                {fmtData(info.vence_em || info.trial_fim)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Subscription Notice / Alert */}
      <SubscriptionNotice
        info={info}
        trialDias={trialDias}
        onPay={() =>
          info.fatura_aberta &&
          setCheckoutFatura({ id: info.fatura_aberta.id, valor: info.fatura_aberta.valor })
        }
      />

      {msg && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs ${
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Monthly Usage Bar (Posicionado acima dos StatCards exatamente como na imagem) */}
      <section className="pzb-section px-4 py-4">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-bold text-ink">Uso do plano neste mês</span>
          <strong className={`font-bold text-xs ${percentual >= 80 ? "text-amber-400" : "text-emerald-400"}`}>
            {Math.round(percentual)}%
          </strong>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <span
            className={`block h-full rounded-full transition-all duration-500 ${
              percentual >= 80 ? "bg-amber-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(percentual, 100)}%` }}
          />
        </div>
      </section>

      {/* 4 Stat Cards (Design compacto e horizontal 1:1) */}
      <section className="pzb-section grid grid-cols-2 xl:grid-cols-4 overflow-hidden">
        <Metric
          icon={Headphones}
          label="Atendimentos usados"
          value={uso ? `${uso.atendimentos}/${uso.atendimentos_limite}` : "0/100"}
          detail={uso ? `${uso.atendimentos_restante} restantes` : "100 restantes"}
        />
        <Metric
          icon={Package}
          label="Produtos"
          value={String(info.plano_info?.limites?.produtos ?? 30)}
          detail="Limite no cardápio"
        />
        <Metric
          icon={Users}
          label="Equipe"
          value={String(info.plano_info?.limites?.equipe ?? 1)}
          detail="Acessos ao painel"
        />
        <Metric
          icon={CalendarClock}
          label={info.tem_assinatura ? "Próxima cobrança" : "Validade atual"}
          value={fmtData(proxima?.vencimento || info.vence_em) !== "—" ? fmtData(proxima?.vencimento || info.vence_em) : "—"}
          detail={proxima ? brl(proxima.valor) : "Sem cobrança aberta"}
        />
      </section>

      {/* 2-Column: Ciclo da Assinatura + Situação Financeira */}
      <section className="grid gap-4 lg:grid-cols-12 items-start">
        {/* Como funciona */}
        <div className="pzb-section lg:col-span-8 p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="mt-0.5 text-sm md:text-base font-bold text-white">Ciclo da sua assinatura</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Veja como funciona o ciclo; o Asaas processa e confirma o pagamento.
              </p>
            </div>
            <button
              type="button"
              onClick={() => load(true)}
              aria-label="Atualizar informações da assinatura"
              disabled={refreshing}
              className="rounded-lg border border-line bg-surface-muted p-1.5 text-ink-muted hover:bg-surface-elevated hover:text-ink transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-orange-400" : ""}`} />
            </button>
          </div>

          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
            <Step
              number="01"
              title="Cobrança emitida"
              text="A fatura mensal é gerada com Pix, boleto ou cartão."
            />
            <Step
              number="02"
              title="Confirmação automática"
              text="O webhook do Asaas informa o pagamento ao PizzaBot."
            />
            <Step
              number="03"
              title="Plano renovado"
              text="O novo ciclo é liberado sem ação manual do suporte."
            />
          </div>

          <div className="mt-3.5 grid gap-2.5 border-t border-line pt-3 sm:grid-cols-2">
            <InfoRow
              icon={Mail}
              label="E-mail de cobrança"
              value={info.cobranca_email || "Ainda não informado"}
            />
            <InfoRow
              icon={CreditCard}
              label="Formas disponíveis"
              value="Pix, boleto ou cartão"
            />
          </div>

          <div className="mt-3.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                document.getElementById("planos-assinatura")?.scrollIntoView({ behavior: "smooth" })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors"
            >
              {info.tem_assinatura
                ? "Trocar de plano"
                : renovacaoCancelada
                ? "Reativar assinatura"
                : "Escolher um plano"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            {info.tem_assinatura && (
              <button
                type="button"
                onClick={() => setCancelModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                <CircleOff className="w-3.5 h-3.5" />
                Cancelar renovação
              </button>
            )}
          </div>
        </div>

        {/* Situação financeira */}
        <div
          className={`lg:col-span-4 rounded-xl border p-4 md:p-5  ${
            info.fatura_aberta
              ? "border-amber-500/30 bg-surface"
              : "border-line bg-surface"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-ink-subtle">
                {info.fatura_aberta ? "Ação necessária" : "Situação financeira"}
              </p>
              <h2 className="mt-0.5 text-sm md:text-base font-bold text-white">
                {info.fatura_aberta
                  ? "Fatura em aberto"
                  : info.proxima_cobranca
                  ? "Próxima cobrança"
                  : "Nenhuma pendência"}
              </h2>
            </div>
            <WalletCards
              className={
                info.fatura_aberta
                  ? "w-4 h-4 text-amber-400"
                  : "w-4 h-4 text-emerald-400"
              }
            />
          </div>

          {proxima ? (
            <div className="mt-3.5">
              <p className="text-xl font-bold text-white">{brl(proxima.valor)}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Vencimento em {fmtData(proxima.vencimento)}
              </p>
              <button
                type="button"
                onClick={() => setCheckoutFatura({ id: proxima.id, valor: proxima.valor })}
                className={`mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                  info.fatura_aberta
                    ? "bg-amber-500 hover:bg-amber-600 text-amber-950"
                    : "border border-line bg-surface-muted text-white hover:bg-surface-elevated"
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                {info.fatura_aberta ? "Pagar agora com Pix" : "Pagar antecipado"}
              </button>
            </div>
          ) : (
            <div className="mt-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              <div className="flex items-center gap-1.5 mb-0.5 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Tudo certo.
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                Não há cobrança aguardando pagamento neste momento.
              </p>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
            Pagamento processado em ambiente seguro pelo Asaas. A confirmação pode levar alguns instantes.
          </p>
        </div>
      </section>

      {/* Planos Disponíveis */}
      <section
        id="planos-assinatura"
        className="pzb-section scroll-mt-[calc(var(--pzb-topbar-height)+1rem)] p-4 md:p-5"
      >
        <div>
          <h2 className="mt-0.5 text-sm md:text-base font-bold text-white">
            {info.tem_assinatura
              ? "Mude conforme sua operação crescer"
              : renovacaoCancelada
              ? "Reative a renovação automática"
              : "Escolha o melhor começo"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Compare os planos disponíveis, preços e capacidade antes de confirmar.
          </p>
        </div>

        {!info.billing_disponivel ? (
          <div className="mt-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <AlertTriangle className="mr-1.5 inline w-3.5 h-3.5" />
            A cobrança Asaas ainda não foi configurada pelo administrador da plataforma.
          </div>
        ) : (
          <>
            <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
              {info.planos.map((plano) => {
                const atual = plano.id === info.plano;
                const recorrente = atual && info.tem_assinatura;
                const escolhido = planoEscolhido === plano.id;
                return (
                  <button
                    key={plano.id}
                    type="button"
                    disabled={recorrente}
                    onClick={() => setPlanoEscolhido(escolhido ? null : plano.id)}
                    className={`relative rounded-xl border p-3.5 text-left transition-all ${
                      escolhido
                        ? "border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/40"
                        : "border-line bg-surface-muted hover:border-line hover:bg-surface-elevated"
                    } disabled:cursor-default disabled:hover:border-line`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-white text-sm">{plano.nome}</p>
                      {atual && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold  ${
                            info.tem_assinatura
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          {info.tem_assinatura ? "Plano atual" : "Acesso atual"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-base font-semibold text-ink">
                      {brl(plano.preco_mensal)}
                      <span className="text-xs font-normal text-ink-muted">/mês</span>
                    </p>
                    <ul className="mt-2.5 space-y-1.5 text-xs text-ink-muted border-t border-line pt-2">
                      <li className="flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{plano.limites.conversas_mes} atendimentos/mês</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{plano.limites.produtos} produtos</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{plano.limites.equipe} acessos de equipe</span>
                      </li>
                    </ul>
                  </button>
                );
              })}
            </div>

            {selecionado && (
              <div className="mt-3.5 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3.5 md:p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="grid flex-1 gap-2.5 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold text-ink-muted">E-mail de cobrança</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="financeiro@suaempresa.com"
                        className="mt-1 w-full rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs text-white outline-none placeholder:text-ink-subtle focus:border-orange-500 transition-colors"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-ink-muted">CPF ou CNPJ</span>
                      <input
                        value={cpfCnpj}
                        onChange={(e) => setCpfCnpj(e.target.value)}
                        placeholder="00.000.000/0000-00"
                        className="mt-1 w-full rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs text-white outline-none placeholder:text-ink-subtle focus:border-orange-500 transition-colors"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={contratar}
                    disabled={
                      contratando || !email.trim() || ![11, 14].includes(cpfCnpj.replace(/\D/g, "").length)
                    }
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors disabled:opacity-40 shrink-0"
                  >
                    {contratando ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <BadgeCheck className="w-3.5 h-3.5" />
                    )}
                    {renovacaoCancelada && selecionado.id === info.plano
                      ? "Reativar"
                      : info.tem_assinatura
                      ? "Confirmar troca"
                      : "Assinar"}{" "}
                    {selecionado.nome}
                  </button>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
                  {info.tem_assinatura
                    ? "Ao trocar, a recorrência anterior é encerrada e uma nova assinatura é criada no Asaas. Se o plano for diferente, a primeira cobrança é emitida agora."
                    : renovacaoCancelada && selecionado.id === info.plano
                    ? `A próxima cobrança será programada para o fim do acesso atual, em ${fmtData(info.vence_em)}.`
                    : "O plano é ativado após a confirmação do primeiro pagamento."}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* Histórico de faturas */}
      <section id="faturas" className="pzb-section p-4 md:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-ink-muted">
              Financeiro
            </p>
            <h2 className="mt-0.5 text-sm md:text-base font-bold text-white">Histórico de faturas</h2>
          </div>
          <span className="text-xs text-ink-subtle">
            {info.faturas.length} registro{info.faturas.length === 1 ? "" : "s"}
          </span>
        </div>
        {info.faturas.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink-subtle flex flex-col items-center justify-center gap-1.5">
            <CreditCard className="w-6 h-6 text-ink-subtle stroke-[1.5]" />
            <span>As cobranças aparecerão aqui após a contratação.</span>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-line">
            {info.faturas.map((fatura: FaturaInfo) => {
              const status = STATUS_FATURA[fatura.status] || STATUS_FATURA.pendente;
              const podePagar = fatura.status === "pendente" || fatura.status === "vencida";
              return (
                <div
                  key={fatura.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center transition-colors hover:bg-surface-muted/30 px-2 rounded-xl"
                >
                  <span className="grid w-8 h-8 shrink-0 place-items-center rounded-lg bg-surface-muted border border-line text-ink-muted">
                    <CreditCard className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-white text-xs">{brl(fatura.valor)}</p>
                    <p className="text-xs text-ink-subtle">
                      Vencimento {fmtData(fatura.vencimento)}
                      {fatura.pago_em ? ` • pago em ${fmtData(fatura.pago_em)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${status.cls}`}>
                      {status.label}
                    </span>
                    {podePagar && (
                      <button
                        type="button"
                        onClick={() =>
                          setCheckoutFatura({ id: fatura.id, valor: fatura.valor })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-800 transition-colors"
                      >
                        <QrCode className="w-3 h-3" />
                        Pagar
                      </button>
                    )}
                    {fatura.link_pagamento && podePagar && (
                      <a
                        href={fatura.link_pagamento}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir no Asaas"
                        aria-label="Abrir fatura no Asaas"
                        className="rounded-lg border border-line bg-surface-muted p-1.5 text-ink-muted hover:text-ink transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pix Checkout Modal */}
      {checkoutFatura && (
        <PixCheckoutModal
          pizzariaId={pizzariaId}
          fatura={checkoutFatura}
          onClose={() => {
            setCheckoutFatura(null);
            load(true);
          }}
          onPaid={() => load(true)}
        />
      )}

      {/* Cancel Renewal Modal */}
      {cancelModal && (
        <CancelModal
          accessUntil={info.vence_em}
          busy={cancelando}
          onClose={() => setCancelModal(false)}
          onConfirm={cancelarRenovacao}
        />
      )}
    </div>
  );
}

function SubscriptionNotice({
  info,
  trialDias,
  onPay,
}: {
  info: AssinaturaInfo;
  trialDias: number | null;
  onPay: () => void;
}) {
  if (info.status === "em_dia" && info.tem_assinatura) return null;
  const config =
    info.status === "trial"
      ? {
          icon: Sparkles,
          tone: "border-violet-500/30 bg-violet-500/10 text-violet-300",
          title: "Você está no período de teste",
          text: trialDias !== null ? `Restam ${trialDias} dias, até ${fmtData(info.trial_fim)}.` : "Teste ativo.",
        }
      : info.status === "vencida"
      ? {
          icon: AlertTriangle,
          tone: "border-rose-500/30 bg-rose-500/10 text-rose-300",
          title: "Assinatura em atraso",
          text: `Venceu em ${fmtData(info.vence_em)}. O atendimento pode ser suspenso após ${info.carencia_dias} dias.`,
        }
      : info.status === "suspensa"
      ? {
          icon: XCircle,
          tone: "border-rose-500/30 bg-rose-500/10 text-rose-300",
          title: "Atendimento suspenso",
          text: "Regularize a assinatura para reativar automaticamente.",
        }
      : info.status === "vence_breve"
      ? {
          icon: CalendarClock,
          tone: "border-amber-500/30 bg-amber-500/10 text-amber-300",
          title: "Vencimento próximo",
          text: `Seu ciclo vence em ${fmtData(info.vence_em)}.`,
        }
      : {
          icon: CircleOff,
          tone: "border-amber-500/30 bg-amber-500/10 text-amber-300",
          title: "Renovação automática desativada",
          text: `Seu acesso atual continua até ${fmtData(info.vence_em)}.`,
        };
  const Icon = config.icon;
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border px-3.5 py-2.5 sm:flex-row sm:items-center ${config.tone}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold leading-tight">{config.title}</p>
        <p className="mt-0.5 text-xs opacity-80 leading-tight">{config.text}</p>
      </div>
      {info.fatura_aberta && (
        <button
          type="button"
          onClick={onPay}
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800 transition-colors shrink-0"
        >
          Pagar agora
        </button>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: any;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="p-4 flex items-start gap-3">
      <span className="grid w-9 h-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-400">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="mt-1 text-base font-semibold text-ink tabular-nums leading-tight">{value}</p>
        <p className="text-xs text-ink-subtle truncate">{detail}</p>
      </div>
    </div>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="border-t border-line pt-3">
      <span className="text-xs font-bold text-orange-400 tracking-wider">{number}</span>
      <p className="mt-1 text-xs font-bold text-white">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{text}</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-3 last:border-b-0">
      <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-bold text-ink-subtle">{label}</p>
        <p className="truncate text-xs font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}

function CancelModal({
  accessUntil,
  busy,
  onClose,
  onConfirm,
}: {
  accessUntil: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assinatura-cancelar-title"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="grid w-11 h-11 place-items-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
          <CircleOff className="w-5 h-5" />
        </span>
        <h2 id="assinatura-cancelar-title" className="mt-4 text-base font-semibold text-ink">Cancelar renovação automática?</h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          O Asaas deixará de gerar novas cobranças e removerá as faturas pendentes desta recorrência.
          Pagamentos já realizados continuam no histórico.
        </p>
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
          Seu acesso não será cortado agora. Ele continua disponível até{" "}
          <strong>{fmtData(accessUntil)}</strong>.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-600 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleOff className="w-4 h-4" />}
            Confirmar cancelamento
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Checkout Pix da assinatura (Dark Slate Refined)
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assinatura-pagamento-title"
        className="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="border-b border-line bg-surface-muted px-5 py-4 flex items-center gap-2.5 rounded-t-xl">
          <span className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-500/30 grid place-items-center">
            <Pizza className="w-4 h-4 text-orange-400" />
          </span>
          <div>
            <p className="font-bold text-white text-sm leading-tight">PizzaBot</p>
            <p id="assinatura-pagamento-title" className="text-xs text-ink-muted leading-tight">Pagamento da assinatura</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar pagamento da assinatura"
            className="ml-auto text-ink-muted hover:text-ink p-1 rounded-lg hover:bg-surface-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {paid ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 grid place-items-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="font-bold text-white text-base">Pagamento confirmado!</p>
              <p className="text-xs text-ink-muted mt-1">Seu plano já está ativo. 🎉</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors"
              >
                Fechar
              </button>
            </div>
          ) : loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
            </div>
          ) : pix?.ok ? (
            <>
              <div className="text-center">
                <p className="text-xs text-ink-muted">Valor</p>
                <p className="text-base font-semibold text-ink">{brl(pix.valor ?? fatura.valor)}</p>
                <p className="text-xs font-semibold text-emerald-400 mt-0.5">Pague com Pix instantâneo</p>
              </div>

              {pix.qr_base64 && (
                <div className="flex justify-center">
                  <div className="p-3 bg-white rounded-xl shadow-md">
                    <img
                      src={`data:image/png;base64,${pix.qr_base64}`}
                      alt="QR Code Pix"
                      className="w-48 h-48 rounded"
                    />
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-ink-muted mb-1.5">Pix copia e cola</p>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 truncate bg-surface-muted border border-line rounded-xl px-3 py-2 text-xs text-ink-muted">
                    {pix.copia_cola}
                  </code>
                  <button
                    type="button"
                    onClick={copiar}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-3.5 rounded-xl transition-colors ${
                      copied
                        ? "bg-emerald-500 text-white"
                        : "bg-brand-700 hover:bg-brand-800 text-white "
                    }`}
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2.5 text-xs text-ink-muted bg-surface-muted border border-line rounded-xl px-3 py-2.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500 shrink-0" />
                Aguardando o pagamento — o plano ativa automaticamente assim que cair.
              </div>

              {pix.link_pagamento && (
                <div className="pt-1 text-center">
                  <a
                    href={pix.link_pagamento}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-ink-muted hover:text-orange-400 inline-flex items-center gap-1 transition-colors"
                  >
                    Prefere boleto ou cartão? <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-ink-muted">
                Não foi possível gerar o Pix agora. Você pode pagar pela página segura do Asaas.
              </p>
              {pix?.link_pagamento ? (
                <a
                  href={pix.link_pagamento}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"
                >
                  Abrir pagamento seguro <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <p className="text-xs text-ink-subtle">A fatura também foi enviada para seu e-mail.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
