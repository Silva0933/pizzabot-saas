/**
 * Construtor visual da personalidade do atendente.
 *
 * Substitui o editor de prompt cru. Cada bloco vira parte do prompt final
 * montado pelo backend (FastAPI). Tem painel de teste integrado.
 */
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Sparkles,
  Smile,
  MapPin,
  Star,
  ShieldAlert,
  Plus,
  X,
  Save,
  RefreshCw,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Eye,
  Bot,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wand2,
  Activity,
  BellRing,
  Brain,
  ShoppingBasket,
  SlidersHorizontal,
  UserRoundCheck,
} from "lucide-react";
import {
  AgentHealth,
  AtendimentoConfig,
  DEFAULT_ATENDIMENTO_CONFIG,
  DEFAULT_PERSONALIDADE,
  EstiloAtendente,
  NivelEmoji,
  Personalidade,
  personalityApi,
} from "../lib/api";

function mergePersonalidade(data?: Personalidade | null): Personalidade {
  const incoming = data?.config_atendimento;
  return {
    ...DEFAULT_PERSONALIDADE,
    ...data,
    diferenciais: [...(data?.diferenciais || [])],
    restricoes: [...(data?.restricoes || [])],
    exemplos_conversa: [...(data?.exemplos_conversa || [])],
    config_atendimento: {
      ...DEFAULT_ATENDIMENTO_CONFIG,
      ...incoming,
      comunicacao: { ...DEFAULT_ATENDIMENTO_CONFIG.comunicacao, ...incoming?.comunicacao },
      vendas: { ...DEFAULT_ATENDIMENTO_CONFIG.vendas, ...incoming?.vendas },
      memoria: { ...DEFAULT_ATENDIMENTO_CONFIG.memoria, ...incoming?.memoria },
      handoff: { ...DEFAULT_ATENDIMENTO_CONFIG.handoff, ...incoming?.handoff },
      followups: {
        ...DEFAULT_ATENDIMENTO_CONFIG.followups,
        ...incoming?.followups,
        confirmacao: {
          ...DEFAULT_ATENDIMENTO_CONFIG.followups.confirmacao,
          ...incoming?.followups?.confirmacao,
        },
        carrinho: {
          ...DEFAULT_ATENDIMENTO_CONFIG.followups.carrinho,
          ...incoming?.followups?.carrinho,
        },
      },
    },
  };
}

// ============================================
// Sub-componente: preset de estilo
// ============================================
interface PresetCardProps {
  value: EstiloAtendente;
  selected: boolean;
  title: string;
  example: string;
  onClick: () => void;
}

function PresetCard({ value, selected, title, example, onClick }: PresetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        selected
          ? "border-orange-500 bg-orange-500/10 shadow-[0_0_15px_rgba(249,115,22,0.15)] ring-1 ring-orange-500/50"
          : "border-slate-800/80 bg-[#161f30]/60 hover:border-slate-700 hover:bg-[#161f30]"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`font-semibold text-sm ${selected ? "text-orange-400" : "text-slate-200"}`}>
          {title}
        </span>
        {selected && <CheckCircle2 className="w-4 h-4 text-orange-400" />}
      </div>
      <p className="text-xs text-slate-400 italic leading-relaxed">"{example}"</p>
    </button>
  );
}

// ============================================
// Sub-componente: slider de emojis
// ============================================
const EMOJI_LEVELS: { value: NivelEmoji; label: string; preview: string }[] = [
  { value: "nenhum",   label: "Nenhum",   preview: "Oi, em que posso ajudar?" },
  { value: "pouco",    label: "Pouco",    preview: "Oi! Em que posso ajudar?" },
  { value: "moderado", label: "Moderado", preview: "Oi! 😊 Em que posso ajudar?" },
  { value: "muito",    label: "Muito",    preview: "Oi, tudo bem? 🍕 Em que posso te ajudar? 😊" },
];

function EmojiSlider({ value, onChange }: { value: NivelEmoji; onChange: (v: NivelEmoji) => void }) {
  const currentIdx = EMOJI_LEVELS.findIndex((l) => l.value === value);

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {EMOJI_LEVELS.map((level, idx) => (
          <button
            key={level.value}
            type="button"
            onClick={() => onChange(level.value)}
            className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all ${
              idx === currentIdx
                ? "bg-orange-500 text-white shadow-sm"
                : "bg-[#161f30] text-slate-300 hover:bg-slate-800 border border-slate-800"
            }`}
          >
            {level.label}
          </button>
        ))}
      </div>
      <div className="bg-[#161f30]/60 border border-slate-800/80 rounded-xl p-3">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Exemplo</span>
        <p className="text-sm text-slate-200 mt-1">{EMOJI_LEVELS[currentIdx].preview}</p>
      </div>
    </div>
  );
}

// ============================================
// Sub-componente: editor de lista
// ============================================
function ListEditor({
  items,
  onChange,
  placeholder,
  emptyHint,
  colorClass = "orange",
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyHint: string;
  colorClass?: "orange" | "red";
}) {
  const [input, setInput] = useState("");
  const styles =
    colorClass === "red"
      ? { bg: "bg-red-500/15", border: "border-red-500/30", text: "text-red-300", btn: "bg-red-600 hover:bg-red-500" }
      : { bg: "bg-orange-500/15", border: "border-orange-500/30", text: "text-orange-300", btn: "bg-orange-500 hover:bg-orange-600" };

  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (items.includes(v)) return;
    onChange([...items, v]);
    setInput("");
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 px-3.5 py-2 text-sm bg-[#161f30] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
        />
        <button
          type="button"
          onClick={add}
          className={`${styles.btn} text-white text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-colors shrink-0`}
        >
          <Plus className="w-4 h-4" />
          Adicionar
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500 italic">{emptyHint}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          <AnimatePresence>
            {items.map((it) => (
              <motion.li
                key={it}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
                className={`${styles.bg} ${styles.border} border ${styles.text} text-sm px-3.5 py-1.5 rounded-full flex items-center gap-2`}
              >
                <span>{it}</span>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((x) => x !== it))}
                  className="hover:opacity-75 transition-opacity"
                  aria-label="Remover"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ============================================
// Sub-componente: editor de exemplos few-shot
// ============================================
function ExamplesEditor({
  examples,
  onChange,
}: {
  examples: Array<{ cliente: string; atendente: string }>;
  onChange: (next: Array<{ cliente: string; atendente: string }>) => void;
}) {
  const addExample = () =>
    onChange([...examples, { cliente: "", atendente: "" }]);

  const update = (idx: number, key: "cliente" | "atendente", val: string) => {
    const next = examples.map((e, i) => (i === idx ? { ...e, [key]: val } : e));
    onChange(next);
  };

  const remove = (idx: number) =>
    onChange(examples.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {examples.map((ex, idx) => (
        <div key={idx} className="bg-[#161f30]/60 border border-slate-800/80 rounded-xl p-3.5 relative">
          <button
            type="button"
            onClick={() => remove(idx)}
            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-red-400"
            aria-label="Remover exemplo"
          >
            <X className="w-4 h-4" />
          </button>
          <label className="flex items-start gap-2.5 mb-3">
            <div className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mt-1.5 shrink-0">
              Cliente
            </div>
            <textarea
              value={ex.cliente}
              onChange={(e) => update(idx, "cliente", e.target.value)}
              rows={1}
              placeholder="ex: oi tem promoção hoje?"
              className="flex-1 px-2.5 py-1.5 text-sm bg-[#111622] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-lg resize-none focus:outline-none focus:border-orange-500"
            />
          </label>
          <label className="flex items-start gap-2.5">
            <div className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mt-1.5 shrink-0">
              Atendente
            </div>
            <textarea
              value={ex.atendente}
              onChange={(e) => update(idx, "atendente", e.target.value)}
              rows={2}
              placeholder="ex: oi! hoje tem rodízio de borda recheada na 4ª compra 😊"
              className="flex-1 px-2.5 py-1.5 text-sm bg-[#111622] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-lg resize-none focus:outline-none focus:border-orange-500"
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={addExample}
        className="w-full py-2.5 border border-dashed border-slate-800 rounded-xl text-sm text-slate-400 hover:border-orange-500/50 hover:text-orange-400 hover:bg-orange-500/5 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Adicionar exemplo de conversa
      </button>
    </div>
  );
}

// ============================================
// Painel principal
// ============================================
export interface PersonalityBuilderProps {
  pizzariaId: string;
  onOpenTest?: () => void;
}

export function PersonalityBuilder({ pizzariaId, onOpenTest }: PersonalityBuilderProps) {
  const [state, setState] = useState<Personalidade>(() => mergePersonalidade());
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewPipeline, setPreviewPipeline] = useState<string>("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "erro"; text: string } | null>(null);

  // Carrega
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // O diagnóstico foi adicionado depois da configuração de personalidade.
        // Mantê-lo opcional evita que um backend ainda não reiniciado (404 em
        // /agente/health) derrube toda a tela "Meu negócio".
        const [data, healthData] = await Promise.all([
          personalityApi.get(pizzariaId),
          personalityApi.health(pizzariaId).catch(() => null),
        ]);
        if (!cancelled && data) {
          setState(mergePersonalidade(data));
        }
        if (!cancelled) setHealth(healthData);
      } catch (e: any) {
        if (!cancelled) setFeedback({ type: "erro", text: `Erro carregando: ${e.message}` });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pizzariaId]);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await personalityApi.save(pizzariaId, state);
      setState(mergePersonalidade(saved));
      setFeedback({ type: "ok", text: "Personalidade salva com sucesso!" });
      // A atualização do diagnóstico não faz parte do salvamento. Se a rota
      // ainda não estiver disponível, o dado salvo continua sendo sucesso.
      try {
        setHealth(await personalityApi.health(pizzariaId));
      } catch {
        setHealth(null);
      }
    } catch (e: any) {
      setFeedback({ type: "erro", text: `Erro: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewOpen(true);
    setPreviewText(null);
    try {
      const r = await personalityApi.preview(pizzariaId);
      setPreviewText(r.prompt);
      setPreviewPipeline(r.pipeline);
    } catch (e: any) {
      setPreviewText(`Erro carregando preview: ${e.message}`);
    }
  };

  const updateCommunication = (patch: Partial<AtendimentoConfig["comunicacao"]>) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        comunicacao: { ...prev.config_atendimento.comunicacao, ...patch },
      },
    }));

  const updateSales = (patch: Partial<AtendimentoConfig["vendas"]>) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        vendas: { ...prev.config_atendimento.vendas, ...patch },
      },
    }));

  const updateMemory = (patch: Partial<AtendimentoConfig["memoria"]>) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        memoria: { ...prev.config_atendimento.memoria, ...patch },
      },
    }));

  const updateHandoff = (patch: Partial<AtendimentoConfig["handoff"]>) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        handoff: { ...prev.config_atendimento.handoff, ...patch },
      },
    }));

  const updateFollowups = (patch: Partial<AtendimentoConfig["followups"]>) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        followups: { ...prev.config_atendimento.followups, ...patch },
      },
    }));

  const updateFollowupItem = (
    key: "confirmacao" | "carrinho",
    patch: Partial<AtendimentoConfig["followups"]["confirmacao"]>,
  ) =>
    setState((prev) => ({
      ...prev,
      config_atendimento: {
        ...prev.config_atendimento,
        followups: {
          ...prev.config_atendimento.followups,
          [key]: { ...prev.config_atendimento.followups[key], ...patch },
        },
      },
    }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/30 grid place-items-center text-orange-500">
              <Sparkles className="w-5 h-5" />
            </span>
            Personalidade da Atendente
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Configure como sua atendente conversa com os clientes — sem mexer em código.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handlePreview}
            className="px-4 py-2 text-xs font-semibold text-slate-300 bg-[#161f30] hover:bg-[#1a253a] hover:text-white border border-[#1e293b] rounded-xl flex items-center gap-2 transition-colors shadow-sm"
            title="Ver o prompt completo que o modelo recebe"
          >
            <Eye className="w-4 h-4 text-slate-400" />
            Ver prompt
          </button>
          {onOpenTest && (
            <button
              type="button"
              onClick={onOpenTest}
              className="px-4 py-2 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-orange-500/20"
            >
              <MessageSquare className="w-4 h-4" />
              Testar agora
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border ${
              feedback.type === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
          >
            {feedback.type === "ok" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {health && (
        <section className="rounded-2xl border border-slate-800/80 bg-[#111622] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-400" />
                Prontidão do atendimento
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Verificação das dependências que deixam o agente operar sem improvisos.
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              health.status === "ready"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : health.status === "blocked"
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"
            }`}>
              {health.status === "ready" ? "Pronto" : health.status === "blocked" ? "Ação necessária" : "Atenção"}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {health.checks.map((check) => (
              <div key={check.key} className="rounded-xl border border-slate-800 bg-[#161f30]/60 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${
                    check.status === "ok" ? "bg-emerald-400" : check.status === "error" ? "bg-red-400" : "bg-amber-400"
                  }`} />
                  <strong className="text-xs text-slate-200">{check.label}</strong>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{check.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2-Column Grid matching Meu Negócio.png */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Coluna Esquerda */}
        <div className="space-y-5">
          {/* Bloco: Identidade */}
          <Card icon={<User className="w-4 h-4" />} title="Identidade">
            <label className="block">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome da atendente</span>
              <input
                type="text"
                value={state.nome}
                onChange={(e) => setState({ ...state, nome: e.target.value })}
                placeholder="Ex: Camila, Júlia, Sofia..."
                className="mt-1.5 w-full px-3.5 py-2.5 text-xs bg-[#161f30] border border-[#1e293b] text-white placeholder-slate-500 rounded-xl focus:outline-none focus:border-orange-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                O nome que aparece quando a IA se apresenta. Pode ser qualquer nome.
              </p>
            </label>
          </Card>

          {/* Bloco: Estilo de comunicação */}
          <Card icon={<Wand2 className="w-4 h-4" />} title="Estilo de comunicação">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PresetCard
                value="casual"
                selected={state.estilo === "casual"}
                title="Casual"
                example="Oi, em que posso te ajudar? Quer dar uma olhada no cardápio?"
                onClick={() => setState({ ...state, estilo: "casual" })}
              />
              <PresetCard
                value="profissional"
                selected={state.estilo === "profissional"}
                title="Profissional"
                example="Olá! Como posso ajudá-lo? Posso enviar nosso cardápio?"
                onClick={() => setState({ ...state, estilo: "profissional" })}
              />
              <PresetCard
                value="proximo"
                selected={state.estilo === "proximo"}
                title="Próximo (carinhoso)"
                example="Oii, tudo bom? 😊 Posso te ajudar com o cardápio, amor?"
                onClick={() => setState({ ...state, estilo: "proximo" })}
              />
            </div>
          </Card>

          {/* Bloco: Uso de emojis */}
          <Card icon={<Smile className="w-4 h-4" />} title="Uso de emojis">
            <EmojiSlider value={state.nivel_emoji} onChange={(v) => setState({ ...state, nivel_emoji: v })} />
          </Card>
        </div>

        {/* Coluna Direita */}
        <div className="space-y-5">
          {/* Bloco: Vocabulário regional */}
          <Card icon={<MapPin className="w-4 h-4" />} title="Vocabulário regional (opcional)">
            <input
              type="text"
              value={state.vocabulario_regional || ""}
              onChange={(e) => setState({ ...state, vocabulario_regional: e.target.value || null })}
              placeholder="Ex: uai, trem, bão, sô"
              className="w-full px-3.5 py-2.5 text-xs bg-[#161f30] border border-[#1e293b] text-white placeholder-slate-500 rounded-xl focus:outline-none focus:border-orange-500"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Palavras/expressões da sua região que a atendente deve usar com naturalidade.
            </p>
          </Card>

          {/* Bloco: Diferenciais que ela deve citar */}
          <Card icon={<Star className="w-4 h-4 text-amber-400" />} title="Diferenciais que ela deve citar">
            <ListEditor
              items={state.diferenciais}
              onChange={(next) => setState({ ...state, diferenciais: next })}
              placeholder="Ex: Massa fermentada 48h"
              emptyHint="Nenhum diferencial cadastrado. Adicione 2-4 itens que fazem sua pizzaria especial."
            />
          </Card>

          {/* Bloco: Coisas que ela NUNCA deve fazer */}
          <Card icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Coisas que ela NUNCA deve fazer">
            <ListEditor
              items={state.restricoes}
              onChange={(next) => setState({ ...state, restricoes: next })}
              placeholder="Ex: Não citar promoções de concorrentes"
              emptyHint="Sem restrições. Adicione regras importantes se houver."
              colorClass="red"
            />
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card icon={<SlidersHorizontal className="w-4 h-4" />} title="Comportamento da conversa">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-400">Tamanho</span>
              <select
                value={state.config_atendimento.comunicacao.tamanho_resposta}
                onChange={(e) => updateCommunication({ tamanho_resposta: e.target.value as "curta" | "equilibrada" })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-[#161f30] px-3 py-2 text-xs text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="curta">Curta</option>
                <option value="equilibrada">Equilibrada</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-400">Ritmo de digitação</span>
              <select
                value={state.config_atendimento.comunicacao.ritmo_digitacao}
                onChange={(e) => updateCommunication({ ritmo_digitacao: e.target.value as "rapido" | "natural" | "calmo" })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-[#161f30] px-3 py-2 text-xs text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="rapido">Rápido</option>
                <option value="natural">Natural</option>
                <option value="calmo">Calmo</option>
              </select>
            </label>
            <NumberField
              label="Máx. de balões"
              min={1}
              max={4}
              value={state.config_atendimento.comunicacao.max_baloes}
              onChange={(value) => updateCommunication({ max_baloes: value })}
            />
          </div>
          <div className="space-y-2">
            <ToggleRow
              label="Uma pergunta por vez"
              description="Evita interrogatórios e mantém o fluxo natural."
              checked={state.config_atendimento.comunicacao.uma_pergunta_por_vez}
              onChange={(checked) => updateCommunication({ uma_pergunta_por_vez: checked })}
            />
            <ToggleRow
              label="Usar o nome do cliente"
              description="Personaliza quando o nome estiver confirmado."
              checked={state.config_atendimento.comunicacao.usar_nome_cliente}
              onChange={(checked) => updateCommunication({ usar_nome_cliente: checked })}
            />
            <ToggleRow
              label="Transparência sobre IA"
              description="Se perguntarem, explica que é a atendente virtual."
              checked={state.config_atendimento.comunicacao.transparencia_ia}
              onChange={(checked) => updateCommunication({ transparencia_ia: checked })}
            />
          </div>
        </Card>

        <Card icon={<ShoppingBasket className="w-4 h-4" />} title="Vendas inteligentes">
          <div className="space-y-2">
            <ToggleRow
              label="Ativar sugestões"
              description="O agente oferece apenas itens reais e disponíveis."
              checked={state.config_atendimento.vendas.habilitado}
              onChange={(checked) => updateSales({ habilitado: checked })}
            />
            <div className="grid grid-cols-2 gap-2">
              <ToggleRow label="Bebidas" checked={state.config_atendimento.vendas.oferecer_bebida} onChange={(checked) => updateSales({ oferecer_bebida: checked })} compact />
              <ToggleRow label="Bordas" checked={state.config_atendimento.vendas.oferecer_borda} onChange={(checked) => updateSales({ oferecer_borda: checked })} compact />
              <ToggleRow label="Adicionais" checked={state.config_atendimento.vendas.oferecer_adicional} onChange={(checked) => updateSales({ oferecer_adicional: checked })} compact />
              <ToggleRow label="Sobremesas" checked={state.config_atendimento.vendas.oferecer_sobremesa} onChange={(checked) => updateSales({ oferecer_sobremesa: checked })} compact />
            </div>
            <NumberField
              label="Máximo de ofertas por conversa"
              min={0}
              max={2}
              value={state.config_atendimento.vendas.max_ofertas}
              onChange={(value) => updateSales({ max_ofertas: value })}
            />
          </div>
        </Card>

        <Card icon={<Brain className="w-4 h-4" />} title="Memória e relacionamento">
          <div className="space-y-2">
            <ToggleRow label="Lembrar nome" description="Reconhece o cliente sem adivinhar." checked={state.config_atendimento.memoria.usar_nome} onChange={(checked) => updateMemory({ usar_nome: checked })} />
            <ToggleRow label="Lembrar endereço" description="Reaproveita somente endereço confirmado." checked={state.config_atendimento.memoria.usar_endereco} onChange={(checked) => updateMemory({ usar_endereco: checked })} />
            <ToggleRow label="Lembrar preferências" description="Considera gostos e restrições já informados." checked={state.config_atendimento.memoria.usar_preferencias} onChange={(checked) => updateMemory({ usar_preferencias: checked })} />
            <ToggleRow label="Oferecer pedido habitual" description="Só após existir padrão nos últimos pedidos." checked={state.config_atendimento.memoria.usar_pedido_habitual} onChange={(checked) => updateMemory({ usar_pedido_habitual: checked })} />
          </div>
        </Card>

        <Card icon={<UserRoundCheck className="w-4 h-4" />} title="Transferência para humano">
          <div className="space-y-2 mb-4">
            <ToggleRow label="Handoff automático" description="Transfere quando o fluxo não consegue avançar." checked={state.config_atendimento.handoff.habilitado} onChange={(checked) => updateHandoff({ habilitado: checked })} />
            <ToggleRow label="Resumo automático" description="Entrega etapa, itens, pagamento e últimas mensagens ao operador." checked={state.config_atendimento.handoff.resumo_automatico} onChange={(checked) => updateHandoff({ resumo_automatico: checked })} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <NumberField label="Falhas de compreensão" min={1} max={5} value={state.config_atendimento.handoff.falhas_nlu_limite} onChange={(value) => updateHandoff({ falhas_nlu_limite: value })} />
            <NumberField label="Pendências repetidas" min={1} max={5} value={state.config_atendimento.handoff.pendencias_limite} onChange={(value) => updateHandoff({ pendencias_limite: value })} />
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-400">Mensagem de transição</span>
            <textarea
              rows={3}
              value={state.config_atendimento.handoff.mensagem_transicao}
              onChange={(e) => updateHandoff({ mensagem_transicao: e.target.value })}
              className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-[#161f30] px-3 py-2 text-xs text-slate-200 focus:border-orange-500 focus:outline-none"
            />
          </label>
        </Card>
      </div>

      <Card icon={<BellRing className="w-4 h-4" />} title="Resgates automáticos">
        <div className="mb-4">
          <ToggleRow
            label="Respeitar horário de funcionamento"
            description="Não envia lembretes quando a pizzaria estiver fechada."
            checked={state.config_atendimento.followups.respeitar_horario}
            onChange={(checked) => updateFollowups({ respeitar_horario: checked })}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {([
            ["confirmacao", "Pedido aguardando confirmação"],
            ["carrinho", "Carrinho abandonado"],
          ] as const).map(([key, title]) => {
            const item = state.config_atendimento.followups[key];
            return (
              <div key={key} className="rounded-xl border border-slate-800 bg-[#161f30]/50 p-4">
                <ToggleRow label={title} checked={item.habilitado} onChange={(checked) => updateFollowupItem(key, { habilitado: checked })} />
                <div className="mt-3 grid grid-cols-[130px_1fr] gap-3 items-start">
                  <NumberField label="Atraso (minutos)" min={2} max={1440} value={item.atraso_minutos} onChange={(value) => updateFollowupItem(key, { atraso_minutos: value })} />
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-400">Mensagem</span>
                    <textarea
                      rows={3}
                      value={item.mensagem}
                      onChange={(e) => updateFollowupItem(key, { mensagem: e.target.value })}
                      className="mt-1 w-full resize-none rounded-xl border border-slate-800 bg-[#111622] px-3 py-2 text-xs text-slate-200 focus:border-orange-500 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Variáveis permitidas: {"{{ primeiro_nome }}"}, {"{{ nome_cliente }}"}, {"{{ nome_pizzaria }}"} e {"{{ nome_atendente }}"}.
        </p>
      </Card>

      {/* Bloco: avançado (escondido por padrão) */}
      <div className="border border-slate-800/80 bg-[#111622] rounded-2xl overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full px-5 py-4 flex items-center justify-between text-sm font-semibold text-slate-300 hover:bg-[#161f30]/40 transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <Bot className="w-4 h-4 text-slate-400" />
            Avançado
            <span className="text-[10px] uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">para usuários experientes</span>
          </span>
          {advancedOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        <AnimatePresence>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-slate-800/80"
            >
              <div className="p-5 space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 mb-1.5 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400" />
                    Exemplos de conversa (few-shot)
                  </h4>
                  <p className="text-xs text-slate-400 mb-3">
                    Mostre 2-3 exemplos do jeito que você QUER que ela responda. A IA aprende com seu estilo.
                  </p>
                  <ExamplesEditor
                    examples={state.exemplos_conversa}
                    onChange={(next) => setState({ ...state, exemplos_conversa: next })}
                  />
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-slate-200 mb-1.5">Instruções extras (em texto livre)</h4>
                  <textarea
                    value={state.instrucoes_extras || ""}
                    onChange={(e) => setState({ ...state, instrucoes_extras: e.target.value || null })}
                    rows={4}
                    placeholder="Ex: Sempre ofereça refrigerante de 2L como combo. Mencione que entregamos em até 40min ou ganha desconto."
                    className="w-full px-3.5 py-2.5 text-sm bg-[#161f30] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 font-mono"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer ações */}
      <div className="sticky bottom-0 bg-[#0b0e14]/90 backdrop-blur-md border-t border-slate-800/80 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-6 py-4 flex items-center justify-between z-10">
        <p className="text-xs text-slate-400">
          As mudanças entram em vigor na próxima mensagem processada.
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-colors shadow-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {/* Modal: preview do prompt */}
      <AnimatePresence>
        {previewOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111622] border border-slate-800 text-slate-100 rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Eye className="w-4 h-4 text-orange-400" />
                  Prompt real da voz · {previewPipeline || "carregando"}
                </h3>
                <button onClick={() => setPreviewOpen(false)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-auto p-4">
                {previewText === null ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs text-slate-300 font-mono leading-relaxed bg-[#161f30] p-4 rounded-xl border border-slate-800">
                    {previewText}
                  </pre>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================
// Helper: Card wrapper
// ============================================
function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#111622] border border-slate-800/80 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3.5">
        <span className="text-slate-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  compact = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#161f30]/50 ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        {description && <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-700 transition-colors peer-checked:bg-orange-500 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
        }}
        className="mt-1 w-full rounded-xl border border-slate-800 bg-[#161f30] px-3 py-2 text-xs text-slate-200 focus:border-orange-500 focus:outline-none"
      />
    </label>
  );
}
