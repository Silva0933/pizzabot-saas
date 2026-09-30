import React, { useEffect, useId, useRef } from "react";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[data-pzb-modal]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
      if (e.key === "Tab") {
        const controls = (Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []) as HTMLElement[]).filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { e.preventDefault(); dialog?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-black/75"
      onClick={onClose}
    >
      <div
        ref={dialogRef} data-pzb-modal role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Diálogo"} tabIndex={-1}
        className={cn(
          "bg-surface border border-line text-ink rounded-xl shadow-pop w-full max-h-[calc(100dvh-24px)] flex flex-col overflow-hidden animate-pop-in",
          SIZE[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="relative shrink-0 px-4 md:px-6 py-4 border-b border-line bg-surface-muted flex items-center gap-3.5">
            {Icon && (
              <span className="w-10 h-10 rounded-xl bg-[#241a12] border border-amber-900/30 text-orange-400 grid place-items-center shrink-0">
                <Icon className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-bold text-base text-ink break-words">{title}</h2>
              {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
            </div>
            <button
              type="button" aria-label="Fechar diálogo"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-surface hover:bg-[#1e293b] text-ink-muted hover:text-white border border-line grid place-items-center transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-4 md:px-6 py-5 min-h-0 overflow-y-auto bg-surface text-slate-200">{children}</div>
        {footer && (
          <div className="px-4 md:px-6 py-3.5 border-t border-line bg-surface-muted shrink-0 flex flex-wrap justify-end items-center gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
