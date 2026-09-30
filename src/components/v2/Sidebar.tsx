import React from "react";
import { MessageSquare, ClipboardList, UtensilsCrossed, Store, Pizza, ShieldCheck, TrendingUp, HelpCircle, CreditCard, Bike, MoreHorizontal, Palette, Users, X } from "lucide-react";
export type NavKey = "inicio" | "analise" | "conversas" | "pedidos" | "clientes" | "cardapio" | "temas" | "negocio" | "entregadores" | "assinatura" | "ajuda" | "admin";
export interface NavBadges { conversas?: number; pedidos?: number; }
export interface SidebarProps {
 active: NavKey; onChange: (next: NavKey) => void;
 pizzariaNome?: string; pizzariaLogo?: string; isPlatformAdmin?: boolean; badges?: NavBadges;
}
const ITEMS = [
 {key:"pedidos",label:"Pedidos",icon:ClipboardList}, {key:"conversas",label:"Conversas",icon:MessageSquare},
 {key:"entregadores",label:"Entregadores",icon:Bike}, {key:"analise",label:"Análise",icon:TrendingUp},
 {key:"clientes",label:"Clientes",icon:Users}, {key:"cardapio",label:"Cardápio",icon:UtensilsCrossed},
 {key:"temas",label:"Temas",icon:Palette}, {key:"negocio",label:"Meu Negócio",icon:Store},
 {key:"assinatura",label:"Assinatura",icon:CreditCard}, {key:"ajuda",label:"Ajuda",icon:HelpCircle},
] as const;
const GROUPS = [
 {label:"Operação",keys:["pedidos","conversas","entregadores"]},
 {label:"Gestão",keys:["analise","clientes"]},
 {label:"Cardápio e identidade",keys:["cardapio","temas"]},
 {label:"Negócio e conta",keys:["negocio","assinatura","ajuda"]},
];
const MOBILE_KEYS = ["pedidos","conversas","cardapio","negocio"];
const PRIMARY = ITEMS.filter(i => MOBILE_KEYS.includes(i.key));
const OVERFLOW = ITEMS.filter(i => !MOBILE_KEYS.includes(i.key));
export function Sidebar({active,onChange,pizzariaNome,pizzariaLogo,isPlatformAdmin,badges}: SidebarProps) {
 const [moreOpen,setMoreOpen] = React.useState(false);
 const moreButton = React.useRef<HTMLButtonElement>(null);
 const panel = React.useRef<HTMLDivElement>(null);
 React.useEffect(() => {
  if (!moreOpen) return;
  panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  const onKey = (e: KeyboardEvent) => {
   if(e.key === "Escape") {setMoreOpen(false); moreButton.current?.focus();}
   if(e.key === "Tab") {
    const controls = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),moreButton.current].filter(Boolean) as HTMLButtonElement[];
    const first = controls[0], last = controls[controls.length-1];
    if(e.shiftKey && document.activeElement===first) {e.preventDefault();last?.focus();}
    else if(!e.shiftKey && document.activeElement===last) {e.preventDefault();first?.focus();}
   }
  };
  document.addEventListener("keydown",onKey);
  return () => document.removeEventListener("keydown",onKey);
 },[moreOpen]);
 const navigate = (key: NavKey) => {onChange(key);setMoreOpen(false);};
 const badgeFor = (key:string) => key==="conversas" ? badges?.conversas : key==="pedidos" ? badges?.pedidos : undefined;
 const overflowActive = OVERFLOW.some(i=>i.key===active) || active==="admin";
 const desktopItem = ({key,label,icon:Icon}:typeof ITEMS[number] | {key:"admin";label:string;icon:typeof ShieldCheck}) => {
  const selected=active===key, badge=badgeFor(key);
  return <button key={key} type="button" aria-current={selected ? "page":undefined} onClick={()=>navigate(key)}
   className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${selected ? "bg-brand-500/12 text-brand-400 font-semibold":"text-ink-muted hover:bg-surface-muted hover:text-ink font-medium"}`}>
   <Icon className="w-[18px] h-[18px] shrink-0"/><span className="flex-1 text-left">{label}</span>
   {!!badge && <span className="rounded-full bg-rose-700 text-white text-xs tabular-nums px-1.5 min-w-5">{badge>99 ? "99+":badge}</span>}
  </button>;
 };
 return <>
  <aside className="pzb-admin-sidebar hidden md:flex flex-col bg-canvas border-r border-line h-dvh sticky top-0 z-30">
   <div className="px-5 pt-6 pb-5 border-b border-line">
    <div className="flex items-center gap-2.5"><span className="h-9 w-9 text-brand-400 grid place-items-center shrink-0"><Pizza className="w-6 h-6"/></span><span className="text-xl font-bold tracking-tight text-ink">Pizza<span className="text-brand-400">Bot</span></span></div>
    <div className="mt-4 flex items-center gap-2 min-w-0">{pizzariaLogo && <img src={pizzariaLogo} alt="" className="w-6 h-6 rounded-md object-cover shrink-0"/>}<p className="text-xs text-ink-muted truncate" title={pizzariaNome}>{pizzariaNome || "Sua pizzaria"}</p></div>
   </div>
   <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
    {GROUPS.map(group=><div key={group.label}><p className="px-3 mb-1.5 text-xs font-medium text-ink-subtle">{group.label}</p><div className="space-y-0.5">{ITEMS.filter(i=>group.keys.includes(i.key)).map(desktopItem)}</div></div>)}
   </nav>
   <div className="p-3 border-t border-line">{isPlatformAdmin && desktopItem({key:"admin",label:"Plataforma",icon:ShieldCheck})}<p className="text-xs text-ink-subtle px-3 pt-2">v2.0 · PizzaBot</p></div>
  </aside>
  {moreOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={()=>{setMoreOpen(false);moreButton.current?.focus();}}>
   <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="pzb-more-title" className="pzb-admin-mobile-more absolute left-0 right-0 bg-surface border-t border-line rounded-t-2xl p-4 shadow-pop max-h-[70dvh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
    <div className="flex justify-between items-center mb-3"><h2 id="pzb-more-title" className="font-semibold text-ink">Mais opções</h2><button type="button" aria-label="Fechar mais opções" className="p-2 text-ink-muted" onClick={()=>{setMoreOpen(false);moreButton.current?.focus();}}><X className="w-5 h-5"/></button></div>
    <div className="grid grid-cols-2 gap-2">
     {OVERFLOW.map(({key,label,icon:Icon})=><button key={key} type="button" aria-current={active===key ? "page":undefined} onClick={()=>navigate(key)} className={`flex items-center gap-3 p-3 min-h-12 rounded-lg text-sm ${active===key ? "bg-brand-500/12 text-brand-400":"text-ink-muted hover:bg-surface-muted"}`}><Icon className="w-5 h-5 shrink-0"/>{label}</button>)}
     {isPlatformAdmin && <button type="button" onClick={()=>navigate("admin")} className={`flex items-center gap-3 p-3 min-h-12 rounded-lg text-sm ${active==="admin" ? "text-brand-400 bg-brand-500/12":"text-ink-muted"}`}><ShieldCheck className="w-5 h-5"/>Plataforma</button>}
    </div>
   </div>
  </div>}
  <nav aria-label="Navegação principal no celular" className="pzb-admin-bottom-nav md:hidden fixed bottom-0 inset-x-0 z-50 bg-surface border-t border-line flex items-start pt-1 safe-area-inset-bottom">
   {PRIMARY.map(({key,label,icon:Icon})=><button key={key} type="button" aria-current={active===key ? "page":undefined} onClick={()=>navigate(key)} className={`flex flex-col items-center justify-center gap-1 py-2 min-h-14 min-w-0 flex-1 relative ${active===key ? "text-brand-400":"text-ink-muted"}`}><Icon className="w-5 h-5"/><span className="text-[11px] font-medium truncate max-w-full">{label}</span>{!!badgeFor(key) && <span className="absolute top-0 right-3 bg-rose-700 text-white rounded-full px-1 text-[10px]">{badgeFor(key)!>9 ? "9+":badgeFor(key)}</span>}</button>)}
   <button ref={moreButton} type="button" aria-label="Mais opções de navegação" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)} className={`flex flex-col items-center justify-center gap-1 py-2 min-h-14 min-w-0 flex-1 ${overflowActive || moreOpen ? "text-brand-400":"text-ink-muted"}`}><MoreHorizontal className="w-5 h-5"/><span className="text-[11px] font-medium">Mais</span></button>
  </nav>
 </>;
}
