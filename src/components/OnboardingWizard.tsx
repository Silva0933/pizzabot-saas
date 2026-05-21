import React, { useState } from "react";
import {
  Pizza,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Smartphone,
  Sparkles,
  Loader2,
  AlertTriangle,
  Building,
  LogOut
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface OnboardingWizardProps {
  userEmail: string;
  onComplete: () => void;
  onSignOut: () => void;
}

const SECRETARIA_WEBHOOK =
  import.meta.env.VITE_N8N_SECRETARIA_WEBHOOK_URL ||
  "https://n8nai.secretariaai.eu.cc/webhook/pizzabot-secretaria";

export function OnboardingWizard({ userEmail, onComplete, onSignOut }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: dados básicos
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [instance, setInstance] = useState("");

  // Step 2: criação Evolution
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [instanceCreated, setInstanceCreated] = useState(false);

  // Step 3: webhook config
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // Sanitize default instance from name on blur
  const ensureInstanceName = () => {
    if (instance) return;
    const slug = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "pizzaria";
    setInstance(`pizzabot-${slug}-${Math.floor(Math.random() * 900 + 100)}`);
  };

  // Step 2: cria instância no servidor Evolution
  const handleCreateInstance = async () => {
    setError(null);
    setCreatingInstance(true);
    const evoUrl = (import.meta.env.VITE_EVOLUTION_API_URL as string | undefined)?.replace(/\/$/, "");
    const evoKey = import.meta.env.VITE_EVOLUTION_API_KEY as string | undefined;

    if (!evoUrl || !evoKey) {
      setError("Variáveis VITE_EVOLUTION_API_URL e VITE_EVOLUTION_API_KEY não estão configuradas no .env do front.");
      setCreatingInstance(false);
      return;
    }

    try {
      const res = await fetch(`${evoUrl}/instance/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evoKey },
        body: JSON.stringify({
          instanceName: instance,
          qrcode: false,
          integration: "WHATSAPP-BAILEYS"
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 201) {
        setInstanceCreated(true);
      } else if (res.status === 409 || /already in use|exists/i.test(JSON.stringify(data))) {
        // Já existe — tudo bem
        setInstanceCreated(true);
      } else {
        setError(`Evolution retornou HTTP ${res.status}: ${data?.error || data?.message || "erro desconhecido"}`);
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao chamar Evolution API.");
    } finally {
      setCreatingInstance(false);
    }
  };

  // Step 3: configura webhook na instância Evolution apontando para /pizzabot-secretaria
  const handleConfigureWebhook = async () => {
    setError(null);
    setConfiguringWebhook(true);
    const evoUrl = (import.meta.env.VITE_EVOLUTION_API_URL as string | undefined)?.replace(/\/$/, "");
    const evoKey = import.meta.env.VITE_EVOLUTION_API_KEY as string | undefined;

    if (!evoUrl || !evoKey) {
      setError("Variáveis do Evolution não configuradas.");
      setConfiguringWebhook(false);
      return;
    }

    try {
      const res = await fetch(`${evoUrl}/webhook/set/${encodeURIComponent(instance)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evoKey },
        body: JSON.stringify({
          enabled: true,
          url: SECRETARIA_WEBHOOK,
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        })
      });
      if (res.ok) {
        setWebhookConfigured(true);
      } else {
        const d = await res.json().catch(() => ({}));
        // Mesmo em erro, tentar a forma alternativa /webhook/{instance}
        try {
          const alt = await fetch(`${evoUrl}/webhook/${encodeURIComponent(instance)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evoKey },
            body: JSON.stringify({
              url: SECRETARIA_WEBHOOK,
              events: ["messages.upsert"],
              webhook_by_events: false
            })
          });
          if (alt.ok) {
            setWebhookConfigured(true);
          } else {
            setError(`Evolution webhook set retornou HTTP ${res.status}: ${d?.message || ""}. Configure manualmente no Evolution.`);
          }
        } catch (e2) {
          setError(`Evolution webhook set retornou HTTP ${res.status}: ${d?.message || ""}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao configurar webhook.");
    } finally {
      setConfiguringWebhook(false);
    }
  };

  // Final: cria pizzaria no Supabase (via RPC)
  const handleFinalize = async () => {
    setError(null);
    setFinalizing(true);
    const { error: e } = await supabase.rpc("bootstrap_pizzeria", {
      p_nome: name.trim(),
      p_instancia: instance.trim() || null,
      p_telefone_admin: phone.trim() || null
    });
    setFinalizing(false);
    if (e) {
      setError(e.message);
      return;
    }
    onComplete();
  };

  const canAdvanceFromStep1 = name.trim().length >= 3 && instance.trim().length >= 3;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col" style={{ maxHeight: "92vh" }}>

        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-600 rounded-xl">
              <Pizza className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Bem-vindo ao PizzaBot</h1>
              <p className="text-xs text-slate-400">Vamos configurar sua pizzaria em 3 passos rápidos.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="p-1.5 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-1">
          {[
            { n: 1, label: "Dados da Pizzaria", icon: Building },
            { n: 2, label: "Preparar WhatsApp", icon: Smartphone },
            { n: 3, label: "Ativar mensagens", icon: Sparkles }
          ].map(({ n, label, icon: Icon }, idx) => (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-2 ${step >= n ? "text-orange-600" : "text-slate-400"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${step > n ? "bg-emerald-600 text-white" : step === n ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                  {step > n ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className="text-[11px] font-semibold hidden sm:block">{label}</span>
              </div>
              {idx < 2 && <div className={`flex-1 h-px ${step > n ? "bg-emerald-400" : "bg-slate-200"}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {step === 1 && (
            <>
              <div className="text-xs text-slate-500 mb-3">
                Identidade básica do estabelecimento. O nome aparece no painel e o identificador ajuda a manter cada pizzaria separada com segurança.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Nome da pizzaria *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={ensureInstanceName}
                  placeholder="Ex: Don Peppone Pizzaria"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-hidden focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Telefone admin para escalamento</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+55..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-hidden focus:border-orange-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">Receberá notificações urgentes (cliente pedindo humano).</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Identificador da conexão *</label>
                <input
                  type="text"
                  required
                  value={instance}
                  onChange={(e) => setInstance(e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase())}
                  placeholder="ex: pizzabot-don-peppone-001"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-hidden focus:border-orange-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">Use apenas letras minúsculas, números e hífens. Geramos um sufixo aleatório no campo Nome para evitar conflitos.</p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-xs text-slate-500 mb-3">
                Vamos preparar a conexão <code className="text-orange-600 font-mono">{instance}</code>. Depois a pizzaria só precisa escanear o QR Code pelo painel.
              </div>

              {!instanceCreated ? (
                <button
                  type="button"
                  onClick={handleCreateInstance}
                  disabled={creatingInstance}
                  className="w-full px-4 py-3 text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {creatingInstance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {creatingInstance ? "Preparando conexão..." : "Preparar conexão do WhatsApp"}
                </button>
              ) : (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Conexão <strong>{instance}</strong> preparada. Pode avançar.</span>
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg text-[11px] text-slate-500 leading-relaxed">
                <p className="font-semibold mb-1">Para o cliente final:</p>
                <p>Esta etapa deixa o WhatsApp pronto para ser conectado. Se algo falhar, o suporte consegue refazer a preparação sem mexer no cadastro da pizzaria.</p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="text-xs text-slate-500 mb-3">
                Por último, ativamos o recebimento automático das mensagens. Toda conversa do WhatsApp passará a aparecer no painel e no atendimento do bot.
              </div>

              {!webhookConfigured ? (
                <button
                  type="button"
                  onClick={handleConfigureWebhook}
                  disabled={configuringWebhook}
                  className="w-full px-4 py-3 text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {configuringWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {configuringWebhook ? "Ativando mensagens..." : "Ativar mensagens do bot"}
                </button>
              ) : (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Mensagens ativadas. Pronto para finalizar!</span>
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg text-[11px] text-slate-500 leading-relaxed">
                <p className="font-semibold mb-1">Suporte:</p>
                <p>Se o cliente não souber avançar, oriente a entrar em contato com o suporte para acompanhar a conexão e validar uma mensagem de teste.</p>
              </div>

              {webhookConfigured && (
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="w-full px-4 py-3 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2 mt-3"
                >
                  {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {finalizing ? "Criando workspace..." : "Finalizar e entrar no painel"}
                </button>
              )}
            </>
          )}

          {error && (
            <div className="p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
              <span>{error}</span>
            </div>
          )}

        </div>

        {/* Footer navigation */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-mono">{userEmail}</span>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Voltar
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                onClick={() => canAdvanceFromStep1 && setStep(2)}
                disabled={!canAdvanceFromStep1}
                className="px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
              >
                Avançar
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={() => instanceCreated && setStep(3)}
                disabled={!instanceCreated}
                className="px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
              >
                Avançar
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
