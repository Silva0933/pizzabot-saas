import React from "react";
import {
  Phone, MapPin, Store, MessageCircle, Trash2, Clock, Check, X, Receipt,
  Hash, User, Bike, Loader2,
} from "lucide-react";
import { Button, Badge, OrderStatusBadge, buttonClasses } from "../../ui";
import { cn } from "../../../lib/cn";
import { nextOrderStatus, advanceLabel, ORDER_STATUS_LIST, orderStatusLabel } from "../../../lib/orderStatus";
import type { BackendPedido } from "../../../lib/api";
import {
  brl, isDelivery, itemCount, paymentMeta, urgency, URGENCY_STYLE,
} from "./pedidoUtils";

interface OrderCardProps {
  pedido: BackendPedido;
  statusLabel: (k: string) => string;
  moving: boolean;
  deleting: boolean;
  paying: boolean;
  comprovante: boolean;
  onStatus: (s: string) => void;
  onDelete: () => void;
  onConferir: (acao: "confirmar" | "rejeitar") => void;
  /** Entregadores ativos da pizzaria (para o seletor de atribuição). */
  entregadores?: { id: string; nome: string; disponivel: boolean }[];
  onAtribuir?: (entregadorId: string | null) => void;
  assigning?: boolean;
}

export function OrderCard({
  pedido: p, statusLabel, moving, deleting, paying, comprovante,
  onStatus, onDelete, onConferir, entregadores, onAtribuir, assigning,
}: OrderCardProps) {
  const delivery = isDelivery(p.tipo);
  const tel = p.cliente?.telefone;
  const aguardandoConferencia = p.payment_status === "em_analise";
  const pay = paymentMeta(p.forma_pagamento, p.payment_status);
  const urg = urgency(p);
  const next = nextOrderStatus(p.status, delivery);
  const nextLabel = advanceLabel(p.status, delivery);
  const totalItens = itemCount(p.itens);

  const ringCls = aguardandoConferencia
    ? "border-amber-300 ring-1 ring-amber-200"
    : urg ? cn("border-line", URGENCY_STYLE[urg.level].ring) : "border-line";

  return (
    <article className={cn("relative bg-surface border rounded-2xl shadow-card overflow-hidden flex flex-col", ringCls)}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between gap-2 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-sm font-extrabold text-ink shrink-0">
            <Hash className="w-3.5 h-3.5 text-ink-subtle" />
            {p.numero_pedido ?? "—"}
          </span>
          {delivery ? (
            <Badge tone="brand" className="shrink-0">🛵 Entrega</Badge>
          ) : (
            <Badge tone="info" className="shrink-0">🏪 Retirada</Badge>
          )}
        </div>
        <OrderStatusBadge status={p.status} className="shrink-0" />
      </div>

      {/* Faixa de conferência do Pix manual */}
      {aguardandoConferencia && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
          <Receipt className="w-3.5 h-3.5" />
          {comprovante ? "Comprovante recebido — confira o pagamento" : "Pix manual — aguardando comprovante"}
        </div>
      )}

      <div className="px-4 py-3 space-y-3 flex-1">
        {/* Cliente */}
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-bold text-ink min-w-0">
            <User className="w-4 h-4 text-ink-subtle shrink-0" />
            <span className="truncate">{p.cliente?.nome || "Cliente novo"}</span>
          </p>
          {urg && (
            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0", URGENCY_STYLE[urg.level].chip)}>
              <Clock className="w-3 h-3" /> {urg.label}
            </span>
          )}
        </div>

        {/* Entrega/Retirada — bloco destacado (dado de despacho) */}
        <div className={cn(
          "rounded-xl px-3 py-2 flex items-start gap-2 text-sm",
          delivery ? "bg-brand-50 border border-brand-100" : "bg-blue-50 border border-blue-100",
        )}>
          {delivery
            ? <MapPin className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
            : <Store className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={cn("text-[10px] font-bold uppercase tracking-wide", delivery ? "text-brand-700" : "text-blue-700")}>
              {delivery ? "Entregar em" : "Retirada no balcão"}
            </p>
            {delivery && (
              <p className="text-ink leading-snug break-words">
                {p.endereco_entrega || <span className="text-rose-500 font-medium">Endereço não informado</span>}
              </p>
            )}
          </div>
        </div>

        {/* Itens — sem truncar */}
        <div>
          <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">
            Itens · {totalItens}
          </p>
          <ul className="space-y-1 text-sm">
            {(p.itens || []).length === 0 && (
              <li className="text-ink-subtle italic text-xs">Rascunho (sem itens)</li>
            )}
            {(p.itens || []).map((it, idx) => {
              const q = Number(it.quantidade ?? 1);
              const pu = Number(it.preco_unit ?? 0);
              return (
                <li key={idx} className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-1.5 min-w-0">
                    <span className="inline-flex items-center justify-center text-[11px] font-bold text-brand-700 bg-brand-50 rounded-md px-1.5 h-5 shrink-0">{q}×</span>
                    <span className="text-ink leading-snug break-words">{it.nome}</span>
                  </span>
                  {pu > 0 && <span className="text-ink-muted text-xs shrink-0 mt-0.5">{brl(pu * q)}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Observações */}
        {p.observacoes && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold">Obs:</span> {p.observacoes}
          </p>
        )}

        {/* Total + pagamento */}
        <div className="flex items-end justify-between gap-2 pt-1 border-t border-line">
          <div className="pt-2">
            <p className="text-[11px] text-ink-subtle">Total</p>
            <p className="text-xl font-extrabold text-emerald-600 leading-none">{brl(p.valor_total)}</p>
          </div>
          <div className="pt-2 flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <pay.icon className="w-3.5 h-3.5 text-ink-subtle" />
              {pay.methodLabel}
            </span>
            {pay.stateLabel && <Badge tone={pay.stateTone} dot>{pay.stateLabel}</Badge>}
          </div>
        </div>

        {/* Contato */}
        {tel && (
          <a
            href={`https://wa.me/${tel}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-600 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> {tel}
          </a>
        )}
      </div>

      {/* Footer: ações */}
      <div className="px-4 py-3 border-t border-line bg-surface-muted/60 space-y-2">
        {/* Atribuição de entregador (apenas delivery) */}
        {delivery && onAtribuir && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted shrink-0">
              <Bike className="w-3.5 h-3.5" /> Entregador
            </span>
            <select
              value={p.entregador_id || ""}
              disabled={assigning || !entregadores || entregadores.length === 0}
              onChange={(e) => onAtribuir(e.target.value || null)}
              className="flex-1 px-2.5 py-1.5 border border-line rounded-lg text-xs font-medium text-ink bg-surface outline-none focus:border-brand-400 disabled:opacity-50 cursor-pointer"
            >
              {(!entregadores || entregadores.length === 0) ? (
                <option value="">— Sem entregadores ativos —</option>
              ) : (
                <>
                  <option value="">— Sem entregador —</option>
                  {entregadores.map((en) => (
                    <option key={en.id} value={en.id}>{en.nome}{en.disponivel ? " • disponível" : ""}</option>
                  ))}
                </>
              )}
            </select>
            {assigning && <Loader2 className="w-4 h-4 animate-spin text-brand-500 shrink-0" />}
          </div>
        )}

        {/* Conferência do Pix manual */}
        {aguardandoConferencia && (
          <div className="flex items-center gap-2">
            <Button variant="success" size="sm" fullWidth icon={Check} isLoading={paying} onClick={() => onConferir("confirmar")}>
              Confirmar pagamento
            </Button>
            <Button variant="outline" size="sm" icon={X} disabled={paying} onClick={() => onConferir("rejeitar")} className="text-rose-600 border-rose-200 hover:bg-rose-50">
              Rejeitar
            </Button>
          </div>
        )}

        {/* Avançar status + override */}
        <div className="flex items-center gap-2">
          {next ? (
            <Button variant="primary" size="sm" fullWidth isLoading={moving} onClick={() => onStatus(next)}>
              {nextLabel || `Avançar p/ ${orderStatusLabel(next)}`}
            </Button>
          ) : (
            <span className="flex-1 text-xs text-ink-subtle italic">Pedido finalizado</span>
          )}
          <select
            value={p.status}
            disabled={moving}
            onChange={(e) => onStatus(e.target.value)}
            title="Alterar status manualmente"
            className="px-2.5 py-1.5 border border-line rounded-lg text-xs font-medium text-ink-muted bg-surface outline-none focus:border-brand-400 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {ORDER_STATUS_LIST.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>

        {/* WhatsApp + excluir */}
        <div className="flex items-center gap-2">
          {tel && (
            <a
              href={`https://wa.me/${tel}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: "success", size: "sm", fullWidth: true })}
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          )}
          <Button variant="ghost" size="sm" icon={Trash2} isLoading={deleting} onClick={onDelete} className="text-rose-500 hover:bg-rose-50 hover:text-rose-600">
            Excluir
          </Button>
        </div>

        <p className="text-[10px] text-ink-subtle flex items-center gap-1 pt-0.5">
          <Clock className="w-3 h-3" />
          {new Date(p.created_at).toLocaleString("pt-BR")}
        </p>
      </div>
    </article>
  );
}
