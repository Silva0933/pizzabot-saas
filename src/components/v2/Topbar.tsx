/**
 * Topbar: status do bot + ações rápidas + menu do usuário.
 *
 * Fica fixa no topo da área de conteúdo, sempre visível.
 */
import React, { useState } from "react";
import { Bot, BellRing, LogOut, ChevronDown, Power, User, Wifi, WifiOff, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip } from "./Tooltip";

export interface TopbarProps {
  pageTitle: string;
  pageSubtitle?: string;
  userName?: string;
  userEmail?: string;
  botAtivo: boolean;
  onToggleBot: () => void;
  /** Estado da conexão WhatsApp: 'open' | 'connecting' | 'close' | null (desconhecido). */
  whatsappEstado?: string | null;
  onWhatsAppClick?: () => void;
  /** Pizzaria em período de teste — mostra chip "Teste" clicável (vai p/ Assinatura). */
  isTrial?: boolean;
  onTrialClick?: () => void;
  onLogout?: () => void;
  notifPermission?: NotificationPermission;
  onEnableNotifications?: () => void;
}

export function Topbar({
  pageTitle,
  pageSubtitle,
  userName,
  userEmail,
  botAtivo,
  onToggleBot,
  whatsappEstado,
  onWhatsAppClick,
  isTrial,
  onTrialClick,
  onLogout,
  notifPermission,
  onEnableNotifications,
}: TopbarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-20">
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
            onClick={() => setUserMenuOpen((v) => !v)}
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
                  className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1"
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
