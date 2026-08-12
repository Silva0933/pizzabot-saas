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
  Bike,
  MoreHorizontal,
  Palette,
  Users,
} from "lucide-react";

export type NavKey = "inicio" | "analise" | "conversas" | "pedidos" | "clientes" | "cardapio" | "temas" | "negocio" | "entregadores" | "assinatura" | "ajuda" | "admin";

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
  { key: "clientes",   label: "Clientes",     icon: Users },
  { key: "cardapio",  label: "Cardápio",     icon: UtensilsCrossed },
  { key: "temas",     label: "Temas",        icon: Palette },
  { key: "negocio",   label: "Meu Negócio",  icon: Store },
  { key: "entregadores", label: "Entregadores", icon: Bike },
  { key: "assinatura", label: "Assinatura",  icon: CreditCard },
  { key: "ajuda",     label: "Ajuda",        icon: HelpCircle },
];

// No mobile a bottom-nav só comporta ~5 slots. Os principais ficam fixos; o
// resto (Análise, Assinatura, Ajuda + Plataforma do admin) vai pra folha "Mais"
// — antes os 7 itens espremidos faziam "Assinatura" sumir/sobrepor os vizinhos.
const MOBILE_PRIMARY: NavKey[] = ["pedidos", "conversas", "cardapio", "negocio"];
const MOBILE_PRIMARY_ITEMS = NAV_ITEMS.filter((i) => MOBILE_PRIMARY.includes(i.key));
const MOBILE_OVERFLOW_ITEMS = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY.includes(i.key));

export function Sidebar({ active, onChange, pizzariaNome, pizzariaLogo, isPlatformAdmin, badges }: SidebarProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const overflowActive =
    MOBILE_OVERFLOW_ITEMS.some((i) => i.key === active) ||
    (isPlatformAdmin && active === "admin");
  return (
    <>
      {/* Desktop sidebar (vertical, fixa à esquerda) */}
      <aside className="pzb-admin-sidebar hidden md:flex flex-col w-60 bg-white border-r border-slate-200 h-screen sticky top-0">
        {/* Logo / nome pizzaria */}
        <div className="px-4 py-5 border-b border-slate-100 flex items-center gap-2.5">
          {pizzariaLogo ? (
            <div className="p-0.5 rounded-xl bg-brand-gradient shrink-0">
              <img src={pizzariaLogo} alt="" className="w-8 h-8 rounded-[10px] object-cover block border-2 border-white" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand shrink-0">
              <Pizza className="w-5 h-5 text-white" />
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
                className={`relative w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-brand-50 text-brand-700 shadow-sm"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-brand-gradient" />}
                <Icon className={`w-4 h-4 ${isActive ? "text-brand-600" : "text-slate-400"}`} />
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

      {/* Folha "Mais" (mobile) — itens secundários que não cabem na bottom-nav */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="pzb-admin-mobile-more absolute bottom-14 left-0 right-0 bg-white border-t border-slate-200 rounded-t-2xl p-2 shadow-lg safe-area-inset-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-1">
              {MOBILE_OVERFLOW_ITEMS.map(({ key, label, icon: Icon }) => {
                const isActive = active === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { onChange(key); setMoreOpen(false); }}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? "text-orange-600" : "text-slate-400"}`} />
                    <span className="text-[11px]">{label}</span>
                  </button>
                );
              })}
              {isPlatformAdmin && (
                <button
                  type="button"
                  onClick={() => { onChange("admin"); setMoreOpen(false); }}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl text-sm font-medium transition-colors ${
                    active === "admin" ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <ShieldCheck className={`w-5 h-5 ${active === "admin" ? "text-violet-600" : "text-slate-400"}`} />
                  <span className="text-[11px]">Plataforma</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom-nav */}
      <nav className="pzb-admin-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 h-14 bg-white border-t border-slate-200 flex items-center justify-around py-1 safe-area-inset-bottom">
        {MOBILE_PRIMARY_ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          const badge =
            key === "conversas" ? badges?.conversas :
            key === "pedidos"   ? badges?.pedidos   : undefined;
          return (
            <button
              key={key}
              type="button"
              onClick={() => { onChange(key); setMoreOpen(false); }}
              className="flex flex-col items-center gap-0.5 px-1 py-1.5 min-w-0 flex-1 relative"
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-orange-600" : "text-slate-400"}`} />
              <span className={`text-[10px] truncate max-w-full ${isActive ? "text-orange-700 font-semibold" : "text-slate-500"}`}>
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

        {/* Botão "Mais" — abre a folha com os itens secundários */}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className="flex flex-col items-center gap-0.5 px-1 py-1.5 min-w-0 flex-1 relative"
        >
          <MoreHorizontal className={`w-5 h-5 ${overflowActive || moreOpen ? "text-orange-600" : "text-slate-400"}`} />
          <span className={`text-[10px] ${overflowActive || moreOpen ? "text-orange-700 font-semibold" : "text-slate-500"}`}>
            Mais
          </span>
        </button>
      </nav>
    </>
  );
}
