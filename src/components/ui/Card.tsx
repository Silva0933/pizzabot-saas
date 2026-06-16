import React from "react";
import { cn } from "../../lib/cn";

export type CardAccent =
  | "orange" | "emerald" | "violet" | "sky" | "amber" | "rose" | "slate";

const ACCENT: Record<CardAccent, string> = {
  orange:  "bg-brand-50 text-brand-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet:  "bg-violet-50 text-violet-600",
  sky:     "bg-sky-50 text-sky-600",
  amber:   "bg-amber-50 text-amber-600",
  rose:    "bg-rose-50 text-rose-600",
  slate:   "bg-slate-100 text-slate-600",
};

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Realça no hover (sombra + leve elevação). */
  interactive?: boolean;
  padded?: boolean;
}

/** Superfície base — substitui os `div bg-white border rounded-2xl` espalhados. */
export function Card({ children, className, interactive, padded = true }: CardProps) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-2xl shadow-card",
        padded && "p-4",
        interactive && "transition-all hover:shadow-card-hover hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  icon?: React.ComponentType<{ className?: string }>;
  accent?: CardAccent;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Cabeçalho de card com ícone temático + título/subtítulo + ação opcional. */
export function CardHeader({ icon: Icon, accent = "orange", title, subtitle, action, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {Icon && (
        <span className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0", ACCENT[accent])}>
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-ink truncate">{title}</h3>
        {subtitle && <p className="text-xs text-ink-muted truncate">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
