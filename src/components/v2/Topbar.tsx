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
    <header className="pzb-admin-topbar bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-20">
      <div className="min-w-0">
        <h1 className="text-base md:text-lg font-bold text-slate-800 truncate">{pageTitle}</h1>
        {pageSubtitle && (
          <p className="text-xs text-slate-500 truncate hidden md:block">{pageSubtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Chip de período de teste (vai para a aba Assinatura) */}
        {isTrial && (
          <Tooltip position="bottom" content="Você está no período de teste. Clique para assinar um plano.">
            <button
              type="button"
              onClick={onTrialClick}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 transition-colors"
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
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                lojaAberta
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                  : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lojaAberta ? "Loja aberta" : "Loja fechada"}</span>
              {lojaStatusManual != null && <span className="hidden lg:inline opacity-70">· manual</span>}
              <ChevronDown className="w-3 h-3 opacity-60" />
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
                  className="pzb-admin-user-menu absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5"
                >
                  <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-slate-100 transition-colors"
                      >
                        <Icon className={`w-4 h-4 ${option.value === false ? "text-red-500" : option.value === true ? "text-emerald-500" : "text-slate-500"}`} />
                        <span className="flex-1 min-w-0">
                          <strong className="block text-xs text-slate-800">{option.label}</strong>
                          <small className="block text-[10px] text-slate-500">{option.help}</small>
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
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                whatsappEstado === "open"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                  : whatsappEstado === "connecting"
                    ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                    : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
              }`}
            >
              {whatsappEstado === "open"
                ? <Wifi className="w-3.5 h-3.5" />
                : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {whatsappEstado === "open" ? "WhatsApp" : whatsappEstado === "connecting" ? "Conectando…" : "Desconectado"}
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
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              botAtivo
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{botAtivo ? "Bot ativo" : "Bot pausado"}</span>
            <Power className="w-3 h-3 opacity-50" />
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
              className="relative flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-[0_0_0_3px_rgba(249,115,22,0.16)] transition-colors hover:bg-orange-600 animate-pulse"
            >
              <BellRing className="w-4 h-4" />
              <span className="hidden lg:inline">Novo pedido</span>
              <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-red-600 px-1 text-[10px] leading-none text-white">
                {orderAlertCount > 99 ? "99+" : orderAlertCount}
              </span>
            </button>
          </Tooltip>
        )}

        {/* Notificações */}
        {notifPermission && notifPermission !== "granted" && onEnableNotifications && (
          <Tooltip position="bottom" content="Receber alertas no navegador quando chegar novo pedido">
            <button
              type="button"
              onClick={onEnableNotifications}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <BellRing className="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setStoreMenuOpen(false);
              setUserMenuOpen((v) => !v);
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-slate-100"
          >
            <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-orange-600" />
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
                  className="pzb-admin-user-menu absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1"
                >
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-800 truncate">{userName || "Sem nome"}</p>
                    <p className="text-[11px] text-slate-500 truncate">{userEmail}</p>
                  </div>
                  {onLogout && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
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
