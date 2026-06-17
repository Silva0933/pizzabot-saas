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
} from "lucide-react";
import { AttendantPage } from "../AttendantPage";
import {
  BackendPizzaria, BackendPedido, pizzariasApi, pedidosApi, conversasApi, WhatsAppConnect,
} from "../../lib/api";

export type NegocioTab = "atendente" | "geral" | "historico";

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
          <TabButton active={tab === "historico"} onClick={() => setTab("historico")}
            icon={<History className="w-4 h-4"/>} label="Histórico"/>
          <TabButton active={tab === "geral"} onClick={() => setTab("geral")}
            icon={<SettingsIcon className="w-4 h-4"/>} label="Geral"/>
        </div>
      </div>

      {tab === "atendente" && <AttendantPage pizzariaId={pizzaria.id} />}
      {tab === "historico" && <HistoricoPedidos pizzaria={pizzaria} />}
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
      {/* 1. Identidade e Horários */}
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
          <Field label="Link do Google Maps (enviado quando o cliente pergunta o endereço ou escolhe retirada)" full>
            <input value={form.endereco_maps_url ?? ""} onChange={(e) => setField("endereco_maps_url", e.target.value)}
              placeholder="https://maps.app.goo.gl/..." className={inputCls}/>
          </Field>
          <Field label="URL do logo" full>
            <input value={form.logo_url ?? ""} onChange={(e) => setField("logo_url", e.target.value)} className={inputCls}/>
          </Field>
        </div>
      </Card>

      <Card icon={<Clock className="w-4 h-4" />} title="Horário de funcionamento" accent="emerald">
        <HorarioFuncionamento
          horarios={(form.horario_funcionamento as any) || {}}
          onChange={(h) => setField("horario_funcionamento", h as any)}
          msgFora={(form.mensagens_status as any)?.fora_horario ?? ""}
          onMsgFora={(t) => setField("mensagens_status", { ...(form.mensagens_status as any || {}), fora_horario: t } as any)}
        />
      </Card>

      {/* 2. WhatsApp & Bot de Atendimento */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-800 ml-1">Atendimento (WhatsApp / IA)</h3>
        <WhatsAppCard pizzaria={pizzaria} />
        
        <Card icon={<Smartphone className="w-4 h-4" />} title="Instância / Bot Global" accent="emerald">
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
      </div>

      {/* 3. Cardápio Digital & Pagamentos */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-800 ml-1">Cardápio & Pagamentos</h3>
        <CardapioDigitalCard pizzaria={pizzaria} onUpdated={onUpdated} />
        
        <Card icon={<Package className="w-4 h-4" />} title="Adicionais & Bordas" accent="violet">
          <p className="text-xs text-slate-500 mb-2">Bordas recheadas e extras que a atendente pode oferecer. Aplicam-se a qualquer pizza.</p>
          <AdicionaisEditor
            adicionais={(form.adicionais as any) || []}
            onChange={(a) => setField("adicionais", a as any)}
          />
        </Card>

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
                <p className="text-xs text-slate-500">
                  A atendente envia o código automaticamente e pede o comprovante. Você confere e
                  confirma o pagamento no card do pedido.
                </p>
              </div>
            )}

            {(form.modo_pagamento_online ?? "automatico") === "desativado" && (
              <p className="text-xs text-slate-500">
                A atendente <strong>não oferece pagamento online</strong>: o cliente paga só na
                entrega ou retirada (dinheiro/cartão).
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* 4. Logística (Delivery/Retirada) */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-800 ml-1">Logística & Entregas</h3>
        
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
                placeholder="ex: 7.00"
                onChange={(e) => setField("taxa_entrega_fixa", e.target.value === "" ? null : Number(e.target.value))}
                className={inputCls}/>
            </Field>
            <TaxasBairroEditor
              taxas={(form.taxas_bairro as any) || []}
              onChange={(t) => setField("taxas_bairro", t as any)}
            />
          </div>
        </Card>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

      <ZonaPerigo pizzariaId={pizzaria.id} />

      <div className="sticky bottom-2 flex justify-end">
        <button onClick={save} disabled={saving}
          className="px-5 py-2.5 bg-brand-gradient hover:brightness-105 text-white rounded-xl flex items-center gap-2 text-sm font-semibold shadow-brand disabled:opacity-50 transition-all">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
          Salvar alterações
          {savedAt && Date.now() - savedAt < 2500 && <span className="text-xs opacity-80">✓ salvo</span>}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Card: Cardápio Digital (link público)
// ============================================
function CardapioDigitalCard({ pizzaria, onUpdated }: { pizzaria: BackendPizzaria; onUpdated: (p: BackendPizzaria) => void }) {
  const slug = pizzaria.slug || "";
  const [editing, setEditing] = useState(false);
  const [newSlug, setNewSlug] = useState(slug);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const link = slug ? `${baseUrl}/m/${slug}` : "";

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function saveSlug() {
    if (!newSlug.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await pizzariasApi.update(pizzaria.id, { slug: newSlug.trim() } as any);
      onUpdated(r);
      setEditing(false);
    } catch (e: any) {
      setErr(e.message || "Erro ao salvar slug");
    }
    setSaving(false);
  }

  if (!slug) return (
    <div className="rounded-2xl p-4 border border-dashed border-slate-300 bg-slate-50 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-orange-400 to-amber-500 text-white shrink-0">
        <Store className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">Cardápio Digital</p>
        <p className="text-xs text-slate-500">Salve as alterações de nome para gerar o link do seu cardápio público.</p>
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl p-4 border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50/80 shadow-sm space-y-3">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-orange-500 to-amber-500 text-white shrink-0">
          <Store className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Cardápio Digital</p>
          <p className="text-xs text-orange-700/80">Link público para seus clientes fazerem pedidos</p>
        </div>
      </div>

      {/* Link e ações */}
      <div className="bg-white rounded-xl border border-orange-200/60 p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0 text-sm font-mono text-slate-700 truncate select-all">
          {link}
        </div>
        <button onClick={copyLink} title="Copiar link"
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors">
          {copied ? "✓ Copiado!" : "📋 Copiar"}
        </button>
        <a href={`/m/${slug}`} target="_blank" rel="noopener noreferrer"
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">
          Abrir ↗
        </a>
      </div>

      {/* Editar slug */}
      {editing ? (
        <div className="flex gap-2 items-center">
          <span className="text-xs text-slate-500 whitespace-nowrap">{baseUrl}/m/</span>
          <input value={newSlug} onChange={e => setNewSlug(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-orange-300 rounded-lg text-sm focus:border-orange-500 outline-none"
            placeholder="minha-pizzaria" />
          <button onClick={saveSlug} disabled={saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
            {saving ? "..." : "Salvar"}
          </button>
          <button onClick={() => { setEditing(false); setErr(null); }}
            className="text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
        </div>
      ) : (
        <button onClick={() => { setNewSlug(slug); setEditing(true); setErr(null); }}
          className="text-xs text-orange-600 hover:text-orange-800 font-medium">
          ✏️ Editar link do cardápio
        </button>
      )}

      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

      <p className="text-[11px] text-slate-500 leading-snug">
        💡 Divulgue este link nos seus anúncios, Instagram e panfletos. Seus clientes podem pedir direto pelo celular sem instalar nada.
      </p>
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
// Aba: Histórico — todos os pedidos
// ============================================
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  novo:       { label: "Novo",       cls: "bg-blue-100 text-blue-700" },
  confirmado: { label: "Confirmado", cls: "bg-emerald-100 text-emerald-700" },
  no_forno:   { label: "No forno",   cls: "bg-amber-100 text-amber-700" },
  a_caminho:  { label: "A caminho",  cls: "bg-violet-100 text-violet-700" },
  entregue:   { label: "Entregue",   cls: "bg-slate-200 text-slate-600" },
  cancelado:  { label: "Cancelado",  cls: "bg-rose-100 text-rose-700" },
};
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function HistoricoPedidos({ pizzaria }: { pizzaria: BackendPizzaria }) {
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>("todos");

  function load() {
    setLoading(true);
    pedidosApi.list(pizzaria.id, { limit: 500 })
      .then(setPedidos)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [pizzaria.id]);

  const filtrados = useMemo(
    () => (filtro === "todos" ? pedidos : pedidos.filter((p) => p.status === filtro)),
    [pedidos, filtro],
  );
  const totalFaturado = useMemo(
    () => pedidos.filter((p) => p.status !== "cancelado").reduce((s, p) => s + Number(p.valor_total || 0), 0),
    [pedidos],
  );

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-orange-500"/></div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white grid place-items-center shadow-sm">
          <History className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-slate-800">Histórico de pedidos</h2>
          <p className="text-sm text-slate-500">
            {pedidos.length} pedido{pedidos.length === 1 ? "" : "s"} no total · {brl(totalFaturado)} faturado
          </p>
        </div>
        <button onClick={load} className="ml-auto p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Atualizar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{err}</div>}

      <div className="flex gap-1.5 flex-wrap">
        {["todos", "novo", "confirmado", "no_forno", "a_caminho", "entregue", "cancelado"].map((s) => (
          <button key={s} onClick={() => setFiltro(s)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              filtro === s ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}>
            {s === "todos" ? "Todos" : STATUS_LABEL[s]?.label || s}
          </button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-50 grid place-items-center mx-auto mb-3">
            <Package className="w-7 h-7 text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-600">Nenhum pedido</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
          {filtrados.map((p) => {
            const st = STATUS_LABEL[p.status] || { label: p.status, cls: "bg-slate-100 text-slate-600" };
            return (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60">
                <span className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 grid place-items-center font-bold text-xs shrink-0">
                  #{p.numero_pedido ?? "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {p.cliente?.nome || p.cliente?.telefone || "Cliente"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(p.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{(p.itens || []).length} {(p.itens || []).length === 1 ? "item" : "itens"}
                  </p>
                </div>
                {typeof p.nps_nota === "number" && (
                  <span title={p.nps_comentario || undefined}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      p.nps_nota >= 9 ? "bg-emerald-100 text-emerald-700"
                      : p.nps_nota >= 7 ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"}`}>
                    ⭐ {p.nps_nota}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls} shrink-0`}>{st.label}</span>
                <span className="text-sm font-bold text-emerald-600 shrink-0 w-24 text-right">{brl(p.valor_total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  // Inicializa os 7 dias se ainda não houver config estruturada — assim o que
  // aparece na tela é exatamente o que será salvo (antes ficava vazio até mexer).
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        {DIAS_SEMANA.map((d) => {
          const dia = getDia(d.key);
          const fechado = !!dia.fechado;
          return (
            <div key={d.key} className="flex items-center gap-2 flex-wrap">
              <span className="w-20 text-sm text-slate-700 font-medium">{d.label}</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer w-24">
                <input type="checkbox" checked={!fechado}
                  onChange={(e) => setDia(d.key, { fechado: !e.target.checked })}
                  className="w-4 h-4 accent-emerald-500" />
                {fechado ? "Fechado" : "Aberto"}
              </label>
              <input type="time" value={dia.abre ?? "18:00"} disabled={fechado}
                onChange={(e) => setDia(d.key, { abre: e.target.value })}
                className={`px-2 py-1 border border-slate-200 rounded-lg text-sm w-28 outline-none focus:border-emerald-400 ${fechado ? "opacity-40" : ""}`} />
              <span className="text-slate-400 text-xs">às</span>
              <input type="time" value={dia.fecha ?? "23:00"} disabled={fechado}
                onChange={(e) => setDia(d.key, { fecha: e.target.value })}
                className={`px-2 py-1 border border-slate-200 rounded-lg text-sm w-28 outline-none focus:border-emerald-400 ${fechado ? "opacity-40" : ""}`} />
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
    <section className="bg-white border border-red-200 rounded-2xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center bg-red-100 text-red-600"><AlertTriangle className="w-4 h-4" /></span>
        Zona de perigo
      </h3>
      <p className="text-xs text-slate-500 mb-3.5">Ações irreversíveis. Apagam dados do painel e do banco de dados.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="border border-slate-200 rounded-xl p-3">
          <p className="text-sm font-medium text-slate-700">Apagar todas as conversas</p>
          <p className="text-xs text-slate-400 mt-0.5 mb-2.5">Conversas, mensagens e filas do bot.</p>
          <button onClick={() => { setConfirm("conversas"); setMsg(null); }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 inline-flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Apagar conversas
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl p-3">
          <p className="text-sm font-medium text-slate-700">Apagar todos os pedidos</p>
          <p className="text-xs text-slate-400 mt-0.5 mb-2.5">Remove pedidos do painel e do servidor.</p>
          <button onClick={() => { setConfirm("pedidos"); setMsg(null); }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 inline-flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Apagar pedidos
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-slate-600 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{msg}</p>}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => !busy && setConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-red-100 grid place-items-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  Apagar {confirm === "conversas" ? "todas as conversas" : "todos os pedidos"}?
                </h3>
                <p className="text-sm text-slate-500">Esta ação é permanente e irreversível.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setConfirm(null)} disabled={busy}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg">
                Cancelar
              </button>
              <button onClick={run} disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2 disabled:opacity-60">
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
  orange: "bg-orange-100 text-orange-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  sky: "bg-sky-100 text-sky-600",
  amber: "bg-amber-100 text-amber-600",
};

type Adicional = { nome: string; preco: number; tipo?: string };

function AdicionaisEditor({ adicionais, onChange }: { adicionais: Adicional[]; onChange: (a: Adicional[]) => void }) {
  const lista = Array.isArray(adicionais) ? adicionais : [];
  function update(i: number, patch: Partial<Adicional>) {
    onChange(lista.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function add() { onChange([...lista, { nome: "", preco: 0, tipo: "borda" }]); }
  function remove(i: number) { onChange(lista.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 font-medium">Lista</span>
        <button type="button" onClick={add}
          className="text-xs px-2.5 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 font-medium">
          + Adicional
        </button>
      </div>
      {lista.length === 0 && <p className="text-xs text-slate-400">Nenhum adicional. A atendente não vai oferecer bordas/extras.</p>}
      {lista.map((t, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={t.nome} placeholder="Ex: Borda Catupiry"
            onChange={(e) => update(i, { nome: e.target.value })}
            className={inputCls + " flex-1"}/>
          <select value={t.tipo || "borda"} onChange={(e) => update(i, { tipo: e.target.value })}
            className={inputCls + " w-24"}>
            <option value="borda">Borda</option>
            <option value="adicional">Adicional</option>
          </select>
          <div className="relative w-24">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
            <input type="number" step="0.01" min="0" value={t.preco}
              onChange={(e) => update(i, { preco: Number(e.target.value) })}
              className={inputCls + " pl-7"}/>
          </div>
          <button type="button" onClick={() => remove(i)}
            className="p-2 text-slate-400 hover:text-red-500" title="Remover">
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      ))}
    </div>
  );
}

type TaxaBairro = { bairro: string; taxa: number };

function TaxasBairroEditor({ taxas, onChange }: { taxas: TaxaBairro[]; onChange: (t: TaxaBairro[]) => void }) {
  const lista = Array.isArray(taxas) ? taxas : [];
  function update(i: number, patch: Partial<TaxaBairro>) {
    onChange(lista.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function add() { onChange([...lista, { bairro: "", taxa: 0 }]); }
  function remove(i: number) { onChange(lista.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 font-medium">Tabela por bairro</span>
        <button type="button" onClick={add}
          className="text-xs px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium">
          + Bairro
        </button>
      </div>
      {lista.length === 0 && (
        <p className="text-xs text-slate-400">Sem bairros cadastrados. A atendente usa a taxa fixa acima.</p>
      )}
      {lista.map((t, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={t.bairro} placeholder="Bairro"
            onChange={(e) => update(i, { bairro: e.target.value })}
            className={inputCls + " flex-1"}/>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
            <input type="number" step="0.01" min="0" value={t.taxa}
              onChange={(e) => update(i, { taxa: Number(e.target.value) })}
              className={inputCls + " pl-7"}/>
          </div>
          <button type="button" onClick={() => remove(i)}
            className="p-2 text-slate-400 hover:text-red-500" title="Remover">
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      ))}
    </div>
  );
}

function Card({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: keyof typeof ACCENTS | string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-2xl p-4 shadow-card">
      <h3 className="text-sm font-bold text-ink mb-3.5 flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-xl grid place-items-center ${ACCENTS[accent] || ACCENTS.orange}`}>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls = "w-full px-3 py-2 bg-surface border border-line rounded-xl text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">{label}{required && " *"}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
