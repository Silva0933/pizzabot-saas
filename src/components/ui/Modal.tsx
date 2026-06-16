import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Header com degradê da marca (true) ou simples (false). */
  gradient?: boolean;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Diálogo centralizado, via portal. Fecha no overlay e no Esc. */
export function Modal({ open, onClose, title, subtitle, icon: Icon, gradient = true, size = "md", children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn("bg-surface rounded-2xl shadow-pop w-full overflow-hidden animate-pop-in", SIZE[size])}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            className={cn(
              "relative px-5 py-4 flex items-center gap-3",
              gradient ? "bg-brand-gradient text-white" : "border-b border-line",
            )}
          >
            {Icon && (
              <span className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0", gradient ? "bg-white/20" : "bg-brand-50 text-brand-600")}>
                <Icon className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className={cn("font-bold text-base truncate", gradient ? "text-white" : "text-ink")}>{title}</h2>
              {subtitle && <p className={cn("text-xs truncate", gradient ? "text-white/80" : "text-ink-muted")}>{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={cn("p-1.5 rounded-lg transition-colors shrink-0", gradient ? "hover:bg-white/20 text-white" : "hover:bg-surface-muted text-ink-muted")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line bg-surface-muted flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
