import React, { useState } from "react";
import { cn } from "../../../lib/cn";
import { ORDER_STATUS_FLOW, ORDER_STATUS_META, type OrderStatus } from "../../../lib/orderStatus";
import type { BackendPedido } from "../../../lib/api";

interface OrderBoardProps {
  pedidos: BackendPedido[];
  statusLabel: (k: string) => string;
  renderCard: (p: BackendPedido) => React.ReactNode;
}

/**
 * Quadro estilo Kanban: colunas por status no desktop (rolagem horizontal).
 * No mobile, exibe Abas horizontais e renderiza apenas a coluna selecionada.
 */
export function OrderBoard({ pedidos, statusLabel, renderCard }: OrderBoardProps) {
  const [mobileTab, setMobileTab] = useState<OrderStatus>("novo");

  const grupos = new Map<string, BackendPedido[]>();
  for (const p of pedidos) {
    const arr = grupos.get(p.status) || [];
    arr.push(p);
    grupos.set(p.status, arr);
  }

  const colunas: OrderStatus[] = [...ORDER_STATUS_FLOW];
  if ((grupos.get("cancelado") || []).length > 0) colunas.push("cancelado");

  return (
    <div className="flex flex-col gap-4 pb-2">
      {/* Abas no Mobile */}
      <div className="xl:hidden flex gap-2 overflow-x-auto pb-3 border-b border-line">
        {colunas.map((status) => {
          const meta = ORDER_STATUS_META[status];
          const isActive = mobileTab === status;
          const count = (grupos.get(status) || []).length;
          return (
            <button
              key={status}
              type="button" aria-pressed={isActive}
              onClick={() => setMobileTab(status)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-lg shrink-0 text-xs font-semibold transition-colors border min-h-10",
                isActive ? "bg-brand-700 text-white border-brand-700" : "bg-surface-muted border-transparent text-ink-muted hover:bg-surface-elevated"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
              {statusLabel(status)}
              <span className="ml-1 text-[11px] bg-surface-muted text-ink-muted px-1.5 py-0.5 rounded-full">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid do Kanban */}
      {/* No desktop o quadro ocupa a altura da tela e CADA coluna rola sozinha:
          antes a página inteira rolava e, com 3-4 pedidos em "Recebido", as outras
          colunas e os cabeçalhos sumiam de vista. */}
      <div className="pzb-kanban">
        {colunas.map((status) => {
          const itens = grupos.get(status) || [];
          const meta = ORDER_STATUS_META[status];
          const isMobileActive = mobileTab === status;

          return (
            <section
              key={status}
              className={cn(
                "pzb-kanban-column min-w-0 flex-col xl:min-h-0",
                isMobileActive ? "flex" : "hidden xl:flex"
              )}
            >
              {/* Cabeçalho da coluna (Desktop) */}
              <div className="hidden xl:flex items-center gap-2 mb-3 pb-3 border-b border-line xl:sticky xl:top-0">
                <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
                <h3 className="text-xs font-semibold text-ink">{statusLabel(status)}</h3>
                <span className="ml-auto text-[11px] font-bold text-ink-muted bg-surface-muted border border-line rounded-full px-2 py-0.5">
                  {itens.length}
                </span>
              </div>

              {/* Cards */}
              {itens.length === 0 ? (
                <div className="flex flex-col gap-3 flex-1 items-center justify-center text-xs text-ink-subtle rounded-xl py-10">
                  <meta.icon className="w-9 h-9 stroke-[1.5]" />Sem pedidos
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 xl:content-start gap-3 xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                  {itens.map((p) => (
                    <div key={p.id}>{renderCard(p)}</div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
