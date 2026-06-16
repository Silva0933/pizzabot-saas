/**
 * Checklist de setup do painel.
 *
 * DISCRETO por padrão: enquanto faltar configurar algo, mostra só uma faixa
 * fininha com um ponto pulsante ("alerta") + quantos passos faltam. Ao clicar,
 * EXPANDE a lista completa (cada passo pode ser CONFIGURADO ou PULADO) e pode
 * RECOLHER de volta. Some sozinho só quando tudo estiver realmente concluído.
 * O que foi pulado é por pizzaria (localStorage).
 */
import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Circle, ChevronRight, ChevronUp, RotateCcw, Sparkles } from "lucide-react";

export interface OnboardingItem {
  id: string;
  title: string;
  description: string;
  done: boolean;
  action?: () => void;
  actionLabel?: string;
}

export interface OnboardingChecklistProps {
  items: OnboardingItem[];
  title?: string;
  /** Chave de persistência (por pizzaria) do que foi pulado. */
  storageKey?: string;
  /** Começa já expandido (ex.: quando aberto a partir de um botão de config). */
  defaultExpanded?: boolean;
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

export function OnboardingChecklist({
  items,
  title = "Vamos terminar a configuração",
  storageKey = "default",
  defaultExpanded = false,
}: OnboardingChecklistProps) {
  const skipKey = `pizzabot:onb:skip:${storageKey}`;

  const [skipped, setSkipped] = useState<string[]>(() => lsGet<string[]>(skipKey, []));
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  useEffect(() => lsSet(skipKey, skipped), [skipKey, skipped]);

  const doneCount = items.filter((i) => i.done).length;
  const skippedItems = items.filter((i) => !i.done && skipped.includes(i.id));
  const pending = items.filter((i) => !i.done && !skipped.includes(i.id));
  const incomplete = pending.length + skippedItems.length; // tudo que NÃO foi feito

  // Tudo realmente concluído → não renderiza nada.
  if (incomplete === 0) return null;

  const skip = (id: string) => setSkipped((s) => Array.from(new Set([...s, id])));
  const restoreAll = () => setSkipped([]);

  // ============================================
  // DISCRETO (padrão): faixa fininha com ponto pulsante.
  // ============================================
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          if (pending.length === 0) restoreAll(); // reabre os pulados pra resolver
        }}
        className="group w-full flex items-center gap-2.5 bg-surface border border-amber-200 rounded-xl px-3.5 py-2 text-left hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
        </span>
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-sm text-ink flex-1 min-w-0 truncate">
          Configuração pendente —{" "}
          <span className="font-semibold text-amber-700">
            {incomplete} passo{incomplete > 1 ? "s" : ""}
          </span>{" "}
          a fazer
        </span>
        <span className="text-xs font-semibold text-amber-700 flex items-center gap-0.5 shrink-0">
          Ver passos
          <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </button>
    );
  }

  // ============================================
  // EXPANDIDO (ao clicar): lista completa.
  // ============================================
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-orange-50 via-amber-50/40 to-white border border-orange-200 rounded-xl p-4 md:p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {doneCount} de {items.length} prontos · falta{pending.length > 1 ? "m" : ""} {pending.length}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-orange-700">{pct}%</span>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            title="Recolher (continua avisando que há pendências)"
            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-white/70"
          >
            <ChevronUp className="w-3.5 h-3.5" /> Recolher
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-orange-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2">
        {pending.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 p-2.5 rounded-lg bg-white border border-slate-150"
          >
            <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{item.title}</p>
              <p className="text-xs text-slate-500">{item.description}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {item.action && (
                <button
                  type="button"
                  onClick={item.action}
                  className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                >
                  {item.actionLabel || "Configurar"}
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => skip(item.id)}
                className="text-[11px] text-slate-400 hover:text-slate-600 px-1"
              >
                Pular
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Rodapé: passos pulados (continuam contando como pendentes). */}
      {skippedItems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-orange-100 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 min-w-0 truncate">
            {skippedItems.length} pulado{skippedItems.length > 1 ? "s" : ""}:{" "}
            {skippedItems.map((i) => i.title).join(", ")}
          </span>
          <button
            type="button"
            onClick={restoreAll}
            className="text-[11px] font-medium text-orange-700 hover:text-orange-800 flex items-center gap-1 shrink-0"
          >
            <RotateCcw className="w-3 h-3" /> Restaurar
          </button>
        </div>
      )}
    </motion.section>
  );
}
