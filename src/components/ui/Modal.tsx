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
export function Modal({ open, onClose, title, subtitle, icon: Icon, gradient = false, size = "md", children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-[#111622] border border-[#1e293b] text-white rounded-2xl shadow-2xl w-full overflow-hidden animate-pop-in duration-200",
          SIZE[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="relative px-6 py-4 border-b border-[#1e293b] bg-[#161f30] flex items-center gap-3.5">
            {Icon && (
              <span className="w-10 h-10 rounded-xl bg-[#241a12] border border-amber-900/30 text-orange-400 grid place-items-center shrink-0">
                <Icon className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-base text-white truncate">{title}</h2>
              {subtitle && <p className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-[#111622] hover:bg-[#1e293b] text-slate-400 hover:text-white border border-[#1e293b] grid place-items-center transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 max-h-[75vh] overflow-y-auto bg-[#111622] text-slate-200">{children}</div>
        {footer && (
          <div className="px-6 py-3.5 border-t border-[#1e293b] bg-[#161f30] flex justify-end items-center gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
