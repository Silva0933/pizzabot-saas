/**
 * Tema do Cardápio Digital — fonte única de verdade.
 *
 * A anatomia da página é a mesma para todo mundo (a do design de referência):
 * barra de cupom, header fixo, hero, diferenciais, cardápio, promoções, passos,
 * localização, dúvidas, rodapé. O que cada pizzaria personaliza é a PELE —
 * paleta, tipografia, arredondamento e todos os textos.
 *
 * Tudo vira CSS custom property em `.cdp-root`, então o CSS não conhece tema
 * nenhum: ele só lê as variáveis. Isso é o que permite acrescentar um tema novo
 * sem tocar em uma linha de estilo.
 *
 * Consumido por CardapioPublico (renderiza) e por CardapioViewV2 (edita).
 */
import type { CSSProperties } from "react";
import type { TemaCardapioConfig, TemaCardapioModelo } from "./api";

// ============================================================
// Tipografia
//
// `escala` compensa a largura da familia no titulo do hero: o desenho de
// referencia calibrou 112px numa CONDENSADA, e uma fonte de largura normal no
// mesmo corpo estoura a coluna e quebra o titulo em quatro linhas.
// ============================================================
export const FONTES_TITULO = {
  big_shoulders: { escala: 1, label: "Big Shoulders", stack: "'Big Shoulders Display','Big Shoulders',Impact,'Arial Narrow',sans-serif", google: "Big+Shoulders+Display:wght@700;800;900" },
  anton: { escala: 0.92, label: "Anton", stack: "'Anton',Impact,sans-serif", google: "Anton" },
  bebas: { escala: 1, label: "Bebas Neue", stack: "'Bebas Neue',Impact,sans-serif", google: "Bebas+Neue" },
  playfair: { escala: 0.68, label: "Playfair Display", stack: "'Playfair Display',Georgia,serif", google: "Playfair+Display:wght@600;700;800;900" },
  outfit: { escala: 0.66, label: "Outfit", stack: "'Outfit',system-ui,sans-serif", google: "Outfit:wght@600;700;800;900" },
  archivo: { escala: 0.64, label: "Archivo Black", stack: "'Archivo Black',Impact,sans-serif", google: "Archivo+Black" },
} as const;

export const FONTES_TEXTO = {
  figtree: { label: "Figtree", stack: "'Figtree',system-ui,-apple-system,'Segoe UI',sans-serif", google: "Figtree:wght@400;500;600;700;800" },
  inter: { label: "Inter", stack: "'Inter',system-ui,sans-serif", google: "Inter:wght@400;500;600;700;800" },
  montserrat: { label: "Montserrat", stack: "'Montserrat',system-ui,sans-serif", google: "Montserrat:wght@400;500;600;700;800" },
  nunito: { label: "Nunito", stack: "'Nunito',system-ui,sans-serif", google: "Nunito:wght@400;500;600;700;800" },
  outfit: { label: "Outfit", stack: "'Outfit',system-ui,sans-serif", google: "Outfit:wght@400;500;600;700;800" },
  dm_sans: { label: "DM Sans", stack: "'DM Sans',system-ui,sans-serif", google: "DM+Sans:wght@400;500;600;700" },
} as const;

export type FonteTituloId = keyof typeof FONTES_TITULO;
export type FonteTextoId = keyof typeof FONTES_TEXTO;

export const BORDAS = {
  retas: { label: "Retas", raio: "4px" },
  suaves: { label: "Suaves", raio: "16px" },
  arredondadas: { label: "Arredondadas", raio: "28px" },
} as const;

// ============================================================
// Textos padrão
//
// Vêm preenchidos para o cardápio já nascer publicável, sem a pizzaria
// precisar escrever nada. Cada campo é editável no painel.
// ============================================================
export const COPY_PADRAO = {
  barra_cupom_ativa: true,
  barra_cupom_texto: "15% OFF em pedidos acima de R$ 30 com o cupom",
  // Sem chamada por padrao: o design de referencia abre direto no titulo.
  chamada: "",
  titulo: "O sabor que|acende a fome.",
  descricao:
    "Feito na hora e do seu jeito. Escolha seus favoritos, personalize o pedido e receba tudo quentinho onde estiver.",
  cta_primario: "Ver cardápio",
  cta_secundario: "Como chegar",
  destaques_titulo: "Destaques",
  diferenciais: [
    { icone: "relogio", titulo: "30–45 min", descricao: "Tempo estimado" },
    { icone: "chama", titulo: "Feito na hora", descricao: "Mais sabor no seu pedido" },
    { icone: "ajustes", titulo: "Personalizável", descricao: "Escolha tamanhos e adicionais" },
    { icone: "sacola", titulo: "Retirada disponível", descricao: "Prático do início ao fim" },
  ],
  promocoes_titulo: "Aproveite antes que acabe",
  promocoes_subtitulo: "Campanhas preparadas especialmente para você.",
  passos_titulo: "Seu pedido em 3 passos",
  passos: [
    { titulo: "Escolha", descricao: "Navegue pelas categorias e encontre seus favoritos." },
    { titulo: "Personalize", descricao: "Defina tamanho, adicionais e observações." },
    { titulo: "Receba", descricao: "Informe o endereço ou escolha retirada no local." },
  ],
  localizacao_titulo: "Nossa localização",
  faq_titulo: "Dúvidas frequentes",
  faq: [
    { pergunta: "Qual o tempo de entrega?", resposta: "Em média de 30 a 45 minutos, dependendo da região e do movimento da casa." },
    { pergunta: "Vocês trabalham com retirada?", resposta: "Sim. É só escolher a opção retirada no fechamento do pedido e vir buscar quando estiver pronto." },
    { pergunta: "Quais formas de pagamento vocês aceitam?", resposta: "Pix, cartão e dinheiro. Você escolhe na hora de fechar o pedido." },
    { pergunta: "Posso personalizar meu pedido?", resposta: "Pode. Cada item tem tamanhos, adicionais e um campo de observações para você escrever do seu jeito." },
  ],
  rodape_frase: "Feito com carinho, entregue com sabor.",
} as const;

// ============================================================
// Os 3 temas
//
// Mesma anatomia, peles diferentes. Cada um define o conjunto COMPLETO de
// tokens: um tema pela metade deixaria buracos de contraste na página.
// ============================================================
export interface TokensTema {
  fonte_titulo: FonteTituloId;
  fonte_texto: FonteTextoId;
  titulo_caixa_alta: boolean;
  cor_primaria: string;
  cor_secundaria: string;
  cor_fundo: string;
  cor_superficie: string;
  cor_superficie_alta: string;
  cor_borda: string;
  cor_texto: string;
  cor_texto_suave: string;
  cor_texto_apagado: string;
  cor_botao: string;
  cor_botao_texto: string;
  bordas: keyof typeof BORDAS;
}

export const TEMAS: Record<TemaCardapioModelo, { label: string; descricao: string; tokens: TokensTema }> = {
  // O design de referência: noite, brasa e um âmbar de realce.
  brasa: {
    label: "Brasa",
    descricao: "Noite e fogo. Títulos condensados em caixa alta, laranja de brasa sobre marrom profundo.",
    tokens: {
      fonte_titulo: "big_shoulders",
      fonte_texto: "figtree",
      titulo_caixa_alta: true,
      cor_primaria: "#FF6B1A",
      cor_secundaria: "#FFC247",
      cor_fundo: "#140F0B",
      cor_superficie: "#1E1712",
      cor_superficie_alta: "#241B15",
      cor_borda: "#2E241C",
      cor_texto: "#FFF3E3",
      cor_texto_suave: "#C9B8A6",
      cor_texto_apagado: "#A08D7B",
      cor_botao: "#FF6B1A",
      cor_botao_texto: "#1A0D05",
      bordas: "suaves",
    },
  },
  // Contraponto claro: cantina italiana, papel e vinho.
  trattoria: {
    label: "Trattoria",
    descricao: "Claro e acolhedor. Serifa elegante, creme de papel, vinho e dourado.",
    tokens: {
      fonte_titulo: "playfair",
      fonte_texto: "nunito",
      titulo_caixa_alta: false,
      cor_primaria: "#9B2C2C",
      cor_secundaria: "#C08A2E",
      cor_fundo: "#F7F1E6",
      cor_superficie: "#FFFDF8",
      cor_superficie_alta: "#F0E6D6",
      cor_borda: "#E2D3BC",
      cor_texto: "#2B1D14",
      cor_texto_suave: "#5C4636",
      cor_texto_apagado: "#8A7360",
      cor_botao: "#9B2C2C",
      cor_botao_texto: "#FFFDF8",
      bordas: "arredondadas",
    },
  },
  // Urbano e elétrico, para quem quer parecer tudo menos tradicional.
  metropole: {
    label: "Metrópole",
    descricao: "Urbano e elétrico. Geométrica moderna, azul-noite com lima e violeta.",
    tokens: {
      fonte_titulo: "outfit",
      fonte_texto: "dm_sans",
      titulo_caixa_alta: false,
      cor_primaria: "#B7F34A",
      cor_secundaria: "#7C5CFF",
      cor_fundo: "#0B1020",
      cor_superficie: "#141A2E",
      cor_superficie_alta: "#1B2340",
      cor_borda: "#26304F",
      cor_texto: "#EEF2FF",
      cor_texto_suave: "#A9B4D4",
      cor_texto_apagado: "#7B87AC",
      cor_botao: "#B7F34A",
      cor_botao_texto: "#0B1020",
      bordas: "arredondadas",
    },
  },
};

export const MODELO_PADRAO: TemaCardapioModelo = "brasa";

/**
 * Valores que a versao ANTERIOR gravava sozinha no tema.
 *
 * O `normalizarTema` antigo mesclava o preset dentro da config a cada salvamento,
 * entao quase toda pizzaria tem esses valores no banco sem nunca ter escolhido
 * nenhum deles. Tratar como personalizacao deixaria todo cardapio existente preso
 * na paleta velha, sem nunca receber o tema novo. Entao valor identico ao preset
 * antigo conta como "nao personalizado" e cede ao tema atual.
 *
 * Personalizacao de verdade (qualquer valor diferente destes) e sempre respeitada.
 */
const LEGADO: Record<TemaCardapioModelo, Record<string, string>> = {
  brasa: {
    fonte_titulo: "anton", fonte_texto: "inter", bordas: "suaves",
    cor_primaria: "#f26b21", cor_secundaria: "#ff4d22", cor_fundo: "#090907",
  },
  trattoria: {
    fonte_titulo: "playfair", fonte_texto: "nunito", bordas: "suaves",
    cor_primaria: "#a52a2a", cor_secundaria: "#d39b45", cor_fundo: "#f5ecdf",
  },
  metropole: {
    fonte_titulo: "outfit", fonte_texto: "montserrat", bordas: "arredondadas",
    cor_primaria: "#b7f34a", cor_secundaria: "#7c5cff", cor_fundo: "#0b1020",
  },
};

/** Textos que o codigo antigo tambem gravava sozinho. */
const LEGADO_TEXTO: Record<string, string> = {
  chamada: "FEITO NA HORA. DO SEU JEITO.",
  promocoes_subtitulo: "Ofertas da semana, enquanto durarem.",
  rodape_frase: "Feito na hora, entregue quentinho.",
  titulo: "O SABOR QUE|ACENDE A FOME.",
  descricao: "Escolha seus favoritos, personalize o pedido e receba tudo quentinho onde estiver.",
};

function ehLegado(modelo: TemaCardapioModelo, chave: string, valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const v = valor.trim().toLowerCase();
  const doModelo = LEGADO[modelo]?.[chave];
  if (doModelo && doModelo.toLowerCase() === v) return true;
  const texto = LEGADO_TEXTO[chave];
  return !!texto && texto.toLowerCase() === v;
}

// ============================================================
// Resolução
// ============================================================

/** Tema completo: tokens do modelo + copy padrão, com o que a pizzaria salvou por cima. */
export function resolverTema(bruto?: TemaCardapioConfig | null): Required<TokensTema> & TemaCardapioConfig {
  const salvo = bruto || {};
  const modelo: TemaCardapioModelo =
    salvo.modelo && TEMAS[salvo.modelo] ? salvo.modelo : MODELO_PADRAO;
  const base = TEMAS[modelo].tokens;

  // Só sobrescreve com o que foi realmente escolhido. String vazia no painel
  // significa "volta pro padrão do tema", não "deixa em branco" — e valor herdado
  // da versão anterior (ver LEGADO) também cede, porque ninguém o escolheu.
  const usar = <T,>(valor: T | undefined | null, padrao: T, chave?: string): T => {
    if (valor === undefined || valor === null || valor === "") return padrao;
    if (chave && ehLegado(modelo, chave, valor)) return padrao;
    return valor;
  };

  return {
    ...COPY_PADRAO,
    ...base,
    ...salvo,
    modelo,
    fonte_titulo: usar(salvo.fonte_titulo as FonteTituloId, base.fonte_titulo, "fonte_titulo"),
    fonte_texto: usar(salvo.fonte_texto as FonteTextoId, base.fonte_texto, "fonte_texto"),
    titulo_caixa_alta: usar(salvo.titulo_caixa_alta, base.titulo_caixa_alta),
    cor_primaria: usar(salvo.cor_primaria, base.cor_primaria, "cor_primaria"),
    cor_secundaria: usar(salvo.cor_secundaria, base.cor_secundaria, "cor_secundaria"),
    cor_fundo: usar(salvo.cor_fundo, base.cor_fundo, "cor_fundo"),
    cor_superficie: usar(salvo.cor_superficie, base.cor_superficie),
    cor_superficie_alta: usar(salvo.cor_superficie_alta, base.cor_superficie_alta),
    cor_borda: usar(salvo.cor_borda, base.cor_borda),
    cor_texto: usar(salvo.cor_texto, base.cor_texto),
    cor_texto_suave: usar(salvo.cor_texto_suave, base.cor_texto_suave),
    cor_texto_apagado: usar(salvo.cor_texto_apagado, base.cor_texto_apagado),
    cor_botao: usar(salvo.cor_botao, salvo.cor_primaria || base.cor_botao),
    cor_botao_texto: usar(salvo.cor_botao_texto, base.cor_botao_texto),
    bordas: usar(salvo.bordas as keyof typeof BORDAS, base.bordas, "bordas"),
    // Copy: cada campo cai no padrão quando vazio.
    chamada: usar(salvo.chamada, COPY_PADRAO.chamada, "chamada"),
    titulo: usar(salvo.titulo, COPY_PADRAO.titulo, "titulo"),
    descricao: usar(salvo.descricao, COPY_PADRAO.descricao, "descricao"),
    cta_primario: usar(salvo.cta_primario, COPY_PADRAO.cta_primario),
    cta_secundario: usar(salvo.cta_secundario, COPY_PADRAO.cta_secundario),
    destaques_titulo: usar(salvo.destaques_titulo, COPY_PADRAO.destaques_titulo),
    promocoes_titulo: usar(salvo.promocoes_titulo, COPY_PADRAO.promocoes_titulo),
    promocoes_subtitulo: usar(salvo.promocoes_subtitulo, COPY_PADRAO.promocoes_subtitulo, "promocoes_subtitulo"),
    passos_titulo: usar(salvo.passos_titulo, COPY_PADRAO.passos_titulo),
    localizacao_titulo: usar(salvo.localizacao_titulo, COPY_PADRAO.localizacao_titulo),
    faq_titulo: usar(salvo.faq_titulo, COPY_PADRAO.faq_titulo),
    rodape_frase: usar(salvo.rodape_frase, COPY_PADRAO.rodape_frase, "rodape_frase"),
    barra_cupom_texto: usar(salvo.barra_cupom_texto, COPY_PADRAO.barra_cupom_texto),
    barra_cupom_ativa: usar(salvo.barra_cupom_ativa, COPY_PADRAO.barra_cupom_ativa),
    // Listas: só troca se a pizzaria montou a dela (lista vazia = usa o padrão).
    diferenciais: salvo.diferenciais?.length ? salvo.diferenciais : [...COPY_PADRAO.diferenciais],
    passos: salvo.passos?.length ? salvo.passos : [...COPY_PADRAO.passos],
    faq: salvo.faq?.length ? salvo.faq : [...COPY_PADRAO.faq],
  } as Required<TokensTema> & TemaCardapioConfig;
}

/** #RRGGBB → rgba(r,g,b,alpha). Usado nos tokens derivados (brilhos, sombras). */
function rgba(hex: string, alpha: number): string {
  const limpo = String(hex || "").replace("#", "").trim();
  const cheio = limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  const n = Number.parseInt(cheio.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Escurece um hex por um fator (0–1). Para estados :hover/:active do botao. */
function escurecer(hex: string, fator: number): string {
  const limpo = String(hex || "").replace("#", "").trim();
  const cheio = limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  const n = Number.parseInt(cheio.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  const k = 1 - Math.min(Math.max(fator, 0), 1);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Luminancia relativa (WCAG) de um #RRGGBB; 0 = preto, 1 = branco. */
function luminancia(hex: string): number {
  const limpo = String(hex || "").replace("#", "").trim();
  const cheio = limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  const n = Number.parseInt(cheio.slice(0, 6), 16);
  if (!Number.isFinite(n)) return 0;
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/**
 * Texto legivel sobre um fundo colorido: o escuro ou o claro, o que der mais
 * contraste. O cupom amarelo do Brasa pede texto escuro; o violeta do
 * Metropole, claro — fixar um dos dois quebra o outro tema.
 */
function textoSobre(fundo: string): string {
  const escuro = "#1A0D05";
  const l = luminancia(fundo);
  const contrasteEscuro = (l + 0.05) / (luminancia(escuro) + 0.05);
  const contrasteClaro = 1.05 / (l + 0.05);
  return contrasteEscuro >= contrasteClaro ? escuro : "#FFFFFF";
}

/**
 * Tokens → CSS custom properties consumidas por `.cdp-root`.
 *
 * Emite o conjunto COMPLETO, inclusive os derivados (brilho, gradiente, sombra)
 * e os nomes legados (--theme-*). Antes esses derivados eram laranja fixo no
 * CSS: quem trocasse a cor primaria ficava com halos da cor antiga.
 */
export function temaParaCssVars(tema: ReturnType<typeof resolverTema>): CSSProperties {
  const titulo = FONTES_TITULO[tema.fonte_titulo as FonteTituloId] ?? FONTES_TITULO.big_shoulders;
  const texto = FONTES_TEXTO[tema.fonte_texto as FonteTextoId] ?? FONTES_TEXTO.figtree;
  const raio = BORDAS[tema.bordas as keyof typeof BORDAS]?.raio ?? BORDAS.suaves.raio;
  const acento = tema.cor_primaria;
  const fundoEscuro = luminancia(tema.cor_fundo) < 0.2;
  // O design foi desenhado com cantos "suaves"; os outros formatos escalam
  // todos os raios da pagina juntos (--rk), sem mexer nas pilulas.
  const escalaRaio = tema.bordas === "retas" ? 0.3 : tema.bordas === "arredondadas" ? 1.3 : 1;

  return {
    // Superficies
    "--bg": tema.cor_fundo,
    "--bg2": tema.cor_superficie,
    "--bg3": tema.cor_superficie_alta,
    "--bg4": tema.cor_borda,
    "--line": tema.cor_borda,
    // Texto
    "--text": tema.cor_texto,
    "--text2": tema.cor_texto_suave,
    "--text3": tema.cor_texto_apagado,
    // Acento e derivados
    "--accent": acento,
    "--accent2": tema.cor_secundaria,
    "--accent-deep": escurecer(acento, 0.18),
    "--accent-glow": rgba(acento, 0.18),
    "--accent-glow2": rgba(acento, 0.08),
    "--grad": `linear-gradient(135deg, ${acento} 0%, ${tema.cor_secundaria} 100%)`,
    "--shadow": `0 8px 30px ${rgba(tema.cor_fundo, 0.45)}`,
    "--shadow-accent": `0 10px 34px ${rgba(acento, 0.32)}`,
    // Botao
    "--button": tema.cor_botao,
    "--button-text": tema.cor_botao_texto,
    // Tipografia (nomes novos + legados, para o CSS existente continuar valendo)
    "--display": titulo.stack,
    "--body": texto.stack,
    "--theme-display": titulo.stack,
    "--theme-body": texto.stack,
    "--display-transform": tema.titulo_caixa_alta ? "uppercase" : "none",
    "--display-scale": String(titulo.escala ?? 1),
    // Raios
    "--radius": raio,
    "--radius-sm": `calc(${raio} * 0.7)`,
    "--radius-xs": `calc(${raio} * 0.5)`,
    "--theme-radius": raio,
    "--rk": String(escalaRaio),
    // Texto sobre as cores de marca (barra de cupom, cartoes de promocao)
    "--on-accent": textoSobre(acento),
    "--on-accent2": textoSobre(tema.cor_secundaria),
    // Estado da loja: verde/vermelho que funcionam no fundo do tema
    "--ok": fundoEscuro ? "#6EE7A0" : "#15803D",
    "--ok-dot": fundoEscuro ? "#4ADE80" : "#16A34A",
    "--bad": fundoEscuro ? "#FCA5A5" : "#B91C1C",
    "--bad-dot": fundoEscuro ? "#F87171" : "#DC2626",
    "--display-lh": tema.titulo_caixa_alta ? "0.88" : "1",
  } as CSSProperties;
}

/**
 * URL do Google Fonts para o par de fontes do tema.
 *
 * Carregada sob demanda: cada cardápio baixa só as duas famílias que usa, em
 * vez de todas as dez.
 */
export function googleFontsUrl(tema: ReturnType<typeof resolverTema>): string {
  const titulo = FONTES_TITULO[tema.fonte_titulo as FonteTituloId] ?? FONTES_TITULO.big_shoulders;
  const texto = FONTES_TEXTO[tema.fonte_texto as FonteTextoId] ?? FONTES_TEXTO.figtree;
  const familias = Array.from(new Set([titulo.google, texto.google]));
  return `https://fonts.googleapis.com/css2?${familias.map((f) => `family=${f}`).join("&")}&display=swap`;
}

/** Injeta (uma vez por URL) o <link> das fontes do tema. */
export function carregarFontes(url: string): void {
  if (typeof document === "undefined") return;
  const existe = document.querySelector(`link[data-cdp-fonts="${url}"]`);
  if (existe) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.setAttribute("data-cdp-fonts", url);
  document.head.appendChild(link);
}

/** Título do hero: `|` marca a quebra de linha desejada pela pizzaria. */
export function linhasDoTitulo(titulo: string): string[] {
  return String(titulo || COPY_PADRAO.titulo)
    .split("|")
    .map((l) => l.trim())
    .filter(Boolean);
}
