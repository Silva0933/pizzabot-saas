import React from "react";
import { cn } from "../../lib/cn";

interface SectionTitleProps {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Título de seção com ícone opcional + dica/ação à direita. */
export function SectionTitle({ icon: Icon, children, hint, action, className }: SectionTitleProps) {
  return (
    <div className={cn("flex items-center gap-2 mb-3", className)}>
      {Icon && <Icon className="w-4 h-4 text-ink-subtle shrink-0" />}
      <h3 className="text-sm font-bold text-ink">{children}</h3>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
