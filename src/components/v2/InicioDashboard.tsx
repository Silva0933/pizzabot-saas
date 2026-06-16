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
import React, { useMemo, useState } from "react";
import {
  ShoppingBag,
  DollarSign,
  MessageSquare,
  ChevronRight,
  AlertCircle,
  Pizza,
  TrendingUp,
  CheckCircle2,
  UtensilsCrossed,
  Store,
  ArrowRight,
  Bell,
  Settings,
  X,
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

  const [showConfig, setShowConfig] = useState(false);
  const pendentesConfig = (onboarding ?? []).filter((i) => !i.done).length;
  const showChecklist = pendentesConfig > 0;
  const humanoNecessario = conversations.filter((c: any) => 
    c.status === "Humano necessário" || c.status === "humano_necessario" || 
    (c as any).raw_status === "humano_necessario"
  ).length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto pb-24 md:pb-6">
      {/* Hero — saudação em gradiente */}
      <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-5 md:p-6 text-white shadow-brand">
        {/* Decoração */}
        <div className="absolute -right-6 -top-8 opacity-20 select-none pointer-events-none">
          <Pizza className="w-40 h-40" />
        </div>
        {/* Botão pulsante de configuração pendente */}
        {showChecklist && (
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            title={`${pendentesConfig} configuração(ões) pendente(s)`}
            className="absolute right-4 top-4 z-10 w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm grid place-items-center transition-colors"
          >
            <Settings className="w-5 h-5 text-white" />
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-white text-orange-600 text-[11px] font-bold grid place-items-center shadow">
              {pendentesConfig}
            </span>
            <span className="absolute inset-0 rounded-full ring-2 ring-white/60 animate-ping" />
          </button>
        )}

        <div className="relative">
          <p className="text-xs font-medium text-white/80 uppercase tracking-wide">{todayLabel()}</p>
          <h2 className="text-2xl md:text-3xl font-bold mt-1">
            {greeting()}, {pizzeria.name || "tudo bem"}? 👋
          </h2>
          <p className="text-sm text-white/90 mt-2 max-w-lg">
            {stats.pedidosPendentes > 0
              ? `Você tem ${stats.pedidosPendentes} pedido${stats.pedidosPendentes > 1 ? "s" : ""} aguardando ação agora.`
              : "Tudo tranquilo até agora. Bom dia de trabalho!"}
          </p>

          {/* Mini-resumo dentro do hero */}
          <div className="flex flex-wrap gap-2 mt-4">
            <HeroPill icon={<ShoppingBag className="w-3.5 h-3.5" />} label={`${stats.pedidosHoje} pedidos hoje`} />
            <HeroPill icon={<DollarSign className="w-3.5 h-3.5" />} label={`${formatBRL(stats.vendidoHoje)} vendido`} />
            {stats.naoLidas > 0 && (
              <HeroPill icon={<MessageSquare className="w-3.5 h-3.5" />} label={`${stats.naoLidas} sem resposta`} pulse />
            )}
          </div>
        </div>
      </div>

      {/* Alerta de atendimento humano */}
      {humanoNecessario > 0 && (
        <button
          type="button"
          onClick={() => onNavigate("conversas")}
          className="w-full bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md hover:border-red-300 transition-all group animate-pulse"
        >
          <div className="w-12 h-12 rounded-xl bg-red-500 text-white flex items-center justify-center shadow-sm shrink-0">
            <Bell className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-bold text-red-700">
              🔴 {humanoNecessario} {humanoNecessario === 1 ? 'cliente precisa' : 'clientes precisam'} de atendimento humano
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              Clique para abrir as conversas e atender
            </p>
          </div>
          <ArrowRight className="w-5 h-5 text-red-400 group-hover:text-red-600 group-hover:translate-x-1 transition-all" />
        </button>
      )}

      {/* Onboarding — só abre ao clicar no ícone pulsante de config */}
      {showChecklist && showConfig && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowConfig(false)}
            className="absolute right-3 top-3 z-10 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
          <OnboardingChecklist items={onboarding!} />
        </div>
      )}

      {/* Cards de KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<ShoppingBag className="w-5 h-5" />}
          label="Pedidos hoje"
          value={stats.pedidosHoje}
          accent="orange"
          onClick={() => onNavigate("pedidos")}
        />
        <KpiCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Vendido hoje"
          value={formatBRL(stats.vendidoHoje)}
          accent="emerald"
        />
        <KpiCard
          icon={<MessageSquare className="w-5 h-5" />}
          label="Não respondidas"
          value={stats.naoLidas}
          accent={stats.naoLidas > 0 ? "amber" : "sky"}
          onClick={() => onNavigate("conversas")}
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Ticket médio hoje"
          value={stats.pedidosHoje > 0 ? formatBRL(stats.vendidoHoje / stats.pedidosHoje) : "—"}
          accent="violet"
        />
      </div>

      {/* Pedidos pendentes (lista resumida) */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 bg-gradient-to-r from-orange-50 to-transparent">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 grid place-items-center">
              <Pizza className="w-4 h-4" />
            </span>
            Aguardando ação
            {stats.pendentes.length > 0 && (
              <span className="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                {stats.pendentes.length}
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={() => onNavigate("pedidos")}
            className="text-xs text-slate-500 hover:text-orange-600 flex items-center gap-0.5 font-medium"
          >
            Ver todos
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {stats.pendentes.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-full bg-emerald-50 grid place-items-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-sm text-slate-700 font-semibold">Tudo em dia! 🎉</p>
            <p className="text-xs text-slate-400 mt-1">Não tem pedido esperando ação.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {stats.pendentes.slice(0, 5).map((p) => (
              <li
                key={p.id}
                className="px-4 py-3 flex items-center gap-3 hover:bg-orange-50/40 cursor-pointer transition-colors"
                onClick={() => onNavigate("pedidos")}
              >
                <span className="w-9 h-9 rounded-lg bg-orange-100 text-orange-700 grid place-items-center font-bold text-xs shrink-0">
                  #{p.orderNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-700 truncate">{p.customerName}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    <span className={`inline-flex items-center gap-1 ${statusColor(p.status)}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {statusLabel(p.status)}
                    </span>
                    {" · "}{formatBRL(p.totalValue)}
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
          icon={<UtensilsCrossed className="w-5 h-5" />}
          title="Cardápio"
          subtitle={
            productCount === 0
              ? "Nenhum produto cadastrado"
              : `${productCount} produto${productCount > 1 ? "s" : ""} no cardápio`
          }
          accent="orange"
          warning={productCount === 0}
          onClick={() => onNavigate("cardapio")}
        />
        <QuickCard
          icon={<Store className="w-5 h-5" />}
          title="Meu Negócio"
          subtitle="Horários, entrega, atendente, pagamentos"
          accent="violet"
          onClick={() => onNavigate("negocio")}
        />
      </section>
    </div>
  );
}

// ============================================
// Sub-componentes
// ============================================
function HeroPill({ icon, label, pulse }: { icon: React.ReactNode; label: string; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1.5 rounded-lg ${pulse ? "ring-1 ring-white/40 animate-pulse" : ""}`}>
      {icon}
      {label}
    </span>
  );
}

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
  accent: "orange" | "emerald" | "amber" | "sky" | "violet";
  onClick?: () => void;
}) {
  const styles = {
    orange:  { grad: "from-orange-500 to-amber-500",   ring: "hover:ring-orange-200" },
    emerald: { grad: "from-emerald-500 to-teal-500",   ring: "hover:ring-emerald-200" },
    amber:   { grad: "from-amber-500 to-yellow-500",   ring: "hover:ring-amber-200" },
    sky:     { grad: "from-sky-500 to-blue-500",       ring: "hover:ring-sky-200" },
    violet:  { grad: "from-violet-500 to-fuchsia-500", ring: "hover:ring-violet-200" },
  }[accent];

  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`text-left bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm transition-all ${onClick ? `${styles.ring} hover:ring-2 hover:shadow-md` : ""}`}
    >
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${styles.grad} text-white flex items-center justify-center shadow-sm mb-2.5`}>
        {icon}
      </div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className="text-xl font-bold text-slate-800 mt-0.5">{value}</p>
    </Comp>
  );
}

function QuickCard({
  icon,
  title,
  subtitle,
  accent,
  warning,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: "orange" | "violet";
  warning?: boolean;
  onClick: () => void;
}) {
  const grad = warning
    ? "from-amber-500 to-orange-500"
    : accent === "violet"
    ? "from-violet-500 to-fuchsia-500"
    : "from-orange-500 to-rose-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left bg-white border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
        warning ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${grad} text-white flex items-center justify-center shadow-sm shrink-0`}>
        {warning ? <AlertCircle className="w-6 h-6" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
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

function todayLabel(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
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

function statusColor(s: string): string {
  const m: Record<string, string> = {
    novo: "text-orange-600",
    confirmado: "text-amber-600",
    no_forno: "text-rose-600",
    a_caminho: "text-sky-600",
    entregue: "text-emerald-600",
    cancelado: "text-slate-400",
  };
  return m[s] || "text-slate-500";
}

function computeTodayStats(orders: Order[], conversations: Conversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hoje = orders.filter((o) => new Date(o.createdAt) >= today && o.status !== "cancelado");
  // Vendido hoje = soma de todos os pedidos não cancelados do dia (atualiza em tempo real).
  const vendidoHoje = hoje.reduce((sum, o) => sum + (o.totalValue || 0), 0);

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
