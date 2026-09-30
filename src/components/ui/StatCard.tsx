import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import type { CardAccent } from "./Card";

const ACCENT: Record<CardAccent, string> = {
  orange:  "text-orange-400",
  emerald: "text-emerald-400",
  violet:  "text-purple-400",
  sky:     "text-sky-400",
  amber:   "text-amber-400",
  rose:    "text-rose-400",
  slate:   "text-slate-400",
};

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  accent?: CardAccent;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: string;
  trendDown?: boolean;
  showChevron?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Tile de KPI — unifica os vários Kpi/KpiCard/MiniStat/StatCard inline. */
export function StatCard({
  icon: Icon,
  accent = "orange",
  label,
  value,
  hint,
  trend,
  trendDown,
  showChevron = true,
  onClick,
  className,
}: StatCardProps) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
      className={cn(
        "bg-surface border border-line rounded-xl p-4 flex items-center justify-between gap-3 transition-all",
        clickable && "cursor-pointer hover:border-ink-subtle",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={cn("w-6 h-6 grid place-items-center shrink-0", ACCENT[accent])}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted">{label}</p>
          <p className="text-xl font-semibold text-ink leading-tight tabular-nums mt-1">{value}</p>
          {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
        </div>
      </div>
      {trend ? (
        <span className={cn(
          "text-xs font-bold px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1",
          trendDown ? "text-rose-400 bg-rose-500/10" : "text-emerald-400 bg-emerald-500/10"
        )}>
          {trend}
        </span>
      ) : showChevron && clickable ? (
        <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
      ) : null}
    </div>
  );
}
