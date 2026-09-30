---
name: PizzaBot — painel operacional
description: Carvão, grafite e laranja para operar a pizzaria com clareza.
colors:
  canvas: "#101418"
  surface: "#191e25"
  surface-muted: "#20262f"
  line: "#303741"
  ink: "#f2f5fa"
  ink-muted: "#b4bdca"
  ink-subtle: "#99a4b5"
  white: "#ffffff"
  brand-300: "#fdba74"
  brand-400: "#fb923c"
  brand-500: "#f97316"
  brand-700: "#c2410c"
  brand-800: "#9a3412"
  brand-900: "#7c2d12"
  orange-400: "oklch(75% 0.183 55.934)"
  orange-500: "oklch(70.5% 0.213 47.604)"
  emerald-700: "oklch(50.8% 0.118 165.612)"
  emerald-800: "oklch(43.2% 0.095 166.913)"
  emerald-900: "oklch(37.8% 0.077 168.94)"
  rose-700: "oklch(51.4% 0.222 16.935)"
  rose-800: "oklch(45.5% 0.188 13.697)"
  rose-900: "oklch(41% 0.159 10.272)"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  description:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
rounded:
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-700}"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-800}"
  button-primary-active:
    backgroundColor: "{colors.brand-900}"
  button-soft:
    backgroundColor: "color-mix(in oklab, oklch(70.5% 0.213 47.604) 15%, transparent)"
    textColor: "{colors.orange-400}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-success:
    backgroundColor: "{colors.emerald-700}"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-danger:
    backgroundColor: "{colors.rose-700}"
    textColor: "{colors.white}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  navigation:
    backgroundColor: "rgb(249 115 22 / .12)"
    textColor: "{colors.brand-400}"
    typography: "{typography.control}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  badge-brand:
    backgroundColor: "rgb(249 115 22 / .10)"
    textColor: "{colors.brand-300}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: PizzaBot — painel operacional

## Overview

**Creative North Star: "A operação em primeiro plano"**

O painel reúne fundo carvão, superfícies grafite, linhas discretas e laranja para orientar seleção e ação. A personalidade é sóbria e operacional: títulos em caixa normal, ícones de traço fino e alinhamento consistente deixam pedidos, mensagens e configurações legíveis durante o turno. Esta linguagem deriva dos conceitos de computador e celular aprovados e do sistema implementado.

A densidade é ajustada ao espaço disponível sem retirar funções. A hierarquia depende de posição, tipografia e níveis tonais; a cor reforça estados já descritos por rótulos. O sistema cobre os painéis da pizzaria e da plataforma, autenticação e diálogos administrativos. A personalização do cardápio público pertence a cada pizzaria.

**Key Characteristics:**
- Carvão e grafite com bordas discretas.
- Laranja em ação principal, seleção e foco.
- Inter, títulos em caixa normal e controles compactos.
- Profundidade tonal, com sombra reservada às sobreposições.
- Reorganização responsiva com destinos e ações preservados.

## Colors

A paleta escura mantém texto claro e deixa o laranja funcionar como orientação operacional. Os valores normativos estão no frontmatter; os nomes acompanham os tokens reais de `src/index.css` e, nos estados semânticos, a escala instalada do Tailwind.

### Primary

- **Laranja de ação — brand-700:** fundo sólido de ação principal com texto branco; a escolha mais escura atende ao contraste do botão.
- **Laranja de resposta — brand-800 e brand-900:** hover e pressionamento da ação principal.
- **Laranja de orientação — brand-400:** seleção, foco, ícones e ênfase de marca em superfícies escuras.
- **Laranja de sinal — brand-500:** pontos de estado e fundos/bordas translúcidos.
- **Laranja claro — brand-300:** texto de badges e anel de foco dos botões.

### Neutral

- **Carvão — canvas:** fundo do shell, sidebar e topo.
- **Grafite — surface:** cartões, campos e diálogos.
- **Grafite elevado — surface-muted:** controles secundários, cabeçalhos e áreas auxiliares; `surface-elevated` usa o mesmo valor no código.
- **Linha — line:** separação de regiões e contornos.
- **Texto principal — ink:** títulos, conteúdo e valores.
- **Texto secundário — ink-muted:** descrições e navegação inativa.
- **Texto auxiliar — ink-subtle:** dicas, placeholders e metadados.
- **Branco — white:** texto de ações sólidas.

As cores semânticas não formam novos acentos de identidade. Emerald atende ações de sucesso; rose atende ações destrutivas. Badges e etapas reutilizam as escalas semânticas existentes em `Badge.tsx` e `orderStatus.ts`, com rótulo e, quando necessário, ponto/ícone.

**The Action Contrast Rule.** Use brand-700 com texto branco nas ações sólidas; use brand-400 para seleção e ênfase sobre superfícies escuras.

## Typography

**Display Font:** não há uma família de display distinta no painel.
**Body Font:** Inter, com fallback ui-sans-serif, system-ui e sans-serif.

**Character:** a mesma família sustenta títulos, conteúdo e controles. Peso e tamanho organizam a densidade sem introduzir um segundo estilo de voz; números de métricas e contagens usam alinhamento tabular quando implementado.

### Hierarchy

- **Headline:** título principal do shell; no celular muda para 25px.
- **Title:** título interno de página; no celular muda para 18px.
- **Body:** base do documento, preservada em 16px; controles e conteúdo compacto usam 14px.
- **Control:** ações médias e navegação, com peso semibold; navegação inativa usa peso 500.
- **Description:** explicações de página, com limite de 72ch quando aplicado.
- **Label:** rótulos, badges e dicas compactas; descrições auxiliares podem usar peso 400 ou 500. Na navegação inferior os rótulos usam 11px.

Títulos de cartão usam 14px/700, títulos de diálogo usam 16px/700, e valores de métricas usam 20px/600 com entrelinha 1.25. Esses papéis são variações observadas da mesma família.

**The Plain Title Rule.** Use títulos em caixa normal e hierarquia direta; não acrescente um eyebrow decorativo acima do título.

## Layout

O shell administrativo tem sidebar fixa no fluxo (244px), conteúdo flexível com largura mínima zero e topo sticky. O topo tem mínimo de 68px; sua altura real é registrada por ResizeObserver em `--pzb-topbar-height`, para que quadros e conversas respeitem as linhas extras de status ou alertas.

A página usa gutters de 24px no computador e 16px no celular. O ritmo reutiliza intervalos de 4, 8, 12, 16, 20 e 24px. Cabeçalhos e ações podem quebrar linha; rótulos e valores longos precisam conservar espaço próprio.

A partir de 768px a sidebar é visível. Abaixo disso, quatro destinos — Pedidos, Conversas, Cardápio e Meu Negócio — e Mais formam a barra inferior. A reserva inferior é `64px + env(safe-area-inset-bottom,0px)`; ações sticky de formulário se posicionam acima dela. Mais preserva os outros destinos e a permissão de Plataforma.

O strip de métricas tem quatro células acima de 1200px e grade 2×2 até 1200px. Em Pedidos, abaixo de 768px, as métricas vêm depois do quadro. O kanban de seis etapas ocupa colunas horizontais a partir de 1280px, com largura mínima de 210px e gap de 12px; Cancelados aparece quando há conteúdo e mantém a rolagem. Abaixo de 1280px o seletor de etapas conduz cartões em coluna. Detalhes e avanço dividem uma grade de duas colunas proporcionais (0.85fr e 1.15fr), com rótulos quebráveis.

## Elevation & Depth

Cartões em repouso usam diferença tonal e contorno, com `shadow-card` e `shadow-card-hover` definidos como none. O cartão interativo destaca a borda no hover. Diálogos, menus e o painel Mais usam a sombra `shadow-pop` registrada no sidecar. A implementação ainda tem sombras locais em avisos e controles específicos; elas não constituem uma escala adicional de elevação.

**The Tonal Surface Rule.** Separe regiões comuns com canvas, surface, surface-muted e line; reserve shadow-pop para sobreposições.

O movimento de entrada usa fade de 180ms, pop com deslocamento vertical de 4px em 180ms e painel lateral em 220ms, com curva cubic-bezier(.16,1,.3,1). Estados dos controles usam a transição padrão de 150ms. Respeite a redução de movimento implementada.

## Shapes

Controles retangulares usam cantos suaves (lg); cartões e regiões usam cantos mais amplos (xl). Badges, pontos e avatares são circulares ou cápsulas (full). Bordas comuns têm 1px. O painel Mais usa cantos superiores de 16px, uma variação local da sobreposição.

Ícones Lucide mantêm traço fino e tamanho conforme o controle: 14–16px em botões, 18px na sidebar e 20px em ações maiores. A marca também é vetorial; nenhum raster de interface foi embarcado.

## Components

### Buttons

Ações compactas e explícitas, com altura mínima e estados visíveis.

- **Primary / solid:** solid é alias visual de primary; fundo de ação, hover e active seguem as três etapas de marca.
- **Soft:** usa a escala orange instalada do Tailwind, com texto orange-400, fundo orange-500 a 15% e borda a 25%; hover aumenta o fundo para 25%.
- **Outline:** surface-muted, texto principal e line; hover troca para surface e borda ink-subtle.
- **Ghost:** texto secundário sem fundo; hover usa surface-muted e texto principal.
- **Success / danger:** fundos semânticos nos níveis 700, 800 e 900 para repouso, hover e active.
- **Sizes:** sm usa 12px, padding 8px 12px e mínimo de 36px; md usa o controle do frontmatter e mínimo de 40px; lg usa 14px, padding 12px 20px e mínimo de 44px.
- **Focus / disabled:** anel de 2px brand-300; desabilitado e carregando reduzem a opacidade para 50% e bloqueiam ação. Carregamento substitui o ícone pelo spinner.

### Chips

Badges usam cápsula, borda de 1px, texto de rótulo e gap de 6px. A versão brand aplica as transparências do frontmatter, com ponto opcional. Estados de pedido vêm da fonte única `orderStatus.ts`; preserve rótulo e indicação além da cor. Um badge informativo não ganha comportamento de botão.

### Cards / Containers

Surface, line, raio xl e padding de 16px compõem o cartão padrão. O estado interativo modifica apenas o contorno. Cabeçalho combina ícone, título, descrição e ação opcional. O strip de métricas compartilha uma moldura e divisórias; suas células deixam de ser cartões independentes.

### Inputs / Fields

Campo de 14px/20px sobre surface, borda line, raio lg e padding do frontmatter. Ícone opcional ocupa a esquerda e amplia o recuo para 36px. Placeholder usa ink-subtle. Focus troca a borda para brand-400 e adiciona anel de 2px a 20%; erro troca para rose, acompanha mensagem textual e não substitui o rótulo. Desabilitado usa opacidade de 60%. Field reúne rótulo, obrigatório, controle e dica/erro.

### Navigation

Sidebar organiza destinos em Operação, Gestão, Cardápio e identidade, Negócio e conta. Seleção usa fundo laranja a 12%, texto brand-400 e peso 600; inativos usam texto secundário e peso 500. Hover reforça fundo e texto. `aria-current="page"` identifica o destino atual. A barra inferior e Mais mantêm os mesmos destinos e permissões.

Tabs são horizontais com rolagem, padding 10px 14px, texto 13px/600 e seleção equivalente à navegação. Topo distingue loja, WhatsApp e bot com texto de estado, ícone e cor semântica.

### Dialogs

Superfície com borda, raio xl, shadow-pop e fundo de bloqueio preto a 75%. Cabeçalho e rodapé usam surface-muted; corpo rola dentro do limite da viewport. Os tamanhos máximos são 384, 512, 672 e 896px. O diálogo move e contém o foco, fecha com Escape e devolve foco ao disparador.

## Do's and Don'ts

### Do:
- **Do** use brand-700 com texto branco para a ação principal e brand-400 para seleção.
- **Do** mantenha títulos em caixa normal, rótulos explícitos e indicação de estado além da cor.
- **Do** preserve gutters, alturas medidas, safe area e a reserva da navegação inferior.
- **Do** permita quebra de rótulos e nomes longos sem invadir valores ou ações.
- **Do** preserve destinos, campos e ações ao reorganizar as telas.

### Don't:
- **Don't** imponha o tema administrativo ou color-scheme dark ao cardápio público.
- **Don't** adicione eyebrows decorativos acima dos títulos.
- **Don't** promova sombras locais a um padrão de elevação para cartões.
- **Don't** substitua dados reais por números ou clientes ilustrativos dos conceitos.

