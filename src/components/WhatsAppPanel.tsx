import React, { useState, useEffect, useRef } from "react";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  QrCode,
  LogOut,
  AlertTriangle,
  Loader2,
  Plus,
  Info
} from "lucide-react";

type ConnectionState = "open" | "close" | "connecting" | "unknown";
type LoadingStep = "idle" | "criando" | "qr" | "verificando";

interface WhatsAppPanelProps {
  instanceName: string;
}

const EVOLUTION_URL = (import.meta.env.VITE_EVOLUTION_API_URL as string ?? "").replace(/\/$/, "");
const EVOLUTION_KEY = import.meta.env.VITE_EVOLUTION_API_KEY as string;

function evoHeaders() {
  return { "Content-Type": "application/json", apikey: EVOLUTION_KEY };
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return {}; }
}

export function WhatsAppPanel({ instanceName }: WhatsAppPanelProps) {
  const [state, setState]         = useState<ConnectionState>("unknown");
  const [qrBase64, setQrBase64]   = useState<string | null>(null);
  const [step, setStep]           = useState<LoadingStep>("idle");
  const [error, setError]         = useState<string | null>(null);
  const [phone, setPhone]         = useState<string | null>(null);
  const [instanceExists, setInstanceExists] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── helpers ───────────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  /** Check connection state. Returns "unknown" if instance doesn't exist yet. */
  const fetchState = async (): Promise<ConnectionState> => {
    try {
      const res = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instanceName}`, {
        headers: evoHeaders()
      });
      if (res.status === 404) { setInstanceExists(false); return "unknown"; }
      if (!res.ok) return "unknown";
      const data = await safeJson(res);
      setInstanceExists(true);
      // v1: data.instance.state  |  v2: data.state
      return (data?.instance?.state ?? data?.state ?? "unknown") as ConnectionState;
    } catch {
      return "unknown";
    }
  };

  /** Try to fetch ownerJid after connecting */
  const fetchPhone = async () => {
    try {
      const res = await fetch(
        `${EVOLUTION_URL}/instance/fetchInstances?instanceName=${instanceName}`,
        { headers: evoHeaders() }
      );
      const data = await safeJson(res);
      const inst = Array.isArray(data) ? data[0] : data;
      const jid =
        inst?.instance?.ownerJid ??
        inst?.ownerJid ??
        null;
      if (jid) setPhone(jid.split("@")[0]);
    } catch {}
  };

  /** Poll every 3 s until WhatsApp connects */
  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const s = await fetchState();
      setState(s);
      if (s === "open") {
        stopPolling();
        setQrBase64(null);
        setStep("idle");
        fetchPhone();
      }
    }, 3000);
  };

  // ─── Step 1: create instance if it doesn't exist ───────────────────────────

  const ensureInstance = async (): Promise<boolean> => {
    setStep("criando");
    try {
      const res = await fetch(`${EVOLUTION_URL}/instance/create`, {
        method: "POST",
        headers: evoHeaders(),
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS"
        })
      });

      // 409 = already exists → OK
      if (res.status === 409 || res.ok) {
        setInstanceExists(true);
        return true;
      }

      const data = await safeJson(res);
      const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
      throw new Error(`Não foi possível criar a instância: ${msg}`);
    } catch (e: any) {
      // If the error text says "already exists" or similar → it's fine
      const txt = (e.message ?? "").toLowerCase();
      if (txt.includes("already") || txt.includes("exist") || txt.includes("409")) {
        setInstanceExists(true);
        return true;
      }
      setError(e.message ?? "Erro ao criar instância.");
      setStep("idle");
      return false;
    }
  };

  // ─── Step 2: fetch QR code ──────────────────────────────────────────────────

  const fetchQR = async () => {
    setStep("qr");
    setQrBase64(null);
    try {
      const res = await fetch(`${EVOLUTION_URL}/instance/connect/${instanceName}`, {
        headers: evoHeaders()
      });

      if (!res.ok) {
        const data = await safeJson(res);
        const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(`Erro ao obter QR Code: ${msg}`);
      }

      const data = await safeJson(res);

      // Evolution returns base64 in several shapes across versions:
      // v1 text:  { code: "2@...", base64: "data:image/png;base64,..." }
      // v2 text:  { qrcode: { code: "2@...", base64: "..." } }
      // already connected: { instance: { state: "open" } }
      const alreadyOpen =
        (data?.instance?.state ?? data?.state) === "open";

      if (alreadyOpen) {
        setState("open");
        setStep("idle");
        fetchPhone();
        return;
      }

      const base64: string | null =
        data?.base64 ??
        data?.qrcode?.base64 ??
        data?.qrCode?.base64 ??
        null;

      if (!base64) {
        throw new Error(
          "QR Code não retornado. A instância pode já estar conectada — clique em 'Verificar Status'."
        );
      }

      setQrBase64(base64);
      setState("connecting");
      startPolling();
    } catch (e: any) {
      setError(e.message ?? "Erro desconhecido ao gerar QR Code.");
      setStep("idle");
    }
  };

  // ─── Main connect flow ──────────────────────────────────────────────────────

  const handleConnect = async () => {
    setError(null);

    // If we know the instance exists, skip creation
    if (!instanceExists) {
      const ok = await ensureInstance();
      if (!ok) return;
    }

    await fetchQR();
  };

  // ─── Disconnect ─────────────────────────────────────────────────────────────

  const handleDisconnect = async () => {
    if (!confirm("Deseja mesmo desconectar o WhatsApp desta instância?")) return;
    setStep("verificando");
    stopPolling();
    try {
      await fetch(`${EVOLUTION_URL}/instance/logout/${instanceName}`, {
        method: "DELETE",
        headers: evoHeaders()
      });
      setQrBase64(null);
      setPhone(null);
      setState("close");
    } catch {
      setError("Erro ao desconectar. Tente novamente.");
    } finally {
      setStep("idle");
    }
  };

  // ─── Initial check ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!EVOLUTION_URL || !instanceName) return;
    (async () => {
      setStep("verificando");
      const s = await fetchState();
      setState(s);
      setStep("idle");
      if (s === "open") fetchPhone();
    })();
    return stopPolling;
  }, [instanceName]);

  // ─── Missing env guard ──────────────────────────────────────────────────────

  if (!EVOLUTION_URL) {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-none mt-0.5" />
        <div className="text-xs text-amber-800 space-y-1">
          <p className="font-bold">Evolution API não configurada</p>
          <p>
            Adicione ao arquivo <strong>.env</strong> e reinicie o servidor:
          </p>
          <code className="block bg-amber-100 px-2 py-1 rounded font-mono text-[10px] whitespace-pre">
            {`VITE_EVOLUTION_API_URL=http://seu-servidor:8080\nVITE_EVOLUTION_API_KEY=sua_chave`}
          </code>
        </div>
      </div>
    );
  }

  if (!instanceName) {
    return (
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-xs text-slate-500">
        <Info className="w-3.5 h-3.5 flex-none" />
        Defina o campo <strong>Instância</strong> na tabela <code>pizzarias</code> do Supabase para ativar a conexão WhatsApp.
      </div>
    );
  }

  const isLoading = step !== "idle";
  const stepLabel: Record<LoadingStep, string> = {
    idle: "",
    criando: "Criando instância na Evolution API...",
    qr: "Gerando QR Code...",
    verificando: "Verificando status..."
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Status bar */}
      <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <div className="flex items-center gap-2.5">
          {state === "open" ? (
            <Wifi className="w-4 h-4 text-emerald-500" />
          ) : isLoading ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          ) : (
            <WifiOff className="w-4 h-4 text-slate-400" />
          )}
          <div>
            <p className="text-xs font-bold text-slate-800 font-sans">
              {state === "open"   ? "WhatsApp Conectado"        :
               state === "connecting" ? "Aguardando leitura do QR..." :
               isLoading         ? stepLabel[step]             :
               instanceExists === false ? "Instância não criada ainda" :
               "WhatsApp Desconectado"}
            </p>
            <p className="text-[10px] text-slate-400 font-mono">
              {phone ? `+${phone}` : `instância: ${instanceName}`}
            </p>
          </div>
        </div>

        <span className={`inline-flex items-center gap-1 text-[10px] font-bold font-mono uppercase ${
          state === "open" ? "text-emerald-600" :
          state === "connecting" ? "text-amber-500" : "text-slate-400"
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            state === "open"       ? "bg-emerald-400 animate-pulse" :
            state === "connecting" ? "bg-amber-400 animate-pulse"   : "bg-slate-300"
          }`} />
          {state === "open" ? "online" : state === "connecting" ? "aguardando" : "offline"}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-700">
          <XCircle className="w-3.5 h-3.5 flex-none mt-0.5" />
          <div className="space-y-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="underline text-[10px] text-red-500"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* QR Code */}
      {qrBase64 && state !== "open" && (
        <div className="flex flex-col items-center gap-3 p-5 bg-white border-2 border-dashed border-emerald-200 rounded-xl">
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <QrCode className="w-4 h-4 text-emerald-600" />
            Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
          </p>
          <div className="p-2 bg-white border border-slate-100 rounded-xl shadow inline-block">
            <img src={qrBase64} alt="QR Code" className="w-52 h-52 object-contain" />
          </div>
          <p className="text-[10px] text-slate-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
            Verificando automaticamente a cada 3 segundos...
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isLoading}
            className="text-[10px] text-slate-500 underline"
          >
            QR expirou? Clique para gerar novo
          </button>
        </div>
      )}

      {/* Connected */}
      {state === "open" && !qrBase64 && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-none" />
          <div>
            <p className="text-xs font-bold text-emerald-800">WhatsApp conectado com sucesso!</p>
            <p className="text-[10px] text-emerald-600 mt-0.5">
              O agente PizzaBot está ativo e recebendo mensagens.
              {phone && ` Número: +${phone}`}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {state !== "open" && (
          <button
            type="button"
            onClick={handleConnect}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors rounded-lg shadow-sm"
          >
            {isLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : instanceExists === false
              ? <Plus className="w-3.5 h-3.5" />
              : <QrCode className="w-3.5 h-3.5" />
            }
            {isLoading
              ? stepLabel[step]
              : qrBase64
              ? "Atualizar QR Code"
              : instanceExists === false
              ? "Criar instância e gerar QR"
              : "Gerar QR Code"}
          </button>
        )}

        {state === "open" && (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors rounded-lg"
          >
            <LogOut className="w-3.5 h-3.5" />
            Desconectar
          </button>
        )}

        <button
          type="button"
          onClick={async () => {
            setStep("verificando");
            const s = await fetchState();
            setState(s);
            setStep("idle");
            if (s === "open") fetchPhone();
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors rounded-lg"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${step === "verificando" ? "animate-spin" : ""}`} />
          Verificar Status
        </button>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        O QR Code expira em ~60 segundos. Se expirar, clique em "Atualizar QR Code".
        Após escanear, aguarde a confirmação automática.
      </p>
    </div>
  );
}
