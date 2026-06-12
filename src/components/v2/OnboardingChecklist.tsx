/**
 * Checklist de setup do painel.
 *
 * Aparece no topo enquanto faltar configurar algo. Cada passo pode ser
 * CONFIGURADO ou PULADO (ex.: quem não quer pagamento online). O dono pode
 * OCULTAR o card — mas fica um chip de alerta destacado lembrando que ainda há
 * configuração pendente (não some de vez). Some sozinho só quando tudo estiver
 * realmente concluído. Estado de pular/ocultar é por pizzaria (localStorage).
 */
import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Circle, ChevronRight, EyeOff, AlertTriangle, RotateCcw } from "lucide-react";

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
  /** Chave de persistência (por pizzaria) do que foi pulado/ocultado. */
  storageKey?: string;
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
}: OnboardingChecklistProps) {
  const skipKey = `pizzabot:onb:skip:${storageKey}`;
  const hideKey = `pizzabot:onb:hide:${storageKey}`;

  const [skipped, setSkipped] = useState<string[]>(() => lsGet<string[]>(skipKey, []));
  const [hidden, setHidden] = useState<boolean>(() => lsGet<boolean>(hideKey, false));

  useEffect(() => lsSet(skipKey, skipped), [skipKey, skipped]);
  useEffect(() => lsSet(hideKey, hidden), [hideKey, hidden]);

  const doneCount = items.filter((i) => i.done).length;
  const skippedItems = items.filter((i) => !i.done && skipped.includes(i.id));
  const pending = items.filter((i) => !i.done && !skipped.includes(i.id));
  const incomplete = pending.length + skippedItems.length; // tudo que NÃO foi feito

  // Tudo realmente concluído → não renderiza nada.
  if (incomplete === 0) return null;

  const skip = (id: string) => setSkipped((s) => Array.from(new Set([...s, id])));
  const restoreAll = () => setSkipped([]);

  // Estado COMPACTO (chip destacado): oculto pelo dono, ou só restam passos
  // pulados (nenhum pendente ativo). Continua visível pra não esquecer.
  if (hidden || pending.length === 0) {
    return (
      <button
        type="button"
        onClick={() => {
          setHidden(false);
          if (pending.length === 0) restoreAll(); // reabre os pulados pra resolver
        }}
        className="w-full flex items-center gap-2.5 bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 text-left hover:bg-amber-100/70 transition-colors"
      >
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <span className="text-sm font-semibold text-amber-800 flex-1 min-w-0">
          Configuração pendente — {incomplete} passo{incomplete > 1 ? "s" : ""} a fazer
        </span>
        <span className="text-xs font-medium text-amber-700 flex items-center gap-1 shrink-0">
          Ver <ChevronRight className="w-3 h-3" />
        </span>
      </button>
    );
  }

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
            onClick={() => setHidden(true)}
            title="Ocultar (continua avisando que há pendências)"
            className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-white/70"
          >
            <EyeOff className="w-3.5 h-3.5" /> Ocultar
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
