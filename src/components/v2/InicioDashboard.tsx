/**
 * Dashboard de "Início" — foco no DIA, não em métricas históricas.
 *
 * Princípio: o dono abre o painel de manhã e em 5 segundos sabe
 *  - Tem pedido novo?
 *  - Tem mensagem não respondida?
 *  - Quanto vendi hoje?
 *  - Tá tudo configurado?
 *
 * Se quiser análise histórica, vai pro "Financeiro" dentro de "Meu Negócio".
 */
import React, { useMemo } from "react";
import {
  ShoppingBag,
  DollarSign,
  MessageSquare,
  ChevronRight,
  AlertCircle,
  Pizza,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import type { Order, Conversation, Pizzeria } from "../../types";
import { OnboardingChecklist, OnboardingItem } from "./OnboardingChecklist";

export interface InicioDashboardProps {
  pizzeria: Pizzeria;
  orders: Order[];
  conversations: Conversation[];
  productCount: number;
  onNavigate: (key: "pedidos" | "conversas" | "cardapio" | "negocio") => void;
  onboarding?: OnboardingItem[];
}

export function InicioDashboard({
  pizzeria,
  orders,
  conversations,
  productCount,
  onNavigate,
  onboarding,
}: InicioDashboardProps) {
  const stats = useMemo(() => computeTodayStats(orders, conversations), [orders, conversations]);

  const showChecklist = onboarding && onboarding.some((i) => !i.done);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Saudação */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-800">
          {greeting()}, {pizzeria.name?.split(" ")[0] || "tudo bem"}? 👋
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {stats.pedidosPendentes > 0
            ? `Você tem ${stats.pedidosPendentes} pedido${stats.pedidosPendentes > 1 ? "s" : ""} aguardando agora.`
            : "Tudo tranquilo até agora. Bom dia de trabalho!"}
        </p>
      </div>

      {/* Onboarding (só aparece se faltam passos) */}
      {showChecklist && <OnboardingChecklist items={onboarding!} />}

      {/* Cards de KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<ShoppingBag className="w-4 h-4" />}
          label="Pedidos hoje"
          value={stats.pedidosHoje}
          accent="orange"
          onClick={() => onNavigate("pedidos")}
        />
        <KpiCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Vendido hoje"
          value={formatBRL(stats.vendidoHoje)}
          accent="emerald"
        />
        <KpiCard
          icon={<MessageSquare className="w-4 h-4" />}
          label="Não respondidas"
          value={stats.naoLidas}
          accent={stats.naoLidas > 0 ? "amber" : "slate"}
          onClick={() => onNavigate("conversas")}
        />
        <KpiCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Ticket médio hoje"
          value={stats.pedidosHoje > 0 ? formatBRL(stats.vendidoHoje / stats.pedidosHoje) : "—"}
          accent="slate"
        />
      </div>

      {/* Pedidos pendentes (lista resumida) */}
      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Pizza className="w-4 h-4 text-orange-500" />
            Aguardando ação
            {stats.pendentes.length > 0 && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold">
                {stats.pendentes.length}
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={() => onNavigate("pedidos")}
            className="text-xs text-slate-500 hover:text-orange-600 flex items-center gap-0.5"
          >
            Ver todos
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {stats.pendentes.length === 0 ? (
          <div className="text-center py-10">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-slate-600 font-medium">Tudo em dia!</p>
            <p className="text-xs text-slate-400 mt-1">Não tem pedido esperando ação.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {stats.pendentes.slice(0, 5).map((p) => (
              <li
                key={p.id}
                className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                onClick={() => onNavigate("pedidos")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">#{p.orderNumber}</span>
                    <span className="text-xs text-slate-500 truncate">{p.customerName}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {statusLabel(p.status)} • {formatBRL(p.totalValue)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Status setup rápido */}
      <section className="grid md:grid-cols-2 gap-3">
        <QuickCard
          icon={<Pizza className="w-4 h-4" />}
          title="Cardápio"
          subtitle={
            productCount === 0
              ? "Nenhum produto cadastrado"
              : `${productCount} produto${productCount > 1 ? "s" : ""} no cardápio`
          }
          warning={productCount === 0}
          onClick={() => onNavigate("cardapio")}
        />
        <QuickCard
          icon={<Pizza className="w-4 h-4" />}
          title="Meu Negócio"
          subtitle="Horários, entrega, atendente, pagamentos"
          onClick={() => onNavigate("negocio")}
        />
      </section>
    </div>
  );
}

// ============================================
// Sub-componentes
// ============================================
function KpiCard({
  icon,
  label,
  value,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent: "orange" | "emerald" | "amber" | "slate";
  onClick?: () => void;
}) {
  const styles = {
    orange:  { bg: "bg-orange-50",  border: "border-orange-100",  iconBg: "bg-orange-100",  iconText: "text-orange-600",  hover: "hover:border-orange-200" },
    emerald: { bg: "bg-emerald-50", border: "border-emerald-100", iconBg: "bg-emerald-100", iconText: "text-emerald-600", hover: "hover:border-emerald-200" },
    amber:   { bg: "bg-amber-50",   border: "border-amber-200",   iconBg: "bg-amber-100",   iconText: "text-amber-700",   hover: "hover:border-amber-300" },
    slate:   { bg: "bg-white",      border: "border-slate-200",   iconBg: "bg-slate-100",   iconText: "text-slate-500",   hover: "hover:border-slate-300" },
  }[accent];

  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`text-left ${styles.bg} border ${styles.border} ${onClick ? `${styles.hover} transition-colors` : ""} rounded-xl p-3`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg ${styles.iconBg} ${styles.iconText} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
      <p className="text-lg font-bold text-slate-800 mt-0.5">{value}</p>
    </Comp>
  );
}

function QuickCard({
  icon,
  title,
  subtitle,
  warning,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white border rounded-xl p-4 flex items-center gap-3 transition-colors hover:border-orange-200 hover:bg-orange-50/30 ${
        warning ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
        warning ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
      }`}>
        {warning ? <AlertCircle className="w-5 h-5" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300" />
    </button>
  );
}

// ============================================
// Helpers
// ============================================
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    novo: "Novo pedido",
    confirmado: "Aguardando preparo",
    no_forno: "No forno",
    a_caminho: "Saiu para entrega",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };
  return m[s] || s;
}

function computeTodayStats(orders: Order[], conversations: Conversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hoje = orders.filter((o) => new Date(o.createdAt) >= today && o.status !== "cancelado");
  const vendidoHoje = hoje
    .filter((o) => (o as any).paymentStatus === "approved" || o.status === "entregue")
    .reduce((sum, o) => sum + (o.totalValue || 0), 0);

  const pendentes = hoje.filter((o) => o.status === "novo" || o.status === "confirmado");
  const naoLidas = conversations.reduce((n, c: any) => n + (c.unreadCount || c.unread_count || 0), 0);

  return {
    pedidosHoje: hoje.length,
    vendidoHoje,
    pedidosPendentes: pendentes.length,
    naoLidas,
    pendentes,
  };
}
