import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, BellRing, LogOut, ChevronDown, Power, Wifi, WifiOff, Sparkles, Store, Clock3, Check, Pizza } from "lucide-react";
import { Tooltip } from "./Tooltip";
export interface TopbarProps {
 pageTitle:string; pageSubtitle?:string; userName?:string; userEmail?:string;
 botAtivo:boolean; onToggleBot:()=>void; lojaAberta:boolean; lojaStatusManual?:boolean|null;
 onSetLojaStatus:(status:boolean|null)=>void; whatsappEstado?:string|null; onWhatsAppClick?:()=>void;
 isTrial?:boolean; onTrialClick?:()=>void; onLogout?:()=>void;
 notifPermission?:NotificationPermission; onEnableNotifications?:()=>void;
 orderAlertCount?:number; onOrderAlertClick?:()=>void;
}
export function Topbar({userName,userEmail,botAtivo,onToggleBot,lojaAberta,lojaStatusManual,onSetLojaStatus,whatsappEstado,onWhatsAppClick,isTrial,onTrialClick,onLogout,notifPermission,onEnableNotifications,orderAlertCount=0,onOrderAlertClick}:TopbarProps) {
 const [userMenuOpen,setUserMenuOpen]=useState(false);
 const [storeMenuOpen,setStoreMenuOpen]=useState(false);
 const header=useRef<HTMLElement>(null);
 const storeTrigger=useRef<HTMLButtonElement>(null), accountTrigger=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  const el=header.current, shell=el?.closest<HTMLElement>(".pzb-admin-shell");
  if(!el || !shell) return;
  const measure=()=>shell.style.setProperty("--pzb-topbar-height",el.offsetHeight+"px");
  measure(); const observer=new ResizeObserver(measure); observer.observe(el);
  return ()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape") {
   if(storeMenuOpen) {setStoreMenuOpen(false);storeTrigger.current?.focus();}
   if(userMenuOpen) {setUserMenuOpen(false);accountTrigger.current?.focus();}
  }};
  document.addEventListener("keydown",key);return()=>document.removeEventListener("keydown",key);
 },[storeMenuOpen,userMenuOpen]);
 const statusClass="pzb-status-control flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-medium min-h-10 transition-colors hover:bg-surface-muted w-full md:w-auto";
 const menuClass="absolute mt-2 bg-surface border border-line rounded-xl shadow-pop z-50 p-1.5";
 const health=lojaAberta ? "text-emerald-300":"text-rose-300";
 const account=<div className="flex items-center gap-1.5">
  <Tooltip position="bottom" content="Alertas e notificações"><button type="button" aria-label={notifPermission==="granted" ? "Notificações ativadas":"Ativar notificações"} onClick={onEnableNotifications} className="p-2.5 rounded-lg text-ink-muted hover:bg-surface-muted relative min-h-10 min-w-10"><BellRing className="w-[18px] h-[18px]"/>{notifPermission!=="granted" && <span className="absolute right-2 top-2 h-1.5 w-1.5 bg-brand-400 rounded-full"/>}</button></Tooltip>
  <div className="relative">
   <button ref={accountTrigger} type="button" aria-label="Abrir menu da conta" aria-expanded={userMenuOpen} onClick={()=>{setStoreMenuOpen(false);setUserMenuOpen(v=>!v);}} className="flex items-center gap-1 p-1.5 min-h-10 rounded-lg hover:bg-surface-muted">
    <span className="h-8 w-8 rounded-full bg-brand-500/12 text-brand-300 border border-brand-500/25 grid place-items-center text-xs font-semibold">{userName?.[0]?.toUpperCase() || "A"}</span><ChevronDown className="w-3 h-3 text-ink-muted"/>
   </button>
   {userMenuOpen && <><div className="fixed inset-0 z-40" onClick={()=>setUserMenuOpen(false)}/><div className={menuClass+" right-0 w-64 max-w-[calc(100vw-32px)]"}>
    <div className="px-3 py-2 border-b border-line"><p className="text-sm font-semibold text-ink break-words">{userName || "Administrador"}</p><p className="text-xs text-ink-muted break-all mt-1">{userEmail}</p></div>
    {onLogout && <button type="button" onClick={()=>{setUserMenuOpen(false);onLogout();}} className="w-full flex items-center gap-2 px-3 py-3 rounded-lg text-sm text-ink-muted hover:bg-surface-muted"><LogOut className="w-4 h-4"/>Sair</button>}
   </div></>}
  </div>
 </div>;
 return <header ref={header} className="pzb-admin-topbar bg-canvas border-b border-line px-4 md:px-6 py-3 sticky top-0 z-30">
  <div className="md:hidden flex items-center justify-between mb-3 min-h-9"><div className="flex items-center gap-2"><span className="h-8 w-8 text-brand-400 grid place-items-center"><Pizza className="w-5 h-5"/></span><span className="text-lg font-bold tracking-tight">Pizza<span className="text-brand-400">Bot</span></span></div></div>
  <div className="absolute top-3 right-4 md:right-6">{account}</div><div className="flex md:justify-end items-center gap-3 md:pr-28">
   <div className={`grid gap-2 flex-1 md:flex md:flex-none ${whatsappEstado!=null ? "grid-cols-3":"grid-cols-2"}`}>
    <div className="relative">
     <button ref={storeTrigger} type="button" aria-label={`Funcionamento da loja: ${lojaAberta ? "aberta":"fechada"}`} aria-expanded={storeMenuOpen} title={lojaStatusManual==null ? "Status calculado pelos horários":"Status manual da loja"} onClick={()=>{setUserMenuOpen(false);setStoreMenuOpen(v=>!v);}} className={statusClass+" "+health}><Store className="w-3.5 h-3.5 shrink-0"/><span>{lojaAberta ? "Loja aberta":"Loja fechada"}{lojaStatusManual!=null && <span className="hidden lg:inline"> · manual</span>}</span><ChevronDown className="w-3 h-3 shrink-0"/></button>
     {storeMenuOpen && <><div className="fixed inset-0 z-40" onClick={()=>setStoreMenuOpen(false)}/><div className={menuClass+" left-0 md:left-auto md:right-0 w-72 max-w-[calc(100vw-32px)]"}>
      <p className="px-3 py-2 text-xs font-semibold text-ink-muted">Funcionamento da loja</p>
      {([{value:null,label:"Seguir horários",help:"Abre e fecha automaticamente",icon:Clock3},{value:true,label:"Abrir agora",help:"Ignora o horário até restaurar",icon:Store},{value:false,label:"Fechar agora",help:"Interrompe novos pedidos",icon:Power}] as const).map(option=>{
       const Icon=option.icon;
       return <button key={String(option.value)} type="button" onClick={()=>{setStoreMenuOpen(false);onSetLojaStatus(option.value);}} className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg hover:bg-surface-muted"><Icon className="w-4 h-4 text-ink-muted"/><span className="flex-1"><strong className="block text-sm font-medium text-ink">{option.label}</strong><small className="block text-xs text-ink-muted mt-0.5">{option.help}</small></span>{lojaStatusManual===option.value && <Check className="w-4 h-4 text-brand-400"/>}</button>;
      })}
     </div></>}
    </div>
    {whatsappEstado!=null && <button type="button" onClick={onWhatsAppClick} aria-label={`WhatsApp: ${whatsappEstado==="open" ? "conectado":whatsappEstado==="connecting" ? "conectando":"desconectado"}`} title={whatsappEstado==="open" ? "WhatsApp conectado e recebendo mensagens":"Clique para verificar a conexão do WhatsApp"} className={statusClass+" "+(whatsappEstado==="open" ? "text-emerald-300":whatsappEstado==="connecting" ? "text-amber-300":"text-rose-300")}>{whatsappEstado==="open" ? <Wifi className="w-3.5 h-3.5 shrink-0"/>:<WifiOff className="w-3.5 h-3.5 shrink-0"/>}<span>WhatsApp<span className="hidden lg:inline"> {whatsappEstado==="open" ? "conectado":whatsappEstado==="connecting" ? "conectando…":"desconectado"}</span></span></button>}
    <button type="button" aria-pressed={botAtivo} onClick={onToggleBot} title={botAtivo ? "Clique para pausar respostas automáticas":"Clique para ativar respostas automáticas"} className={statusClass+" "+(botAtivo ? "text-emerald-300":"text-ink-muted")}><Bot className="w-3.5 h-3.5 shrink-0"/><span>{botAtivo ? "Bot ativo":"Bot pausado"}</span><Power className="hidden lg:block w-3 h-3"/></button>
   </div>

  </div>
  {(isTrial || (orderAlertCount>0 && onOrderAlertClick)) && <div className="flex flex-wrap justify-end gap-2 mt-2">
   {isTrial && <button type="button" onClick={onTrialClick} className="inline-flex items-center gap-2 text-xs font-medium text-brand-300 border border-brand-500/25 rounded-lg px-3 py-2 hover:bg-brand-500/10"><Sparkles className="w-3.5 h-3.5"/>Teste · Assinar</button>}
   {orderAlertCount>0 && onOrderAlertClick && <button type="button" onClick={onOrderAlertClick} aria-label={`${orderAlertCount} novo(s) pedido(s). Abrir e silenciar alerta.`} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold px-3 py-2"><BellRing className="w-4 h-4"/>Novo pedido<span className="tabular-nums">{orderAlertCount>99 ? "99+":orderAlertCount}</span></button>}
  </div>}
 </header>;
}
