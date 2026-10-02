/**
 * Conexão pela API OFICIAL do WhatsApp (Cloud API da Meta) — opção separada da
 * Evolution (QR Code). Três passos: credenciais (validadas na Meta), webhook
 * (a Meta precisa verificar a URL antes de ativar) e ativar. O modelo aprovado
 * cobre as mensagens fora da janela de 24 h (confirmação do cardápio, status).
 */
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Copy, Loader2, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { ApiOficialConfig, ApiOficialModelo, pizzariasApi } from "../../lib/api";

const inputCls = "w-full px-3 py-2 bg-surface border border-line rounded-xl text-sm text-ink placeholder-ink-subtle focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 outline-none transition";
const MODELO_SUGERIDO = "Olá, {{1}}! Novidade sobre o seu pedido: {{2}} Qualquer dúvida, é só responder esta mensagem.";

function Copiavel({ label, valor }: { label: string; valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <p className="text-[11px] text-ink-subtle mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-surface border border-line rounded-lg px-2.5 py-2 text-ink">{valor}</code>
        <button type="button" aria-label={`Copiar ${label}`}
          onClick={() => navigator.clipboard?.writeText(valor).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
          className="shrink-0 p-2 rounded-lg border border-line text-ink-muted hover:text-ink hover:bg-surface-elevated transition-colors">
          {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function Passo({ n, titulo, feito, children }: { n: number; titulo: string; feito?: boolean; children: ReactNode }) {
  return (
    <section className="border border-line rounded-xl p-3.5 space-y-3">
      <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
        <span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold ${
          feito ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400"}`}>
          {feito ? "✓" : n}
        </span>
        {titulo}
      </h4>
      {children}
    </section>
  );
}

export function WhatsAppApiOficial({ pizzariaId, onTipoMudou }: {
  pizzariaId: string;
  onTipoMudou?: (tipo: "qrcode" | "cloud_api") => void;
}) {
  const [cfg, setCfg] = useState<ApiOficialConfig | null>(null);
  const [form, setForm] = useState({ phone_number_id: "", waba_id: "", token: "", app_secret: "" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modelos, setModelos] = useState<ApiOficialModelo[] | null>(null);
  const [modeloSel, setModeloSel] = useState("");

  function aplicar(c: ApiOficialConfig) {
    setCfg(c);
    setForm((f) => ({ ...f, phone_number_id: c.phone_number_id, waba_id: c.waba_id, token: "", app_secret: "" }));
    setModeloSel(c.modelo_nome ? `${c.modelo_nome}|${c.modelo_idioma}` : "");
  }

  async function carregar() {
    try { aplicar(await pizzariasApi.apiOficial(pizzariaId)); } catch (e: any) { setErro(e.message); }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [pizzariaId]);

  // Esperando a Meta verificar o webhook: confere sozinho a cada 5 s.
  const aguardandoWebhook = !!cfg?.token_configurado && !cfg?.webhook_verificado_em;
  useEffect(() => {
    if (!aguardandoWebhook) return;
    const t = setInterval(async () => {
      try {
        const c = await pizzariasApi.apiOficial(pizzariaId);
        if (c.webhook_verificado_em) setCfg(c);
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 5000);
    return () => clearInterval(t);
  }, [aguardandoWebhook, pizzariaId]);

  async function executar(rotulo: string, fn: () => Promise<ApiOficialConfig>) {
    setOcupado(rotulo); setErro(null);
    try {
      const c = await fn();
      aplicar(c);
      onTipoMudou?.(c.tipo);
    } catch (e: any) { setErro(e.message || "Erro"); }
    setOcupado(null);
  }

  async function carregarModelos() {
    setOcupado("modelos"); setErro(null);
    try { setModelos(await pizzariasApi.apiOficialModelos(pizzariaId)); } catch (e: any) { setErro(e.message); }
    setOcupado(null);
  }

  if (!cfg) {
    return erro
      ? <p className="text-sm text-red-400">{erro}</p>
      : <div className="py-8 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>;
  }

  const salvo = cfg.token_configurado && cfg.app_secret_configurado && !!cfg.phone_number_id;
  const podeSalvar = form.phone_number_id.trim() && form.waba_id.trim()
    && (form.token.trim() || cfg.token_configurado) && (form.app_secret.trim() || cfg.app_secret_configurado);

  return (
    <div className="space-y-3 text-xs text-ink-muted">
      {cfg.ativa ? (
        <div className="flex items-start gap-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">API oficial ativa</p>
            <p>{cfg.numero_exibicao} {cfg.nome_verificado && `· ${cfg.nome_verificado}`}</p>
          </div>
        </div>
      ) : (
        <p>
          Conexão direta com a Meta, sem QR Code e sem risco de banimento. Você precisa de uma conta no
          Meta Business, um app com o produto WhatsApp e um número registrado na API. A Meta cobra por
          conversa iniciada pela loja.
        </p>
      )}

      <Passo n={1} titulo="Credenciais do app da Meta" feito={salvo}>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-ink-subtle">ID do número de telefone</span>
            <input className={inputCls} inputMode="numeric" value={form.phone_number_id}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} placeholder="Phone number ID" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-ink-subtle">ID da conta do WhatsApp Business</span>
            <input className={inputCls} inputMode="numeric" value={form.waba_id}
              onChange={(e) => setForm({ ...form, waba_id: e.target.value })} placeholder="WhatsApp Business Account ID" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[11px] text-ink-subtle">Token de acesso permanente (usuário do sistema)</span>
            <input className={inputCls} type="password" autoComplete="off" value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={cfg.token_configurado ? "•••••• salvo — preencha só para trocar" : "EAAG…"} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[11px] text-ink-subtle">Chave secreta do app (App Secret)</span>
            <input className={inputCls} type="password" autoComplete="off" value={form.app_secret}
              onChange={(e) => setForm({ ...form, app_secret: e.target.value })}
              placeholder={cfg.app_secret_configurado ? "•••••• salva — preencha só para trocar" : "Configurações do app → Básico"} />
          </label>
        </div>
        {salvo && cfg.numero_exibicao && (
          <p className="text-emerald-400">✓ Número {cfg.numero_exibicao}{cfg.nome_verificado && ` (${cfg.nome_verificado})`}
            {cfg.qualidade && ` · qualidade ${cfg.qualidade}`}</p>
        )}
        <button type="button" disabled={!podeSalvar || !!ocupado}
          onClick={() => executar("salvar", () => pizzariasApi.apiOficialSalvar(pizzariaId, {
            phone_number_id: form.phone_number_id, waba_id: form.waba_id,
            token: form.token || undefined, app_secret: form.app_secret || undefined,
          }))}
          className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {ocupado === "salvar" && <Loader2 className="w-4 h-4 animate-spin" />} Validar na Meta e salvar
        </button>
      </Passo>

      {salvo && (
        <Passo n={2} titulo="Webhook no app da Meta" feito={!!cfg.webhook_verificado_em}>
          <p>Em <strong>WhatsApp → Configuração → Webhook</strong>, cole os dois valores, clique em
            <strong> Verificar e salvar</strong> e assine o campo <strong>{cfg.webhook_campo}</strong>.</p>
          <Copiavel label="URL de callback" valor={cfg.webhook_url} />
          <Copiavel label="Token de verificação" valor={cfg.verify_token} />
          {cfg.webhook_verificado_em
            ? <p className="text-emerald-400">✓ A Meta verificou o webhook.</p>
            : <p className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando a verificação da Meta…</p>}
        </Passo>
      )}

      {salvo && (
        <Passo n={3} titulo={cfg.ativa ? "Conexão ativa" : "Ativar"} feito={cfg.ativa}>
          {cfg.ativa ? (
            <button type="button" disabled={!!ocupado}
              onClick={() => executar("desativar", () => pizzariasApi.apiOficialDesativar(pizzariaId))}
              className="w-full px-4 py-2 rounded-xl text-sm font-medium border border-line text-ink-muted hover:text-ink hover:bg-surface-elevated disabled:opacity-50">
              {ocupado === "desativar" ? "Desativando…" : "Desativar e voltar para o QR Code"}
            </button>
          ) : (
            <>
              <p className="flex items-start gap-1.5 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Ao ativar, a conexão por QR Code (Evolution) desta loja é desligada.
              </p>
              <button type="button" disabled={!cfg.webhook_verificado_em || !!ocupado}
                onClick={() => executar("ativar", () => pizzariasApi.apiOficialAtivar(pizzariaId))}
                className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                {ocupado === "ativar" && <Loader2 className="w-4 h-4 animate-spin" />} Ativar API oficial
              </button>
            </>
          )}
        </Passo>
      )}

      {salvo && (
        <section className="border border-line rounded-xl p-3.5 space-y-2.5">
          <h4 className="text-sm font-semibold text-ink">Modelo para fora da janela de 24 h</h4>
          <p>
            Passadas 24 h da última mensagem do cliente, a Meta só entrega <strong>modelo aprovado</strong>.
            Sem modelo, a confirmação do cardápio digital e os avisos de status não chegam a quem não
            conversou com a loja (a loja é avisada). Crie no Gerenciador do WhatsApp um modelo de
            <strong> Utilidade</strong> com até 2 variáveis, por exemplo:
          </p>
          <code className="block text-xs bg-surface border border-line rounded-lg px-2.5 py-2 text-ink whitespace-pre-wrap">{MODELO_SUGERIDO}</code>
          <p className="text-[11px] text-ink-subtle">{"{{1}}"} = primeiro nome do cliente, {"{{2}}"} = a mensagem. Com uma variável só, {"{{1}}"} = a mensagem.</p>
          {cfg.modelo_nome && (
            <p className="text-emerald-400">✓ Em uso: {cfg.modelo_nome} ({cfg.modelo_idioma})</p>
          )}
          {modelos === null ? (
            <button type="button" onClick={carregarModelos} disabled={!!ocupado}
              className="w-full px-4 py-2 rounded-xl text-sm font-medium border border-line text-ink-muted hover:text-ink hover:bg-surface-elevated disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              {ocupado === "modelos" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Buscar modelos aprovados
            </button>
          ) : (
            <div className="flex gap-2">
              <select className={inputCls} value={modeloSel} onChange={(e) => setModeloSel(e.target.value)}>
                <option value="">Sem modelo</option>
                {modelos.map((m) => (
                  <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}
                    disabled={!m.compativel || m.parametros > 2}>
                    {m.nome} ({m.idioma}) · {m.parametros} variável(is){!m.compativel || m.parametros > 2 ? " — incompatível" : ""}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!!ocupado}
                onClick={() => {
                  const [nome, idioma] = modeloSel ? modeloSel.split("|") : [null, null];
                  executar("modelo", () => pizzariasApi.apiOficialModelo(pizzariaId, { nome, idioma }));
                }}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
                {ocupado === "modelo" ? "…" : "Usar"}
              </button>
            </div>
          )}
        </section>
      )}

      {erro && <p className="text-sm text-red-400">{erro}</p>}

      {salvo && !cfg.ativa && (
        <button type="button" disabled={!!ocupado}
          onClick={() => executar("remover", () => pizzariasApi.apiOficialRemover(pizzariaId))}
          className="text-[11px] text-ink-subtle hover:text-red-400 underline">
          Apagar credenciais da API oficial
        </button>
      )}
    </div>
  );
}
