/**
 * "Meu Negócio" v2 — tabs: Atendente | Análise | Geral (config).
 *
 * Versão totalmente conectada ao backend Python.
 * - Atendente: reusa AttendantPage (já chama o backend)
 * - Análise: MetricasView
 * - Geral: formulário inline de config da pizzaria (substitui SettingsView)
 */
import React, { useEffect, useState } from "react";
import {
  Bot, Settings as SettingsIcon, Sparkles, TrendingUp, Save, Loader2,
  Store, Smartphone, CreditCard, Clock, X, QrCode, CheckCircle2,
  RefreshCw, Wifi, WifiOff,
} from "lucide-react";
import { AttendantPage } from "../AttendantPage";
import { MetricasView } from "./MetricasView";
import { BackendPizzaria, pizzariasApi, WhatsAppConnect } from "../../lib/api";

export type NegocioTab = "atendente" | "geral" | "analise";

interface Props {
  pizzaria: BackendPizzaria;
  onUpdated: (p: BackendPizzaria) => void;
  initialTab?: NegocioTab;
}

export function MeuNegocioViewV2({ pizzaria, onUpdated, initialTab = "atendente" }: Props) {
  const [tab, setTab] = useState<NegocioTab>(initialTab);

  return (
    <div className="pb-24 md:pb-6">
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 sticky top-[57px] z-10">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          <TabButton active={tab === "atendente"} onClick={() => setTab("atendente")}
            icon={<Bot className="w-4 h-4"/>} label="Atendente"
            badge={<Sparkles className="w-3 h-3 text-orange-500"/>}/>
          <TabButton active={tab === "analise"} onClick={() => setTab("analise")}
            icon={<TrendingUp className="w-4 h-4"/>} label="Análise"/>
          <TabButton active={tab === "geral"} onClick={() => setTab("geral")}
            icon={<SettingsIcon className="w-4 h-4"/>} label="Geral"/>
        </div>
      </div>

      {tab === "atendente" && <AttendantPage pizzariaId={pizzaria.id} />}
      {tab === "analise"   && <MetricasView pizzariaId={pizzaria.id} />}
      {tab === "geral"     && <ConfigGeral pizzaria={pizzaria} onUpdated={onUpdated} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, badge }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}>
      {icon}{label}{badge}
    </button>
  );
}

// ============================================
// Aba: Geral — config da pizzaria
// ============================================
function ConfigGeral({ pizzaria, onUpdated }: { pizzaria: BackendPizzaria; onUpdated: (p: BackendPizzaria) => void; }) {
  const [form, setForm] = useState<Partial<BackendPizzaria>>(pizzaria);
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
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Conexão do WhatsApp */}
      <WhatsAppCard pizzaria={pizzaria} />

      <Card icon={<Store className="w-4 h-4" />} title="Identidade" accent="orange">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Nome da pizzaria" required>
            <input value={form.nome ?? ""} onChange={(e) => setField("nome", e.target.value)} className={inputCls}/>
          </Field>
          <Field label="Telefone admin (WhatsApp do dono)">
            <input value={form.telefone_admin ?? ""} onChange={(e) => setField("telefone_admin", e.target.value)} className={inputCls}/>
          </Field>
          <Field label="Endereço" full>
            <input value={form.endereco ?? ""} onChange={(e) => setField("endereco", e.target.value)} className={inputCls}/>
          </Field>
          <Field label="URL do logo" full>
            <input value={form.logo_url ?? ""} onChange={(e) => setField("logo_url", e.target.value)} className={inputCls}/>
          </Field>
        </div>
      </Card>

      <Card icon={<Smartphone className="w-4 h-4" />} title="WhatsApp / Bot" accent="emerald">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Instância Evolution">
            <input value={form.instancia ?? ""} onChange={(e) => setField("instancia", e.target.value)} className={inputCls}/>
          </Field>
          <label className="flex items-center gap-2.5 text-sm text-slate-700 mt-6 cursor-pointer">
            <input type="checkbox" checked={form.bot_ativo_global ?? false}
              onChange={(e) => setField("bot_ativo_global", e.target.checked)}
              className="w-4 h-4 accent-orange-500"/>
            Bot ativo globalmente
          </label>
        </div>
      </Card>

      <Card icon={<CreditCard className="w-4 h-4" />} title="Pagamentos" accent="violet">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Gateway">
            <select value={form.gateway_pagamento ?? "mercadopago"}
              onChange={(e) => setField("gateway_pagamento", e.target.value)} className={inputCls}>
              <option value="mercadopago">Mercado Pago</option>
              <option value="asaas">Asaas</option>
              <option value="manual">Manual (sem cobrança automática)</option>
            </select>
          </Field>
          <Field label="MP access token">
            <input type="password" value={form.mp_access_token ?? ""} onChange={(e) => setField("mp_access_token", e.target.value)} className={inputCls}/>
          </Field>
          <Field label="Asaas API key" full>
            <input type="password" value={form.asaas_api_key ?? ""} onChange={(e) => setField("asaas_api_key", e.target.value)} className={inputCls}/>
          </Field>
        </div>
      </Card>

      <Card icon={<Clock className="w-4 h-4" />} title="Tempos de entrega (minutos)" accent="sky">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Delivery mín">
            <input type="number" value={form.tempo_entrega_min ?? 30}
              onChange={(e) => setField("tempo_entrega_min", Number(e.target.value))} className={inputCls}/>
          </Field>
          <Field label="Delivery máx">
            <input type="number" value={form.tempo_entrega_max ?? 60}
              onChange={(e) => setField("tempo_entrega_max", Number(e.target.value))} className={inputCls}/>
          </Field>
        </div>
      </Card>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

      <div className="sticky bottom-2 flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 text-white rounded-xl flex items-center gap-2 text-sm font-medium shadow-lg shadow-orange-500/20 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
          Salvar alterações
          {savedAt && Date.now() - savedAt < 2500 && <span className="text-xs opacity-80">✓ salvo</span>}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Card de conexão WhatsApp (status + QR)
// ============================================
function WhatsAppCard({ pizzaria }: { pizzaria: BackendPizzaria }) {
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

  // Polling enquanto o modal está aberto e não conectou
  useEffect(() => {
    if (!open || conectado) return;
    const t = setInterval(loadStatus, 3500);
    const q = setInterval(refreshQr, 28000);
    return () => { clearInterval(t); clearInterval(q); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conectado]);

  return (
    <div className={`rounded-2xl p-4 border shadow-sm flex items-center gap-4 ${
      conectado ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200" : "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200"
    }`}>
      <div className={`w-12 h-12 rounded-xl grid place-items-center text-white shrink-0 ${conectado ? "bg-gradient-to-br from-emerald-500 to-teal-500" : "bg-gradient-to-br from-amber-500 to-orange-500"}`}>
        {conectado ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          WhatsApp
          {state === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </p>
        <p className={`text-xs ${conectado ? "text-emerald-700" : "text-amber-700"}`}>
          {state === "loading" ? "Verificando conexão…"
            : conectado ? "Conectado e recebendo mensagens"
            : "Desconectado — escaneie o QR para ativar"}
        </p>
      </div>
      <button onClick={openConnect}
        className={`px-3.5 py-2 rounded-xl text-sm font-medium text-white shrink-0 flex items-center gap-1.5 ${conectado ? "bg-slate-700 hover:bg-slate-800" : "bg-emerald-500 hover:bg-emerald-600"}`}>
        <QrCode className="w-4 h-4" />
        {conectado ? "Reconectar" : "Conectar"}
      </button>

      {/* Modal QR */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="relative px-5 py-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white">
              <button onClick={() => setOpen(false)} className="absolute right-3 top-3 p-1.5 rounded-lg hover:bg-white/20">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 grid place-items-center"><Smartphone className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base leading-tight">Conectar WhatsApp</h3>
                  <p className="text-xs text-white/80 truncate">{pizzaria.nome}</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              {conectado ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-3">
                    <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                  </div>
                  <p className="font-semibold text-slate-800">WhatsApp conectado!</p>
                  <button onClick={() => setOpen(false)} className="mt-5 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium">Concluir</button>
                </div>
              ) : qrErr ? (
                <div className="text-center py-6">
                  <WifiOff className="w-10 h-10 text-red-500 mx-auto mb-3" />
                  <p className="text-sm text-red-600 font-medium">{qrErr}</p>
                  <button onClick={openConnect} className="mt-4 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium inline-flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4" /> Tentar de novo
                  </button>
                </div>
              ) : (
                <>
                  <ol className="text-xs text-slate-500 space-y-0.5 mb-3 list-decimal list-inside">
                    <li>Abra o WhatsApp no celular da pizzaria</li>
                    <li>Toque em <strong>Aparelhos conectados → Conectar</strong></li>
                    <li>Aponte a câmera para o QR Code</li>
                  </ol>
                  <div className="aspect-square w-full max-w-[260px] mx-auto rounded-xl border-2 border-dashed border-slate-200 grid place-items-center overflow-hidden bg-slate-50">
                    {loadingQr && !qr?.qrcode?.base64 ? (
                      <div className="text-center text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        <p className="text-xs">Gerando QR Code…</p>
                      </div>
                    ) : qr?.qrcode?.base64 ? (
                      <img src={qr.qrcode.base64.startsWith("data:") ? qr.qrcode.base64 : `data:image/png;base64,${qr.qrcode.base64}`}
                        alt="QR Code" className="w-full h-full object-contain p-2" />
                    ) : (
                      <div className="text-center text-slate-400 px-4">
                        <QrCode className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-xs">QR indisponível. Gere novamente.</p>
                      </div>
                    )}
                  </div>
                  {qr?.qrcode?.pairingCode && (
                    <p className="text-center text-xs text-slate-500 mt-3">Ou código: <span className="font-mono font-bold text-slate-700">{qr.qrcode.pairingCode}</span></p>
                  )}
                  <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-slate-400">
                    <Wifi className="w-3.5 h-3.5 animate-pulse" /> Aguardando leitura…
                  </div>
                  <button onClick={refreshQr} disabled={loadingQr}
                    className="mt-3 w-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
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
// Helpers visuais
// ============================================
const ACCENTS: Record<string, string> = {
  orange: "bg-orange-100 text-orange-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  sky: "bg-sky-100 text-sky-600",
};

function Card({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: keyof typeof ACCENTS | string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3.5 flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg grid place-items-center ${ACCENTS[accent] || ACCENTS.orange}`}>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
