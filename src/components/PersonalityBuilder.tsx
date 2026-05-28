/**
 * Construtor visual da personalidade do atendente.
 *
 * Substitui o editor de prompt cru. Cada bloco vira parte do prompt final
 * montado pelo backend (FastAPI). Tem painel de teste integrado.
 */
import React, { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import {
  DEFAULT_PERSONALIDADE,
  EstiloAtendente,
  NivelEmoji,
  Personalidade,
  personalityApi,
} from "../lib/api";

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
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`font-semibold text-sm ${selected ? "text-orange-700" : "text-slate-700"}`}>
          {title}
        </span>
        {selected && <CheckCircle2 className="w-4 h-4 text-orange-600" />}
      </div>
      <p className="text-xs text-slate-500 italic leading-relaxed">"{example}"</p>
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
            className={`py-2 px-2 text-xs font-medium rounded-lg transition-all ${
              idx === currentIdx
                ? "bg-orange-500 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {level.label}
          </button>
        ))}
      </div>
      <div className="bg-slate-50 border border-slate-150 rounded-lg p-3">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Exemplo</span>
        <p className="text-sm text-slate-700 mt-1">{EMOJI_LEVELS[currentIdx].preview}</p>
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
      ? { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", btn: "bg-red-500 hover:bg-red-600" }
      : { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", btn: "bg-orange-500 hover:bg-orange-600" };

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
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
        />
        <button
          type="button"
          onClick={add}
          className={`${styles.btn} text-white text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors`}
        >
          <Plus className="w-4 h-4" />
          Adicionar
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{emptyHint}</p>
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
                className={`${styles.bg} ${styles.border} border ${styles.text} text-sm px-3 py-1.5 rounded-full flex items-center gap-2`}
              >
                <span>{it}</span>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((x) => x !== it))}
                  className="hover:opacity-60"
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
        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3 relative">
          <button
            type="button"
            onClick={() => remove(idx)}
            className="absolute top-2 right-2 text-slate-400 hover:text-red-500"
            aria-label="Remover exemplo"
          >
            <X className="w-4 h-4" />
          </button>
          <label className="flex items-start gap-2 mb-3">
            <div className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mt-1.5">
              Cliente
            </div>
            <textarea
              value={ex.cliente}
              onChange={(e) => update(idx, "cliente", e.target.value)}
              rows={1}
              placeholder="ex: oi tem promoção hoje?"
              className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-orange-300"
            />
          </label>
          <label className="flex items-start gap-2">
            <div className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mt-1.5">
              Atendente
            </div>
            <textarea
              value={ex.atendente}
              onChange={(e) => update(idx, "atendente", e.target.value)}
              rows={2}
              placeholder="ex: oi! hoje tem rodízio de borda recheada na 4ª compra 😊"
              className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-orange-300"
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={addExample}
        className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50 transition-colors flex items-center justify-center gap-2"
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
  const [state, setState] = useState<Personalidade>(DEFAULT_PERSONALIDADE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "erro"; text: string } | null>(null);

  // Carrega
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await personalityApi.get(pizzariaId);
        if (!cancelled && data) {
          setState({ ...DEFAULT_PERSONALIDADE, ...data });
        }
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

  const isDirty = useMemo(() => true, [state]); // simplificação

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await personalityApi.save(pizzariaId, state);
      setState({ ...DEFAULT_PERSONALIDADE, ...saved });
      setFeedback({ type: "ok", text: "Personalidade salva!" });
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
    } catch (e: any) {
      setPreviewText(`Erro carregando preview: ${e.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-orange-500" />
            Personalidade da Atendente
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure como sua atendente conversa com os clientes — sem mexer em código.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreview}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg flex items-center gap-1.5 transition-colors"
            title="Ver o prompt completo que o modelo recebe"
          >
            <Eye className="w-4 h-4" />
            Ver prompt
          </button>
          {onOpenTest && (
            <button
              type="button"
              onClick={onOpenTest}
              className="px-3 py-2 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-lg flex items-center gap-1.5 transition-colors"
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
            className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg ${
              feedback.type === "ok"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : "bg-red-50 border border-red-200 text-red-700"
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

      {/* Bloco: identidade */}
      <Card icon={<User className="w-4 h-4" />} title="Identidade">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">Nome da atendente</span>
          <input
            type="text"
            value={state.nome}
            onChange={(e) => setState({ ...state, nome: e.target.value })}
            placeholder="Ex: Camila, Júlia, Sofia..."
            className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            O nome que aparece quando a IA se apresenta. Pode ser qualquer nome.
          </p>
        </label>
      </Card>

      {/* Bloco: estilo */}
      <Card icon={<Wand2 className="w-4 h-4" />} title="Estilo de comunicação">
        <div className="grid md:grid-cols-3 gap-3">
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

      {/* Bloco: emojis */}
      <Card icon={<Smile className="w-4 h-4" />} title="Uso de emojis">
        <EmojiSlider value={state.nivel_emoji} onChange={(v) => setState({ ...state, nivel_emoji: v })} />
      </Card>

      {/* Bloco: vocabulário regional */}
      <Card icon={<MapPin className="w-4 h-4" />} title="Vocabulário regional (opcional)">
        <input
          type="text"
          value={state.vocabulario_regional || ""}
          onChange={(e) => setState({ ...state, vocabulario_regional: e.target.value || null })}
          placeholder="Ex: uai, trem, bão, sô"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          Palavras/expressões da sua região que a atendente deve usar com naturalidade.
        </p>
      </Card>

      {/* Bloco: diferenciais */}
      <Card icon={<Star className="w-4 h-4 text-amber-500" />} title="Diferenciais que ela deve citar">
        <ListEditor
          items={state.diferenciais}
          onChange={(next) => setState({ ...state, diferenciais: next })}
          placeholder="Ex: Massa fermentada 48h"
          emptyHint="Nenhum diferencial cadastrado. Adicione 2-4 itens que fazem sua pizzaria especial."
        />
      </Card>

      {/* Bloco: restrições */}
      <Card icon={<ShieldAlert className="w-4 h-4 text-red-500" />} title="Coisas que ela NUNCA deve fazer">
        <ListEditor
          items={state.restricoes}
          onChange={(next) => setState({ ...state, restricoes: next })}
          placeholder="Ex: Não citar promoções de concorrentes"
          emptyHint="Sem restrições. Adicione regras importantes se houver."
          colorClass="red"
        />
      </Card>

      {/* Bloco: avançado (escondido por padrão) */}
      <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Avançado
            <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">para usuários experientes</span>
          </span>
          {advancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <AnimatePresence>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4" />
                    Exemplos de conversa (few-shot)
                  </h4>
                  <p className="text-xs text-slate-500 mb-3">
                    Mostre 2-3 exemplos do jeito que você QUER que ela responda. A IA aprende com seu estilo.
                  </p>
                  <ExamplesEditor
                    examples={state.exemplos_conversa}
                    onChange={(next) => setState({ ...state, exemplos_conversa: next })}
                  />
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Instruções extras (em texto livre)</h4>
                  <textarea
                    value={state.instrucoes_extras || ""}
                    onChange={(e) => setState({ ...state, instrucoes_extras: e.target.value || null })}
                    rows={4}
                    placeholder="Ex: Sempre ofereça refrigerante de 2L como combo. Mencione que entregamos em até 40min ou ganha desconto."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 font-mono"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer ações */}
      <div className="sticky bottom-0 bg-white border border-slate-200 rounded-xl shadow-lg p-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          As mudanças entram em vigor na próxima conversa nova.
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {/* Modal: preview do prompt */}
      <AnimatePresence>
        {previewOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Prompt completo enviado ao modelo
                </h3>
                <button onClick={() => setPreviewOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-auto p-4">
                {previewText === null ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono leading-relaxed">
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
    <section className="bg-white border border-slate-200 rounded-xl p-4 md:p-5">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
        <span className="text-slate-500">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}
