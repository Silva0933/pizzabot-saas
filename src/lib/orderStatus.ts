import {
  Sparkles, CheckCircle2, Flame, PackageOpen, Bike, PackageCheck, XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Fonte única de verdade do status de pedido.
 * Consolida o que estava duplicado em PedidosViewV2 (STATUS_META),
 * InicioDashboard (statusColor/statusLabel) e MeuNegocioViewV2 (STATUS_LABEL).
 */
export type OrderStatus =
  | "novo" | "confirmado" | "no_forno" | "pronto_entrega" | "a_caminho" | "entregue" | "cancelado";

export interface OrderStatusMeta {
  label: string;
  /** Classes do badge claro (fundo + texto + borda). */
  badge: string;
  /** Cor sólida da bolinha/indicador. */
  dot: string;
  /** Classe de texto da cor temática. */
  text: string;
  icon: LucideIcon;
}

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  novo:       { label: "Recebido",   badge: "bg-orange-500/10 text-orange-300 border-orange-500/25",       dot: "bg-orange-500",    text: "text-orange-300",    icon: Sparkles },
  confirmado: { label: "Aceito",     badge: "bg-sky-500/10 text-sky-300 border-sky-500/25", dot: "bg-sky-500", text: "text-sky-300", icon: CheckCircle2 },
  no_forno:   { label: "No forno",   badge: "bg-amber-500/10 text-amber-300 border-amber-500/25",     dot: "bg-amber-500",   text: "text-amber-300",   icon: Flame },
  pronto_entrega: { label: "Pronto p/ entrega", badge: "bg-violet-500/10 text-violet-300 border-violet-500/25", dot: "bg-violet-500", text: "text-violet-300", icon: PackageOpen },
  a_caminho:  { label: "A caminho",  badge: "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",  dot: "bg-cyan-500",  text: "text-cyan-300",  icon: Bike },
  entregue:   { label: "Entregue",   badge: "bg-green-500/10 text-green-300 border-green-500/25",     dot: "bg-green-500",   text: "text-green-300",   icon: PackageCheck },
  cancelado:  { label: "Cancelado",  badge: "bg-rose-500/10 text-rose-300 border-rose-500/25",        dot: "bg-rose-500",    text: "text-rose-300",    icon: XCircle },
};

/** Todos os status (inclui cancelado), na ordem do seletor. */
export const ORDER_STATUS_LIST: OrderStatus[] = [
  "novo", "confirmado", "no_forno", "pronto_entrega", "a_caminho", "entregue", "cancelado",
];

/** Etapas do funil operacional (cancelado fica de fora). */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "novo", "confirmado", "no_forno", "pronto_entrega", "a_caminho", "entregue",
];

/** CTA do botão "avançar" a partir do status atual (null = sem próximo passo). */
const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  novo: "Confirmar",
  confirmado: "Pôr no forno",
  no_forno: "Pronto p/ entrega",
  pronto_entrega: "Saiu p/ entrega",
  a_caminho: "Marcar entregue",
};

export function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_META;
}

export function orderStatusMeta(status: string): OrderStatusMeta {
  return ORDER_STATUS_META[(status as OrderStatus)] ?? ORDER_STATUS_META.novo;
}

export function orderStatusLabel(status: string): string {
  return orderStatusMeta(status).label;
}

/** Próximo status no funil, ou null se for terminal/fora do funil. */
export function nextOrderStatus(status: string, isDelivery: boolean = true): OrderStatus | null {
  if (!isDelivery && status === "no_forno") {
    // Retirada pula "a_caminho" e vai para "entregue" (Finalizado/Retirado)
    return "entregue";
  }
  const idx = ORDER_STATUS_FLOW.indexOf(status as OrderStatus);
  if (idx < 0 || idx >= ORDER_STATUS_FLOW.length - 1) return null;
  return ORDER_STATUS_FLOW[idx + 1];
}

/** Texto do CTA de avanço (ex.: "Confirmar", "Pôr no forno"). */
export function advanceLabel(status: string, isDelivery: boolean = true): string | null {
  if (!isDelivery) {
    if (status === "no_forno") return "Pronto p/ retirar (Finalizar)";
    if (status === "a_caminho") return "Marcar como entregue";
  }
  return ADVANCE_LABEL[status as OrderStatus] ?? null;
}
