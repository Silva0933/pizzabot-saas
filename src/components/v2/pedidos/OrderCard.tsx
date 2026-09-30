import React from "react";
import {
  Phone, MapPin, Store, MessageCircle, Clock, Check, X, Receipt,
  Hash, User, Bike, Loader2, History, Wrench, TriangleAlert, CircleCheck,
} from "lucide-react";
import { Button, Badge, OrderStatusBadge, buttonClasses } from "../../ui";
import { cn } from "../../../lib/cn";
import { nextOrderStatus, advanceLabel, orderStatusLabel } from "../../../lib/orderStatus";
import type { BackendPedido } from "../../../lib/api";
import {
  brl, isDelivery, itemCount, paymentMeta, urgency, URGENCY_STYLE,
} from "./pedidoUtils";

interface OrderCardProps {
  pedido: BackendPedido;
  statusLabel: (k: string) => string;
  moving: boolean;
  paying: boolean;
  comprovante: boolean;
  onStatus: (s: string) => void;
  onConferir: (acao: "confirmar" | "rejeitar") => void;
  onHistory: () => void;
  onCorrect: () => void;
  onProblem: () => void;
  onResolveProblem: () => void;
  /** Entregadores ativos da pizzaria (para o seletor de atribuição). */
  entregadores?: { id: string; nome: string; disponivel: boolean }[];
  onAtribuir?: (entregadorId: string | null) => void;
  assigning?: boolean;
}

export function OrderCard({
  pedido: p, statusLabel, moving, paying, comprovante, onStatus, onConferir,
  onHistory, onCorrect, onProblem, onResolveProblem, entregadores, onAtribuir, assigning,
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
  // Compacto por padrão: aberto, o card media ~490 px e a coluna "Recebido"
  // mostrava UM pedido por tela — com 3 ou 4 a equipe perdia os outros.
  const [aberto, setAberto] = React.useState(false);
  const resumoItens = (p.itens || [])
    .map((it) => `${Number(it.quantidade ?? 1)}× ${it.nome}`)
    .join(", ");

  return (
    <article className={cn("pzb-order-card relative bg-surface border rounded-xl overflow-hidden flex flex-col", ringCls)}>
      {/* Header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-sm font-extrabold text-ink shrink-0">
            <Hash className="w-3.5 h-3.5 text-ink-subtle" />
            {p.numero_pedido ?? "—"}
          </span>
        </div>
        <time className="text-xs tabular-nums text-ink-subtle">{new Date(p.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
      </div>

      {/* Faixa de conferência do Pix manual */}
      {aguardandoConferencia && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <Receipt className="w-3.5 h-3.5" />
          {comprovante ? "Comprovante recebido — confira o pagamento" : "Pix manual — aguardando comprovante"}
        </div>
      )}

      {/* Conferência da loja (comportamento da pizzaria): a IA fechou, a equipe aprova */}
      {p.aguardando_revisao && p.status === "novo" && (
        <div className="px-4 py-2 bg-violet-500/10 border-b border-violet-500/25 flex items-center gap-1.5 text-xs font-semibold text-violet-300">
          <CircleCheck className="w-3.5 h-3.5 shrink-0" />
          <span>Pedido da IA — confira e confirme para ir à cozinha</span>
        </div>
      )}

      {p.em_problema && (
        <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/25 flex items-center gap-1.5 text-xs font-semibold text-rose-300">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Problema: {p.problema_motivo || "precisa de revisao"}</span>
        </div>
      )}

      <div className="px-3 py-2 space-y-2.5 flex-1">
        {/* Cliente */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-bold text-ink min-w-0 flex-1">

            <span className="break-words">{p.cliente?.nome || "Cliente novo"}</span>
          </p>
          {urg && (
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-md shrink-0", URGENCY_STYLE[urg.level].chip)}>
              <Clock className="w-3 h-3" /> {urg.label}
            </span>
          )}
        </div>

        {!aberto && (
          <>
            <ul className="text-xs leading-relaxed text-ink-muted space-y-0.5" title={resumoItens}>
              {(p.itens || []).slice(0,3).map((it,idx)=><li key={idx}>{Number(it.quantidade ?? 1)}× {it.nome}</li>)}
              {(p.itens || []).length > 3 && <li>+{p.itens.length - 3} outros itens · ver detalhes</li>}
              {!(p.itens || []).length && <li className="italic">Rascunho (sem itens)</li>}
            </ul>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-base font-semibold text-ink tabular-nums">{brl(p.valor_total)}</span>
              <Badge tone={delivery ? "neutral":"info"} icon={delivery ? Bike:Store}>{delivery ? "Delivery":"Retirada"}</Badge>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-ink-muted min-w-0">
              {delivery ? <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <Store className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span className="break-words">{delivery ? (p.endereco_entrega || <span className="text-rose-300">Endereço não informado</span>) : "Retirada no balcão"}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              <pay.icon className="w-3.5 h-3.5" /> {pay.methodLabel}
              {pay.stateLabel && <Badge tone={pay.stateTone} dot>{pay.stateLabel}</Badge>}
            </div>
          </>
        )}

        {aberto && (<>
        {/* Entrega/Retirada — bloco destacado (dado de despacho) */}
        <div className={cn(
          "rounded-xl px-3 py-2 flex items-start gap-2 text-sm",
          delivery ? "bg-brand-500/10 border border-brand-500/25" : "bg-blue-500/10 border border-blue-500/25",
        )}>
          {delivery
            ? <MapPin className="w-4 h-4 text-brand-300 shrink-0 mt-0.5" />
            : <Store className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={cn("text-xs font-bold uppercase tracking-wide", delivery ? "text-brand-300" : "text-blue-300")}>
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
          <p className="text-xs font-bold text-ink-subtle uppercase tracking-wide mb-1.5">
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
                <li key={idx} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <span className="flex items-start gap-1.5 min-w-0 flex-1">
                    <span className="inline-flex items-center justify-center text-xs font-bold text-brand-300 bg-brand-500/10 rounded-md px-1.5 h-5 shrink-0">{q}×</span>
                    <span className="text-ink leading-snug break-words min-w-0 flex-1">{it.nome}</span>
                  </span>
                  {pu > 0 && <span className="text-ink-muted text-xs shrink-0 mt-0.5">{brl(pu * q)}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Observações */}
        {p.observacoes && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold">Obs:</span> {p.observacoes}
          </p>
        )}

        {/* Total + pagamento */}
        <div className="flex items-end justify-between gap-2 pt-1 border-t border-line">
          <div className="pt-2">
            <p className="text-xs text-ink-subtle">Total</p>
            <p className="text-xl font-semibold text-ink tabular-nums leading-none">{brl(p.valor_total)}</p>
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
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-brand-300 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> {tel}
          </a>
        )}
        </>)}
      </div>

      {/* Footer: ações */}
      <div className="px-3 py-3 border-t border-line space-y-2">
        {/* Atribuição de entregador (apenas delivery) */}
        {aberto && delivery && onAtribuir && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted shrink-0">
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
            <Button variant="outline" size="sm" icon={X} disabled={paying} onClick={() => onConferir("rejeitar")} className="text-rose-300 border-rose-500/25 hover:bg-rose-500/10">
              Rejeitar
            </Button>
          </div>
        )}

        {/* Avanco sequencial: nao permite pular fases por acidente. */}
        <div className={cn("pzb-order-actions", !aberto && "pzb-order-primary-actions")}>
          {!aberto && <Button variant="outline" size="sm" className="pzb-order-details" onClick={() => setAberto(true)} title="Ver endereço, itens, entregador e mais ações">Detalhes</Button>}
          {next ? (
            <Button variant="primary" size="sm" className="pzb-order-advance" isLoading={moving} onClick={() => onStatus(next)}>
              {nextLabel || `Avançar p/ ${orderStatusLabel(next)}`}
            </Button>
          ) : (
            <span className="flex-1 text-xs text-ink-subtle italic">Pedido finalizado</span>
          )}
          {aberto ? (
            <Button variant="outline" size="sm" icon={Wrench} disabled={moving} onClick={onCorrect}>
              Corrigir
            </Button>
          ) : null}
        </div>

        {aberto && (<>
        {/* Whatsapp e acoes auditaveis. Pedidos nao podem mais ser excluidos. */}
        <div className="pzb-order-actions">
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
          <Button variant="ghost" size="sm" icon={History} onClick={onHistory} title="Ver historico do pedido">
            Historico
          </Button>
          {p.em_problema ? (
            <Button variant="ghost" size="sm" icon={CircleCheck} onClick={onResolveProblem} className="text-emerald-300 hover:bg-emerald-500/10">
              Resolver
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon={TriangleAlert} onClick={onProblem} className="text-rose-300 hover:bg-rose-500/10">
              Problema
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <p className="text-xs text-ink-subtle flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(p.created_at).toLocaleString("pt-BR")}
          </p>
          <button type="button" onClick={() => setAberto(false)} className="text-xs font-semibold text-ink-muted hover:text-ink">
            Recolher
          </button>
        </div>
        </>)}
      </div>
    </article>
  );
}
