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
          onLogout={onLogout}
          notifPermission={notifPermission}
          onEnableNotifications={onEnableNotifications}
        />

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
  conversas: { title: "Conversas", subtitle: "Mensagens dos clientes no WhatsApp" },
  pedidos:   { title: "Pedidos",   subtitle: "Acompanhe o fluxo dos pedidos" },
  cardapio:  { title: "Cardápio",  subtitle: "Produtos, categorias e preços" },
  negocio:   { title: "Meu Negócio", subtitle: "Tudo sobre sua pizzaria" },
  admin:     { title: "Plataforma", subtitle: "Visão de administrador da SaaS" },
};
