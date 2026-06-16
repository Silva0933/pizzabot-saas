import { QrCode, CreditCard, Banknote, Wallet, type LucideIcon } from "lucide-react";
import type { BadgeTone } from "../../ui";
import type { BackendPedido } from "../../../lib/api";

export const brl = (n: number | string): string =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function isDelivery(tipo: string | null | undefined): boolean {
  const t = (tipo || "").toLowerCase();
  return t.includes("deliv") || t.includes("entrega");
}

/** Soma das quantidades dos itens (não o número de linhas). */
export function itemCount(itens: BackendPedido["itens"]): number {
  return (itens || []).reduce((acc, it) => acc + Number(it.quantidade ?? 1), 0);
}

// ---- Forma de pagamento ----
interface PaymentMeta {
  methodLabel: string;
  icon: LucideIcon;
  /** Estado do pagamento (badge), quando relevante. */
  stateLabel: string | null;
  stateTone: BadgeTone;
}

const METHOD_ICON: Record<string, LucideIcon> = {
  pix: QrCode,
  cartao: CreditCard,
  credito: CreditCard,
  debito: CreditCard,
  dinheiro: Banknote,
};

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function paymentMeta(forma: string | null, paymentStatus: string): PaymentMeta {
  const key = normalizeKey(forma || "");
  const icon = METHOD_ICON[key] || Wallet;
  const methodLabel = forma ? forma.charAt(0).toUpperCase() + forma.slice(1) : "A definir";

  let stateLabel: string | null = null;
  let stateTone: BadgeTone = "neutral";
  switch (paymentStatus) {
    case "approved":   stateLabel = "Pago";      stateTone = "success"; break;
    case "em_analise": stateLabel = "Conferir";  stateTone = "warning"; break;
    case "rejected":   stateLabel = "Recusado";  stateTone = "danger";  break;
    case "expired":    stateLabel = "Expirado";  stateTone = "danger";  break;
    case "pending":    stateLabel = "A pagar";   stateTone = "neutral"; break;
  }
  return { methodLabel, icon, stateLabel, stateTone };
}

// ---- Urgência por tempo (chama atenção pra pedidos parados) ----
const URGENCY_WARN_MIN = 8;
const URGENCY_LATE_MIN = 18;
/** Status em que a urgência importa (dono ainda precisa agir). */
const URGENCY_STATUSES = new Set(["novo", "confirmado"]);

export type UrgencyLevel = "calm" | "warn" | "late";

export interface Urgency {
  minutes: number;
  level: UrgencyLevel;
  label: string;
}

export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function ageLabel(minutes: number): string {
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `há ${h}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
}

export function urgency(pedido: BackendPedido): Urgency | null {
  if (!URGENCY_STATUSES.has(pedido.status)) return null;
  const minutes = minutesSince(pedido.created_at);
  const level: UrgencyLevel =
    minutes >= URGENCY_LATE_MIN ? "late" : minutes >= URGENCY_WARN_MIN ? "warn" : "calm";
  return { minutes, level, label: ageLabel(minutes) };
}

export const URGENCY_STYLE: Record<UrgencyLevel, { chip: string; ring: string }> = {
  calm: { chip: "bg-slate-100 text-slate-500", ring: "" },
  warn: { chip: "bg-amber-100 text-amber-700", ring: "ring-1 ring-amber-200" },
  late: { chip: "bg-rose-100 text-rose-700 animate-pulse", ring: "ring-1 ring-rose-300" },
};
