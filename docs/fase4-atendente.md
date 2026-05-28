# Fase 4 — Construtor visual de personalidade

## O que entrou

Três componentes React novos, todos no padrão visual do painel (orange/slate, lucide, motion):

| Arquivo | Função |
|---|---|
| `src/lib/api.ts` | Cliente HTTP do novo backend Python + persistência de JWT |
| `src/components/PersonalityBuilder.tsx` | Tela principal com 6 cards de configuração |
| `src/components/AgentTestPanel.tsx` | Modal de chat de teste (sem WhatsApp) |
| `src/components/AttendantPage.tsx` | Wrapper que junta os dois |

## Estrutura visual da tela

```
┌─ Personalidade da Atendente ──────────── [Ver prompt] [Testar agora] ─┐
│                                                                       │
│  ┌─ Identidade ─────────────────────────────────────────────────┐    │
│  │  Nome: [ Camila                                  ]            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─ Estilo de comunicação ──────────────────────────────────────┐    │
│  │  [Casual ✓]    [Profissional]    [Próximo (carinhoso)]        │    │
│  │   "Oi, em que posso te ajudar? Quer dar uma olhada..."        │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─ Uso de emojis ──────────────────────────────────────────────┐    │
│  │  [Nenhum] [Pouco] [Moderado ✓] [Muito]                        │    │
│  │  Exemplo: "Oi! 😊 Em que posso ajudar?"                       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─ Vocabulário regional (opcional) ────────────────────────────┐    │
│  │  [ uai, trem, bão                                            ]│    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─ ⭐ Diferenciais que ela deve citar ─────────────────────────┐    │
│  │  [+ adicionar...                                ] [Adicionar]│    │
│  │  ● Massa fermentada 48h  ●Borda recheada quarta              │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─ 🛡️ Coisas que ela NUNCA deve fazer ─────────────────────────┐    │
│  │  [+ adicionar...                                ] [Adicionar]│    │
│  │  ● Não citar concorrentes                                    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ▼ Avançado (para usuários experientes)                              │
│    - Exemplos de conversa (few-shot)                                 │
│    - Instruções extras (texto livre)                                 │
│                                                                       │
│  ────────────────────────────────────────────────────────────────    │
│  Mudanças entram em vigor na próxima conversa.   [Salvar 💾]         │
└──────────────────────────────────────────────────────────────────────┘
```

## Como mostrar no painel (testando antes da Fase 5)

Em qualquer componente onde você tenha `pizzeria.id`:

```tsx
import { AttendantPage } from "./components/AttendantPage";

<AttendantPage pizzariaId={pizzeria.id} />
```

### Configurando o endpoint da API

Adicione no `.env` do front (ou no `vite.config.ts` defaults):

```
VITE_PIZZABOT_API_URL=http://localhost:8000
```

Em produção (Coolify):

```
VITE_PIZZABOT_API_URL=https://api.seu-dominio.com
```

### Autenticação

Antes de abrir a `AttendantPage`, faça login uma vez (qualquer lugar):

```tsx
import { authApi } from "./lib/api";

await authApi.login("admin@teste.com", "SuaSenha123");
// Token vai pra localStorage, todas as próximas chamadas usam ele
```

## O que o usuário sente vs o que acontece no servidor

| O dono clica em... | O backend recebe... |
|---|---|
| Escolhe "Casual" | `estilo: "casual"` |
| Slider em "Muito" emojis | `nivel_emoji: "muito"` |
| Digita "uai, trem" em regional | `vocabulario_regional: "uai, trem"` |
| Adiciona "Massa fermentada 48h" | `diferenciais: ["Massa fermentada 48h"]` |
| Clica "Salvar" | `PUT /pizzarias/{id}/agente/personalidade` |
| Clica "Ver prompt" | Mostra o system_prompt MONTADO no servidor |
| Clica "Testar agora" + escreve "oi" | `POST /pizzarias/{id}/agente/testar` → resposta real do Gemini |

## Por que assim e não um campo de texto livre

Antes (n8n): prompt cru de 200+ linhas que o dono não ia mexer.
Agora:
- O dono não precisa escrever uma palavra de prompt
- Cada bloco é validável (estilo só aceita 3 valores)
- O backend MONTA o prompt — se a gente melhorar a estrutura, todas as pizzarias ganham automático
- Quem quiser **pode** mexer no avançado (instruções extras), mas é opt-in

## Próxima fase

Fase 5 vai colocar essa tela dentro da nova nav (`Meu Negócio → Atendente`), junto com outras configs reorganizadas. Por enquanto, ela já está 100% funcional e pode ser testada montando em qualquer rota.
