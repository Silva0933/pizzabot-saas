import React from "react";
import { cn } from "../../lib/cn";

const INPUT_BASE =
  "w-full bg-surface border border-line rounded-xl text-sm text-ink placeholder:text-ink-subtle " +
  "outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

interface InputProps {
  ref?: React.Ref<HTMLInputElement>;
  icon?: React.ComponentType<{ className?: string }>;
  invalid?: boolean;
  className?: string;
  /** Passthrough para value, onChange, placeholder, type, etc. (React sem tipos no projeto). */
  [key: string]: unknown;
}

export function Input({ icon: Icon, invalid, className, ref, ...rest }: InputProps) {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}
      <input
        ref={ref}
        className={cn(
          INPUT_BASE,
          Icon ? "pl-9 pr-3 py-2" : "px-3 py-2",
          invalid && "border-rose-300 focus:border-rose-400 focus:ring-rose-100",
          className,
        )}
        {...rest}
      />
    </div>
  );
}

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Wrapper de campo: rótulo + controle + dica/erro. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      {label && (
        <span className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
          {label}
          {required && <span className="text-rose-500 ml-0.5">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="block text-xs text-rose-600 mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-ink-subtle mt-1">{hint}</span>
      ) : null}
    </label>
  );
}
