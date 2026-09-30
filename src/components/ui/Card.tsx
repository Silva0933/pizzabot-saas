import React from "react";
import { cn } from "../../lib/cn";

export type CardAccent =
  | "orange" | "emerald" | "violet" | "sky" | "amber" | "rose" | "slate";

const ACCENT: Record<CardAccent, string> = {
  orange:  "text-brand-400",
  emerald: "text-emerald-400",
  violet:  "text-violet-300",
  sky:     "text-sky-300",
  amber:   "text-amber-300",
  rose:    "text-rose-300",
  slate:   "text-ink-muted",
};

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Realça no hover (sombra + leve elevação). */
  interactive?: boolean;
  padded?: boolean;
  /** React strip `key` antes de passar; declarado só p/ uso em listas (projeto sem @types/react). */
  key?: string | number;
}

/** Superfície base — substitui os `div bg-white border rounded-2xl` espalhados. */
export function Card({ children, className, interactive, padded = true }: CardProps) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-xl",
        padded && "p-4",
        interactive && "transition-colors hover:border-ink-subtle",
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
        <span className={cn("w-6 h-6 grid place-items-center shrink-0", ACCENT[accent])}>
          <Icon className="w-5 h-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
