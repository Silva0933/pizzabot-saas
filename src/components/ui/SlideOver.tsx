import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Largura máxima do painel. */
  maxWidth?: string;
}

/** Gaveta lateral (direita), via portal. Fecha no overlay e no Esc. */
export function SlideOver({ open, onClose, title, subtitle, children, footer, maxWidth = "max-w-xl" }: SlideOverProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-screen bg-surface shadow-pop flex flex-col animate-slide-in-right",
          maxWidth,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="px-5 py-4 border-b border-line flex items-center gap-3 shrink-0">
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-base text-ink truncate">{title}</h2>
              {subtitle && <p className="text-xs text-ink-muted truncate">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-muted text-ink-muted transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line bg-surface-muted flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
