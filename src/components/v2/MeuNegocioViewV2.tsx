/**
 * "Meu Negócio" v2 — tabs: Atendente | Análise | Geral (config).
 *
 * Versão totalmente conectada ao backend Python.
 * - Atendente: reusa AttendantPage (já chama o backend)
 * - Análise: MetricasView
 * - Geral: formulário inline de config da pizzaria (substitui SettingsView)
 */
import React, { useState } from "react";
import { Bot, Settings as SettingsIcon, Sparkles, TrendingUp, Save, Loader2 } from "lucide-react";
import { AttendantPage } from "../AttendantPage";
import { MetricasView } from "./MetricasView";
import { BackendPizzaria, pizzariasApi } from "../../lib/api";

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
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? "border-orange-500 text-orange-700" : "border-transparent text-slate-500 hover:text-slate-700"
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
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Identidade</h3>
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
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">WhatsApp / Bot</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Instância Evolution">
            <input value={form.instancia ?? ""} onChange={(e) => setField("instancia", e.target.value)} className={inputCls}/>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 mt-5">
            <input type="checkbox" checked={form.bot_ativo_global ?? false}
              onChange={(e) => setField("bot_ativo_global", e.target.checked)}/>
            Bot ativo globalmente
          </label>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Pagamentos</h3>
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
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tempos de entrega (minutos)</h3>
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
      </section>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded">{err}</div>}

      <div className="sticky bottom-2 flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg flex items-center gap-2 text-sm font-medium shadow disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
          Salvar alterações
          {savedAt && Date.now() - savedAt < 2500 && <span className="text-xs opacity-80">✓ salvo</span>}
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
