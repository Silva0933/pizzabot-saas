import React from "react";
import { cn } from "../../lib/cn";
import type { CardAccent } from "./Card";

const ACCENT: Record<CardAccent, string> = {
  orange:  "bg-brand-50 text-brand-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet:  "bg-violet-50 text-violet-600",
  sky:     "bg-sky-50 text-sky-600",
  amber:   "bg-amber-50 text-amber-600",
  rose:    "bg-rose-50 text-rose-600",
  slate:   "bg-slate-100 text-slate-600",
};

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  accent?: CardAccent;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Tile de KPI — unifica os vários Kpi/KpiCard/MiniStat/StatCard inline. */
export function StatCard({ icon: Icon, accent = "orange", label, value, hint, onClick, className }: StatCardProps) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick!() : undefined}
      className={cn(
        "bg-surface border border-line rounded-2xl p-3.5 shadow-card flex items-center gap-3",
        clickable && "cursor-pointer transition-all hover:shadow-card-hover hover:-translate-y-0.5",
        className,
      )}
    >
      <span className={cn("w-10 h-10 rounded-xl grid place-items-center shrink-0", ACCENT[accent])}>
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-[11px] font-semibold text-ink-subtle uppercase truncate">{label}</p>
        <p className="text-base sm:text-lg font-bold text-ink leading-tight truncate">{value}</p>
        {hint && <p className="text-[11px] text-ink-muted truncate">{hint}</p>}
      </div>
    </div>
  );
}
