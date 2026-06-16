/**
 * Shell principal do painel v2.
 *
 * Composição:
 *   <Sidebar /> | <Topbar />
 *               | <main>{children}</main>
 *
 * Não decide QUAL view renderizar — só fornece o esqueleto + nav controlada.
 * O parent (App.tsx) escolhe o que vai em `children` baseado no `activeNav`.
 */
import React from "react";
import { Sidebar, NavKey, NavBadges } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface AppShellProps {
  // Navegação
  activeNav: NavKey;
  onNavChange: (key: NavKey) => void;
  badges?: NavBadges;

  // Top bar
  pageTitle: string;
  pageSubtitle?: string;
  botAtivo: boolean;
  onToggleBot: () => void;
  /** Estado da conexão WhatsApp ('open' | 'connecting' | 'close' | null). */
  whatsappEstado?: string | null;
  onWhatsAppClick?: () => void;
  /** Pizzaria em período de teste — mostra chip "Teste" no Topbar. */
  isTrial?: boolean;
  onTrialClick?: () => void;

  // Identidade
  pizzariaNome?: string;
  pizzariaLogo?: string;
  userName?: string;
  userEmail?: string;
  isPlatformAdmin?: boolean;

  // Ações
  onLogout?: () => void;
  notifPermission?: NotificationPermission;
  onEnableNotifications?: () => void;

  // Conteúdo
  children: React.ReactNode;
}

export function AppShell({
  activeNav,
  onNavChange,
  badges,
  pageTitle,
  pageSubtitle,
  botAtivo,
  onToggleBot,
  whatsappEstado,
  onWhatsAppClick,
  isTrial,
  onTrialClick,
  pizzariaNome,
  pizzariaLogo,
  userName,
  userEmail,
  isPlatformAdmin,
  onLogout,
  notifPermission,
  onEnableNotifications,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#fafbfc] flex">
      <Sidebar
        active={activeNav}
        onChange={onNavChange}
        pizzariaNome={pizzariaNome}
        pizzariaLogo={pizzariaLogo}
        isPlatformAdmin={isPlatformAdmin}
        badges={badges}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          pageTitle={pageTitle}
          pageSubtitle={pageSubtitle}
          userName={userName}
          userEmail={userEmail}
          botAtivo={botAtivo}
          onToggleBot={onToggleBot}
          whatsappEstado={whatsappEstado}
          onWhatsAppClick={onWhatsAppClick}
          isTrial={isTrial}
          onTrialClick={onTrialClick}
          onLogout={onLogout}
          notifPermission={notifPermission}
          onEnableNotifications={onEnableNotifications}
        />

        {whatsappEstado === "close" && (
          <div className="bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
            <span>
              <strong>WhatsApp desconectado.</strong> Os clientes não estão sendo atendidos.
            </span>
            {onWhatsAppClick && (
              <button
                type="button"
                onClick={onWhatsAppClick}
                className="shrink-0 bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1 text-xs font-semibold"
              >
                Reconectar agora
              </button>
            )}
          </div>
        )}

        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}

// Helper para o parent: títulos padrão de cada nav
export const NAV_PAGE_META: Record<NavKey, { title: string; subtitle?: string }> = {
  inicio:    { title: "Início" },
  analise:   { title: "Análise", subtitle: "Desempenho e métricas do seu negócio" },
  conversas: { title: "Conversas", subtitle: "Mensagens dos clientes no WhatsApp" },
  pedidos:   { title: "Pedidos",   subtitle: "Acompanhe o fluxo dos pedidos" },
  cardapio:  { title: "Cardápio",  subtitle: "Produtos, categorias e preços" },
  negocio:   { title: "Meu Negócio", subtitle: "Tudo sobre sua pizzaria" },
  entregadores: { title: "Entregadores", subtitle: "Cadastre e gerencie sua equipe de entrega" },
  assinatura: { title: "Assinatura", subtitle: "Plano, faturas e renovação" },
  ajuda:     { title: "Ajuda", subtitle: "Guia rápido de cada funcionalidade" },
  admin:     { title: "Plataforma", subtitle: "Visão de administrador da SaaS" },
};
