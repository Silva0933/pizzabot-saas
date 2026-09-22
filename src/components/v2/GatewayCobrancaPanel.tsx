/**
 * Gateway de cobrança da plataforma — o Asaas que cobra as pizzarias.
 *
 * Não confundir com o Asaas de "Meu Negócio → Pagamento", que é o da pizzaria
 * cobrando o cliente final dela. Este é o seu, cobrando as assinaturas.
 *
 * Mesmo padrão da Evolution e do LLM: valor salvo no banco tem prioridade sobre
 * a variável de ambiente, o segredo volta mascarado, devolver a máscara
 * significa "não mexi", e salvar já testa a chave de verdade.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Save, Wifi } from "lucide-react";
import { adminApi, BillingConfigResp, BillingTeste } from "../../lib/api";

export function GatewayCobrancaPanel() {
  const [cfg, setCfg] = useState<BillingConfigResp | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<BillingTeste | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function carregar() {
    const d = await adminApi.billing();
    setCfg(d);
    setApiKey(d.api_key_mascarada);
    setWebhookToken(d.webhook_token_mascarado);
    setBaseUrl(d.base_url);
  }

  useEffect(() => {
    carregar().catch((e) => setErro(String(e?.message || e)));
  }, []);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setTeste(null);
    try {
      const r = await adminApi.salvarBilling({ api_key: apiKey, webhook_token: webhookToken, base_url: baseUrl });
      setTeste(r.teste);
      await carregar();
    } catch (e: any) {
      setErro(e?.message || "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setErro(null);
    try {
      setTeste(await adminApi.testarBilling());
    } catch (e: any) {
      setErro(e?.message || "Não consegui testar.");
    } finally {
      setTestando(false);
    }
  }

  async function limpar(campo: "api_key" | "webhook_token") {
    setSalvando(true);
    try {
      await adminApi.salvarBilling(
        campo === "api_key" ? { limpar_api_key: true } : { limpar_webhook_token: true },
      );
      await carregar();
      setTeste(null);
    } catch (e: any) {
      setErro(e?.message || "Não consegui limpar.");
    } finally {
      setSalvando(false);
    }
  }

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando gateway…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-orange-400" />
            Gateway de cobrança
          </h2>
          <p className="mt-1 text-[11px] text-slate-400 leading-relaxed max-w-xl">
            O Asaas que <strong>você</strong> usa para cobrar as assinaturas das pizzarias. Não é o
            mesmo de "Meu Negócio → Pagamento", que é o da pizzaria cobrando o cliente final dela.
          </p>
        </div>
        <Selo ok={cfg.configurada} />
      </div>

      {!cfg.configurada && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2.5 text-[11px] text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Sem chave, <strong>nenhuma pizzaria consegue assinar nem pagar</strong> — e a suspensão
            automática por inadimplência fica desligada de propósito, para não trancar a base
            inteira sem saída.
          </span>
        </div>
      )}

      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2.5 text-xs text-red-300">{erro}</div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Campo
          rotulo="Chave de API"
          ajuda="Asaas → Integrações → Chave de API"
          origem={cfg.origem.api_key}
          valor={apiKey}
          onChange={setApiKey}
          onLimpar={cfg.origem.api_key === "banco" ? () => limpar("api_key") : undefined}
        />
        <Campo
          rotulo="Token do webhook"
          ajuda="Asaas → Webhooks → Token de autenticação"
          origem={cfg.origem.webhook_token}
          valor={webhookToken}
          onChange={setWebhookToken}
          onLimpar={cfg.origem.webhook_token === "banco" ? () => limpar("webhook_token") : undefined}
        />
      </div>

      <label className="block">
        <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 mb-1">
          Ambiente <SeloOrigem origem={cfg.origem.base_url} />
        </span>
        <input
          list="asaas-urls"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#1e293b] bg-[#161f30] text-xs text-white outline-none focus:border-orange-500"
        />
        <datalist id="asaas-urls">
          {cfg.sugestoes_base_url.map((u) => <option key={u} value={u} />)}
        </datalist>
        <span className="block mt-1 text-[10px] text-slate-500">
          Produção: <code>api.asaas.com</code> · Testes: <code>api-sandbox.asaas.com</code>
        </span>
      </label>

      <div>
        <span className="block text-[11px] font-semibold text-slate-400 mb-1">
          URL para cadastrar no Asaas (Webhooks)
        </span>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 rounded-lg bg-[#161f30] border border-[#1e293b] text-[11px] text-slate-200 break-all">
            {cfg.webhook_url}
          </code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(cfg.webhook_url);
                setCopiado(true);
                window.setTimeout(() => setCopiado(false), 1800);
              } catch { /* sem clipboard: a URL continua visível pra copiar à mão */ }
            }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1e293b] bg-[#161f30] text-[11px] font-semibold text-slate-300 hover:text-white hover:border-orange-500"
          >
            {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {teste && (
        <div
          className={`rounded-xl border px-3 py-2.5 text-[11px] ${
            teste.ok
              ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300"
              : "border-red-500/30 bg-red-950/40 text-red-300"
          }`}
        >
          {teste.ok ? (
            <>
              Conectado a <strong>{teste.conta?.nome || "conta Asaas"}</strong>
              {teste.conta?.cpf_cnpj ? ` (${teste.conta.cpf_cnpj})` : ""}.
              {teste.conta?.sandbox && (
                <strong className="text-amber-300"> Atenção: é a sandbox, não cobra de verdade.</strong>
              )}
            </>
          ) : (
            <>Falhou: {teste.erro}</>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={testar}
          disabled={testando || !cfg.configurada}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs font-semibold text-slate-300 hover:text-white hover:border-orange-500 disabled:opacity-40"
        >
          {testando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
          Testar conexão
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold disabled:opacity-40"
        >
          {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {salvando ? "Salvando…" : "Salvar e testar"}
        </button>
      </div>
    </section>
  );
}

function Selo({ ok }: { ok: boolean }) {
  return (
    <span
      className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold ${
        ok ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
           : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
      }`}
    >
      {ok ? "Configurado" : "Não configurado"}
    </span>
  );
}

/** De onde o valor em uso veio — evita o admin editar algo que não está valendo. */
function SeloOrigem({ origem }: { origem: string }) {
  if (origem === "banco") return <span className="text-[9px] text-emerald-400 font-normal">salvo aqui</span>;
  if (origem === "env") return <span className="text-[9px] text-sky-400 font-normal">vindo do ambiente</span>;
  return <span className="text-[9px] text-slate-500 font-normal">vazio</span>;
}

function Campo({
  rotulo, ajuda, valor, origem, onChange, onLimpar,
}: {
  rotulo: string;
  ajuda: string;
  valor: string;
  origem: string;
  onChange: (v: string) => void;
  onLimpar?: () => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 mb-1">
        {rotulo} <SeloOrigem origem={origem} />
        {onLimpar && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onLimpar(); }}
            className="ml-auto text-[10px] font-semibold text-slate-500 hover:text-red-400"
          >
            limpar
          </button>
        )}
      </span>
      <input
        type="text"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="$aact_..."
        className="w-full px-3 py-2 rounded-lg border border-[#1e293b] bg-[#161f30] text-xs text-white font-mono outline-none focus:border-orange-500"
      />
      <span className="block mt-1 text-[10px] text-slate-500">{ajuda}</span>
    </label>
  );
}
