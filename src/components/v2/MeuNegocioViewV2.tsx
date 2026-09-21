/**
 * "Meu Negócio" v2 — tabs: Atendente | Análise | Geral (config).
 *
 * Versão totalmente conectada ao backend Python.
 * - Atendente: reusa AttendantPage (já chama o backend)
 * - Análise: MetricasView
 * - Geral: formulário inline de config da pizzaria (substitui SettingsView)
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Bot, Settings as SettingsIcon, Sparkles, Save, Loader2,
  Store, Smartphone, CreditCard, Clock, X, QrCode, CheckCircle2,
  RefreshCw, Wifi, WifiOff, History, AlertTriangle, Trash2, Package,
  Bike, ChevronDown, Copy, ExternalLink,
} from "lucide-react";
import { AttendantPage } from "../AttendantPage";
import {
  BackendPizzaria, BackendPedido, pizzariasApi, pedidosApi, conversasApi, WhatsAppConnect,
  MP_WEBHOOK_URL,
} from "../../lib/api";

export type NegocioTab = "atendente" | "geral";

interface Props {
  pizzaria: BackendPizzaria;
  onUpdated: (p: BackendPizzaria) => void;
  initialTab?: NegocioTab;
  openWhatsApp?: boolean;
  onWhatsAppOpened?: () => void;
  openPayment?: boolean;
  onPaymentOpened?: () => void;
}

export function MeuNegocioViewV2({
  pizzaria,
  onUpdated,
  initialTab = "atendente",
  openWhatsApp = false,
  onWhatsAppOpened,
  openPayment = false,
  onPaymentOpened,
}: Props) {
  const [tab, setTab] = useState<NegocioTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (openWhatsApp || openPayment) {
      setTab("geral");
    }
  }, [openWhatsApp, openPayment]);

  return (
    <div className="pb-24 md:pb-6">
      <div className="bg-[#0b0e14]/90 backdrop-blur-md border-b border-[#1e293b] px-4 md:px-8 sticky top-[57px] z-10">
        <div className="flex gap-2 -mb-px overflow-x-auto">
          <TabButton active={tab === "atendente"} onClick={() => setTab("atendente")}
            icon={<Bot className="w-4 h-4"/>} label="Atendente"
            badge={<Sparkles className="w-3 h-3 text-orange-500"/>}/>
          <TabButton active={tab === "geral"} onClick={() => setTab("geral")}
            icon={<SettingsIcon className="w-4 h-4"/>} label="Geral"/>
        </div>
      </div>

      {tab === "atendente" && <AttendantPage pizzariaId={pizzaria.id} />}
      {tab === "geral"     && (
        <ConfigGeral
          pizzaria={pizzaria}
          onUpdated={onUpdated}
          openWhatsApp={openWhatsApp}
          onWhatsAppOpened={onWhatsAppOpened}
          openPayment={openPayment}
          onPaymentOpened={onPaymentOpened}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, badge }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
        active ? "border-orange-500 text-orange-400" : "border-transparent text-slate-400 hover:text-slate-200"
      }`}>
      {icon}{label}{badge}
    </button>
  );
}

// ============================================
function ConfigAccordion({
  id,
  icon,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    }
  }, [defaultOpen]);

  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-[#1e293b] bg-[#111622] shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="flex w-full items-center gap-3.5 p-4 md:p-5 text-left transition hover:bg-[#161f30]/40">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">{icon}</span>
        <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-white">{title}</strong><small className="mt-0.5 block text-xs leading-relaxed text-slate-400">{description}</small></span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180 text-orange-400" : ""}`} />
      </button>
      {open && <div className="border-t border-[#1e293b] p-4 md:p-5 space-y-4">{children}</div>}
    </section>
  );
}
// Aba: Geral — config da pizzaria
// ============================================
function ConfigGeral({
  pizzaria,
  onUpdated,
  openWhatsApp = false,
  onWhatsAppOpened,
  openPayment = false,
  onPaymentOpened,
}: {
  pizzaria: BackendPizzaria;
  onUpdated: (p: BackendPizzaria) => void;
  openWhatsApp?: boolean;
  onWhatsAppOpened?: () => void;
  openPayment?: boolean;
  onPaymentOpened?: () => void;
}) {
  const [form, setForm] = useState<Partial<BackendPizzaria>>(pizzaria);

  useEffect(() => {
    if (openWhatsApp) {
      setTimeout(() => {
        const el = document.getElementById("secao-atendimento-automacao");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [openWhatsApp]);

  useEffect(() => {
    if (openPayment) {
      setTimeout(() => {
        const el = document.getElementById("secao-meios-recebimento") || document.getElementById("secao-cardapio-pagamentos");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        onPaymentOpened?.();
      }, 100);
    }
  }, [openPayment, onPaymentOpened]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function setField<K extends keyof BackendPizzaria>(k: K, v: BackendPizzaria[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await pizzariasApi.update(pizzaria.id, form);
      onUpdated(r);
      setSavedAt(Date.now());
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Configurações do negócio</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gerencie os dados da <strong className="text-slate-200">sua pizzaria, endereço</strong>, imagem e funcionamento.
          </p>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          {err}
        </div>
      )}

      {/* Row 1: 2-Column Grid (Identidade + Horário de funcionamento) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Coluna 1: Identidade */}
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Identidade</h3>
                <p className="text-xs text-slate-400 mt-0.5">Dados da pizzaria, endereço, imagem e funcionamento.</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 rotate-180 text-orange-400" />
          </div>

          <div className="pt-2 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="NOME DA PIZZARIA *" required>
                <input value={form.nome ?? ""} onChange={(e) => setField("nome", e.target.value)} className={inputCls}/>
              </Field>
              <Field label="WHATSAPP DE ATENDIMENTO (BOTÃO DO CARDÁPIO DIGITAL)">
                <input value={form.telefone_contato ?? ""} onChange={(e) => setField("telefone_contato", e.target.value)}
                  placeholder="Ex: 11999999999" className={inputCls}/>
              </Field>
            </div>
            <Field label="TELEFONE ADMIN (WHATSAPP PESSOAL DO DONO)" full>
              <input value={form.telefone_admin ?? ""} onChange={(e) => setField("telefone_admin", e.target.value)}
                placeholder="Ex: 11999999999" className={inputCls}/>
            </Field>
            <Field label="ENDEREÇO" full>
              <input value={form.endereco ?? ""} onChange={(e) => setField("endereco", e.target.value)} className={inputCls}/>
            </Field>
            <Field label="LINK DO GOOGLE MAPS (ENVIADO QUANDO O CLIENTE PERGUNTA O ENDEREÇO OU ESCOLHE RETIRADA)" full>
              <input value={form.endereco_maps_url ?? ""} onChange={(e) => setField("endereco_maps_url", e.target.value)}
                placeholder="https://maps.app.goo.gl/..." className={inputCls}/>
            </Field>
            <Field label="URL DO LOGO" full>
              <input value={form.logo_url ?? ""} onChange={(e) => setField("logo_url", e.target.value)} className={inputCls}/>
            </Field>
            <Field label="URL DO BANNER DO CARDÁPIO DIGITAL (IMAGEM LARGA DO TOPO — EX.: FOTO DA PIZZARIA/PROMOÇÃO)" full>
              <input value={form.banner_url ?? ""} onChange={(e) => setField("banner_url", e.target.value)}
                placeholder="https://... (recomendado 1600×500px)" className={inputCls}/>
            </Field>
          </div>
        </div>

        {/* Coluna 2: Horário de funcionamento */}
        <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Horário de funcionamento</h3>
                <p className="text-xs text-slate-400 mt-0.5">Dias e faixas de atendimento da pizzaria.</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 rotate-180 text-orange-400" />
          </div>

          <div className="pt-2">
            <HorarioFuncionamento
              horarios={(form.horario_funcionamento as any) || {}}
              onChange={(h) => setField("horario_funcionamento", h as any)}
              msgFora={(form.mensagens_status as any)?.fora_horario ?? ""}
              onMsgFora={(t) => setField("mensagens_status", { ...(form.mensagens_status as any || {}), fora_horario: t } as any)}
            />
          </div>
        </div>
      </div>

      {/* Rows 2 & 3: 2-Column Grid de Accordions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Atendimento e automação */}
        <ConfigAccordion
          id="secao-atendimento-automacao"
          icon={<Smartphone className="w-4 h-4" />}
          title="Atendimento e automação"
          description="WhatsApp, conexão da instância e ativação do bot."
          defaultOpen={openWhatsApp}
        >
          <div className="space-y-3">
            <WhatsAppCard
              pizzaria={pizzaria}
              autoOpen={openWhatsApp}
              onOpened={onWhatsAppOpened}
            />
            
            <Card icon={<Smartphone className="w-4 h-4" />} title="Instância / Bot Global" accent="emerald">
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Instância Evolution">
                  <input value={form.instancia ?? ""} onChange={(e) => setField("instancia", e.target.value)} className={inputCls}/>
                </Field>
                <label className="flex items-center gap-2.5 text-xs text-slate-300 mt-6 cursor-pointer">
                  <input type="checkbox" checked={form.bot_ativo_global ?? false}
                    onChange={(e) => setField("bot_ativo_global", e.target.checked)}
                    className="w-4 h-4 accent-orange-500 rounded"/>
                  Bot ativo globalmente
                </label>
              </div>
            </Card>
          </div>
        </ConfigAccordion>

        {/* Meios de Pagamento e Cobrança */}
        <ConfigAccordion
          id="secao-cardapio-pagamentos"
          icon={<CreditCard className="w-4 h-4" />}
          title="Meios de Pagamento & Cobrança"
          description="Pix próprio, cartões e gateway de cobrança online."
          defaultOpen={openPayment}
        >
          <div className="space-y-3">
            <div id="secao-meios-recebimento">
              <Card icon={<CreditCard className="w-4 h-4" />} title="Meios de Recebimento" accent="violet">
                <div className="space-y-3">
                  <Field label="Pagamento na conversa (Como receber no WhatsApp e Cardápio)">
                    <select value={form.modo_pagamento_online ?? "automatico"}
                      onChange={(e) => setField("modo_pagamento_online", e.target.value)} className={inputCls}>
                      <option value="automatico">Automático — cobrança pelo provedor (Mercado Pago / Asaas)</option>
                      <option value="manual">Manual — Pix próprio (você confere o comprovante)</option>
                      <option value="desativado">Desativado — só na entrega/retirada</option>
                    </select>
                  </Field>

                  {(form.modo_pagamento_online ?? "automatico") === "automatico" && (
                    <div className="grid md:grid-cols-2 gap-3">
                      <Field label="Gateway">
                        <select value={form.gateway_pagamento ?? "mercadopago"}
                          onChange={(e) => setField("gateway_pagamento", e.target.value)} className={inputCls}>
                          <option value="mercadopago">Mercado Pago</option>
                          <option value="asaas">Asaas</option>
                        </select>
                      </Field>
                      <Field label="MP access token">
                        <input type="password" value={form.mp_access_token ?? ""} onChange={(e) => setField("mp_access_token", e.target.value)} className={inputCls}/>
                      </Field>
                      <Field label="Asaas API key" full>
                        <input type="password" value={form.asaas_api_key ?? ""} onChange={(e) => setField("asaas_api_key", e.target.value)} className={inputCls}/>
                      </Field>
                      {(form.gateway_pagamento ?? "mercadopago") === "mercadopago" && (
                        <>
                          <Field label="MP assinatura secreta do webhook (opcional)" full>
                            <input type="password" value={form.mp_webhook_secret ?? ""}
                              onChange={(e) => setField("mp_webhook_secret", e.target.value)}
                              placeholder="Cole a chave secreta gerada no painel do Mercado Pago"
                              className={inputCls}/>
                          </Field>
                          <div className="md:col-span-2 text-xs text-slate-400 space-y-1">
                            <p>
                              A confirmação automática do pedido já funciona só com o token — a URL de
                              aviso vai junto em cada cobrança. Cadastrar o webhook no Mercado Pago é
                              opcional e serve para gerar a chave secreta acima, que permite verificar
                              que a notificação veio mesmo deles.
                            </p>
                            <p>
                              Em <strong>Suas integrações → sua aplicação → Webhooks</strong>, use esta
                              URL e marque o evento <strong>Pagamentos</strong>:
                            </p>
                            <code className="block bg-slate-800/60 rounded px-2 py-1 break-all text-slate-200">
                              {MP_WEBHOOK_URL}
                            </code>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {(form.modo_pagamento_online ?? "automatico") === "manual" && (
                    <div className="space-y-3">
                      <Field label="Pix copia-e-cola (a atendente envia este código pro cliente pagar)" full>
                        <textarea value={form.pix_manual_copia_cola ?? ""}
                          onChange={(e) => setField("pix_manual_copia_cola", e.target.value)}
                          placeholder="Cole aqui o seu código Pix copia-e-cola (gerado no app do seu banco)"
                          rows={3} className={inputCls}/>
                      </Field>
                      <Field label="Nome do recebedor (opcional — aparece como 'em nome de …')">
                        <input value={form.pix_manual_titular ?? ""} onChange={(e) => setField("pix_manual_titular", e.target.value)} className={inputCls}/>
                      </Field>
                      <p className="text-xs text-slate-400">
                        A atendente envia o código automaticamente e pede o comprovante. Você confere e
                        confirma o pagamento no card do pedido.
                      </p>
                    </div>
                  )}

                  {(form.modo_pagamento_online ?? "automatico") === "desativado" && (
                    <p className="text-xs text-slate-400">
                      A atendente <strong>não oferece pagamento online</strong>: o cliente paga só na
                      entrega ou retirada (dinheiro/cartão).
                    </p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </ConfigAccordion>

        {/* Logística e entregas */}
        <ConfigAccordion icon={<Bike className="w-4 h-4" />} title="Logística e entregas" description="Configure acesso da equipe, prazos e taxas de delivery.">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 ml-1">Logística & Entregas</h3>

            <EntregadorAccessCard />

            <Card icon={<Clock className="w-4 h-4" />} title="Tempos de preparo e rota (minutos)" accent="sky">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Delivery mín">
                  <input type="number" value={form.tempo_entrega_min ?? 30}
                    onChange={(e) => setField("tempo_entrega_min", Number(e.target.value))} className={inputCls}/>
                </Field>
                <Field label="Delivery máx">
                  <input type="number" value={form.tempo_entrega_max ?? 60}
                    onChange={(e) => setField("tempo_entrega_max", Number(e.target.value))} className={inputCls}/>
                </Field>
                <Field label="Retirada mín">
                  <input type="number" value={form.tempo_retirada_min ?? 15}
                    onChange={(e) => setField("tempo_retirada_min", Number(e.target.value))} className={inputCls}/>
                </Field>
                <Field label="Retirada máx">
                  <input type="number" value={form.tempo_retirada_max ?? 25}
                    onChange={(e) => setField("tempo_retirada_max", Number(e.target.value))} className={inputCls}/>
                </Field>
              </div>
            </Card>

            <Card icon={<CreditCard className="w-4 h-4" />} title="Taxas de entrega" accent="amber">
              <div className="space-y-3">
                <Field label="Taxa fixa padrão (R$) — usada quando o bairro não está na tabela abaixo">
                  <input type="number" step="0.01" min="0"
                    value={form.taxa_entrega_fixa ?? ""}
                    onChange={(e) => setField("taxa_entrega_fixa", Number(e.target.value))} className={inputCls}/>
                </Field>
                <p className="text-xs text-slate-400">
                  Cadastre as taxas por bairro em formato tabela (se preferir por distância,
                  use o campo de raio nas opções avançadas).
                </p>
              </div>
            </Card>
          </div>
        </ConfigAccordion>

        {/* Área sensível */}
        <ConfigAccordion icon={<AlertTriangle className="w-4 h-4" />} title="Área sensível" description="Ações administrativas que exigem atenção.">
          <ZonaPerigo pizzariaId={pizzaria.id} />
        </ConfigAccordion>
      </div>

      {/* Sticky Bottom Bar */}
      <div className="sticky bottom-0 bg-[#0b0e14]/90 backdrop-blur-md border-t border-[#1e293b] -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-6 py-4 flex items-center justify-between z-10">
        <p className="text-xs text-slate-400">
          As mudanças entram em vigor na próxima conversa nova.
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-orange-500/20"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : "Salvar alterações"}
          {savedAt && Date.now() - savedAt < 2500 && <span className="text-xs text-orange-200">✓ salvo</span>}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Card: acesso da equipe de entregadores
// ============================================
function EntregadorAccessCard() {
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${baseUrl}/entregador`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o link da área do entregador:", link);
    }
  }

  return (
    <div className="rounded-2xl border border-sky-900/40 bg-[#161f30]/60 p-5 shadow-sm space-y-3.5">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
          <Bike className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Área do entregador</p>
          <p className="text-xs text-sky-300/80">
            Envie este link para cada entregador acessar com o próprio e-mail e senha.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-[#0b0e14] p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 select-all truncate font-mono text-xs text-slate-300">
          {link}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 sm:flex-none"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copiado!" : "Copiar"}
          </button>
          <a
            href="/entregador"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 sm:flex-none"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir
          </a>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        O acesso é individual e usa as credenciais criadas na aba <strong>Entregadores</strong>.
        Para testar sem sair do painel do dono, abra o link em uma janela anônima ou em outro dispositivo.
      </p>
    </div>
  );
}

// ============================================
// Card de conexão WhatsApp (status + QR)
// ============================================
function WhatsAppCard({
  pizzaria,
  autoOpen = false,
  onOpened,
}: {
  pizzaria: BackendPizzaria;
  autoOpen?: boolean;
  onOpened?: () => void;
}) {
  const [state, setState] = useState<string>("loading");
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<WhatsAppConnect | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [qrErr, setQrErr] = useState<string | null>(null);

  const conectado = state === "open";

  async function loadStatus() {
    try {
      const st = await pizzariasApi.whatsappStatus(pizzaria.id);
      setState(st.state);
    } catch { setState("close"); }
  }
  useEffect(() => { loadStatus(); /* eslint-disable-next-line */ }, [pizzaria.id]);

  async function openConnect() {
    setOpen(true); setQr(null); setQrErr(null); setLoadingQr(true);
    try {
      const res = await pizzariasApi.whatsappConectar(pizzaria.id);
      setQr(res); setState(res.state);
    } catch (e: any) { setQrErr(e.message || "Erro ao conectar."); }
    setLoadingQr(false);
  }
  async function refreshQr() {
    setLoadingQr(true); setQrErr(null);
    try {
      const res = await pizzariasApi.whatsappQrcode(pizzaria.id);
      setQr(res); setState(res.state);
    } catch (e: any) { setQrErr(e.message || "Erro ao gerar QR."); }
    setLoadingQr(false);
  }

  useEffect(() => {
    if (autoOpen) {
      openConnect();
      onOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  // Polling enquanto o modal está aberto e não conectou
  useEffect(() => {
    if (!open || conectado) return;
    const t = setInterval(loadStatus, 3500);
    const q = setInterval(refreshQr, 28000);
    return () => { clearInterval(t); clearInterval(q); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conectado]);

  return (
    <div className={`rounded-2xl p-5 border shadow-sm flex items-center gap-4 ${
      conectado ? "bg-[#161f30]/60 border-emerald-900/40" : "bg-[#161f30]/60 border-amber-900/40"
    }`}>
      <div className={`w-12 h-12 rounded-xl grid place-items-center text-white shrink-0 ${
        conectado ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
      }`}>
        {conectado ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
          WhatsApp
          {state === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </p>
        <p className={`text-xs ${conectado ? "text-emerald-400" : "text-amber-400"}`}>
          {state === "loading" ? "Verificando conexão…"
            : conectado ? "Conectado e recebendo mensagens"
            : "Desconectado — escaneie o QR para ativar"}
        </p>
      </div>
      <button onClick={openConnect}
        className={`px-4 py-2 rounded-xl text-sm font-semibold shrink-0 flex items-center gap-1.5 transition-colors ${
          conectado ? "bg-[#111622] hover:bg-slate-800 text-slate-200 border border-slate-700" : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
        }`}>
        <QrCode className="w-4 h-4" />
        {conectado ? "Reconectar" : "Conectar"}
      </button>

      {/* Modal QR */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setOpen(false)}>
          <div className="bg-[#111622] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="relative px-5 py-4 bg-[#161f30] border-b border-[#1e293b] text-white">
              <button onClick={() => setOpen(false)} className="absolute right-3 top-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e293b] transition-colors">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 grid place-items-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base leading-tight text-white">Conectar WhatsApp</h3>
                  <p className="text-xs text-slate-400 truncate">{pizzaria.nome}</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              {conectado ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 grid place-items-center mx-auto mb-3">
                    <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                  </div>
                  <p className="font-semibold text-white">WhatsApp conectado!</p>
                  <button onClick={() => setOpen(false)} className="mt-5 px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold">Concluir</button>
                </div>
              ) : qrErr ? (
                <div className="text-center py-6">
                  <WifiOff className="w-10 h-10 text-red-400 mx-auto mb-3" />
                  <p className="text-sm text-red-400 font-medium">{qrErr}</p>
                  <button onClick={openConnect} className="mt-4 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium inline-flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4" /> Tentar de novo
                  </button>
                </div>
              ) : (
                <>
                  <ol className="text-xs text-slate-400 space-y-1 mb-3 list-decimal list-inside">
                    <li>Abra o WhatsApp no celular da pizzaria</li>
                    <li>Toque em <strong>Aparelhos conectados → Conectar</strong></li>
                    <li>Aponte a câmera para o QR Code</li>
                  </ol>
                  <div className="aspect-square w-full max-w-[260px] mx-auto rounded-2xl border-2 border-dashed border-[#1e293b] grid place-items-center overflow-hidden bg-white p-3 shadow-inner">
                    {loadingQr && !qr?.qrcode?.base64 ? (
                      <div className="text-center text-slate-500">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-orange-500" />
                        <p className="text-xs">Gerando QR Code…</p>
                      </div>
                    ) : qr?.qrcode?.base64 ? (
                      <img src={qr.qrcode.base64.startsWith("data:") ? qr.qrcode.base64 : `data:image/png;base64,${qr.qrcode.base64}`}
                        alt="QR Code" className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-center text-slate-500 px-4">
                        <QrCode className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-xs">QR indisponível. Gere novamente.</p>
                      </div>
                    )}
                  </div>
                  {qr?.qrcode?.pairingCode && (
                    <p className="text-center text-xs text-slate-400 mt-3">Ou código: <span className="font-mono font-bold text-orange-400">{qr.qrcode.pairingCode}</span></p>
                  )}
                  <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-slate-400">
                    <Wifi className="w-3.5 h-3.5 animate-pulse text-emerald-400" /> Aguardando leitura…
                  </div>
                  <button onClick={refreshQr} disabled={loadingQr}
                    className="mt-3 w-full px-4 py-2 text-sm text-slate-300 hover:bg-[#1e293b] hover:text-white rounded-xl font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors border border-[#1e293b]">
                    {loadingQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Gerar novo QR
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Aba: Histórico — todos os pedidos
// ============================================
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  novo:       { label: "Novo",       cls: "bg-blue-500/15 border border-blue-500/30 text-blue-400" },
  confirmado: { label: "Confirmado", cls: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400" },
  no_forno:   { label: "No forno",   cls: "bg-amber-500/15 border border-amber-500/30 text-amber-400" },
  a_caminho:  { label: "A caminho",  cls: "bg-purple-500/15 border border-purple-500/30 text-purple-400" },
  entregue:   { label: "Entregue",   cls: "bg-slate-800 border border-slate-700 text-slate-300" },
  cancelado:  { label: "Cancelado",  cls: "bg-rose-500/15 border border-rose-500/30 text-rose-400" },
};
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export { HistoricoPedidos } from "./HistoricoPedidos";

// ============================================
// Horário de funcionamento (por dia + msg fora do horário)
// ============================================
const DIAS_SEMANA: Array<{ key: string; label: string }> = [
  { key: "seg", label: "Segunda" },
  { key: "ter", label: "Terça" },
  { key: "qua", label: "Quarta" },
  { key: "qui", label: "Quinta" },
  { key: "sex", label: "Sexta" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
];

interface DiaHorario { abre?: string; fecha?: string; fechado?: boolean }

function HorarioFuncionamento({
  horarios, onChange, msgFora, onMsgFora,
}: {
  horarios: Record<string, DiaHorario | string>;
  onChange: (h: Record<string, DiaHorario>) => void;
  msgFora: string;
  onMsgFora: (t: string) => void;
}) {
  useEffect(() => {
    const temEstrutura = DIAS_SEMANA.some((d) => horarios[d.key] && typeof horarios[d.key] === "object");
    if (!temEstrutura) {
      const base: Record<string, DiaHorario> = {};
      for (const d of DIAS_SEMANA) base[d.key] = { abre: "18:00", fecha: "23:00", fechado: false };
      onChange(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getDia(key: string): DiaHorario {
    const v = horarios[key];
    if (v && typeof v === "object") return v as DiaHorario;
    return { abre: "18:00", fecha: "23:00", fechado: false };
  }
  function setDia(key: string, patch: Partial<DiaHorario>) {
    const base: Record<string, DiaHorario> = {};
    for (const d of DIAS_SEMANA) base[d.key] = getDia(d.key);
    base[key] = { ...base[key], ...patch };
    onChange(base);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {DIAS_SEMANA.map((d) => {
          const dia = getDia(d.key);
          const fechado = !!dia.fechado;
          return (
            <div key={d.key} className="flex items-center gap-3 flex-wrap">
              <span className="w-20 text-sm text-slate-200 font-medium">{d.label}</span>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer w-24">
                <input type="checkbox" checked={!fechado}
                  onChange={(e) => setDia(d.key, { fechado: !e.target.checked })}
                  className="w-4 h-4 accent-orange-500 rounded" />
                {fechado ? "Fechado" : "Aberto"}
              </label>
              <input type="time" value={dia.abre ?? "18:00"} disabled={fechado}
                onChange={(e) => setDia(d.key, { abre: e.target.value })}
                className={`px-3 py-1.5 bg-[#111622] border border-slate-800 rounded-xl text-sm text-slate-100 w-28 outline-none focus:border-orange-500 ${fechado ? "opacity-30" : ""}`} />
              <span className="text-slate-500 text-xs">às</span>
              <input type="time" value={dia.fecha ?? "23:00"} disabled={fechado}
                onChange={(e) => setDia(d.key, { fecha: e.target.value })}
                className={`px-3 py-1.5 bg-[#111622] border border-slate-800 rounded-xl text-sm text-slate-100 w-28 outline-none focus:border-orange-500 ${fechado ? "opacity-30" : ""}`} />
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">
        Dica: para virar a madrugada use, por exemplo, 18:00 às 02:00.
      </p>
      <Field label="Mensagem fora do horário (a atendente envia uma única vez quando fechado)" full>
        <textarea rows={3} value={msgFora}
          onChange={(e) => onMsgFora(e.target.value)}
          placeholder="Ex.: Olá! No momento estamos fechados 😴. Funcionamos de seg a sáb, das 18h às 23h. Volte mais tarde!"
          className={inputCls} />
      </Field>
    </div>
  );
}

// ============================================
// Zona de perigo — apagar conversas / pedidos
// ============================================
function ZonaPerigo({ pizzariaId }: { pizzariaId: string }) {
  const [confirm, setConfirm] = useState<null | "conversas" | "pedidos">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!confirm) return;
    setBusy(true);
    setMsg(null);
    try {
      if (confirm === "conversas") {
        const r = await conversasApi.limparTodas(pizzariaId);
        setMsg(`${r.conversas_deletadas} conversa(s) apagada(s).`);
      } else {
        const r = await pedidosApi.apagarTodos(pizzariaId);
        setMsg(`${r.pedidos_deletados} pedido(s) apagado(s).`);
      }
      setConfirm(null);
    } catch (e: any) { setMsg(e.message || "Erro ao apagar."); }
    setBusy(false);
  }

  return (
    <section className="bg-[#161f30]/60 border border-red-900/40 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-red-400 mb-1 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center bg-red-500/15 text-red-400"><AlertTriangle className="w-4 h-4" /></span>
        Zona de perigo
      </h3>
      <p className="text-xs text-slate-400 mb-4">Ações irreversíveis. Apagam dados do painel e do banco de dados.</p>

      <div className="grid sm:grid-cols-2 gap-3.5">
        <div className="border border-slate-800 bg-[#111622] rounded-xl p-4">
          <p className="text-sm font-semibold text-white">Apagar todas as conversas</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">Conversas, mensagens e filas do bot.</p>
          <button onClick={() => { setConfirm("conversas"); setMsg(null); }}
            className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 inline-flex items-center gap-1.5 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Apagar conversas
          </button>
        </div>
        <div className="border border-slate-800 bg-[#111622] rounded-xl p-4">
          <p className="text-sm font-semibold text-white">Apagar todos os pedidos</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">Remove pedidos do painel e do servidor.</p>
          <button onClick={() => { setConfirm("pedidos"); setMsg(null); }}
            className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 inline-flex items-center gap-1.5 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Apagar pedidos
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-slate-300 mt-3.5 bg-[#111622] border border-slate-800 rounded-xl px-3.5 py-2.5">{msg}</p>}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !busy && setConfirm(null)}>
          <div className="bg-[#111622] border border-slate-800 text-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3.5 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 grid place-items-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Apagar {confirm === "conversas" ? "todas as conversas" : "todos os pedidos"}?
                </h3>
                <p className="text-sm text-slate-400 mt-0.5">Esta ação é permanente e irreversível.</p>
              </div>
            </div>
            <div className="flex gap-2.5 justify-end mt-5">
              <button onClick={() => setConfirm(null)} disabled={busy}
                className="px-4 py-2 text-sm font-medium text-slate-300 bg-[#161f30] hover:bg-slate-800 border border-slate-700 rounded-xl">
                Cancelar
              </button>
              <button onClick={run} disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl flex items-center gap-2 disabled:opacity-60 shadow-sm">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                <Trash2 className="w-4 h-4" /> Sim, apagar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================
// Helpers visuais
// ============================================
const ACCENTS: Record<string, string> = {
  orange: "bg-orange-500/15 border border-orange-500/30 text-orange-400",
  emerald: "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400",
  violet: "bg-purple-500/15 border border-purple-500/30 text-purple-400",
  sky: "bg-sky-500/15 border border-sky-500/30 text-sky-400",
  amber: "bg-amber-500/15 border border-amber-500/30 text-amber-400",
};

type TaxaBairro = { bairro: string; taxa: number };

function TaxasBairroEditor({ taxas, onChange }: { taxas: TaxaBairro[]; onChange: (t: TaxaBairro[]) => void }) {
  const lista = Array.isArray(taxas) ? taxas : [];
  function update(i: number, patch: Partial<TaxaBairro>) {
    onChange(lista.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function add() { onChange([...lista, { bairro: "", taxa: 0 }]); }
  function remove(i: number) { onChange(lista.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-semibold">Tabela por bairro</span>
        <button type="button" onClick={add}
          className="text-xs px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 font-semibold transition-colors">
          + Bairro
        </button>
      </div>
      {lista.length === 0 && (
        <p className="text-xs text-slate-500 italic">Sem bairros cadastrados. A atendente usa a taxa fixa acima.</p>
      )}
      {lista.map((t, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={t.bairro} placeholder="Bairro"
            onChange={(e) => update(i, { bairro: e.target.value })}
            className={inputCls + " flex-1"}/>
          <div className="relative w-32">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">R$</span>
            <input type="number" step="0.01" min="0" value={t.taxa}
              onChange={(e) => update(i, { taxa: Number(e.target.value) })}
              className={inputCls + " pl-8"}/>
          </div>
          <button type="button" onClick={() => remove(i)}
            className="p-2 text-slate-500 hover:text-red-400 transition-colors" title="Remover">
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      ))}
    </div>
  );
}

function Card({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: keyof typeof ACCENTS | string; children: React.ReactNode }) {
  return (
    <section className="bg-[#161f30]/60 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-xl grid place-items-center ${ACCENTS[accent] || ACCENTS.orange}`}>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls = "w-full px-3.5 py-2.5 bg-[#111622] border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 outline-none transition";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}{required && " *"}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
