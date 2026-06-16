import React from "react";
import { cn } from "../../lib/cn";
import { orderStatusMeta } from "../../lib/orderStatus";

export type BadgeTone =
  | "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

const TONE: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400" },
  brand:   { badge: "bg-brand-50 text-brand-700 border-brand-200",       dot: "bg-brand-500" },
  success: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  warning: { badge: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500" },
  danger:  { badge: "bg-rose-50 text-rose-700 border-rose-200",          dot: "bg-rose-500" },
  info:    { badge: "bg-blue-50 text-blue-700 border-blue-200",          dot: "bg-blue-500" },
  violet:  { badge: "bg-violet-50 text-violet-700 border-violet-200",    dot: "bg-violet-500" },
};

interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  /** Mostra a bolinha colorida à esquerda. */
  dot?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}

export function Badge({ children, tone = "neutral", dot, icon: Icon, className }: BadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border",
        t.badge,
        className,
      )}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />}
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </span>
  );
}

/** Badge derivado do status de pedido (usa a fonte única orderStatus). */
export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = orderStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border",
        meta.badge,
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}
