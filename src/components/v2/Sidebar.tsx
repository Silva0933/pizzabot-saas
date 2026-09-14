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
      <aside className="pzb-admin-sidebar hidden md:flex flex-col w-60 bg-[#0d1117] border-r border-[#1e2638] h-screen sticky top-0 z-30">
        {/* Logo / nome pizzaria */}
        <div className="px-4 py-5 border-b border-[#1e2638] flex items-center gap-2.5">
          {pizzariaLogo ? (
            <div className="p-0.5 rounded-xl bg-orange-500 shrink-0">
              <img src={pizzariaLogo} alt="" className="w-8 h-8 rounded-[10px] object-cover block border-2 border-[#0d1117]" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0">
              <Pizza className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {pizzariaNome || "Fornalha Burger & Pizza"}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Painel</p>
          </div>
        </div>

        {/* Itens */}
        <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
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
                className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  isActive
                    ? "bg-orange-500/10 text-orange-500 font-semibold shadow-xs"
                    : "text-slate-400 hover:bg-[#161f30] hover:text-slate-200 font-medium"
                }`}
              >
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-orange-500" />}
                <Icon className={`w-4 h-4 ${isActive ? "text-orange-500" : "text-slate-400"}`} />
                <span className="flex-1 text-left">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white min-w-[18px] text-center">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          {isPlatformAdmin && (
            <>
              <div className="my-3 border-t border-[#1e2638]" />
              <button
                type="button"
                onClick={() => onChange("admin")}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active === "admin"
                    ? "bg-violet-500/15 text-violet-400 font-semibold"
                    : "text-slate-400 hover:bg-[#161f30] hover:text-slate-200"
                }`}
              >
                <ShieldCheck className={`w-4 h-4 ${active === "admin" ? "text-violet-400" : "text-slate-400"}`} />
                <span className="text-left">Plataforma</span>
              </button>
            </>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-[#1e2638]">
          <p className="text-[11px] text-slate-500 text-center font-medium">v2.0 · PizzaBot</p>
        </div>
      </aside>

      {/* Folha "Mais" (mobile) — itens secundários que não cabem na bottom-nav */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" />
          <div
            className="pzb-admin-mobile-more absolute bottom-14 left-0 right-0 bg-[#111622] border-t border-[#1e293b] rounded-t-2xl p-3 shadow-2xl safe-area-inset-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-3 gap-1.5">
              {MOBILE_OVERFLOW_ITEMS.map(({ key, label, icon: Icon }) => {
                const isActive = active === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { onChange(key); setMoreOpen(false); }}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium transition-colors ${
                      isActive ? "bg-orange-500/15 text-orange-400 font-bold border border-orange-500/25" : "text-slate-400 hover:bg-[#161f30] hover:text-white"
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? "text-orange-400" : "text-slate-400"}`} />
                    <span className="text-[11px]">{label}</span>
                  </button>
                );
              })}
              {isPlatformAdmin && (
                <button
                  type="button"
                  onClick={() => { onChange("admin"); setMoreOpen(false); }}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium transition-colors ${
                    active === "admin" ? "bg-violet-500/20 text-violet-400 font-bold border border-violet-500/30" : "text-slate-400 hover:bg-[#161f30] hover:text-white"
                  }`}
                >
                  <ShieldCheck className={`w-5 h-5 ${active === "admin" ? "text-violet-400" : "text-slate-400"}`} />
                  <span className="text-[11px]">Plataforma</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom-nav */}
      <nav className="pzb-admin-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 h-14 bg-[#0d1117] border-t border-[#1e293b] flex items-center justify-around py-1 safe-area-inset-bottom">
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
              <Icon className={`w-5 h-5 ${isActive ? "text-orange-400" : "text-slate-400"}`} />
              <span className={`text-[10px] truncate max-w-full ${isActive ? "text-orange-400 font-semibold" : "text-slate-400"}`}>
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
          <MoreHorizontal className={`w-5 h-5 ${overflowActive || moreOpen ? "text-orange-400" : "text-slate-400"}`} />
          <span className={`text-[10px] ${overflowActive || moreOpen ? "text-orange-400 font-semibold" : "text-slate-400"}`}>
            Mais
          </span>
        </button>
      </nav>
    </>
  );
}
