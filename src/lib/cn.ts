import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — combina classes condicionais (clsx) e resolve conflitos do Tailwind
 * (tailwind-merge). Use em todos os primitivos de UI e onde houver classes
 * dinâmicas que possam colidir (ex.: `px-3` sobrescrito por uma variante).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
