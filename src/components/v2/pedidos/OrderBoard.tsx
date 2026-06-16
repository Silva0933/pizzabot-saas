import React from "react";
import { cn } from "../../../lib/cn";
import { ORDER_STATUS_FLOW, ORDER_STATUS_META, type OrderStatus } from "../../../lib/orderStatus";
import type { BackendPedido } from "../../../lib/api";

interface OrderBoardProps {
  pedidos: BackendPedido[];
  statusLabel: (k: string) => string;
  renderCard: (p: BackendPedido) => React.ReactNode;
}

/**
 * Quadro estilo Kanban: colunas por status no desktop (rolagem horizontal),
 * colapsa em seções empilhadas no mobile. Cancelados só aparecem se houver.
 */
export function OrderBoard({ pedidos, statusLabel, renderCard }: OrderBoardProps) {
  const grupos = new Map<string, BackendPedido[]>();
  for (const p of pedidos) {
    const arr = grupos.get(p.status) || [];
    arr.push(p);
    grupos.set(p.status, arr);
  }

  const colunas: OrderStatus[] = [...ORDER_STATUS_FLOW];
  if ((grupos.get("cancelado") || []).length > 0) colunas.push("cancelado");

  return (
    <div className="flex flex-col xl:flex-row xl:gap-4 xl:overflow-x-auto gap-5 pb-2">
      {colunas.map((status) => {
        const itens = grupos.get(status) || [];
        const meta = ORDER_STATUS_META[status];
        return (
          <section key={status} className="xl:w-[340px] xl:shrink-0 flex flex-col">
            {/* Cabeçalho da coluna */}
            <div className="flex items-center gap-2 mb-2.5 px-0.5 xl:sticky xl:top-0">
              <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
              <h3 className="text-sm font-bold text-ink">{statusLabel(status)}</h3>
              <span className="ml-auto text-[11px] font-bold text-ink-muted bg-surface-muted border border-line rounded-full px-2 py-0.5">
                {itens.length}
              </span>
            </div>

            {/* Cards */}
            {itens.length === 0 ? (
              <div className="hidden xl:flex items-center justify-center text-xs text-ink-subtle border border-dashed border-line rounded-2xl py-10">
                Sem pedidos
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
                {itens.map((p) => (
                  <div key={p.id}>{renderCard(p)}</div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
