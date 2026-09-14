import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import type { CardAccent } from "./Card";

const ACCENT: Record<CardAccent, string> = {
  orange:  "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  emerald: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  violet:  "bg-purple-500/15 text-purple-400 border border-purple-500/20",
  sky:     "bg-sky-500/15 text-sky-400 border border-sky-500/20",
  amber:   "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  rose:    "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  slate:   "bg-slate-500/15 text-slate-400 border border-slate-500/20",
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
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick!() : undefined}
      className={cn(
        "bg-[#111622] border border-[#1e293b] rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 transition-all",
        clickable && "cursor-pointer hover:border-slate-700 hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <span className={cn("w-11 h-11 rounded-xl grid place-items-center shrink-0", ACCENT[accent])}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
          <p className="text-xl font-black text-white leading-tight truncate mt-0.5">{value}</p>
          {hint && <p className="text-[11px] text-slate-400 truncate mt-0.5">{hint}</p>}
        </div>
      </div>
      {trend ? (
        <span className={cn(
          "text-xs font-bold px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1",
          trendDown ? "text-rose-400 bg-rose-500/10" : "text-emerald-400 bg-emerald-500/10"
        )}>
          {trend}
        </span>
      ) : showChevron ? (
        <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
      ) : null}
    </div>
  );
}
