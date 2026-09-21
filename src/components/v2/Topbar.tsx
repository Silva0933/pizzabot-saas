/**
 * Topbar: status do bot + ações rápidas + menu do usuário.
 *
 * Fica fixa no topo da área de conteúdo, sempre visível.
 */
import React, { useState } from "react";
import { Bot, BellRing, LogOut, ChevronDown, Power, User, Wifi, WifiOff, Sparkles, Store, Clock3, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip } from "./Tooltip";

export interface TopbarProps {
  pageTitle: string;
  pageSubtitle?: string;
  userName?: string;
  userEmail?: string;
  botAtivo: boolean;
  onToggleBot: () => void;
  lojaAberta: boolean;
  lojaStatusManual?: boolean | null;
  onSetLojaStatus: (status: boolean | null) => void;
  /** Estado da conexão WhatsApp: 'open' | 'connecting' | 'close' | null (desconhecido). */
  whatsappEstado?: string | null;
  onWhatsAppClick?: () => void;
  /** Pizzaria em período de teste — mostra chip "Teste" clicável (vai p/ Assinatura). */
  isTrial?: boolean;
  onTrialClick?: () => void;
  onLogout?: () => void;
  notifPermission?: NotificationPermission;
  onEnableNotifications?: () => void;
  orderAlertCount?: number;
  onOrderAlertClick?: () => void;
}

export function Topbar({
  pageTitle,
  pageSubtitle,
  userName,
  userEmail,
  botAtivo,
  onToggleBot,
  lojaAberta,
  lojaStatusManual,
  onSetLojaStatus,
  whatsappEstado,
  onWhatsAppClick,
  isTrial,
  onTrialClick,
  onLogout,
  notifPermission,
  onEnableNotifications,
  orderAlertCount = 0,
  onOrderAlertClick,
}: TopbarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  return (
    <header className="pzb-admin-topbar bg-[#0d1117] border-b border-[#1e2638] px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
      <div className="min-w-0">
        <h1 className="text-base md:text-lg font-extrabold text-white tracking-wide uppercase truncate">{pageTitle}</h1>
        {pageSubtitle && (
          <p className="text-xs text-slate-400 truncate hidden md:block mt-0.5">{pageSubtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {/* Chip de período de teste (vai para a aba Assinatura) */}
        {isTrial && (
          <Tooltip position="bottom" content="Você está no período de teste. Clique para assinar um plano.">
            <button
              type="button"
              onClick={onTrialClick}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-violet-500/15 border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Teste · Assinar</span>
              <span className="sm:hidden">Teste</span>
            </button>
          </Tooltip>
        )}

        {/* Funcionamento da loja: agenda automática ou override temporário. */}
        <div className="relative">
          <Tooltip
            position="bottom"
            content={lojaStatusManual == null
              ? `Status calculado pelos horários: loja ${lojaAberta ? "aberta" : "fechada"}.`
              : `Status manual: loja ${lojaAberta ? "aberta" : "fechada"}. Clique para alterar.`}
          >
            <button
              type="button"
              aria-label={`Funcionamento da loja: ${lojaAberta ? "aberta" : "fechada"}`}
              aria-expanded={storeMenuOpen}
              onClick={() => {
                setUserMenuOpen(false);
                setStoreMenuOpen((v) => !v);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                lojaAberta
                  ? "bg-[#064e3b]/50 border-emerald-500/30 text-emerald-400 hover:bg-[#064e3b]/70"
                  : "bg-[#451a1a]/50 border-red-500/30 text-red-400 hover:bg-[#451a1a]/70"
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lojaAberta ? "Loja aberta" : "Loja fechada"}</span>
              {lojaStatusManual != null && <span className="hidden lg:inline opacity-70">· manual</span>}
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>
          </Tooltip>

          <AnimatePresence>
            {storeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setStoreMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="pzb-admin-user-menu absolute right-0 mt-1.5 w-64 bg-[#111622] border border-[#1e293b] rounded-xl shadow-xl z-50 p-1.5"
                >
                  <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Funcionamento da loja
                  </p>
                  {([
                    { value: null, label: "Seguir horários", help: "Abre e fecha automaticamente", icon: Clock3 },
                    { value: true, label: "Abrir agora", help: "Ignora o horário até restaurar", icon: Store },
                    { value: false, label: "Fechar agora", help: "Interrompe novos pedidos", icon: Power },
                  ] as const).map((option) => {
                    const active = lojaStatusManual === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => {
                          setStoreMenuOpen(false);
                          onSetLojaStatus(option.value);
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[#161f30] transition-colors"
                      >
                        <Icon className={`w-4 h-4 ${option.value === false ? "text-red-400" : option.value === true ? "text-emerald-400" : "text-slate-400"}`} />
                        <span className="flex-1 min-w-0">
                          <strong className="block text-xs text-white">{option.label}</strong>
                          <small className="block text-[10px] text-slate-400">{option.help}</small>
                        </span>
                        {active && <Check className="w-4 h-4 text-orange-500" />}
                      </button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Status da conexão WhatsApp */}
        {whatsappEstado != null && (
          <Tooltip
            position="bottom"
            content={whatsappEstado === "open"
              ? "WhatsApp conectado e recebendo mensagens."
              : whatsappEstado === "connecting"
                ? "WhatsApp conectando…"
                : "WhatsApp DESCONECTADO — o atendimento está parado. Clique para reconectar."}
          >
            <button
              type="button"
              onClick={onWhatsAppClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                whatsappEstado === "open"
                  ? "bg-[#064e3b]/50 border-emerald-500/30 text-emerald-400 hover:bg-[#064e3b]/70"
                  : whatsappEstado === "connecting"
                    ? "bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30"
                    : "bg-[#451a1a]/50 border-red-500/40 text-red-300 hover:bg-[#451a1a]/70"
              }`}
            >
              {whatsappEstado === "open"
                ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
              <span className="hidden sm:inline">
                {whatsappEstado === "open" ? "Conectado" : whatsappEstado === "connecting" ? "Conectando…" : "Desconectado"}
              </span>
            </button>
          </Tooltip>
        )}

        {/* Status do bot */}
        <Tooltip
          position="bottom"
          content={botAtivo
            ? "Bot está respondendo automaticamente. Clique para pausar (atendentes humanos respondem manualmente)."
            : "Bot pausado. Nenhuma mensagem é respondida automaticamente."}
        >
          <button
            type="button"
            onClick={onToggleBot}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              botAtivo
                ? "bg-[#064e3b]/50 border-emerald-500/30 text-emerald-400 hover:bg-[#064e3b]/70"
                : "bg-[#131b2e] border-slate-700/60 text-slate-300 hover:bg-[#18223a]"
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{botAtivo ? "Bot ativo" : "Bot pausado"}</span>
            <Power className="w-3 h-3 opacity-70" />
          </button>
        </Tooltip>

        {/* Novo pedido: fica pulsando até o operador atender o alerta. */}
        {orderAlertCount > 0 && onOrderAlertClick && (
          <Tooltip
            position="bottom"
            content="Novo pedido aguardando. Clique para abrir os pedidos e silenciar o alerta."
          >
            <button
              type="button"
              onClick={onOrderAlertClick}
              aria-label={`${orderAlertCount} novo(s) pedido(s). Abrir e silenciar alerta.`}
              className="relative flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-md shadow-orange-500/30 transition-colors hover:bg-orange-600 animate-pulse"
            >
              <BellRing className="w-4 h-4" />
              <span className="hidden lg:inline">Novo pedido</span>
              <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-extrabold leading-none text-white">
                {orderAlertCount > 99 ? "99+" : orderAlertCount}
              </span>
            </button>
          </Tooltip>
        )}

        {/* Notificações / Sino */}
        <Tooltip position="bottom" content="Alertas e notificações">
          <button
            type="button"
            onClick={onEnableNotifications}
            className="relative p-2 rounded-lg text-slate-400 hover:bg-[#161f30] hover:text-white transition-colors"
          >
            <BellRing className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-orange-500" />
          </button>
        </Tooltip>

        {/* User menu / Avatar */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setStoreMenuOpen(false);
              setUserMenuOpen((v) => !v);
            }}
            className="flex items-center gap-1 p-1 rounded-lg hover:bg-[#161f30] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-[#201610] text-orange-500 border border-orange-500/30 flex items-center justify-center font-bold text-xs">
              {(userName ? userName[0].toUpperCase() : "A")}
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          <AnimatePresence>
            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setUserMenuOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="pzb-admin-user-menu absolute right-0 mt-1.5 w-56 bg-[#111622] border border-[#1e293b] rounded-xl shadow-xl z-50 py-1"
                >
                  <div className="px-3 py-2 border-b border-[#1e293b]">
                    <p className="text-sm font-semibold text-white truncate">{userName || "Administrador"}</p>
                    <p className="text-[11px] text-slate-400 truncate">{userEmail}</p>
                  </div>
                  {onLogout && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full px-3 py-2 text-sm text-slate-300 hover:bg-[#161f30] hover:text-white flex items-center gap-2 transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-slate-400" />
                      Sair
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
