/**
 * Sidebar de 5 itens — navegação principal do painel.
 *
 * Inspirada em painéis enxutos (Notion/Linear): menos opções, mais foco.
 * Em telas pequenas vira bottom-nav (mobile-first sem ficar pobre).
 */
import React from "react";
import {
  MessageSquare,
  ClipboardList,
  UtensilsCrossed,
  Store,
  Pizza,
  ShieldCheck,
  TrendingUp,
  HelpCircle,
  CreditCard,
} from "lucide-react";

export type NavKey = "inicio" | "analise" | "conversas" | "pedidos" | "cardapio" | "negocio" | "assinatura" | "ajuda" | "admin";

export interface NavBadges {
  conversas?: number;
  pedidos?: number;
}

export interface SidebarProps {
  active: NavKey;
  onChange: (next: NavKey) => void;
  pizzariaNome?: string;
  pizzariaLogo?: string;
  isPlatformAdmin?: boolean;
  badges?: NavBadges;
}

const NAV_ITEMS: { key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "pedidos",   label: "Pedidos",      icon: ClipboardList },
  { key: "analise",   label: "Análise",      icon: TrendingUp },
  { key: "conversas", label: "Conversas",    icon: MessageSquare },
  { key: "cardapio",  label: "Cardápio",     icon: UtensilsCrossed },
  { key: "negocio",   label: "Meu Negócio",  icon: Store },
  { key: "assinatura", label: "Assinatura",  icon: CreditCard },
  { key: "ajuda",     label: "Ajuda",        icon: HelpCircle },
];

export function Sidebar({ active, onChange, pizzariaNome, pizzariaLogo, isPlatformAdmin, badges }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar (vertical, fixa à esquerda) */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-slate-200 h-screen sticky top-0">
        {/* Logo / nome pizzaria */}
        <div className="px-4 py-5 border-b border-slate-100 flex items-center gap-2.5">
          {pizzariaLogo ? (
            <img src={pizzariaLogo} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <Pizza className="w-4 h-4 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {pizzariaNome || "PizzaBot"}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Painel</p>
          </div>
        </div>

        {/* Itens */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
            const isActive = active === key;
            const badge =
              key === "conversas" ? badges?.conversas :
              key === "pedidos"   ? badges?.pedidos   : undefined;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-orange-50 text-orange-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-orange-600" : "text-slate-400"}`} />
                <span className="flex-1 text-left">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-orange-200 text-orange-800" : "bg-slate-200 text-slate-700"
                  }`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          {isPlatformAdmin && (
            <>
              <div className="my-3 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => onChange("admin")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active === "admin"
                    ? "bg-violet-50 text-violet-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <ShieldCheck className={`w-4 h-4 ${active === "admin" ? "text-violet-600" : "text-slate-400"}`} />
                <span className="text-left">Plataforma</span>
              </button>
            </>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 text-center">v2.0 · PizzaBot</p>
        </div>
      </aside>

      {/* Mobile bottom-nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 flex items-center justify-around py-1 safe-area-inset-bottom">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          const badge =
            key === "conversas" ? badges?.conversas :
            key === "pedidos"   ? badges?.pedidos   : undefined;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className="flex flex-col items-center gap-0.5 px-1 py-1.5 min-w-0 flex-1 relative"
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-orange-600" : "text-slate-400"}`} />
              <span className={`text-[10px] ${isActive ? "text-orange-700 font-semibold" : "text-slate-500"}`}>
                {label}
              </span>
              {badge !== undefined && badge > 0 && (
                <span className="absolute top-0 right-2 text-[8px] font-bold bg-red-500 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
