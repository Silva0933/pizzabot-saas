/**
 * Checklist de setup do painel.
 *
 * Aparece no Início enquanto faltar configurar algo. Some sozinho
 * quando tudo estiver feito. Bom para acolher o usuário novo.
 */
import React from "react";
import { motion } from "motion/react";
import { Circle, ChevronRight } from "lucide-react";

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
}

export function OnboardingChecklist({ items, title = "Vamos terminar a configuração" }: OnboardingChecklistProps) {
  const done = items.filter((i) => i.done).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
  // Mostra só o que falta — itens concluídos somem para não ocupar espaço.
  const pending = items.filter((i) => !i.done);

  // Nada pendente → não renderiza (o pai também já trata isso).
  if (pending.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-orange-50 via-amber-50/40 to-white border border-orange-200 rounded-xl p-4 md:p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {done} de {items.length} prontos · falta{pending.length > 1 ? "m" : ""} {pending.length}
          </p>
        </div>
        <div className="text-xs font-semibold text-orange-700">{pct}%</div>
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
            {item.action && (
              <button
                type="button"
                onClick={item.action}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 shrink-0"
              >
                {item.actionLabel || "Configurar"}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
