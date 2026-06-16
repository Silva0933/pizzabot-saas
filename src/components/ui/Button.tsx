import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export type ButtonVariant =
  | "primary" | "solid" | "soft" | "success" | "danger" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "text-white bg-brand-gradient shadow-brand hover:brightness-105 active:brightness-95",
  solid:   "text-white bg-brand-500 hover:bg-brand-600 active:bg-brand-700",
  soft:    "text-brand-700 bg-brand-50 border border-brand-100 hover:bg-brand-100",
  success: "text-white bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700",
  danger:  "text-white bg-rose-500 hover:bg-rose-600 active:bg-rose-700",
  outline: "text-ink bg-surface border border-line hover:bg-surface-muted",
  ghost:   "text-ink-muted hover:bg-surface-muted hover:text-ink",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5 rounded-lg",
  md: "text-sm px-4 py-2 gap-2 rounded-xl",
  lg: "text-sm px-5 py-2.5 gap-2 rounded-xl",
};

const BASE =
  "inline-flex items-center justify-center font-semibold transition-all cursor-pointer select-none " +
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
