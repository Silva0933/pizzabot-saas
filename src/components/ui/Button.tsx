import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export type ButtonVariant =
  | "primary" | "solid" | "soft" | "success" | "danger" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "text-white bg-brand-700 hover:bg-brand-800 active:bg-brand-900",
  solid:   "text-white bg-brand-700 hover:bg-brand-800 active:bg-brand-900",
  soft:    "text-orange-400 bg-orange-500/15 border border-orange-500/25 hover:bg-orange-500/25",
  success: "text-white bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900",
  danger:  "text-white bg-rose-700 hover:bg-rose-800 active:bg-rose-900",
  outline: "text-ink bg-surface-muted border border-line hover:bg-surface hover:border-ink-subtle",
  ghost:   "text-ink-muted hover:bg-surface-muted hover:text-ink",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-2 gap-1.5 rounded-lg min-h-9",
  md: "text-sm px-4 py-2.5 gap-2 rounded-lg min-h-10",
  lg: "text-sm px-5 py-3 gap-2 rounded-lg min-h-11",
};

const BASE =
  "inline-flex items-center justify-center font-semibold transition-colors cursor-pointer select-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";

/** Classes do botão — reutilizável em <a> estilizados como botão. */
export function buttonClasses(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  const { variant = "primary", size = "md", fullWidth, className } = opts;
  return cn(BASE, VARIANT[variant], SIZE[size], fullWidth && "w-full", className);
}

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
  /** Ícone à esquerda (componente lucide ou similar). */
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  /** Passthrough para onClick, title, aria-*, form, etc. (React sem tipos no projeto). */
  [key: string]: unknown;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  isLoading,
  icon: Icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const iconCls = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <button
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className={cn(iconCls, "animate-spin")} />
      ) : (
        Icon && <Icon className={iconCls} />
      )}
      {children}
    </button>
  );
}
