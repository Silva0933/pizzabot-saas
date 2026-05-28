# Fase 5 — Reorganização do painel

## O que entrou

7 arquivos novos em `src/components/v2/`:

| Arquivo | Função |
|---|---|
| `AppShell.tsx` | Shell principal (sidebar + topbar + slot de conteúdo) |
| `Sidebar.tsx` | Nav vertical desktop / bottom-nav mobile com 5 itens |
| `Topbar.tsx` | Status do bot + notificações + menu do usuário |
| `Tooltip.tsx` | Hover hints para explicar opções técnicas |
| `InicioDashboard.tsx` | Dashboard focado no DIA (não em histórico) |
| `MeuNegocioView.tsx` | Container com tabs: Atendente + Geral |
| `OnboardingChecklist.tsx` | Checklist visual de setup (some quando completo) |

Tudo exportado por `src/components/v2/index.ts`.

## Nova arquitetura visual

```
┌───────────────────┬─────────────────────────────────────────┐
│  🍕 Pizzaria Tal  │  Início                      [🤖 Bot ✓] │
│     PAINEL        ├─────────────────────────────────────────┤
│                   │                                         │
│  🏠 Início        │   Bom dia, João? 👋                     │
│  💬 Conversas 3   │   Você tem 2 pedidos aguardando agora.  │
│  📋 Pedidos 2     │                                         │
│  🍴 Cardápio      │   [Pedidos hoje: 8]  [Vendido: R$ 432]  │
│  🏪 Meu Negócio   │   [Não lidas: 3]     [Ticket: R$ 54]    │
│                   │                                         │
│  ─────────────    │   ▼ Aguardando ação (2)                 │
│  🛡️ Plataforma   │     #15 Joao Silva — Novo — R$ 67,50    │
│                   │     #14 Maria — Confirmado — R$ 89,90   │
│                   │                                         │
│  v2.0 · PizzaBot  │                                         │
└───────────────────┴─────────────────────────────────────────┘
```

Mobile: sidebar vira **bottom-nav** com 5 ícones.

## Princípios da Fase 5

1. **5 itens no menu** — não 8, não 12. Só o que importa todo dia.
2. **Dashboard do DIA** — abriu o painel, em 5 segundos sabe se tem algo pra resolver.
3. **Meu Negócio agrupa tudo de config** — o dono não precisa entender "subsistemas".
4. **Tooltips em opções técnicas** — `<Tooltip content="...">` em qualquer botão.
5. **Onboarding-by-checklist** — mostra o que falta, some quando pronto.

## Como ligar no App.tsx

Substitui o `return <div>...</div>` do App por:

```tsx
import {
  AppShell, NAV_PAGE_META,
  InicioDashboard, MeuNegocioView,
} from "./components/v2";
import { KanbanView } from "./components/KanbanView";
import { ConversationsView } from "./components/ConversationsView";
import { MenuManagementView } from "./components/MenuManagementView";
import { SaasAdminView } from "./components/SaasAdminView";

// ... toda a lógica de hooks/dados continua a mesma ...

const [nav, setNav] = useState<NavKey>("inicio");
const meta = NAV_PAGE_META[nav];

return (
  <AppShell
    activeNav={nav}
    onNavChange={setNav}
    pageTitle={meta.title}
    pageSubtitle={meta.subtitle}
    badges={{
      conversas: conversations.filter(c => (c as any).unreadCount > 0).length,
      pedidos: orders.filter(o => o.status === 'novo').length,
    }}
    pizzariaNome={pizzeria.name}
    pizzariaLogo={pizzeria.logoUrl}
    userName={currentOperator?.email?.split('@')[0]}
    userEmail={user?.email}
    botAtivo={pizzeria.botActiveGlobal}
    onToggleBot={() => updatePizzeria({ botActiveGlobal: !pizzeria.botActiveGlobal })}
    isPlatformAdmin={isPlatformAdmin}
    onLogout={() => supabase.auth.signOut()}
    notifPermission={notifPermission}
    onEnableNotifications={handleEnableNotifications}
  >
    {nav === "inicio" && (
      <InicioDashboard
        pizzeria={pizzeria}
        orders={orders}
        conversations={conversations}
        productCount={products.length}
        onNavigate={(k) => setNav(k as NavKey)}
        onboarding={[
          { id: "menu", title: "Cadastre seu cardápio", description: "Adicione pelo menos 3 produtos",
            done: products.length >= 3, action: () => setNav("cardapio") },
          { id: "wpp", title: "Conecte o WhatsApp",  description: "Escaneie o QR code da Evolution",
            done: Boolean(pizzeria.instance), action: () => setNav("negocio") },
          { id: "pay", title: "Configure pagamento", description: "Mercado Pago ou Asaas",
            done: pizzeria.gatewayPayment !== 'nenhum', action: () => setNav("negocio") },
          { id: "atendente", title: "Personalize a atendente", description: "Defina nome, estilo e diferenciais",
            done: false /* checar via API /agente/personalidade */, action: () => setNav("negocio") },
        ]}
      />
    )}

    {nav === "conversas" && (
      <ConversationsView /* ... props existentes ... */ />
    )}

    {nav === "pedidos" && (
      <KanbanView /* ... props existentes ... */ />
    )}

    {nav === "cardapio" && (
      <MenuManagementView /* ... props existentes ... */ />
    )}

    {nav === "negocio" && (
      <MeuNegocioView
        pizzeria={pizzeria}
        operators={operators}
        onUpdatePizzeria={updatePizzeria}
        onInviteOperator={inviteOperator}
        onDeleteOperator={deleteOperator}
        onOpenTestAgent={() => setIsTestAgentOpen(true)}
      />
    )}

    {nav === "admin" && isPlatformAdmin && (
      <SaasAdminView />
    )}
  </AppShell>
);
```

## O que mudou na experiência do dono

### Antes (estrutura antiga)
- 8+ abas no topo: Quickstart, Dashboard, Pedidos, Conversas, Cardápio, Financeiro, Configurações, Simulador, etc.
- Dashboard com métricas históricas confusas
- Configurações em uma página gigante com 10+ seções
- Editor de prompt cru

### Depois (v2)
- 5 itens no menu lateral
- Início focado no dia + checklist de setup
- "Meu Negócio" agrupa Atendente (Fase 4) + Configurações
- Atendente = builder visual, sem prompt
- Tooltips em opções técnicas
- Mobile-first: bottom-nav idêntica em telefone

### O que NÃO mudou (intencionalmente)
- **Cores**: orange/slate, mesmas variáveis Tailwind
- **Componentes que funcionam**: KanbanView, ConversationsView, MenuManagementView ficam EXATAMENTE como estão
- **Stack**: React 19 + Vite + Tailwind v4 + lucide + motion
- **Banco**: ainda Supabase (a Fase 6 migra pro backend novo)

## Migração incremental

Não é preciso trocar tudo de uma vez. Como o `AppShell` é "props-in / children-out", você pode:

1. Manter `App.tsx` atual no `main` enquanto desenvolve
2. Criar um `App.v2.tsx` paralelo usando o snippet acima
3. Trocar o `<App />` em `main.tsx` quando estiver confortável
4. Apagar componentes antigos só depois de validar
