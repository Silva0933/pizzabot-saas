/**
 * Edição dos planos vendidos pela plataforma.
 *
 * Os defaults vivem no código (backend services/plans.py); aqui o admin
 * sobrescreve nome, preço, descrição e limites, e pode voltar ao padrão campo a
 * campo. `id` e `ordem` não são editáveis de propósito: as assinaturas já
 * criadas no Asaas referenciam o id, e mexer nele órfã os pagamentos.
 */
import { useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, Save } from "lucide-react";
import { adminApi, PlanoAdmin, PlanoPatch, PlanosResp } from "../../lib/api";
import { GatewayCobrancaPanel } from "./GatewayCobrancaPanel";

const LIMITES: Array<{ chave: keyof PlanoAdmin["limites"]; rotulo: string; ajuda?: string }> = [
  { chave: "produtos", rotulo: "Produtos no cardápio" },
  { chave: "conversas_mes", rotulo: "Atendimentos por mês", ajuda: "É a cota que bloqueia novas conversas." },
  { chave: "mensagens_ia_mes", rotulo: "Mensagens de IA por mês", ajuda: "Referência — não bloqueia." },
  { chave: "equipe", rotulo: "Pessoas na equipe" },
];

export function PlanosAdminPanel() {
  const [dados, setDados] = useState<PlanosResp | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, PlanoPatch>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    adminApi.planos().then(setDados).catch((e) => setErro(String(e?.message || e)));
  }, []);

  function alterar(planoId: string, patch: PlanoPatch) {
    setRascunho((r) => ({ ...r, [planoId]: { ...r[planoId], ...patch } }));
    setSalvo(null);
  }

  function alterarLimite(planoId: string, chave: keyof PlanoAdmin["limites"], valor: string) {
    const n = valor === "" ? null : Number(valor);
    setRascunho((r) => ({
      ...r,
      [planoId]: { ...r[planoId], limites: { ...r[planoId]?.limites, [chave]: n } },
    }));
    setSalvo(null);
  }

  async function salvar(planoId: string) {
    const patch = rascunho[planoId];
    if (!patch) return;
    setSalvando(planoId);
    setErro(null);
    try {
      await adminApi.salvarPlano(planoId, patch);
      setDados(await adminApi.planos());
      setRascunho((r) => {
        const { [planoId]: _, ...resto } = r;
        return resto;
      });
      setSalvo(planoId);
      window.setTimeout(() => setSalvo(null), 2500);
    } catch (e: any) {
      setErro(e?.message || "Não consegui salvar o plano.");
    } finally {
      setSalvando(null);
    }
  }

  /** Limpa os ajustes do plano: manda tudo nulo e o backend volta ao default. */
  async function voltarAoPadrao(planoId: string) {
    setSalvando(planoId);
    setErro(null);
    try {
      await adminApi.salvarPlano(planoId, {
        nome: null,
        preco_mensal: null,
        descricao: null,
        limites: { produtos: null, conversas_mes: null, mensagens_ia_mes: null, equipe: null } as any,
      });
      setDados(await adminApi.planos());
      setRascunho((r) => {
        const { [planoId]: _, ...resto } = r;
        return resto;
      });
    } catch (e: any) {
      setErro(e?.message || "Não consegui restaurar o plano.");
    } finally {
      setSalvando(null);
    }
  }

  if (erro && !dados) {
    return <div className="rounded-xl border border-red-500/30 bg-red-950/40 text-red-300 px-4 py-3 text-xs">{erro}</div>;
  }
  if (!dados) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando planos…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Primeiro o gateway: plano bem configurado nao cobra nada sem ele. */}
      <GatewayCobrancaPanel />

      <div className="rounded-2xl border border-[#1e293b] bg-[#111622] p-4">
        <h2 className="text-sm font-bold text-white">Planos e limites</h2>
        <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
          O preço novo vale para assinaturas <strong>novas</strong>. Quem já assinou continua no
          valor contratado até trocar de plano, porque a recorrência fica no Asaas. Campo em
          branco volta ao padrão do sistema.
        </p>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 text-red-300 px-4 py-3 text-xs">{erro}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {dados.planos.map((plano) => {
          const patch = rascunho[plano.id] || {};
          const mudou = Object.keys(patch).length > 0;
          const ajustado = dados.ajustados.includes(plano.id);
          const padrao = dados.padrao.find((p) => p.id === plano.id);
          const ehTrial = plano.id === "trial";

          return (
            <section key={plano.id} className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-bold text-white">{plano.nome}</strong>
                    <code className="text-[10px] text-slate-500 bg-[#161f30] px-1.5 py-0.5 rounded">{plano.id}</code>
                    {ehTrial && (
                      <span className="text-[10px] text-slate-400 border border-[#1e293b] px-1.5 py-0.5 rounded">
                        não é vendido
                      </span>
                    )}
                  </div>
                  {ajustado && padrao && (
                    <p className="mt-1 text-[10px] text-orange-400">
                      Alterado — padrão: {padrao.nome}, R$ {padrao.preco_mensal.toFixed(2)}
                    </p>
                  )}
                </div>
                {ajustado && (
                  <button
                    type="button"
                    onClick={() => voltarAoPadrao(plano.id)}
                    disabled={salvando === plano.id}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1e293b] bg-[#161f30] text-[11px] font-semibold text-slate-300 hover:text-white hover:border-orange-500 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" /> Padrão
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Campo
                  rotulo="Nome"
                  valor={patch.nome ?? plano.nome}
                  onChange={(v) => alterar(plano.id, { nome: v })}
                />
                <Campo
                  rotulo="Preço mensal (R$)"
                  tipo="number"
                  desabilitado={ehTrial}
                  valor={String(patch.preco_mensal ?? plano.preco_mensal)}
                  onChange={(v) => alterar(plano.id, { preco_mensal: v === "" ? null : Number(v) })}
                />
              </div>

              <Campo
                rotulo="Descrição (aparece na tela de assinatura)"
                valor={patch.descricao ?? plano.descricao ?? ""}
                onChange={(v) => alterar(plano.id, { descricao: v })}
              />

              <div>
                <span className="block text-[11px] font-semibold text-slate-400 mb-2">Limites</span>
                <div className="grid grid-cols-2 gap-3">
                  {LIMITES.map(({ chave, rotulo, ajuda }) => (
                    <div key={chave}>
                      <Campo
                        rotulo={rotulo}
                        ajuda={ajuda}
                        tipo="number"
                        valor={String(patch.limites?.[chave] ?? plano.limites[chave])}
                        onChange={(v) => alterarLimite(plano.id, chave, v)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => salvar(plano.id)}
                  disabled={!mudou || salvando === plano.id}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:hover:bg-orange-500 text-white text-xs font-bold"
                >
                  {salvando === plano.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : salvo === plano.id ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {salvando === plano.id ? "Salvando…" : salvo === plano.id ? "Salvo" : "Salvar plano"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Campo({
  rotulo, valor, onChange, tipo = "text", ajuda, desabilitado,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: "text" | "number";
  ajuda?: string;
  desabilitado?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-400 mb-1">{rotulo}</span>
      <input
        type={tipo}
        value={valor}
        disabled={desabilitado}
        min={tipo === "number" ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[#1e293b] bg-[#161f30] text-xs text-white outline-none focus:border-orange-500 disabled:opacity-40"
      />
      {ajuda && <span className="block mt-1 text-[10px] text-slate-500">{ajuda}</span>}
    </label>
  );
}
