/**
 * Aba "Assinatura" — plano atual, status, faturas e contratação/upgrade.
 *
 * O dono vê o plano, quando vence, paga a fatura aberta (link Asaas) e
 * contrata/troca de plano (cria assinatura mensal no Asaas da plataforma:
 * Pix, boleto ou cartão — o Asaas envia a fatura por e-mail também).
 */
import React, { useEffect, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, CreditCard,
  ExternalLink, Loader2, Sparkles, XCircle, Pizza, Copy, Check, X, QrCode,
} from "lucide-react";
import { AssinaturaInfo, FaturaInfo, PixCheckout, pizzariasApi } from "../../lib/api";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const STATUS_FATURA: Record<string, { label: string; cls: string }> = {
  paga:     { label: "Paga",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pendente: { label: "Em aberto", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  vencida:  { label: "Vencida",  cls: "bg-red-50 text-red-700 border-red-200" },
  cancelada:{ label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

export function AssinaturaView({ pizzariaId }: { pizzariaId: string }) {
  const [info, setInfo] = useState<AssinaturaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Form de contratação
  const [planoEscolhido, setPlanoEscolhido] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [contratando, setContratando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Checkout Pix branded (in-panel) da fatura aberta
  const [checkoutFatura, setCheckoutFatura] = useState<{ id: string; valor: number } | null>(null);

  function load() {
    setLoading(true);
    pizzariasApi.assinatura(pizzariaId)
      .then((a) => {
        setInfo(a);
        setEmail(a.cobranca_email || "");
        setCpfCnpj(a.cobranca_cpf_cnpj || "");
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [pizzariaId]);

  async function contratar() {
    if (!planoEscolhido) return;
    setContratando(true);
    setMsg(null);
    try {
      const r = await pizzariasApi.contratarAssinatura(pizzariaId, {
        plano: planoEscolhido,
        cobranca_email: email.trim(),
        cobranca_cpf_cnpj: cpfCnpj.trim(),
      });
      const fat = r.primeira_fatura;
      setMsg({
        ok: true,
        text: fat
          ? "Assinatura criada! Pague abaixo — o plano ativa assim que o pagamento confirmar."
          : "Assinatura criada! A fatura chega por e-mail (e aparece aqui em instantes).",
      });
      // Abre o checkout Pix branded direto (sem mandar pra página do Asaas).
      if (fat?.id) setCheckoutFatura({ id: fat.id, valor: fat.valor });
      setPlanoEscolhido(null);
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Erro ao criar assinatura." });
    }
    setContratando(false);
  }

  if (loading && !info) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }
  if (err || !info) {
    return <div className="p-6 text-sm text-red-600">Erro ao carregar assinatura: {err}</div>;
  }

  const trialDiasRestantes = info.trial_fim
    ? Math.max(0, Math.ceil((new Date(info.trial_fim).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      {/* Banner de status */}
      {info.status === "trial" && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
          <div className="text-sm text-violet-900">
            <strong>Teste grátis</strong> — {trialDiasRestantes !== null
              ? <>restam <strong>{trialDiasRestantes} dia(s)</strong> (até {fmtData(info.trial_fim)})</>
              : "ativo"}.{" "}
            Até {info.plano_info.limites.conversas_mes} atendimentos no período. Assine um plano abaixo
            para não interromper o atendimento.
          </div>
        </div>
      )}
      {info.status === "vence_breve" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-900">
          <CalendarClock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>Sua assinatura <strong>vence em {fmtData(info.vence_em)}</strong>. Pague a fatura para não interromper o atendimento.</div>
        </div>
      )}
      {info.status === "vencida" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-sm text-red-900">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            Assinatura <strong>vencida em {fmtData(info.vence_em)}</strong>. O atendimento será
            suspenso automaticamente após {info.carencia_dias} dias de atraso.
          </div>
        </div>
      )}
      {info.status === "suspensa" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3 text-sm text-red-900">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <strong>Atendimento suspenso</strong>
            {info.suspensa_motivo === "trial_expirado" ? " — seu teste grátis terminou." :
             info.suspensa_motivo === "inadimplencia" ? " — assinatura em atraso." : "."}{" "}
            Assine/pague abaixo: a reativação é automática assim que o pagamento confirmar.
          </div>
        </div>
      )}

      {/* Plano atual */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 grid place-items-center">
            <BadgeCheck className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-bold text-slate-800">
              Plano {info.plano_info.nome}
              {info.plano !== "trial" && (
                <span className="text-slate-400 font-medium"> · {brl(info.plano_info.preco_mensal)}/mês</span>
              )}
            </h2>
            <p className="text-xs text-slate-500">
              {info.plano !== "trial" && info.vence_em
                ? <>Válido até <strong>{fmtData(info.vence_em)}</strong></>
                : "Cota reduzida durante o teste"}
              {" · "}{info.plano_info.limites.conversas_mes} atendimentos/mês
              {" · "}{info.plano_info.limites.produtos} produtos
            </p>
          </div>
        </div>

        {info.fatura_aberta && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-amber-900">
              <strong>Fatura em aberto:</strong> {brl(info.fatura_aberta.valor)} · vence {fmtData(info.fatura_aberta.vencimento)}
            </div>
            <button type="button"
              onClick={() => setCheckoutFatura({ id: info.fatura_aberta!.id, valor: info.fatura_aberta!.valor })}
              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-3.5 py-1.5 rounded-lg">
              Pagar agora <QrCode className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {checkoutFatura && (
        <PixCheckoutModal
          pizzariaId={pizzariaId}
          fatura={checkoutFatura}
          onClose={() => { setCheckoutFatura(null); load(); }}
          onPaid={load}
        />
      )}

      {/* Contratar / trocar plano */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 grid place-items-center">
            <CreditCard className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-bold text-slate-800">
              {info.tem_assinatura ? "Trocar de plano" : "Assinar um plano"}
            </h2>
            <p className="text-xs text-slate-500">
              Cobrança mensal automática via Asaas — pague com Pix, boleto ou cartão. A fatura também chega no seu e-mail.
            </p>
          </div>
        </div>

        {!info.billing_disponivel ? (
          <p className="mt-3 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            A cobrança automática ainda não está habilitada na plataforma. Fale com o suporte para ativar seu plano.
          </p>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              {info.planos.map((p) => {
                const atual = p.id === info.plano && info.tem_assinatura;
                const selecionado = planoEscolhido === p.id;
                return (
                  <button key={p.id} type="button" disabled={atual}
                    onClick={() => setPlanoEscolhido(selecionado ? null : p.id)}
                    className={`text-left rounded-xl border p-3.5 transition-colors disabled:opacity-60 ${
                      selecionado
                        ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
                        : "border-slate-200 hover:border-emerald-300 bg-white"
                    }`}>
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      {p.nome}
                      {atual && <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">atual</span>}
                    </p>
                    <p className="text-lg font-extrabold text-slate-900 mt-0.5">
                      {brl(p.preco_mensal)}<span className="text-xs font-medium text-slate-400">/mês</span>
                    </p>
                    <ul className="mt-1.5 text-[11px] text-slate-500 space-y-0.5">
                      <li>• {p.limites.conversas_mes} atendimentos/mês</li>
                      <li>• {p.limites.produtos} produtos no cardápio</li>
                      <li>• {p.limites.equipe} usuário(s) no painel</li>
                    </ul>
                  </button>
                );
              })}
            </div>

            {planoEscolhido && (
              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  Dados de cobrança (obrigatórios para emitir a fatura)
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">E-mail de cobrança</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="financeiro@suapizzaria.com"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-400" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600">CPF ou CNPJ</span>
                    <input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-400" />
                  </label>
                </div>
                <button type="button" onClick={contratar}
                  disabled={contratando || !email.trim() || cpfCnpj.replace(/\D/g, "").length < 11}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
                  {contratando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Assinar {info.planos.find((p) => p.id === planoEscolhido)?.nome} —{" "}
                  {brl(info.planos.find((p) => p.id === planoEscolhido)?.preco_mensal ?? 0)}/mês
                </button>
                <p className="text-[11px] text-slate-400">
                  O plano ativa (ou troca) assim que o primeiro pagamento confirmar.
                </p>
              </div>
            )}

            {msg && (
              <div className={`mt-3 text-sm px-3 py-2 rounded-lg border ${
                msg.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {msg.text}
              </div>
            )}
          </>
        )}
      </div>

      {/* Histórico de faturas */}
      <div id="faturas" className="bg-white border border-slate-200 rounded-2xl p-5">
        <h2 className="font-bold text-slate-800 mb-3">Faturas</h2>
        {info.faturas.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma fatura ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {info.faturas.map((f: FaturaInfo) => {
              const st = STATUS_FATURA[f.status] || STATUS_FATURA.pendente;
              return (
                <div key={f.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800">{brl(f.valor)}</span>
                    <span className="text-slate-400"> · venc. {fmtData(f.vencimento)}</span>
                    {f.pago_em && <span className="text-slate-400"> · pago em {fmtData(f.pago_em)}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    {f.link_pagamento && f.status !== "paga" && f.status !== "cancelada" && (
                      <a href={f.link_pagamento} target="_blank" rel="noopener noreferrer"
                        className="text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 text-xs font-semibold">
                        Pagar <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Checkout Pix branded (in-panel) — substitui a página hospedada do Asaas.
// Mostra o QR + copia-e-cola com a cara do PizzaBot; cartão/boleto seguem como
// fallback no link do Asaas. Confirma o pagamento por polling (webhook atualiza).
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
