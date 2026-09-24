/**
 * CardapioPublico — Cardápio digital público (link da pizzaria).
 *
 * Rota: /m/:slug
 * Mobile-first, sem autenticação, tema escuro premium nível iFood/Rappi.
 * Fluxo: Navegar → Adicionar ao carrinho → Checkout → Confirmação WhatsApp
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  menuApi,
  MenuResponse,
  MenuProduto,
  MenuPizzaria,
  PedidoDigitalPayload,
  PedidoDigitalResponse,
  ApiError,
  TemaCardapioConfig,
  CampanhaCardapio,
  CupomCardapio,
  PedidoAcompanhamento,
  ClienteConta,
  ClientePedidoConta,
} from "../../lib/api";
import { calcEstaAberto, getTextoProximaAbertura } from "../../lib/businessHours";
import "../../styles/cardapio-publico.css";
import "../../styles/cardapio-redesign.css";
import "../../styles/cardapio-cards.css";
import "../../styles/cardapio-fornalha.css";
import {
  resolverTema, temaParaCssVars, googleFontsUrl, carregarFontes, linhasDoTitulo, COPY_PADRAO,
} from "../../lib/cardapioTema";

// ============================================
// Tipos internos
// ============================================
interface CartItem {
  id: string;
  produtoId: string;
  nome: string;
  tamanho: string | null;
  preco: number;
  quantidade: number;
  observacao: string;
  adicionais: string[];
  imgUrl?: string;
  /** Meio a meio: os OUTROS sabores (o primeiro é produtoId). */
  sabores?: Array<{ id: string; nome: string }>;
}

type Step = "menu" | "produto" | "carrinho" | "checkout" | "confirmacao";

// ============================================
// Constantes de estilo
// ============================================
const CAT_EMOJI: Record<string, string> = {
  pizza: "🍕", lanche: "🍔", bebida: "🥤", sobremesa: "🍰", outro: "🍽️",
};


// Tema, fontes e copy padrao vivem em lib/cardapioTema.ts — a mesma fonte de
// verdade que o editor do painel usa, para preview e producao nao divergirem.

// ============================================
// Componente Principal
// ============================================
function fmt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Monta o link wa.me a partir do telefone de contato (normaliza DDI 55). */
// ============================================
// Icones (stroke, herdam currentColor)
// ============================================
const svgBase = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const IcoRelogio = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const IcoSacola = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M5 8h14l-1.2 12H6.2z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
);
const IcoPin = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
const IcoMais = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>
);
const IcoChama = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={1.9}><path d="M12 3c.8 3.4 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2.3 1-3.8 2.3-4.8.2 1.7 1 2.7 2 3.1-.2-3.2.1-5.8.7-8.5z" /></svg>
);
const IcoAjustes = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={1.9}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>
);
const IcoUsuario = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={1.9}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6" /></svg>
);
const IcoAlvo = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={1.9}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
);
const IcoFechar = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IcoMaisFino = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>
);
const IcoMenos = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M5 12h14" /></svg>
);
const IcoBusca = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
const IcoMenu = ({ s = 22 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
const IcoRota = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2.2}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8" /></svg>
);
const IcoCopiar = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2.2}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" /></svg>
);
const IcoCheck = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const IcoWhats = ({ s = 16 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z" /></svg>
);
const IcoWhatsFlutuante = ({ s = 26 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z" /><path d="M9 9.5c.3 2 1.8 3.8 4 4.6" /></svg>
);
/** Fatia de pizza: marca da loja quando ela ainda não subiu um logo. */
const IcoFatia = ({ s = 24 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={2}><path d="M3.5 5.5c5.5-2.6 11.5-2.6 17 0L12 21.5z" /><path d="M5.2 8.6c4.4-1.8 9.2-1.8 13.6 0" /><circle cx="10.6" cy="11.6" r="1.1" /><circle cx="13.6" cy="14.4" r="1" /></svg>
);
/** Prato vazio: ocupa o lugar da foto de produto que ainda não tem imagem. */
const IcoPrato = ({ s = 32 }: { s?: number }) => (
  <svg width={s} height={s} {...svgBase} strokeWidth={1.6}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></svg>
);

/** Foto do produto, ou o placeholder neutro do design quando não há imagem. */
function Foto({ src, alt, className = "", eager = false }: { src?: string | null; alt: string; className?: string; eager?: boolean }) {
  return (
    <div className={`fx-ph ${className}`} role={src ? undefined : "img"} aria-label={src ? undefined : `Sem foto: ${alt}`}>
      {src ? <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} /> : <IcoPrato />}
    </div>
  );
}

/** Nome da seção do cardápio: as categorias chegam no singular ("pizza"). */
const TITULO_CATEGORIA: Record<string, string> = {
  pizza: "Pizzas", lanche: "Lanches", bebida: "Bebidas", sobremesa: "Sobremesas", outro: "Outros",
};
function tituloCategoria(cat: string): string {
  return TITULO_CATEGORIA[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

/** Tira acentos e caixa para a busca achar "pao" em "Pão". */
function normalizarBusca(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "(11) 99999-2026" a partir de qualquer formato salvo no cadastro. */
function formatarTelefone(tel?: string | null): string {
  let d = (tel || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || "";
}

/**
 * Quebra o endereço em rua/bairro e cidade/UF, como o cartão de endereço do
 * design mostra. Sem o padrão "Cidade - UF" no fim, fica tudo numa linha.
 */
function dividirEndereco(endereco?: string | null): [string, string] {
  const texto = (endereco || "").trim();
  const m = texto.match(/,\s*([^,]+?\s[–-]\s[A-Za-z]{2}\b.*)$/);
  if (!m || m.index === undefined) return [texto, ""];
  return [texto.slice(0, m.index).trim(), m[1].trim()];
}

function rotuloDesconto(c: CupomCardapio): string {
  return c.tipo === "percentual" ? `${Number(c.valor)}% OFF` : `${fmt(Number(c.valor))} OFF`;
}

/** Icone da faixa de diferenciais, escolhido pelo nome salvo no tema. */
function IconeDiferencial({ nome }: { nome?: string }) {
  switch (nome) {
    case "chama": return <IcoChama />;
    case "ajustes": return <IcoAjustes />;
    case "sacola": return <IcoSacola s={20} />;
    case "pin": return <IcoPin s={20} />;
    case "relogio":
    default: return <IcoRelogio s={20} />;
  }
}

/** Menor preco do produto (produtos com tamanhos mostram "a partir de"). */
function precoDe(p: MenuProduto): number {
  return p.tamanhos && p.tamanhos.length > 0
    ? Math.min(...p.tamanhos.map((t) => Number(t.preco)))
    : Number(p.preco);
}

type RegrasMeia = { permitido?: boolean; calculo?: string; max_sabores?: number };

/** Regra de meio a meio do produto (Cardápio → produto). Sem regra = permitido. */
function regrasMeia(p: MenuProduto): RegrasMeia {
  const r = (p.regras as { meia_meia?: RegrasMeia } | undefined)?.meia_meia;
  return r && typeof r === "object" ? r : {};
}

/**
 * Aceita meio a meio: pizza sem a regra desligada, ou qualquer produto em que a
 * pizzaria ligou a regra de propósito. Sem o filtro de categoria, todo lanche
 * (que não tem regra cadastrada) ganharia um "meio a meio" sem sentido.
 */
function aceitaMeia(p: MenuProduto): boolean {
  const r = regrasMeia(p);
  if (r.permitido === false) return false;
  return r.permitido === true || /pizza/i.test(p.categoria || "");
}

/**
 * Preço de 1 unidade com os sabores escolhidos, pela mesma regra do servidor
 * (maior valor, ou média se a pizzaria configurou). null = o tamanho não existe
 * em algum sabor. O servidor recalcula tudo; isto é só o que o cliente vê.
 */
function precoDosSabores(sabores: MenuProduto[], tamanho: string | null): number | null {
  const precos: number[] = [];
  for (const s of sabores) {
    if (s.tamanhos && s.tamanhos.length > 0) {
      const t = s.tamanhos.find((x) => x.tamanho === tamanho);
      if (!t) return null;
      precos.push(Number(t.preco));
    } else {
      precos.push(Number(s.preco));
    }
  }
  if (precos.length === 0) return null;
  if (precos.length === 1) return precos[0];
  if (regrasMeia(sabores[0]).calculo === "media") {
    return Math.round((precos.reduce((a, b) => a + b, 0) / precos.length) * 100) / 100;
  }
  return Math.max(...precos);
}

function waLink(tel?: string | null): string {
  const d = (tel || "").replace(/\D/g, "");
  if (!d) return "";
  const full = d.startsWith("55") ? d : (d.length === 10 || d.length === 11 ? "55" + d : d);
  return `https://wa.me/${full}`;
}

/** Monta mensagem formatada para envio do pedido em andamento pelo WhatsApp caso a loja feche. */
function buildWhatsAppOrderMessage({
  pizzariaNome,
  cart,
  total,
  checkoutForm,
  taxaEntrega,
  cupomAplicado,
  descontoEstimado,
}: {
  pizzariaNome: string;
  cart: CartItem[];
  total: number;
  checkoutForm: {
    nome: string;
    telefone: string;
    tipo: "delivery" | "retirada";
    rua: string;
    numero: string;
    bairro: string;
    referencia: string;
    pagamento: string;
    observacoes: string;
  };
  taxaEntrega: number;
  cupomAplicado?: string | null;
  descontoEstimado?: number;
}): string {
  const linhas: string[] = [];
  linhas.push(`🍕 *PEDIDO EM ANDAMENTO — ${pizzariaNome.toUpperCase()}*`);
  linhas.push(`_Olá! Meu pedido estava em andamento no cardápio digital quando a loja encerrou o horário. Gostaria de finalizar por aqui com a equipe:_`);
  linhas.push("");

  if (checkoutForm.nome.trim()) {
    linhas.push(`👤 *Cliente:* ${checkoutForm.nome.trim()}`);
  }
  if (checkoutForm.telefone.trim()) {
    linhas.push(`📱 *WhatsApp:* ${checkoutForm.telefone.trim()}`);
  }

  linhas.push(`🛵 *Tipo:* ${checkoutForm.tipo === "delivery" ? "Entrega (Delivery)" : "Retirada no Balcão"}`);

  if (checkoutForm.tipo === "delivery" && checkoutForm.rua.trim()) {
    let end = checkoutForm.rua.trim();
    if (checkoutForm.numero.trim()) end += `, ${checkoutForm.numero.trim()}`;
    if (checkoutForm.bairro.trim()) end += ` - ${checkoutForm.bairro.trim()}`;
    if (checkoutForm.referencia.trim()) end += ` (Ref: ${checkoutForm.referencia.trim()})`;
    linhas.push(`📍 *Endereço:* ${end}`);
  }

  if (checkoutForm.pagamento) {
    const pagMap: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
    linhas.push(`💳 *Forma de Pagamento:* ${pagMap[checkoutForm.pagamento] || checkoutForm.pagamento}`);
  }

  linhas.push("");
  linhas.push(`📋 *ITENS DO PEDIDO:*`);
  cart.forEach((item) => {
    const nomeTamanho = item.tamanho ? `${item.nome} (${item.tamanho})` : item.nome;
    linhas.push(`• ${item.quantidade}x ${nomeTamanho} — ${fmt(item.preco * item.quantidade)}`);
    if (item.adicionais && item.adicionais.length > 0) {
      linhas.push(`   + Adicionais: ${item.adicionais.join(", ")}`);
    }
    if (item.observacao && item.observacao.trim()) {
      linhas.push(`   _Obs: ${item.observacao.trim()}_`);
    }
  });

  linhas.push("");
  if (checkoutForm.tipo === "delivery" && taxaEntrega > 0) {
    linhas.push(`🚚 *Taxa de entrega:* ${fmt(taxaEntrega)}`);
  }
  if (cupomAplicado && (descontoEstimado || 0) > 0) {
    linhas.push(`🎟️ *Cupom (${cupomAplicado}):* -${fmt(descontoEstimado || 0)}`);
  }
  linhas.push(`💰 *TOTAL:* *${fmt(total)}*`);

  if (checkoutForm.observacoes && checkoutForm.observacoes.trim()) {
    linhas.push("");
    linhas.push(`📝 *Observações:* ${checkoutForm.observacoes.trim()}`);
  }

  return linhas.join("\n");
}

export function CardapioPublico({ slug }: { slug: string }) {
  const [data, setData] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navegação e UI
  const [step, setStep] = useState<Step>("menu");
  const [selectedCat, setSelectedCat] = useState("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduto, setSelectedProduto] = useState<MenuProduto | null>(null);
  const [cartPulse, setCartPulse] = useState(false);
  // Sacola do celular (painel que abre da barra de baixo) e menu do header.
  const [bagOpen, setBagOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Seletor rápido de tamanho ao clicar no "+" (sem entrar no produto).
  const [quickPick, setQuickPick] = useState<MenuProduto | null>(null);
  const checkoutRequestKeyRef = useRef<string | null>(null);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);

  // Checkout
  const [checkoutForm, setCheckoutForm] = useState({
    nome: "", telefone: "", tipo: "delivery" as "delivery" | "retirada",
    rua: "", numero: "", bairro: "", referencia: "",
    pagamento: "", observacoes: "",
    lat: null as number | null, lon: null as number | null,
  });
  // GPS exato (pino preciso pro entregador): "idle" | "loading" | "ok" | "error".
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  function usarMinhaLocalizacao() {
    if (!navigator.geolocation) { setGeoStatus("error"); return; }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCheckoutForm(f => ({ ...f, lat: pos.coords.latitude, lon: pos.coords.longitude }));
        setGeoStatus("ok");
      },
      () => setGeoStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PedidoDigitalResponse | null>(null);
  const [cupomInput, setCupomInput] = useState("");
  const [cupomAplicado, setCupomAplicado] = useState<string | null>(null);
  const [cupomFeedback, setCupomFeedback] = useState<string | null>(null);
  const [topOfferVisible, setTopOfferVisible] = useState(true);
  const [topOfferCopied, setTopOfferCopied] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingForm, setTrackingForm] = useState({ numero: "", telefone: "" });
  const [tracking, setTracking] = useState<PedidoAcompanhamento | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<"login" | "register">("login");
  const [accountForm, setAccountForm] = useState({ nome: "", telefone: "", email: "", senha: "" });
  const [accountToken, setAccountToken] = useState<string | null>(() => {
    try { return localStorage.getItem(`pizzabot:customer-token:${slug}`); } catch { return null; }
  });
  const [customer, setCustomer] = useState<ClienteConta | null>(null);
  const [customerOrders, setCustomerOrders] = useState<ClientePedidoConta[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [repeatingOrderId, setRepeatingOrderId] = useState<string | null>(null);
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [accountEditSaving, setAccountEditSaving] = useState(false);
  const [accountEditError, setAccountEditError] = useState<string | null>(null);
  const [accountEditForm, setAccountEditForm] = useState({
    nome: "", telefone: "", email: "", cep: "", rua: "", numero: "", bairro: "", complemento: "", referencia: "",
  });

  function preencherCheckoutDaConta(conta: ClienteConta) {
    const endereco = conta.endereco || { cep: "", rua: "", numero: "", bairro: "", complemento: "", referencia: "" };
    setCheckoutForm((form) => ({
      ...form,
      nome: conta.nome || form.nome,
      telefone: conta.telefone || form.telefone,
      rua: endereco.rua || form.rua,
      numero: endereco.numero || form.numero,
      bairro: endereco.bairro || form.bairro,
      referencia: endereco.referencia || form.referencia,
    }));
  }

  function abrirEdicaoConta() {
    if (!customer) return;
    const endereco = customer.endereco || {};
    setAccountEditForm({
      nome: customer.nome || "", telefone: customer.telefone || "", email: customer.email || "",
      cep: endereco.cep || "", rua: endereco.rua || "", numero: endereco.numero || "",
      bairro: endereco.bairro || "", complemento: endereco.complemento || "", referencia: endereco.referencia || "",
    });
    setAccountEditError(null);
    setAccountEditOpen(true);
  }

  function fecharEdicaoConta() {
    setAccountEditOpen(false);
    setAccountEditError(null);
  }




  // Modal de produto
  const [modalTamanho, setModalTamanho] = useState<string | null>(null);
  const [modalObs, setModalObs] = useState("");
  const [modalAdicionais, setModalAdicionais] = useState<string[]>([]);
  const [modalQtd, setModalQtd] = useState(1);
  // Meio a meio: ligado pelo cliente e os ids dos outros sabores escolhidos.
  const [modalMeio, setModalMeio] = useState(false);
  const [modalSabores, setModalSabores] = useState<string[]>([]);

  // ---- Load & Sincronização em tempo real do status da loja ----
  useEffect(() => {
    let active = true;
    setLoading(true);
    menuApi.getBySlug(slug)
      .then((menu) => { if (active) { setData(menu); setError(null); } })
      .catch((e: ApiError) => { if (active) setError(e.message || "Cardápio não encontrado"); })
      .finally(() => { if (active) setLoading(false); });

    // 1. Polling leve de status a cada 12 segundos (detecta alteração imediata feita no painel)
    const statusTimer = window.setInterval(() => {
      menuApi.getStatus(slug)
        .then((st) => {
          if (!active) return;
          setData((prev) => {
            if (!prev) return prev;
            const mudouAberto = prev.pizzaria.aberto !== st.aberto;
            const mudouManual = (prev.pizzaria as any).aberto_manual !== st.aberto_manual;
            const mudouTel = Boolean(st.telefone_contato && prev.pizzaria.telefone_contato !== st.telefone_contato);
            if (!mudouAberto && !mudouManual && !mudouTel) return prev;
            return {
              ...prev,
              pizzaria: {
                ...prev.pizzaria,
                aberto: st.aberto,
                aberto_manual: st.aberto_manual ?? null,
                telefone_contato: st.telefone_contato || prev.pizzaria.telefone_contato,
                horario_funcionamento: st.horario_funcionamento || prev.pizzaria.horario_funcionamento,
              },
            };
          });
        })
        .catch(() => { /* mantém estado em falhas transitórias */ });
    }, 12_000);

    // 2. Avaliação de relógio a cada 5 segundos (detecta fechamento programado no segundo exato)
    const clockTimer = window.setInterval(() => {
      if (!active) return;
      setData((prev) => {
        if (!prev) return prev;
        const calc = calcEstaAberto(prev.pizzaria.horario_funcionamento, (prev.pizzaria as any).aberto_manual);
        if (calc !== prev.pizzaria.aberto) {
          return {
            ...prev,
            pizzaria: {
              ...prev.pizzaria,
              aberto: calc,
            },
          };
        }
        return prev;
      });
    }, 5_000);

    // 3. Atualização do cardápio completo a cada 60 segundos
    const refreshTimer = window.setInterval(() => {
      menuApi.getBySlug(slug)
        .then((menu) => { if (active) setData(menu); })
        .catch(() => { /* mantém a última versão válida em falhas transitórias */ });
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
    };
  }, [slug]);

  useEffect(() => {
    if (!accountToken) {
      setCustomer(null);
      setCustomerOrders([]);
      return;
    }
    let active = true;
    setAccountLoading(true);
    Promise.all([menuApi.getCustomer(slug, accountToken), menuApi.getCustomerOrders(slug, accountToken)])
      .then(([conta, pedidos]) => {
        if (!active) return;
        setCustomer(conta);
        setCustomerOrders(pedidos);
        preencherCheckoutDaConta(conta);
        setAccountError(null);
      })
      .catch(() => {
        if (!active) return;
        setAccountToken(null);
        setCustomer(null);
        setCustomerOrders([]);
        try { localStorage.removeItem(`pizzabot:customer-token:${slug}`); } catch { /* modo privado */ }
      })
      .finally(() => { if (active) setAccountLoading(false); });
    return () => { active = false; };
  }, [accountToken, slug]);

  // ---- Categorias ----
  const categorias = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.produtos.map(p => p.categoria || "outro"));
    return ["todos", ...Array.from(set)];
  }, [data]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`pizzabot:last-order:${slug}`);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed?.numero && parsed?.telefone) {
        setTrackingForm({ numero: String(parsed.numero), telefone: String(parsed.telefone) });
      }
    } catch {
      // Armazenamento indisponível ou dado antigo inválido.
    }
  }, [slug]);


  // ---- Produtos filtrados ----
  const produtosFiltrados = useMemo(() => {
    if (!data) return [];
    return data.produtos.filter(p => {
      const matchCat = selectedCat === "todos" || (p.categoria || "outro") === selectedCat;
      const matchSearch = !searchQuery.trim() ||
        p.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.descricao || "").toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [data, selectedCat, searchQuery]);

  // ---- Carrinho helpers ----
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.preco * i.quantidade, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantidade, 0), [cart]);

  // Mesma regra do servidor: bairro comparado sem acento/caixa; fora da tabela e
  // sem taxa fixa, a taxa fica "a confirmar" pela loja (não sai de graça).
  const { taxaEntrega, taxaAConfirmar } = useMemo(() => {
    if (!data || checkoutForm.tipo !== "delivery") return { taxaEntrega: 0, taxaAConfirmar: false };
    const p = data.pizzaria;
    const bairro = normalizarBusca(checkoutForm.bairro.trim()).replace(/\s+/g, " ");
    if (bairro && p.taxas_bairro?.length) {
      const match = p.taxas_bairro.find(
        tb => normalizarBusca(String(tb.bairro || "").trim()).replace(/\s+/g, " ") === bairro
      );
      if (match) return { taxaEntrega: Number(match.taxa) || 0, taxaAConfirmar: false };
    }
    if (p.taxa_entrega_fixa) return { taxaEntrega: Number(p.taxa_entrega_fixa), taxaAConfirmar: false };
    return { taxaEntrega: 0, taxaAConfirmar: Boolean(bairro && p.taxas_bairro?.length) };
  }, [data, checkoutForm.tipo, checkoutForm.bairro]);

  // Validação do telefone: precisa de DDD (Brasil = 10-11 dígitos com DDD).
  const telDigits = checkoutForm.telefone.replace(/\D/g, "");
  const telValido = telDigits.length >= 10;
  const campanhasAtivas = useMemo(
    () => ((data?.pizzaria.tema_cardapio?.campanhas || []) as CampanhaCardapio[])
      .filter((item) => item.ativa)
      .sort((a, b) => a.ordem - b.ordem),
    [data],
  );
  const cuponsAtivos = useMemo(
    () => ((data?.pizzaria.tema_cardapio?.cupons || []) as CupomCardapio[]).filter((item) => item.ativo),
    [data],
  );
  const cupomSelecionado = useMemo(
    () => cuponsAtivos.find((item) => item.codigo.trim().toUpperCase() === cupomAplicado),
    [cuponsAtivos, cupomAplicado],
  );
  const descontoEstimado = useMemo(() => {
    if (!cupomSelecionado) return 0;
    const validade = cupomSelecionado.validade ? new Date(`${cupomSelecionado.validade}T23:59:59`) : null;
    if (validade && validade.getTime() < Date.now()) return 0;
    if (cartTotal < Number(cupomSelecionado.pedido_minimo || 0)) return 0;
    const bruto = cupomSelecionado.tipo === "percentual"
      ? cartTotal * Math.min(100, Number(cupomSelecionado.valor)) / 100
      : Number(cupomSelecionado.valor);
    return Math.min(cartTotal, Math.max(0, bruto));
  }, [cartTotal, cupomSelecionado]);
  const totalEstimado = Math.max(0, cartTotal - descontoEstimado) + taxaEntrega;

  const proximaAberturaTexto = useMemo(() => {
    if (!data) return null;
    return getTextoProximaAbertura(data.pizzaria.horario_funcionamento);
  }, [data?.pizzaria.horario_funcionamento]);

  const whatsappOrderUrl = useMemo(() => {
    if (!data || cart.length === 0) {
      return waLink(data?.pizzaria.telefone_contato);
    }
    const msg = buildWhatsAppOrderMessage({
      pizzariaNome: data.pizzaria.nome,
      cart,
      total: totalEstimado,
      checkoutForm,
      taxaEntrega,
      cupomAplicado,
      descontoEstimado,
    });
    const tel = data.pizzaria.telefone_contato;
    const baseWa = waLink(tel);
    if (!baseWa) return "";
    return `${baseWa}?text=${encodeURIComponent(msg)}`;
  }, [data, cart, totalEstimado, checkoutForm, taxaEntrega, cupomAplicado, descontoEstimado]);

  useEffect(() => {
    if (!trackingOpen || !tracking || !trackingForm.numero || !trackingForm.telefone) return;
    const timer = window.setInterval(() => {
      menuApi.trackOrder(slug, Number(trackingForm.numero), trackingForm.telefone)
        .then(setTracking)
        .catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [trackingOpen, tracking, trackingForm.numero, trackingForm.telefone, slug]);


  function addToCart(
    produto: MenuProduto, tamanho: string | null, preco: number, qtd: number, obs: string,
    adicionais: string[], outrosSabores: MenuProduto[] = [],
  ) {
    if (!data?.pizzaria.aberto) return;
    // Sabores e adicionais entram na chave: sem eles, uma calabresa com borda e
    // outra sem viravam "2 calabresas" com a borda de só uma delas.
    const key = [
      produto.id, ...outrosSabores.map((s) => s.id).sort(), tamanho || "unico",
      ...[...adicionais].sort(),
    ].join("-");
    const nome = outrosSabores.length
      ? [produto, ...outrosSabores].map((s) => `Meia ${s.nome}`).join(" / ")
      : produto.nome;
    setCart(prev => {
      const existing = prev.find(i => i.id === key && i.observacao === obs);
      if (existing) {
        return prev.map(i => i === existing ? { ...i, quantidade: i.quantidade + qtd } : i);
      }
      return [...prev, {
        id: key, produtoId: produto.id, nome,
        tamanho, preco, quantidade: qtd, observacao: obs, adicionais,
        imgUrl: produto.imagem_url || undefined,
        sabores: outrosSabores.length ? outrosSabores.map((s) => ({ id: s.id, nome: s.nome })) : undefined,
      }];
    });
    // Animação de pulso no botão flutuante
    setCartPulse(true);
    setTimeout(() => setCartPulse(false), 600);
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(i => i.id !== id));
  }
  function animateProductToCart(origin: HTMLElement, produto: MenuProduto) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A sacola do header existe em duas versões (desktop e celular); o alvo é
    // a que está visível.
    const target = Array.from(document.querySelectorAll<HTMLElement>(".fx-bag-target"))
      .find((el) => el.offsetParent !== null);
    if (!target) return;
    const card = origin.closest(".fx-card, .fx-feat-card, .fx-hero-media");
    const visual = card?.querySelector(".fx-ph, img") as HTMLElement | null;
    const sourceRect = (visual || origin).getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const flyer = document.createElement("div");
    flyer.className = "cdp-cart-flyer";
    flyer.setAttribute("aria-hidden", "true");
    if (produto.imagem_url) {
      flyer.style.backgroundImage = `url("${produto.imagem_url.replace(/"/g, "%22")}")`;
    } else {
      flyer.textContent = CAT_EMOJI[produto.categoria || "outro"] || "\uD83C\uDF7D\uFE0F";
    }
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyer.style.setProperty("--cdp-fly-x", `${endX - startX}px`);
    flyer.style.setProperty("--cdp-fly-y", `${endY - startY}px`);
    const arcHeight = Math.min(150, Math.max(72, Math.abs(endY - startY) * 0.18));
    flyer.style.setProperty("--cdp-fly-mid-x", `${(endX - startX) * 0.58}px`);
    flyer.style.setProperty("--cdp-fly-mid-y", `${(endY - startY) * 0.44 - arcHeight}px`);

    document.body.appendChild(flyer);
    requestAnimationFrame(() => flyer.classList.add("is-flying"));
    flyer.addEventListener("animationend", () => flyer.remove(), { once: true });
    window.setTimeout(() => flyer.remove(), 1_000);
  }


  function updateCartQty(id: string, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.id !== id) return i;
      const newQty = Math.max(0, i.quantidade + delta);
      return newQty === 0 ? null! : { ...i, quantidade: newQty };
    }).filter(Boolean));
  }

  /**
   * Leva à sacola. No desktop ela é o painel fixo ao lado do cardápio; no
   * celular, a barra de baixo abre o painel. O atraso deixa o React montar o
   * menu quando a chamada vem de outra etapa (voltar do checkout, recompra).
   */
  function abrirSacola() {
    setBagOpen(true);
    window.setTimeout(() => {
      const alvo = Array.from(document.querySelectorAll<HTMLElement>(".fx-bag-anchor"))
        .find((el) => el.offsetParent !== null);
      alvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }
  function aplicarCupom(codigo = cupomInput) {
    const normalizado = codigo.trim().toUpperCase();
    const cupom = cuponsAtivos.find((item) => item.codigo.trim().toUpperCase() === normalizado);
    if (!cupom) {
      setCupomAplicado(null);
      setCupomFeedback("Cupom inválido ou indisponível.");
      return;
    }
    if (cupom.validade && new Date(`${cupom.validade}T23:59:59`).getTime() < Date.now()) {
      setCupomAplicado(null);
      setCupomFeedback("Este cupom expirou.");
      return;
    }
    if (cartTotal < Number(cupom.pedido_minimo || 0)) {
      setCupomAplicado(null);
      setCupomFeedback(`Pedido mínimo de ${fmt(Number(cupom.pedido_minimo))} para usar este cupom.`);
      return;
    }
    setCupomInput(normalizado);
    setCupomAplicado(normalizado);
    setCupomFeedback("Cupom aplicado com sucesso.");
  }

  async function consultarPedido() {
    if (!trackingForm.numero || trackingForm.telefone.replace(/\D/g, "").length < 10) {
      setTrackingError("Informe o número do pedido e o telefone com DDD.");
      return;
    }
    setTrackingLoading(true);
    setTrackingError(null);
    try {
      const andamento = await menuApi.trackOrder(slug, Number(trackingForm.numero), trackingForm.telefone);
      setTracking(andamento);
    } catch (e: any) {
      setTracking(null);
      setTrackingError(e.message || "Pedido não encontrado.");
    } finally {
      setTrackingLoading(false);
    }
  }

  function abrirAcompanhamentoNaConta() {
    setTrackingOpen(false);
    setTrackingError(null);
    setAccountError(null);
    setAccountTab(accountToken ? "login" : "register");
    setAccountOpen(true);
  }

  async function submitCustomerAccount(event: React.FormEvent) {
    event.preventDefault();
    setAccountLoading(true);
    setAccountError(null);
    try {
      const auth = accountTab === "register"
        ? await menuApi.registerCustomer(slug, accountForm)
        : await menuApi.loginCustomer(slug, { email: accountForm.email, senha: accountForm.senha });
      setAccountToken(auth.access_token);
      setCustomer(auth.cliente);
      preencherCheckoutDaConta(auth.cliente);
      try { localStorage.setItem(`pizzabot:customer-token:${slug}`, auth.access_token); } catch { /* modo privado */ }
      setCustomerOrders(await menuApi.getCustomerOrders(slug, auth.access_token));
      setAccountForm((form) => ({ ...form, senha: "" }));
    } catch (error: any) {
      setAccountError(error.message || "Não foi possível acessar sua conta.");
    } finally {
      setAccountLoading(false);
    }
  }

  function logoutCustomer() {
    setAccountToken(null);
    setCustomer(null);
    setCustomerOrders([]);
    setAccountTab("login");
    setAccountError(null);
    try { localStorage.removeItem(`pizzabot:customer-token:${slug}`); } catch { /* modo privado */ }
  }


  async function salvarDadosConta(event: React.FormEvent) {
    event.preventDefault();
    if (!accountToken || accountEditSaving) return;
    if (accountEditForm.cep.replace(/\D/g, "").length !== 8) {
      setAccountEditError("Informe um CEP valido com 8 digitos.");
      return;
    }
    setAccountEditSaving(true);
    setAccountEditError(null);
    try {
      const conta = await menuApi.updateCustomer(slug, accountToken, {
        nome: accountEditForm.nome,
        telefone: accountEditForm.telefone,
        email: accountEditForm.email,
        endereco: {
          cep: accountEditForm.cep,
          rua: accountEditForm.rua,
          numero: accountEditForm.numero,
          bairro: accountEditForm.bairro,
          complemento: accountEditForm.complemento || undefined,
          referencia: accountEditForm.referencia || undefined,
        },
      });
      setCustomer(conta);
      preencherCheckoutDaConta(conta);
      setAccountEditOpen(false);
    } catch (error: any) {
      setAccountEditError(error.message || "Nao foi possivel salvar seus dados.");
    } finally {
      setAccountEditSaving(false);
    }
  }

  async function repeatCustomerOrder(order: ClientePedidoConta) {
    setRepeatingOrderId(order.id);
    if (!accountToken || repeatingOrderId) return;
    setAccountError(null);
    try {
      const repeated = await menuApi.repeatCustomerOrder(slug, accountToken, order.id);
      if (!repeated.itens.length) {
        setAccountError("Os produtos deste pedido não estão mais disponíveis no cardápio.");
        return;
      }
      setCart(repeated.itens.map((item, index) => ({
        id: `${item.produto_id}-${item.tamanho || "unico"}-repeat-${index}`,
        produtoId: item.produto_id,
        nome: item.nome,
        tamanho: item.tamanho || null,
        preco: Number(item.preco),
        quantidade: item.quantidade,
        observacao: item.observacao || "",
        adicionais: item.adicionais || [],
        imgUrl: item.imagem_url || undefined,
      })));
      setCartPulse(true);
      window.setTimeout(() => setCartPulse(false), 700);
      setAccountOpen(false);
      abrirSacola();
    } catch (error: any) {
      setAccountError(error.message || "Não foi possível repetir este pedido.");
    } finally {
      setRepeatingOrderId(null);
    }
  }

  async function trackCustomerOrder(order: ClientePedidoConta) {
    const telefone = customer?.telefone || "";
    setTrackingForm({ numero: String(order.numero_pedido), telefone });
    setTracking(null);
    setTrackingError(null);
    setAccountOpen(false);
    setTrackingOpen(true);
    setTrackingLoading(true);
    try {
      setTracking(await menuApi.trackOrder(slug, order.numero_pedido, telefone));
    } catch (error: any) {
      setTrackingError(error.message || "Pedido não encontrado.");
    } finally {
      setTrackingLoading(false);
    }
  }


  // ---- Botão "+" do card: adiciona direto ou abre o seletor de tamanho ----
  function handleQuickAdd(e: React.MouseEvent<HTMLElement>, p: MenuProduto) {
    e.stopPropagation();
    if (!data?.pizzaria.aberto) return;
    if (p.tamanhos && p.tamanhos.length > 0) {
      setQuickPick(p); // tem variação → escolhe o tamanho ali mesmo
    } else {
      animateProductToCart(e.currentTarget, p);
      addToCart(p, null, Number(p.preco), 1, "", []); // simples → direto pra sacola
    }
  }

  // ---- Abrir modal de produto ----
  function openProduto(p: MenuProduto) {
    setSelectedProduto(p);
    setModalTamanho(p.tamanhos?.[0]?.tamanho || null);
    setModalObs("");
    setModalAdicionais([]);
    setModalQtd(1);
    setModalMeio(false);
    setModalSabores([]);
    setStep("produto");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function confirmAddToCart() {
    if (!selectedProduto || !data?.pizzaria.aberto || faltaSabor) return;
    // Mesmo preço que a tela mostra (antes o botão somava os adicionais da
    // pizzaria e a tela os do produto, e os valores podiam divergir).
    addToCart(
      selectedProduto, modalTamanho, precoAtual + precoAdicionais, modalQtd, modalObs,
      modalAdicionais, modalMeio ? saboresEscolhidos : [],
    );
    setStep("menu");
    setSelectedProduto(null);
  }

  /** Marca/desmarca um sabor da meia; ajusta o tamanho se o novo sabor não tiver o atual. */
  function alternarSabor(id: string) {
    if (!selectedProduto || !data) return;
    const proximo = modalSabores.includes(id)
      ? modalSabores.filter((x) => x !== id)
      : modalSabores.length >= limiteOutrosSabores
        ? [...modalSabores.slice(1), id] // no limite: troca o mais antigo
        : [...modalSabores, id];
    setModalSabores(proximo);
    const escolhidos = proximo
      .map((x) => data.produtos.find((p) => p.id === x))
      .filter((p): p is MenuProduto => !!p);
    if (precoDosSabores([selectedProduto, ...escolhidos], modalTamanho) === null) {
      const comum = (selectedProduto.tamanhos || [])
        .find((t) => precoDosSabores([selectedProduto, ...escolhidos], t.tamanho) !== null);
      setModalTamanho(comum ? comum.tamanho : null);
    }
  }

  // ---- Submit pedido ----
  async function submitPedido() {
    if (!data) return;
    if (!data.pizzaria.aberto) {
      setSubmitError("A loja encerrou o horário de funcionamento para pedidos pelo cardápio. Finalize seu pedido em andamento pelo WhatsApp no botão abaixo.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const payload: PedidoDigitalPayload = {
      nome_cliente: checkoutForm.nome,
      telefone: checkoutForm.telefone,
      tipo: checkoutForm.tipo,
      endereco_rua: checkoutForm.rua || undefined,
      endereco_numero: checkoutForm.numero || undefined,
      endereco_bairro: checkoutForm.bairro || undefined,
      endereco_referencia: checkoutForm.referencia || undefined,
      endereco_lat: checkoutForm.lat ?? undefined,
      endereco_lon: checkoutForm.lon ?? undefined,
      forma_pagamento: checkoutForm.pagamento,
      cupom: cupomAplicado || undefined,
      observacoes: checkoutForm.observacoes || undefined,
      itens: cart.map(i => ({
        produto_id: i.produtoId,
        nome: i.nome + (i.tamanho ? ` (${i.tamanho})` : ""),
        quantidade: i.quantidade,
        tamanho: i.tamanho || undefined,
        preco_unit: i.preco,
        observacao: i.observacao || undefined,
        adicionais: i.adicionais.length ? i.adicionais : undefined,
        sabores_ids: i.sabores?.length ? i.sabores.map((s) => s.id) : undefined,
      })),
      website: "",
    };
    try {
      if (!checkoutRequestKeyRef.current) {
        checkoutRequestKeyRef.current = crypto.randomUUID?.() ||
          `pedido-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const res = await menuApi.submitOrder(slug, payload, checkoutRequestKeyRef.current, accountToken);
      setResultado(res);
      setStep("confirmacao");
      setCupomAplicado(null);
      setCupomInput("");
      setTrackingForm({ numero: String(res.numero_pedido), telefone: checkoutForm.telefone });
      try {
        localStorage.setItem(
          `pizzabot:last-order:${slug}`,
          JSON.stringify({ numero: res.numero_pedido, telefone: checkoutForm.telefone }),
        );
      } catch { /* modo privado */ }
      if (accountToken) {
        Promise.all([menuApi.getCustomer(slug, accountToken), menuApi.getCustomerOrders(slug, accountToken)])
          .then(([conta, pedidos]) => { setCustomer(conta); setCustomerOrders(pedidos); })
          .catch(() => { /* a sessão será revalidada na próxima abertura */ });
      }
      setCart([]);
      checkoutRequestKeyRef.current = null;
    } catch (e: any) {
      const msg = e.message || "Erro ao enviar pedido";
      if (msg.toLowerCase().includes("fechada") || msg.toLowerCase().includes("horário") || msg.toLowerCase().includes("horario")) {
        setData(prev => prev ? { ...prev, pizzaria: { ...prev.pizzaria, aberto: false } } : prev);
        setSubmitError("A loja fechou para novos pedidos. Como você já estava com o pedido em andamento, utilize o botão abaixo para finalizar diretamente pelo nosso WhatsApp!");
      } else {
        setSubmitError(msg);
      }
    }
    setSubmitting(false);
  }

  // Adicionais e preços calculados de forma segura para o passo de produto
  const {
    precoAtual, precoAdicionais, precoTotal, adicionaisDisp,
    saboresCandidatos, saboresEscolhidos, limiteOutrosSabores, faltaSabor, tamanhosMeia,
  } = useMemo(() => {
    const vazio = {
      precoAtual: 0, precoAdicionais: 0, precoTotal: 0,
      adicionaisDisp: [] as Array<{ nome: string; preco: number; tipo?: string }>,
      saboresCandidatos: [] as MenuProduto[], saboresEscolhidos: [] as MenuProduto[],
      limiteOutrosSabores: 1, faltaSabor: false, tamanhosMeia: null as string[] | null,
    };
    if (!selectedProduto || !data) return vazio;
    const p = selectedProduto;

    // Meio a meio: outros sabores da MESMA categoria que aceitam meia e têm ao
    // menos um tamanho em comum com este (o servidor recusa o resto).
    const candidatos = aceitaMeia(p)
      ? data.produtos.filter((o) =>
          o.id !== p.id
          && (o.categoria || "") === (p.categoria || "")
          && aceitaMeia(o)
          && (!p.tamanhos?.length || p.tamanhos.some((t) => precoDosSabores([p, o], t.tamanho) !== null)))
      : [];
    const escolhidos = modalMeio
      ? modalSabores.map((id) => candidatos.find((o) => o.id === id)).filter((o): o is MenuProduto => !!o)
      : [];
    const limite = Math.max(
      1,
      Math.min(...[p, ...escolhidos].map((s) => Number(regrasMeia(s).max_sabores) || 2)) - 1,
    );
    const tamanhos = escolhidos.length && p.tamanhos?.length
      ? p.tamanhos.filter((t) => precoDosSabores([p, ...escolhidos], t.tamanho) !== null).map((t) => t.tamanho)
      : null;

    let precoAt = precoDosSabores([p, ...escolhidos], modalTamanho)
      ?? precoDosSabores([p], modalTamanho)
      ?? Number(p.preco);
    if (!p.tamanhos?.length && !escolhidos.length) precoAt = Number(p.preco);
    let adsp: Array<{ nome: string; preco: number; tipo?: string }> = [];
    if (p.opcoes && Array.isArray((p.opcoes as any).adicionais) && (p.opcoes as any).adicionais.length > 0) {
      adsp = ((p.opcoes as any).adicionais as any[]).map(item => {
        if (typeof item === "string") {
          return { nome: item, preco: 0, tipo: item.toLowerCase().includes("borda") ? "borda" : "adicional" };
        }
        return {
          nome: String(item?.nome || "").trim(),
          preco: Number(item?.preco) || 0,
          tipo: item?.tipo || "adicional"
        };
      }).filter(it => it.nome.length > 0);
    } else {
      adsp = data.pizzaria.adicionais || [];
    }

    let precoAds = 0;
    for (const a of modalAdicionais) {
      const info = adsp.find(ai => ai.nome === a);
      if (info) precoAds += info.preco;
    }
    return {
      precoAtual: precoAt,
      precoAdicionais: precoAds,
      precoTotal: (precoAt + precoAds) * modalQtd,
      adicionaisDisp: adsp,
      saboresCandidatos: candidatos,
      saboresEscolhidos: escolhidos,
      limiteOutrosSabores: limite,
      // Ligou meio a meio mas ainda não escolheu o outro sabor: não dá pra adicionar.
      faltaSabor: modalMeio && escolhidos.length === 0,
      tamanhosMeia: tamanhos,
    };
  }, [selectedProduto, modalTamanho, modalAdicionais, modalQtd, modalMeio, modalSabores, data]);

  // ============================================
  // Renders
  // ============================================
  // ATENCAO: hooks daqui pra cima, porque logo abaixo comecam os returns
  // condicionais (loading/erro). Hook depois de um return condicional roda em
  // quantidade diferente entre renders e quebra a pagina com React #310.
  const [faqAberta, setFaqAberta] = useState<number | null>(0);
  /*
   * Previa ao vivo do painel: quando esta pagina roda dentro de um iframe na tela
   * de Temas, o painel manda o tema ainda NAO salvo e a pagina se repinta na hora.
   * E a propria pagina publica que aparece na previa — nada de um mockup paralelo
   * que envelhece sozinho.
   */
  const [temaPreview, setTemaPreview] = useState<TemaCardapioConfig | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  useEffect(() => {
    if (window.parent === window) return; // so vale dentro do iframe
    function aoReceber(e: MessageEvent) {
      if (e.origin !== window.location.origin) return; // so o proprio painel
      const d = e.data as {
        tipo?: string; tema?: TemaCardapioConfig; banner?: string;
        fracao?: number; secao?: string; item?: number;
      } | null;
      if (d && d.tipo === "cdp-previa-tema") {
        setTemaPreview(d.tema || {});
        setBannerPreview(typeof d.banner === "string" ? d.banner : null);
      }
      if (d && d.tipo === "cdp-previa-rolar") rolarPrevia(d);
    }
    /*
     * O painel rola a previa junto com o formulario (fracao 0..1) e, quando um
     * texto muda, leva ate a secao dele — sem isso quem edita as duvidas ou o
     * rodape fica olhando o topo e nao ve a mudanca acontecer.
     */
    function rolarPrevia(d: { fracao?: number; secao?: string; item?: number }) {
      const doc = document.documentElement;
      if (typeof d.fracao === "number") {
        window.scrollTo({ top: d.fracao * Math.max(0, doc.scrollHeight - window.innerHeight), behavior: "instant" });
        return;
      }
      const seletores: Record<string, string> = {
        diferenciais: ".fx-trust-wrap", cardapio: "#cardapio", promocoes: "#promocoes", passos: ".fx-steps",
        localizacao: "#localizacao", duvidas: "#duvidas", rodape: ".fx-footer",
      };
      if (typeof d.item === "number") setFaqAberta(d.item);
      // Espera o React pintar a mudanca (secao nova, pergunta aberta) antes de medir.
      requestAnimationFrame(() => {
        if (!d.secao || d.secao === "topo") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
        const alvo = seletores[d.secao] ? document.querySelector(seletores[d.secao]) : null;
        if (!alvo) return; // secao que nao aparece (ex.: promocoes sem cupom): fica onde esta
        window.scrollTo({ top: alvo.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
      });
    }
    window.addEventListener("message", aoReceber);
    // Dentro da moldura do painel a barra de rolagem so rouba largura.
    document.documentElement.style.scrollbarWidth = "none";
    // Avisa que ja pode receber (o painel pode ter montado antes do iframe).
    try {
      window.parent.postMessage({ tipo: "cdp-previa-pronta" }, window.location.origin);
    } catch { /* origem diferente: previa simplesmente nao liga */ }
    return () => window.removeEventListener("message", aoReceber);
  }, []);
  // Cada cardapio baixa so as duas familias do seu tema, nao as dez.
  const fontesUrl = googleFontsUrl(resolverTema(temaPreview ?? data?.pizzaria.tema_cardapio));
  useEffect(() => { carregarFontes(fontesUrl); }, [fontesUrl]);

  if (loading) return (
    <div className="cdp-loading">
      <div className="cdp-spinner-wrap">
        <div className="cdp-spinner" />
        <div className="cdp-spinner-logo">🍕</div>
      </div>
      <p className="cdp-loading-text">Carregando cardápio...</p>
    </div>
  );

  if (error || !data) return (
    <div className="cdp-error">
      <span className="cdp-error-emoji">😕</span>
      <h2>Cardápio não encontrado</h2>
      <p>{error || "Verifique o link e tente novamente."}</p>
    </div>
  );

  const pizz = data.pizzaria;
  const waUrl = waLink(pizz.telefone_contato);
  const tema = resolverTema(temaPreview ?? pizz.tema_cardapio);
  const linhasTitulo = linhasDoTitulo(tema.titulo || "");
  // Destaque do hero. Era simplesmente o primeiro produto da lista, e na Palazio o
  // primeiro era uma Fanta sem foto: "Destaque da casa: Fanta 1L" em cima de um
  // emoji. Agora prefere um prato principal com foto, na ordem da pizzaria; se
  // não houver, qualquer um com foto; em último caso, o primeiro.
  const ehPratoPrincipal = (p: { categoria?: string | null }) =>
    !["bebida", "sobremesa"].includes((p.categoria || "").toLowerCase());
  const produtoDestaque =
    data.produtos.find((p) => p.imagem_url && ehPratoPrincipal(p)) ??
    data.produtos.find((p) => p.imagem_url) ??
    data.produtos[0] ??
    null;
  // Foto do topo: banner da pizzaria; sem banner, a foto do próprio destaque (que
  // é o que está sendo anunciado ali embaixo); depois o logo; só então o emoji.
  const heroImagem =
    (bannerPreview ?? pizz.banner_url) || produtoDestaque?.imagem_url || pizz.logo_url || null;
  const themeStyle = temaParaCssVars(tema);
  const trackingSteps = tracking ? (
    tracking.tipo === "delivery"
      ? [
          { key: "confirmado", label: "Confirmado", detail: "O pedido entrou na operação." },
          { key: "no_forno", label: "Em preparo", detail: "A cozinha está preparando tudo." },
          { key: "pronto_entrega", label: "Pronto", detail: "O pedido está pronto para sair." },
          { key: "a_caminho", label: "A caminho", detail: tracking.entregador_nome ? `${tracking.entregador_nome} está levando seu pedido.` : "O pedido saiu para entrega." },
          { key: "entregue", label: "Entregue", detail: "Pedido finalizado. Bom apetite!" },
        ]
      : [
          { key: "confirmado", label: "Confirmado", detail: "O pedido entrou na operação." },
          { key: "no_forno", label: "Em preparo", detail: "A cozinha está preparando tudo." },
          { key: "pronto_entrega", label: "Pronto para retirada", detail: "Já pode vir buscar seu pedido." },
          { key: "entregue", label: "Retirado", detail: "Pedido finalizado. Bom apetite!" },
        ]
  ) : [];
  const trackingIndex = tracking ? Math.max(0, trackingSteps.findIndex((item) => item.key === tracking.status)) : 0;

  // ---- Dados do layout do cardápio (design de referência) ----
  /** Rola até uma seção da página e fecha o menu do celular. */
  const irPara = (id: string) => (e?: React.MouseEvent) => {
    e?.preventDefault();
    setMenuOpen(false);
    if (id === "inicio") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };
  const busca = normalizarBusca(searchQuery.trim());
  const combinaBusca = (p: MenuProduto) =>
    !busca || normalizarBusca(`${p.nome} ${p.descricao || ""}`).includes(busca);
  // Mesmo com uma categoria escolhida o cardápio segue em seções, como no
  // design; a busca filtra dentro delas e some com as que ficam vazias.
  const secoes = categorias
    .filter((c) => c !== "todos" && (selectedCat === "todos" || selectedCat === c))
    .map((c) => ({
      id: c,
      titulo: tituloCategoria(c),
      itens: data.produtos.filter((p) => (p.categoria || "outro") === c && combinaBusca(p)),
    }))
    .filter((s) => s.itens.length > 0);
  const contagemCategoria = (c: string) =>
    c === "todos" ? data.produtos.length : data.produtos.filter((p) => (p.categoria || "outro") === c).length;
  const mostrarDestaques = selectedCat === "todos" && !busca && data.produtos.length > 3;
  // Destaques com foto primeiro: um card de destaque sem foto não destaca nada.
  const destaques = [
    ...data.produtos.filter((p) => p.imagem_url),
    ...data.produtos.filter((p) => !p.imagem_url),
  ].slice(0, 8);

  const tempoEntrega = pizz.tempo_entrega_min && pizz.tempo_entrega_max
    ? `${pizz.tempo_entrega_min}–${pizz.tempo_entrega_max} min`
    : null;
  // O primeiro diferencial padrão traz "30–45 min" escrito; com o tempo real
  // cadastrado, mostra o real em vez do número de exemplo.
  const diferenciais = (tema.diferenciais || []).slice(0, 4).map((d) =>
    d.icone === "relogio" && d.titulo === "30–45 min" && tempoEntrega ? { ...d, titulo: tempoEntrega } : d,
  );

  // Cupom: a barra e o cartão de promoção anunciam o primeiro cupom ativo; a
  // sacola acompanha o que a pessoa aplicou (ou esse mesmo, se nenhum).
  const cupomBarra = cuponsAtivos[0] ?? null;
  const minimoDoCupom = (c: CupomCardapio) => Number(c.pedido_minimo || 0);
  const textoBarra = cupomBarra
    ? (tema.barra_cupom_texto && tema.barra_cupom_texto !== COPY_PADRAO.barra_cupom_texto
      ? tema.barra_cupom_texto
      : `${rotuloDesconto(cupomBarra)} ${minimoDoCupom(cupomBarra) > 0 ? `em pedidos acima de ${fmt(minimoDoCupom(cupomBarra))}` : "no seu pedido"} com o cupom`)
    : "";
  const cupomAlvo = cupomSelecionado ?? cupomBarra;
  const cupomNaSacola = !!cupomSelecionado && descontoEstimado > 0;
  const faltaParaCupom = cupomAlvo ? Math.max(0, minimoDoCupom(cupomAlvo) - cartTotal) : 0;
  const progressoCupom = cupomAlvo && minimoDoCupom(cupomAlvo) > 0
    ? Math.min(100, Math.round((cartTotal / minimoDoCupom(cupomAlvo)) * 100))
    : 100;

  async function copiarCupom(codigo: string) {
    const normalizado = codigo.trim().toUpperCase();
    setCupomInput(normalizado);
    setCupomAplicado(normalizado);
    try { await navigator.clipboard.writeText(normalizado); } catch { /* aplica mesmo sem área de transferência */ }
    setTopOfferCopied(true);
    window.setTimeout(() => setTopOfferCopied(false), 1800);
  }

  const temPromocoes = campanhasAtivas.length > 0 || cuponsAtivos.length > 0;
  const temLocal = !!(pizz.endereco || pizz.endereco_maps_url);
  const temFaq = (tema.faq || []).length > 0;
  const rotaUrl = pizz.endereco
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pizz.endereco)}`
    : pizz.endereco_maps_url || "";
  const mapaUrl = pizz.endereco_maps_url
    || (pizz.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pizz.endereco)}` : "");
  const [enderecoLinha1, enderecoLinha2] = dividirEndereco(pizz.endereco);
  const ruaNoMapa = (pizz.endereco || "").split(",")[0].trim().slice(0, 22);
  const nomeNoMapa = pizz.nome.length > 28 ? `${pizz.nome.slice(0, 27)}…` : pizz.nome;
  const telefoneExibido = formatarTelefone(pizz.telefone_contato);
  const fotosProdutos = data.produtos.filter((p) => p.imagem_url).map((p) => p.imagem_url as string);
  const campanhaPrincipal = campanhasAtivas[0] ?? null;
  // Colagem do cartão: os produtos que a pizzaria escolheu, na ordem escolhida.
  // Sem escolha, a imagem da campanha e depois as primeiras fotos do cardápio.
  const fotosEscolhidas = (campanhaPrincipal?.produtos_colagem || [])
    .map((id) => data.produtos.find((p) => p.id === id)?.imagem_url)
    .filter((f): f is string => !!f);
  const fotosCampanha = !campanhaPrincipal
    ? []
    : fotosEscolhidas.length > 0
      ? fotosEscolhidas.slice(0, 3)
      : [campanhaPrincipal.imagem_url, ...fotosProdutos].filter((f): f is string => !!f).slice(0, 3);

  function finalizarPedido() {
    setBagOpen(false);
    setStep("checkout");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function aoEscolherCampanha(campanha: CampanhaCardapio) {
    if (campanha.cupom_codigo) {
      setCupomInput(campanha.cupom_codigo);
      setCupomAplicado(campanha.cupom_codigo.toUpperCase());
    }
    document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" });
  }

  /** Conteúdo da sacola: o mesmo no painel lateral (desktop) e no da barra de baixo (celular). */
  function renderSacola() {
    const entrega = checkoutForm.tipo === "delivery";
    const notaModo = entrega
      ? (tempoEntrega ? `Entrega estimada em ${tempoEntrega}.` : "Você informa o endereço ao finalizar.")
      : (pizz.endereco ? `Retire em ${pizz.endereco}.` : "Retire no balcão da loja.");
    return (
      <>
        <div className="fx-bag-head">
          <h2 className="fx-bag-title fx-disp">Sua sacola</h2>
          <span className="fx-bag-count">{cartCount === 0 ? "vazia" : `${cartCount} ${cartCount === 1 ? "item" : "itens"}`}</span>
        </div>
        <div className="fx-seg">
          <button type="button" aria-pressed={entrega} onClick={() => setCheckoutForm((f) => ({ ...f, tipo: "delivery" }))}>Entrega</button>
          <button type="button" aria-pressed={!entrega} onClick={() => setCheckoutForm((f) => ({ ...f, tipo: "retirada" }))}>Retirada</button>
        </div>
        <p className="fx-mode-note">{notaModo}</p>

        {cartCount === 0 ? (
          <div className="fx-bag-empty">
            <p className="fx-bag-empty-title">Sua sacola está vazia</p>
            <p className="fx-bag-empty-sub">Toque no + de qualquer item para começar.</p>
          </div>
        ) : (
          <>
            <div className="fx-lines">
              {cart.map((item) => (
                <div className="fx-line" key={item.id}>
                  <Foto src={item.imgUrl} alt={item.nome} />
                  <div className="fx-line-body">
                    <span className="fx-line-name fx-clamp1">{item.nome}{item.tamanho ? ` (${item.tamanho})` : ""}</span>
                    {item.adicionais.length > 0 && <span className="fx-line-extra fx-clamp1">+ {item.adicionais.join(", ")}</span>}
                    <span className="fx-line-total fx-num">{fmt(item.preco * item.quantidade)}</span>
                  </div>
                  <div className="fx-stepper">
                    <button type="button" aria-label={`Tirar um ${item.nome}`} onClick={() => updateCartQty(item.id, -1)}><IcoMenos s={14} /></button>
                    <span>{item.quantidade}</span>
                    <button type="button" aria-label={`Mais um ${item.nome}`} disabled={!pizz.aberto} onClick={() => updateCartQty(item.id, 1)}><IcoMaisFino s={14} /></button>
                  </div>
                </div>
              ))}
            </div>

            {cupomAlvo && (cupomNaSacola ? (
              <div className="fx-cup-ok"><IcoCheck />Cupom {cupomAlvo.codigo.toUpperCase()} aplicado: {rotuloDesconto(cupomAlvo)}</div>
            ) : faltaParaCupom > 0.004 ? (
              <div className="fx-cup-wait">
                <span>Faltam {fmt(faltaParaCupom)} para liberar {rotuloDesconto(cupomAlvo)} com {cupomAlvo.codigo.toUpperCase()}</span>
                <div className="fx-progress"><div style={{ width: `${progressoCupom}%` }} /></div>
              </div>
            ) : (
              <div className="fx-cup-wait">
                <span>Seu pedido já pode usar {rotuloDesconto(cupomAlvo)} com {cupomAlvo.codigo.toUpperCase()}</span>
                <button type="button" className="fx-cup-apply" onClick={() => aplicarCupom(cupomAlvo.codigo)}>Aplicar cupom</button>
              </div>
            ))}

            <div className="fx-totals fx-num">
              <div className="fx-trow"><span>Subtotal</span><span>{fmt(cartTotal)}</span></div>
              {descontoEstimado > 0 && cupomSelecionado && (
                <div className="fx-trow is-disc"><span>Desconto {cupomSelecionado.codigo.toUpperCase()}</span><span>− {fmt(descontoEstimado)}</span></div>
              )}
              {entrega && taxaEntrega > 0 && (
                <div className="fx-trow"><span>{pizz.taxas_bairro?.length ? "Entrega (estimada)" : "Taxa de entrega"}</span><span>{fmt(taxaEntrega)}</span></div>
              )}
              <div className="fx-trow is-total"><span>Total</span><span>{fmt(totalEstimado)}</span></div>
            </div>
          </>
        )}

        {!pizz.aberto && cartCount > 0 && whatsappOrderUrl ? (
          <a className="fx-finish fx-pri" href={whatsappOrderUrl} target="_blank" rel="noopener noreferrer">
            <IcoWhats s={18} />Enviar pelo WhatsApp
          </a>
        ) : (
          <button type="button" className="fx-finish fx-pri" disabled={cartCount === 0 || !pizz.aberto} onClick={finalizarPedido}>
            {pizz.aberto ? "Finalizar pedido" : "Loja fechada"}
          </button>
        )}
      </>
    );
  }


  // Card de produto reutilizado pela grade plana e pelas seções por categoria.
  /** Quantas unidades deste produto ja estao na sacola (somando variacoes). */
  function qtdDoProduto(p: MenuProduto): number {
    return cart.reduce((total, item) => (item.produtoId === p.id ? total + item.quantidade : total), 0);
  }

  /**
   * Tira uma unidade do produto. Mexe na ULTIMA linha adicionada dele — com
   * tamanhos/adicionais diferentes existe mais de uma linha, e a ultima e a que
   * a pessoa acabou de mexer.
   */
  function tirarUmDoProduto(p: MenuProduto) {
    setCart(prev => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].produtoId !== p.id) continue;
        if (prev[i].quantidade > 1) {
          return prev.map((item, idx) => (idx === i ? { ...item, quantidade: item.quantidade - 1 } : item));
        }
        return prev.filter((_, idx) => idx !== i);
      }
      return prev;
    });
  }

  function renderProduct(p: MenuProduto) {
    const preco = precoDe(p);
    const temVariacao = !!(p.tamanhos && p.tamanhos.length > 0);
    const qtd = qtdDoProduto(p);
    // A pilula de quantidade so aparece em produto simples: com tamanhos, tirar
    // "um" seria ambiguo (qual tamanho?), entao o + reabre o seletor.
    const mostrarPilula = qtd > 0 && !temVariacao && pizz.aberto;

    return (
      <article key={p.id} className="fx-card" onClick={() => openProduto(p)} role="button" tabIndex={0}
        aria-label={`${p.nome}, ${temVariacao ? "a partir de " : ""}${fmt(preco)}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduto(p); } }}>
        <div className="fx-card-body">
          <h3 className="fx-card-name">{p.nome}</h3>
          {p.descricao && <p className="fx-card-desc fx-clamp2">{p.descricao}</p>}
          <div className="fx-card-priceline">
            {temVariacao && <span className="fx-card-from">a partir de</span>}
            <span className="fx-card-price fx-num">{fmt(preco)}</span>
          </div>
        </div>

        <div className="fx-card-media">
          <Foto src={p.imagem_url} alt={p.nome} />
          {mostrarPilula ? (
            <div className="fx-card-qty" onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label={`Tirar um ${p.nome}`}
                onClick={(e) => { e.stopPropagation(); tirarUmDoProduto(p); }}>
                <IcoMenos s={16} />
              </button>
              <span>{qtd}</span>
              <button type="button" aria-label={`Mais um ${p.nome}`} onClick={(e) => handleQuickAdd(e, p)}>
                <IcoMaisFino s={16} />
              </button>
            </div>
          ) : (
            <button type="button" className="fx-card-add fx-pri" disabled={!pizz.aberto}
              aria-label={pizz.aberto ? `Adicionar ${p.nome}` : "Loja fechada"}
              onClick={(e) => handleQuickAdd(e, p)}>
              <IcoMais />
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className={`cdp-root cdp-theme-${tema.modelo || "brasa"} cdp-radius-${tema.bordas || "suaves"} cdp-cards-${tema.estilo_cartoes || "elevado"} cdp-btn-${tema.estilo_botao || "solido"}`} style={themeStyle}>
      <div className="cdp-wrapper">

        {/* ===== CONFIRMAÇÃO ===== */}
        {step === "confirmacao" && resultado ? (
          <div className="cdp-confirmacao">
            <div className="cdp-confirmacao-ring">
              <div className="cdp-confirmacao-icon">✅</div>
            </div>
            <div className="cdp-confirmacao-badge">Pedido confirmado!</div>
            <h2 className="cdp-confirmacao-title">Pedido #{resultado.numero_pedido}</h2>
            <p className="cdp-confirmacao-sub">
              Recebemos seu pedido! Você receberá a confirmação pelo WhatsApp em instantes.
            </p>
            <div className="cdp-confirmacao-card">
              <div className="cdp-confirmacao-row">
                <span>Total pago</span>
                <span className="cdp-confirmacao-price">{fmt(resultado.valor_total)}</span>
              </div>
              {resultado.taxa_entrega > 0 && (
                <div className="cdp-confirmacao-row cdp-confirmacao-row-sm">
                  <span>Taxa de entrega inclusa</span>
                  <span>{fmt(resultado.taxa_entrega)}</span>
                </div>
              )}
              {resultado.desconto > 0 && (
                <div className="cdp-confirmacao-row cdp-confirmacao-row-sm cdp-discount-row">
                  <span>Cupom {resultado.cupom_codigo}</span>
                  <span>- {fmt(resultado.desconto)}</span>
                </div>
              )}
              <div className="cdp-confirmacao-divider" />
              <div className="cdp-confirmacao-row">
                <span>⏱️ Previsão</span>
                <span className="cdp-confirmacao-eta">{resultado.tempo_estimado}</span>
              </div>
            </div>
            <button className="cdp-btn-secondary cdp-btn-lg cdp-track-confirmed" onClick={() => { setStep("menu"); setResultado(null); setTrackingOpen(true); }}>
              Acompanhar este pedido
            </button>
            <button className="cdp-btn-primary cdp-btn-lg" onClick={() => { setStep("menu"); setResultado(null); }}>
              🛍️ Fazer outro pedido
            </button>
          </div>

        ) : step === "checkout" ? (
          /* ===== CHECKOUT ===== */
          <>
            <div className="cdp-topbar">
              <button className="cdp-topbar-back" onClick={() => { setStep("menu"); abrirSacola(); }}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
              </button>
              <h2 className="cdp-topbar-title">Finalizar Pedido</h2>
              <div style={{ width: 32 }} />
            </div>

            <Stepper current="checkout" />

            <div className="cdp-checkout">
              {/* Resumo */}
              <div className="cdp-section-label">📋 Resumo do pedido</div>
              <div className="cdp-checkout-card">
                {cart.map(item => (
                  <div key={item.id} className="cdp-checkout-item">
                    <div className="cdp-checkout-item-qty">{item.quantidade}×</div>
                    <div className="cdp-checkout-item-name">
                      {item.nome}{item.tamanho ? ` (${item.tamanho})` : ""}
                      {item.adicionais.length > 0 && <span className="cdp-checkout-item-extras">+ {item.adicionais.join(", ")}</span>}
                    </div>
                    <span className="cdp-checkout-item-price">{fmt(item.preco * item.quantidade)}</span>
                  </div>
                ))}
                {checkoutForm.tipo === "delivery" && taxaEntrega > 0 && (
                  <div className="cdp-checkout-item cdp-checkout-item-taxa">
                    <div className="cdp-checkout-item-qty">🚚</div>
                    <div className="cdp-checkout-item-name">Taxa de entrega</div>
                    <span className="cdp-checkout-item-price">{fmt(taxaEntrega)}</span>
                  </div>
                )}
                {descontoEstimado > 0 && (
                  <div className="cdp-checkout-item cdp-checkout-item-discount">
                    <div className="cdp-checkout-item-qty">%</div>
                    <div className="cdp-checkout-item-name">Cupom {cupomAplicado}</div>
                    <span className="cdp-checkout-item-price">- {fmt(descontoEstimado)}</span>
                  </div>
                )}
                  <span>Total</span>
                <div className="cdp-checkout-total-row">
                  <span className="cdp-checkout-total-price">{fmt(totalEstimado)}</span>
                </div>
              </div>

              {/* Dados pessoais */}
              {cuponsAtivos.length > 0 && (
                <div className="cdp-coupon-box">
                  <div className="cdp-coupon-copy"><strong>Tem um cupom?</strong><small>Insira o código para conferir seu desconto.</small></div>
                  <div className="cdp-coupon-form">
                    <input value={cupomInput} onChange={(e) => { setCupomInput(e.target.value.toUpperCase()); setCupomFeedback(null); }} onKeyDown={(e) => e.key === "Enter" && aplicarCupom()} placeholder="CÓDIGO" />
                    <button type="button" onClick={() => aplicarCupom()}>Aplicar</button>
                  </div>
                  {cupomFeedback && <p className={cupomAplicado ? "success" : "error"}>{cupomFeedback}</p>}
                  {cuponsAtivos.length > 0 && (
                    <div className="cdp-coupon-suggestions">
                      {cuponsAtivos.slice(0, 3).map((cupom) => (
                        <button key={cupom.id} type="button" onClick={() => { setCupomInput(cupom.codigo); aplicarCupom(cupom.codigo); }}>
                          <b>{cupom.codigo}</b><span>{cupom.descricao || (cupom.tipo === "percentual" ? `${cupom.valor}% OFF` : `${fmt(cupom.valor)} OFF`)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="cdp-section-label">👤 Seus dados</div>
              <div className="cdp-checkout-card cdp-checkout-card-inputs">
                <div className="cdp-input-group">
                  <label className="cdp-input-label">Nome completo</label>
                  <input
                    placeholder="Seu nome"
                    value={checkoutForm.nome}
                    onChange={e => setCheckoutForm({ ...checkoutForm, nome: e.target.value })}
                    className="cdp-input"
                  />
                </div>
                <div className="cdp-input-group">
                  <label className="cdp-input-label">WhatsApp (com DDD)</label>
                  <input
                    placeholder="(11) 99999-9999"
                    value={checkoutForm.telefone}
                    onChange={e => setCheckoutForm({ ...checkoutForm, telefone: e.target.value })}
                    className={`cdp-input ${checkoutForm.telefone && !telValido ? "cdp-input-invalid" : ""}`}
                    type="tel"
                  />
                  {checkoutForm.telefone && !telValido && (
                    <p className="cdp-field-hint">📱 Inclua o DDD — ex: (11) 99999-9999</p>
                  )}
                </div>
              </div>

              {/* Tipo entrega */}
              <div className="cdp-section-label">🚚 Como quer receber?</div>
              <div className="cdp-delivery-toggle">
                <button
                  className={`cdp-delivery-btn ${checkoutForm.tipo === "delivery" ? "active" : ""}`}
                  onClick={() => setCheckoutForm({ ...checkoutForm, tipo: "delivery" })}
                >
                  <span className="cdp-delivery-btn-icon">🛵</span>
                  <span className="cdp-delivery-btn-label">Entrega</span>
                  {checkoutForm.tipo === "delivery" && <span className="cdp-delivery-check">✓</span>}
                </button>
                <button
                  className={`cdp-delivery-btn ${checkoutForm.tipo === "retirada" ? "active" : ""}`}
                  onClick={() => setCheckoutForm({ ...checkoutForm, tipo: "retirada" })}
                >
                  <span className="cdp-delivery-btn-icon">🏪</span>
                  <span className="cdp-delivery-btn-label">Retirada</span>
                  {checkoutForm.tipo === "retirada" && <span className="cdp-delivery-check">✓</span>}
                </button>
              </div>

              {/* Endereço */}
              {checkoutForm.tipo === "delivery" && (
                <>
                  <div className="cdp-section-label">📍 Endereço de entrega</div>
                  <div className="cdp-checkout-card cdp-checkout-card-inputs">
                    <div className="cdp-input-group">
                      <label className="cdp-input-label">Rua / Avenida</label>
                      <input placeholder="Ex: Rua das Flores" value={checkoutForm.rua}
                        onChange={e => setCheckoutForm({ ...checkoutForm, rua: e.target.value })} className="cdp-input" />
                    </div>
                    <div className="cdp-input-row">
                      <div className="cdp-input-group" style={{ flex: "0 0 100px" }}>
                        <label className="cdp-input-label">Número</label>
                        <input placeholder="123" value={checkoutForm.numero}
                          onChange={e => setCheckoutForm({ ...checkoutForm, numero: e.target.value })} className="cdp-input" />
                      </div>
                      <div className="cdp-input-group" style={{ flex: 1 }}>
                        <label className="cdp-input-label">Bairro</label>
                        <input placeholder="Seu bairro" value={checkoutForm.bairro} list="cdp-bairros"
                          onChange={e => setCheckoutForm({ ...checkoutForm, bairro: e.target.value })} className="cdp-input" />
                        {/* Sugere os bairros com taxa cadastrada: o nome certo já
                            traz a taxa certa, sem depender de digitação exata. */}
                        {(pizz.taxas_bairro?.length ?? 0) > 0 && (
                          <datalist id="cdp-bairros">
                            {pizz.taxas_bairro.map((tb) => <option key={tb.bairro} value={tb.bairro} />)}
                          </datalist>
                        )}
                      </div>
                    </div>
                    <div className="cdp-input-group">
                      <label className="cdp-input-label">Ponto de referência (opcional)</label>
                      <input placeholder="Ex: próximo ao mercado" value={checkoutForm.referencia}
                        onChange={e => setCheckoutForm({ ...checkoutForm, referencia: e.target.value })} className="cdp-input" />
                    </div>
                    <button type="button" onClick={usarMinhaLocalizacao}
                      className={`cdp-geo-btn ${geoStatus === "ok" ? "ok" : ""}`}>
                      📍 {geoStatus === "loading" ? "Localizando…"
                        : geoStatus === "ok" ? "Localização exata capturada ✓"
                        : "Usar minha localização exata"}
                    </button>
                    {geoStatus === "ok" && (
                      <p className="cdp-geo-hint ok">O entregador vai chegar no ponto certo. 📍</p>
                    )}
                    {geoStatus === "error" && (
                      <p className="cdp-geo-hint">Não consegui pegar sua localização — confira a permissão do navegador.</p>
                    )}
                    {checkoutForm.bairro && taxaEntrega > 0 && (
                      <p className="cdp-taxa-info">🚚 Taxa para {checkoutForm.bairro}: <strong>{fmt(taxaEntrega)}</strong></p>
                    )}
                    {taxaAConfirmar && (
                      <p className="cdp-taxa-info">🚚 Não temos taxa cadastrada para <strong>{checkoutForm.bairro}</strong>: a loja confirma o valor da entrega com você pelo WhatsApp.</p>
                    )}
                  </div>
                </>
              )}

              {/* Pagamento */}
              <div className="cdp-section-label">💳 Forma de pagamento</div>
              <div className="cdp-payment-grid">
                {(pizz.formas_pagamento_aceitas.length > 0
                  ? pizz.formas_pagamento_aceitas
                  : ["pix", "cartao", "dinheiro"]
                ).map(fp => (
                  <button
                    key={fp}
                    className={`cdp-payment-card ${checkoutForm.pagamento === fp ? "active" : ""}`}
                    onClick={() => setCheckoutForm({ ...checkoutForm, pagamento: fp })}
                  >
                    <span className="cdp-payment-icon">
                      {fp === "pix" ? "💠" : fp === "cartao" ? "💳" : fp === "dinheiro" ? "💵" : "💰"}
                    </span>
                    <span className="cdp-payment-label">
                      {fp === "pix" ? "Pix" : fp === "cartao" ? "Cartão" : fp === "dinheiro" ? "Dinheiro" : fp}
                    </span>
                    {checkoutForm.pagamento === fp && <span className="cdp-payment-check">✓</span>}
                  </button>
                ))}
              </div>

              {/* Observações */}
              <div className="cdp-section-label">📝 Observações gerais (opcional)</div>
              <div className="cdp-checkout-card cdp-checkout-card-inputs">
                <textarea
                  placeholder="Ex: troco pra R$ 100, campainha não funciona..."
                  value={checkoutForm.observacoes}
                  onChange={e => setCheckoutForm({ ...checkoutForm, observacoes: e.target.value })}
                  className="cdp-textarea"
                  rows={3}
                />
              </div>

              {/* Honeypot anti-bot */}
              <input type="text" name="website" style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

              {submitError && <div className="cdp-error-inline">⚠️ {submitError}</div>}

              {!pizz.aberto ? (
                <div className="cdp-closed-order-box">
                  <div className="cdp-closed-order-badge">⚠️ Loja Fechada</div>
                  <h3 className="cdp-closed-order-title">O horário de funcionamento encerrou</h3>
                  <p className="cdp-closed-order-desc">
                    Como você já estava montando seu pedido, envie todos os detalhes diretamente para nosso WhatsApp para verificarmos se ainda é possível atender:
                  </p>
                  <a
                    href={whatsappOrderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cdp-btn-whatsapp-order"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-1 .9-1.2 2-.7 3.3.6 1.5 1.6 2.9 2.9 4.1 2 1.9 3.7 2.5 5.2 2.9 1.3.3 2.1.2 2.7-.1.4-.2 1.2-.9 1.4-1.4.2-.5.2-1 .1-1.1 0-.1-.2-.2-.5-.4zM12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2z"/></svg>
                    <span>Finalizar Pedido pelo WhatsApp • {fmt(totalEstimado)}</span>
                  </a>
                </div>
              ) : (
                <button
                  className="cdp-btn-primary cdp-btn-lg cdp-btn-submit"
                  disabled={submitting || !checkoutForm.nome || !telValido || !checkoutForm.pagamento || (checkoutForm.tipo === "delivery" && !checkoutForm.rua)}
                  onClick={submitPedido}
                >
                  {submitting ? (
                    <span className="cdp-btn-loading">
                      <span className="cdp-mini-spinner" /> Enviando...
                    </span>
                  ) : `✅ Confirmar Pedido • ${fmt(totalEstimado)}`}
                </button>
              )}
            </div>
          </>

        ) : step === "carrinho" ? (
          /* ===== CARRINHO ===== */
          <>
            <div className="cdp-topbar">
              <button className="cdp-topbar-back" onClick={() => setStep("menu")}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
              </button>
              <h2 className="cdp-topbar-title">Seu Pedido</h2>
              <div style={{ width: 32 }} />
            </div>

            <Stepper current="carrinho" />

            <div className="cdp-cart-page">
              {cart.length === 0 ? (
                <div className="cdp-cart-empty">
                  <div className="cdp-cart-empty-icon-wrap">🛒</div>
                  <h3>Carrinho vazio</h3>
                  <p>Adicione itens do cardápio para continuar</p>
                  <button className="cdp-btn-secondary" onClick={() => setStep("menu")}>Ver cardápio</button>
                </div>
              ) : (
                <>
                  <div className="cdp-cart-items">
                    {cart.map(item => (
                      <div key={item.id} className="cdp-cart-item">
                        {item.imgUrl ? (
                          <img src={item.imgUrl} alt={item.nome} className="cdp-cart-item-img" />
                        ) : (
                          <div className="cdp-cart-item-img-ph">
                            {CAT_EMOJI["outro"]}
                          </div>
                        )}
                        <div className="cdp-cart-item-body">
                          <div className="cdp-cart-item-name">
                            {item.nome}
                            {item.tamanho && <span className="cdp-cart-item-tag">{item.tamanho}</span>}
                          </div>
                          {item.adicionais.length > 0 && (
                            <div className="cdp-cart-item-extras">+ {item.adicionais.join(", ")}</div>
                          )}
                          {item.observacao && <div className="cdp-cart-item-obs">📝 {item.observacao}</div>}
                          <div className="cdp-cart-item-price-row">
                            <span className="cdp-cart-item-price">{fmt(item.preco * item.quantidade)}</span>
                          </div>
                        </div>
                        <div className="cdp-cart-item-actions">
                          <div className="cdp-qty-controls">
                            <button onClick={() => updateCartQty(item.id, -1)}>−</button>
                            <span>{item.quantidade}</span>
                            <button onClick={() => updateCartQty(item.id, 1)}>+</button>
                          </div>
                          <button className="cdp-cart-remove" onClick={() => removeFromCart(item.id)}>
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Resumo do total */}
                  <div className="cdp-cart-summary">
                    <div className="cdp-cart-summary-row">
                      <span>Subtotal ({cartCount} {cartCount === 1 ? "item" : "itens"})</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    {checkoutForm.tipo === "delivery" && taxaEntrega > 0 && (
                      <div className="cdp-cart-summary-row cdp-cart-summary-row-muted">
                        <span>🚚 Taxa de entrega estimada</span>
                        <span>{fmt(taxaEntrega)}</span>
                      </div>
                    )}
                    <div className="cdp-cart-summary-total">
                      <span>Total</span>
                      <span>{fmt(cartTotal + taxaEntrega)}</span>
                    </div>
                  </div>

                  <div className="cdp-cart-cta">
                    {!pizz.aberto ? (
                      <div className="cdp-closed-order-box cdp-closed-order-box-cart">
                        <p className="cdp-closed-order-cart-notice">
                          ⚠️ <strong>A loja fechou para novos pedidos pelo cardápio.</strong> Como você já tem itens na sacola, finalize diretamente pelo WhatsApp!
                        </p>
                        <a
                          href={whatsappOrderUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cdp-btn-whatsapp-order"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-1 .9-1.2 2-.7 3.3.6 1.5 1.6 2.9 2.9 4.1 2 1.9 3.7 2.5 5.2 2.9 1.3.3 2.1.2 2.7-.1.4-.2 1.2-.9 1.4-1.4.2-.5.2-1 .1-1.1 0-.1-.2-.2-.5-.4zM12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2z"/></svg>
                          <span>Enviar pedido pelo WhatsApp ({fmt(cartTotal)})</span>
                        </a>
                      </div>
                    ) : (
                      <button className="cdp-btn-primary cdp-btn-lg" onClick={() => setStep("checkout")}>
                        Continuar • {fmt(cartTotal)}
                      </button>
                    )}
                    <button className="cdp-cart-add-more" onClick={() => setStep("menu")}>
                      + Adicionar mais itens
                    </button>
                  </div>
                </>
              )}
            </div>
          </>

        ) : step === "produto" && selectedProduto ? (
          /* ===== PRODUTO DETAIL ===== */
          <>
            <div className="cdp-produto-hero">
              {selectedProduto.imagem_url ? (
                <img src={selectedProduto.imagem_url} alt={selectedProduto.nome} className="cdp-produto-hero-img" />
              ) : (
                <div className="cdp-produto-hero-ph">
                  <span>{CAT_EMOJI[selectedProduto.categoria || "outro"] || "🍽️"}</span>
                </div>
              )}
              <div className="cdp-produto-hero-gradient" />
              <button className="cdp-btn-back-circle" onClick={() => { setStep("menu"); setSelectedProduto(null); }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
              </button>
              <div className="cdp-produto-hero-overlay">
                <h1 className="cdp-produto-hero-title">
                  {saboresEscolhidos.length
                    ? [selectedProduto, ...saboresEscolhidos].map((s) => `Meia ${s.nome}`).join(" / ")
                    : selectedProduto.nome}
                </h1>
                {!selectedProduto.tamanhos || selectedProduto.tamanhos.length === 0 ? (
                  <div className="cdp-produto-hero-price">{fmt(Number(selectedProduto.preco))}</div>
                ) : (
                  <div className="cdp-produto-hero-price">a partir de {fmt(Math.min(...selectedProduto.tamanhos.map(t => Number(t.preco))))}</div>
                )}
              </div>
            </div>

            <div className="cdp-produto-body">
              {selectedProduto.descricao && (
                <div className="cdp-produto-desc-block">
                  <p className="cdp-produto-desc">{selectedProduto.descricao}</p>
                </div>
              )}

              {/* Meio a meio: só aparece se existir outro sabor compatível */}
              {saboresCandidatos.length > 0 && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>Inteira ou meio a meio?</h3>
                  </div>
                  <div className="cdp-tamanho-list">
                    {([[false, "Inteira", selectedProduto.nome], [true, "Meio a meio", "Escolha o outro sabor"]] as const).map(([meio, rotulo, detalhe]) => (
                      <button
                        key={rotulo}
                        type="button"
                        aria-pressed={modalMeio === meio}
                        className={`cdp-tamanho-btn ${modalMeio === meio ? "active" : ""}`}
                        onClick={() => { setModalMeio(meio); if (!meio) setModalSabores([]); }}
                      >
                        <div className="cdp-tamanho-left">
                          <span className={`cdp-radio ${modalMeio === meio ? "active" : ""}`} />
                          <span className="cdp-tamanho-name">{rotulo}</span>
                        </div>
                        <span className="cdp-tamanho-price" style={{ fontWeight: 500 }}>{detalhe}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {modalMeio && saboresCandidatos.length > 0 && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>{limiteOutrosSabores > 1 ? `Escolha até ${limiteOutrosSabores} sabores` : "Escolha o outro sabor"}</h3>
                    <span className="cdp-badge cdp-badge-required">Obrigatório</span>
                  </div>
                  <p className="cdp-produto-desc" style={{ marginBottom: 10 }}>
                    Metade {selectedProduto.nome}, metade o sabor escolhido.{" "}
                    {regrasMeia(selectedProduto).calculo === "media"
                      ? "O preço é a média dos sabores."
                      : "O preço é o do sabor mais caro."}
                  </p>
                  <div className="cdp-tamanho-list">
                    {saboresCandidatos.map((s) => {
                      const ativo = modalSabores.includes(s.id);
                      const preco = precoDosSabores([s], modalTamanho);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={ativo}
                          className={`cdp-tamanho-btn ${ativo ? "active" : ""}`}
                          onClick={() => alternarSabor(s.id)}
                        >
                          <div className="cdp-tamanho-left">
                            <span className={`cdp-radio ${ativo ? "active" : ""}`} />
                            <span className="cdp-tamanho-name">{s.nome}</span>
                          </div>
                          {preco !== null && <span className="cdp-tamanho-price">{fmt(preco)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tamanhos (no meio a meio, só os que existem em todos os sabores) */}
              {selectedProduto.tamanhos && selectedProduto.tamanhos.length > 0 && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>Escolha o tamanho</h3>
                    <span className="cdp-badge cdp-badge-required">Obrigatório</span>
                  </div>
                  <div className="cdp-tamanho-list">
                    {selectedProduto.tamanhos
                      .filter(t => !tamanhosMeia || tamanhosMeia.includes(t.tamanho))
                      .map(t => (
                      <button
                        key={t.tamanho}
                        className={`cdp-tamanho-btn ${modalTamanho === t.tamanho ? "active" : ""}`}
                        onClick={() => setModalTamanho(t.tamanho)}
                      >
                        <div className="cdp-tamanho-left">
                          <span className={`cdp-radio ${modalTamanho === t.tamanho ? "active" : ""}`} />
                          <span className="cdp-tamanho-name">{t.tamanho}</span>
                        </div>
                        <span className="cdp-tamanho-price">
                          {fmt(precoDosSabores([selectedProduto, ...saboresEscolhidos], t.tamanho) ?? t.preco)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Adicionais e Bordas */}
              {adicionaisDisp.length > 0 && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>Adicionais & Bordas</h3>
                    <span className="cdp-badge cdp-badge-optional">Opcional</span>
                  </div>
                  <div className="cdp-adicionais-list">
                    {adicionaisDisp.map(a => {
                      const isActive = modalAdicionais.includes(a.nome);
                      return (
                        <label key={a.nome} className={`cdp-adicional-item ${isActive ? "active" : ""}`}>
                          <div className="cdp-adicional-left">
                            <span className={`cdp-checkbox ${isActive ? "active" : ""}`}>
                              {isActive && <svg width="10" height="10" fill="white" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>}
                            </span>
                            <span className="cdp-adicional-name">{a.nome}</span>
                          </div>
                          {a.preco > 0 && <span className="cdp-adicional-price">+{fmt(a.preco)}</span>}
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => {
                              if (e.target.checked) setModalAdicionais([...modalAdicionais, a.nome]);
                              else setModalAdicionais(modalAdicionais.filter(x => x !== a.nome));
                            }}
                            style={{ display: "none" }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Observação */}
              <div className="cdp-produto-section">
                <div className="cdp-produto-section-header">
                  <h3>Alguma observação?</h3>
                  <span className="cdp-badge cdp-badge-optional">Opcional</span>
                </div>
                <textarea
                  placeholder="Ex: sem cebola, borda fina..."
                  value={modalObs}
                  onChange={e => setModalObs(e.target.value)}
                  className="cdp-textarea cdp-textarea-obs"
                  rows={2}
                />
              </div>
            </div>

            {/* Footer fixo */}
            <div className="cdp-produto-footer">
              <div className="cdp-qty-controls cdp-qty-lg">
                <button onClick={() => setModalQtd(Math.max(1, modalQtd - 1))}>−</button>
                <span>{modalQtd}</span>
                <button onClick={() => setModalQtd(modalQtd + 1)}>+</button>
              </div>
              <button className="cdp-btn-primary cdp-btn-add" disabled={!pizz.aberto || faltaSabor} onClick={confirmAddToCart}>
                {!pizz.aberto ? "Loja fechada" : faltaSabor ? "Escolha o outro sabor" : `Adicionar • ${fmt(precoTotal)}`}
              </button>
            </div>
          </>

        ) : (
          /* ===== MENU PRINCIPAL (layout do design de referência) ===== */
          <div className="fx" id="inicio">
            {/* Barra de cupom: só existe quando há cupom ativo pra anunciar. */}
            {topOfferVisible && tema.barra_cupom_ativa !== false && cupomBarra && (
              <div className="fx-bar">
                <span className="fx-bar-msg">{textoBarra} <span className="fx-bar-code">{cupomBarra.codigo.toUpperCase()}</span></span>
                <button type="button" className="fx-bar-copy" onClick={() => copiarCupom(cupomBarra.codigo)}>
                  {topOfferCopied ? "Copiado" : "Copiar cupom"}
                </button>
                <button type="button" className="fx-bar-close" aria-label="Fechar aviso" onClick={() => setTopOfferVisible(false)}>
                  <IcoFechar />
                </button>
              </div>
            )}

            {/* Header fixo. O estado da loja fica na segunda linha da marca porque
                os chips do hero saem de vista ao rolar. */}
            <header className="fx-header">
              <div className="fx-wrap fx-header-in">
                <a href="#inicio" className="fx-brand" onClick={irPara("inicio")} aria-label={`${pizz.nome} — voltar ao início`}>
                  <span className="fx-brand-mark">
                    {pizz.logo_url ? <img src={pizz.logo_url} alt="" /> : <IcoFatia />}
                  </span>
                  <span className="fx-brand-text">
                    <span className="fx-brand-name fx-disp">{pizz.nome}</span>
                    <span className={`fx-brand-sub ${pizz.aberto ? "is-open" : "is-closed"}`}>
                      {pizz.aberto ? "Aberto agora" : "Fechado agora"}
                    </span>
                  </span>
                </a>

                <nav className="fx-nav fx-only-desk" aria-label="Principal">
                  <a href="#inicio" onClick={irPara("inicio")}>Início</a>
                  <a href="#cardapio" onClick={irPara("cardapio")}>Cardápio</a>
                  {temPromocoes && <a href="#promocoes" onClick={irPara("promocoes")}>Promoções</a>}
                  {temLocal && <a href="#localizacao" onClick={irPara("localizacao")}>Nossa localização</a>}
                  {temFaq && <a href="#duvidas" onClick={irPara("duvidas")}>Dúvidas</a>}
                </nav>

                <div className="fx-actions">
                  {tema.mostrar_acompanhamento !== false && (
                    <button type="button" className="fx-hbtn fx-only-desk" onClick={abrirAcompanhamentoNaConta}>
                      <IcoAlvo /><span className="fx-hbtn-label">Acompanhar pedido</span>
                    </button>
                  )}
                  <button type="button" className="fx-hbtn fx-only-desk" onClick={() => setAccountOpen(true)}
                    aria-label={customer ? `Abrir conta de ${customer.nome}` : "Minha conta"}>
                    <IcoUsuario /><span className="fx-hbtn-label">{customer ? customer.nome.split(" ")[0] : "Minha conta"}</span>
                  </button>
                  <button type="button" className={`fx-hbag fx-pri fx-only-desk fx-bag-target ${cartPulse ? "is-pulse" : ""}`} onClick={abrirSacola}>
                    <IcoSacola s={18} />Sacola<span className="fx-hbag-count">{cartCount}</span>
                  </button>

                  <button type="button" className="fx-ibtn fx-only-mob" onClick={() => setAccountOpen(true)}
                    aria-label={customer ? `Abrir conta de ${customer.nome}` : "Minha conta"}>
                    <IcoUsuario s={22} />
                  </button>
                  <button type="button" className={`fx-ibtn fx-pri fx-only-mob fx-bag-target ${cartPulse ? "is-pulse" : ""}`}
                    onClick={abrirSacola} aria-label={`Sacola, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}>
                    <IcoSacola s={20} />
                    <span className="fx-ibag-badge">{cartCount}</span>
                  </button>
                  <button type="button" className="fx-ibtn fx-only-mob" aria-label="Abrir menu" aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}>
                    {menuOpen ? <IcoFechar s={22} /> : <IcoMenu />}
                  </button>
                </div>
              </div>

              {menuOpen && (
                <nav className="fx-mnav fx-only-mob" aria-label="Principal">
                  <a href="#inicio" onClick={irPara("inicio")}>Início</a>
                  <a href="#cardapio" onClick={irPara("cardapio")}>Cardápio</a>
                  {temPromocoes && <a href="#promocoes" onClick={irPara("promocoes")}>Promoções</a>}
                  {temLocal && <a href="#localizacao" onClick={irPara("localizacao")}>Nossa localização</a>}
                  {temFaq && <a href="#duvidas" onClick={irPara("duvidas")}>Dúvidas</a>}
                  <div className="fx-mnav-actions">
                    {tema.mostrar_acompanhamento !== false && (
                      <button type="button" onClick={() => { setMenuOpen(false); abrirAcompanhamentoNaConta(); }}><IcoAlvo s={16} />Acompanhar pedido</button>
                    )}
                    <button type="button" onClick={() => { setMenuOpen(false); setAccountOpen(true); }}><IcoUsuario s={16} />Minha conta</button>
                  </div>
                </nav>
              )}
            </header>

            {/* Hero: chips de estado, título, CTAs e foto com o destaque da casa. */}
            <section className="fx-wrap fx-hero" aria-label="Apresentação">
              <div className="fx-hero-col">
                <div className="fx-chips">
                  <span className={`fx-chip ${pizz.aberto ? "is-open" : "is-closed"}`}>
                    <span className="fx-dot" />{pizz.aberto ? "Aberto agora" : "Fechado agora"}
                  </span>
                  {!pizz.aberto && proximaAberturaTexto && <span className="fx-chip">{proximaAberturaTexto}</span>}
                  {tempoEntrega && (
                    <span className="fx-chip"><IcoRelogio /><span className="fx-only-desk">Entrega em {tempoEntrega}</span><span className="fx-only-mob">{tempoEntrega}</span></span>
                  )}
                  <span className="fx-chip"><span className="fx-only-desk"><IcoSacola /></span>Retirada disponível</span>
                </div>

                {tema.chamada && <p className="fx-eyebrow">{tema.chamada}</p>}

                <h1 className="fx-hero-title fx-disp">
                  {linhasTitulo.map((linha, i) => (
                    <React.Fragment key={i}>{i > 0 && " "}{linha}</React.Fragment>
                  ))}
                </h1>

                <p className="fx-hero-desc">{tema.descricao}</p>

                <div className="fx-ctas">
                  <a href="#cardapio" className="fx-cta fx-pri" onClick={irPara("cardapio")}>{tema.cta_primario}</a>
                  {temLocal && (
                    <a href="#localizacao" className="fx-cta fx-ghost" onClick={irPara("localizacao")}>
                      <span className="fx-only-desk"><IcoPin s={18} /></span>{tema.cta_secundario}
                    </a>
                  )}
                </div>

                {pizz.endereco && <p className="fx-addr"><IcoPin />{pizz.endereco}</p>}
              </div>

              <div className="fx-hero-media">
                {heroImagem ? <img src={heroImagem} alt="" fetchPriority="high" /> : <Foto alt={pizz.nome} />}
                {produtoDestaque && (
                  <div className="fx-hero-card">
                    <div className="fx-hero-card-body">
                      <span className="fx-hero-card-label">Destaque da casa</span>
                      <span className="fx-hero-card-name fx-clamp1">{produtoDestaque.nome}</span>
                      {produtoDestaque.descricao && <span className="fx-hero-card-desc fx-clamp1">{produtoDestaque.descricao}</span>}
                      <span className="fx-hero-card-price-m fx-num">{fmt(precoDe(produtoDestaque))}</span>
                    </div>
                    <span className="fx-hero-card-price fx-num">{fmt(precoDe(produtoDestaque))}</span>
                    <button type="button" className="fx-hero-add fx-pri" disabled={!pizz.aberto}
                      onClick={(e) => handleQuickAdd(e, produtoDestaque)}
                      aria-label={`Adicionar ${produtoDestaque.nome} à sacola`}>
                      <IcoMais />Adicionar
                    </button>
                  </div>
                )}
              </div>
            </section>

            {!pizz.aberto && (
              <div className="fx-wrap">
                <div className="fx-closed" role="status">
                  <div className="fx-closed-text">
                    <strong>{cart.length > 0 ? "A loja fechou para novos pedidos pelo cardápio" : "Loja fechada no momento"}</strong>
                    <span>
                      {cart.length > 0
                        ? `Você tem ${cartCount} ${cartCount === 1 ? "item" : "itens"} na sacola. Finalize o pedido pelo WhatsApp.`
                        : (proximaAberturaTexto || "Você pode consultar o cardápio e pedir quando a loja abrir.")}
                    </span>
                  </div>
                  {(cart.length > 0 ? whatsappOrderUrl : waUrl) && (
                    <a className="fx-wa-btn fx-pri" href={cart.length > 0 ? whatsappOrderUrl : waUrl} target="_blank" rel="noopener noreferrer">
                      <IcoWhats s={18} />{cart.length > 0 ? "Enviar pedido" : "Falar no WhatsApp"}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Diferenciais: 4 blocos, editáveis no painel. */}
            {diferenciais.length > 0 && (
              <div className="fx-wrap fx-trust-wrap">
                <ul className="fx-trust">
                  {diferenciais.map((d, i) => (
                    <li key={i}>
                      <span className="fx-trust-ico"><IconeDiferencial nome={d.icone} /></span>
                      <span className="fx-trust-text">
                        <span className="fx-trust-title">{d.titulo}</span>
                        {d.descricao && <span className="fx-trust-desc">{d.descricao}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <section id="cardapio" className="fx-wrap fx-menu" aria-label="Cardápio">
              <div className="fx-toolbar">
                <div className="fx-search">
                  <IcoBusca />
                  <label htmlFor="fx-busca" className="fx-sr">Buscar no cardápio</label>
                  <input id="fx-busca" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar no cardápio" autoComplete="off" />
                  {searchQuery && (
                    <button type="button" className="fx-search-clear" aria-label="Limpar busca" onClick={() => setSearchQuery("")}><IcoFechar s={16} /></button>
                  )}
                </div>
                <div className="fx-cats fx-hscroll">
                  {categorias.map((cat) => (
                    <button key={cat} type="button" className="fx-cat" aria-pressed={selectedCat === cat} onClick={() => setSelectedCat(cat)}>
                      {cat === "todos" ? "Todos" : tituloCategoria(cat)}
                      <span className="fx-cat-n">{contagemCategoria(cat)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="fx-menu-grid">
                <div className="fx-menu-main">
                  {mostrarDestaques && (
                    <div className="fx-sec">
                      <div className="fx-sec-head">
                        <h2 className="fx-sec-title fx-disp">{tema.destaques_titulo}</h2>
                        <span className="fx-sec-count">Os favoritos da casa</span>
                      </div>
                      <div className="fx-feat fx-hscroll">
                        {destaques.map((p) => (
                          <article key={p.id} className="fx-feat-card" role="button" tabIndex={0}
                            aria-label={`${p.nome}, ${fmt(precoDe(p))}`}
                            onClick={() => openProduto(p)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduto(p); } }}>
                            <Foto src={p.imagem_url} alt={p.nome} />
                            <div className="fx-feat-foot">
                              <div className="fx-feat-info">
                                <h3 className="fx-feat-name fx-clamp1">{p.nome}</h3>
                                <span className="fx-feat-price fx-num">{fmt(precoDe(p))}</span>
                              </div>
                              <button type="button" className="fx-round fx-pri" disabled={!pizz.aberto}
                                aria-label={pizz.aberto ? `Adicionar ${p.nome}` : "Loja fechada"}
                                onClick={(e) => handleQuickAdd(e, p)}>
                                <IcoMais />
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}

                  {secoes.length === 0 ? (
                    <div className="fx-empty">
                      <p className="fx-empty-title">{busca ? `Nada encontrado para “${searchQuery.trim()}”` : "Nenhum produto nesta categoria"}</p>
                      <p className="fx-empty-sub">Confira a grafia ou procure em outra categoria.</p>
                      {busca && <button type="button" className="fx-ghost" onClick={() => setSearchQuery("")}>Limpar busca</button>}
                    </div>
                  ) : secoes.map((s) => (
                    <div key={s.id} id={`cat-${s.id}`} className="fx-sec">
                      <div className="fx-sec-head">
                        <h2 className="fx-sec-title fx-disp">{s.titulo}</h2>
                        <span className="fx-sec-count">{s.itens.length} {s.itens.length === 1 ? "item" : "itens"}</span>
                      </div>
                      <div className="fx-items">{s.itens.map(renderProduct)}</div>
                    </div>
                  ))}
                </div>

                <aside id="sacola" className="fx-aside fx-only-desk fx-bag-anchor" aria-label="Sua sacola">
                  <div className="fx-bag">{renderSacola()}</div>
                  <div className="fx-info">
                    <div className="fx-info-row">
                      <span className={`fx-dot ${pizz.aberto ? "" : "is-closed"}`} />
                      <span className={pizz.aberto ? "fx-info-open" : "fx-info-closed"}>{pizz.aberto ? "Aberto agora" : "Fechado agora"}</span>
                      {tempoEntrega && <span>Entrega em {tempoEntrega}</span>}
                    </div>
                    {pizz.endereco && <div className="fx-info-row is-top"><IcoPin /><span>{enderecoLinha1 || pizz.endereco}</span></div>}
                    {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer"><IcoWhats />Pedir pelo WhatsApp</a>}
                  </div>
                </aside>
              </div>

              {/* Celular: barra fixa embaixo que abre a sacola. */}
              {cartCount > 0 && (
                <div className="fx-mbag fx-only-mob fx-bag-anchor">
                  {bagOpen && <div className="fx-bag fx-mbag-panel">{renderSacola()}</div>}
                  <button type="button" className="fx-mbag-bar fx-pri" aria-expanded={bagOpen} onClick={() => setBagOpen((v) => !v)}>
                    <span className="fx-mbag-count">{cartCount}</span>
                    <span className="fx-mbag-cta">{bagOpen ? "Fechar sacola" : "Ver sacola"}</span>
                    <span className="fx-num">{fmt(totalEstimado)}</span>
                  </button>
                </div>
              )}
            </section>

            {temPromocoes && (
              <section id="promocoes" className="fx-promo" aria-label="Promoções">
                <div className="fx-wrap fx-promo-in">
                  <div className="fx-promo-head">
                    <h2 className="fx-promo-title fx-disp">{tema.promocoes_titulo}</h2>
                    {tema.promocoes_subtitulo && <p className="fx-promo-sub">{tema.promocoes_subtitulo}</p>}
                  </div>
                  <div className={`fx-promo-grid ${campanhaPrincipal && cupomBarra ? "" : "is-single"}`}>
                    {campanhaPrincipal && (
                      <article className={`fx-camp ${fotosCampanha.length ? "" : "is-plain"}`}>
                        <div className="fx-camp-body">
                          <span className="fx-camp-tag">{campanhaPrincipal.etiqueta || "Oferta da semana"}</span>
                          <h3 className="fx-camp-title fx-disp">{campanhaPrincipal.titulo}</h3>
                          {campanhaPrincipal.subtitulo && <p className="fx-camp-text">{campanhaPrincipal.subtitulo}</p>}
                          <button type="button" className="fx-camp-cta" onClick={() => aoEscolherCampanha(campanhaPrincipal)}>
                            {campanhaPrincipal.cta_label || "Escolher meu favorito"}
                          </button>
                        </div>
                        {fotosCampanha.length > 0 && (
                          <div className="fx-collage" aria-hidden="true">
                            {fotosCampanha.map((f, i) => <React.Fragment key={i}><Foto src={f} alt="" className={`c${i}`} /></React.Fragment>)}
                          </div>
                        )}
                      </article>
                    )}
                    {cupomBarra && (
                      <article className="fx-coupon">
                        <div className="fx-coupon-top">
                          <p className="fx-coupon-kicker">{cupomBarra.descricao || "Cupom de desconto"}</p>
                          <p className="fx-coupon-big fx-disp">{rotuloDesconto(cupomBarra)}</p>
                          <p className="fx-coupon-min">
                            {minimoDoCupom(cupomBarra) > 0 ? `em pedidos acima de ${fmt(minimoDoCupom(cupomBarra))}` : "em qualquer pedido"}
                          </p>
                        </div>
                        <div className="fx-coupon-foot">
                          <span className="fx-coupon-notch l" />
                          <span className="fx-coupon-notch r" />
                          <span className="fx-coupon-code fx-disp">{cupomBarra.codigo.toUpperCase()}</span>
                          <button type="button" className="fx-coupon-copy" onClick={() => copiarCupom(cupomBarra.codigo)}>
                            <IcoCopiar />{topOfferCopied ? "Copiado" : "Copiar cupom"}
                          </button>
                        </div>
                      </article>
                    )}
                  </div>
                  {campanhasAtivas.length > 1 && (
                    <div className="fx-camp-more">
                      {campanhasAtivas.slice(1).map((c) => (
                        <article key={c.id} className="fx-camp is-plain">
                          <div className="fx-camp-body">
                            {c.etiqueta && <span className="fx-camp-tag">{c.etiqueta}</span>}
                            <h3 className="fx-camp-title fx-disp">{c.titulo}</h3>
                            {c.subtitulo && <p className="fx-camp-text">{c.subtitulo}</p>}
                            <button type="button" className="fx-camp-cta" onClick={() => aoEscolherCampanha(c)}>
                              {c.cta_label || "Escolher agora"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {(tema.passos || []).length > 0 && (
              <section className="fx-wrap fx-steps" aria-label="Como pedir">
                <div className="fx-steps-head">
                  <h2 className="fx-h2 fx-disp">{tema.passos_titulo}</h2>
                  <p>Simples como deve ser.</p>
                </div>
                <ol>
                  {(tema.passos || []).map((passo, i) => (
                    <li key={i}>
                      <span className="fx-step-n fx-disp">{i + 1}</span>
                      <span className="fx-step-body">
                        <h3 className="fx-step-t">{passo.titulo}</h3>
                        {passo.descricao && <p className="fx-step-d">{passo.descricao}</p>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {temLocal && (
              <section id="localizacao" className="fx-wrap fx-loc-wrap" aria-label={tema.localizacao_titulo}>
                <div className="fx-loc">
                  <div className="fx-loc-copy">
                    <h2 className="fx-loc-title fx-disp">{tema.localizacao_titulo}</h2>
                    <p className="fx-loc-text">Abra a rota no Google Maps ou no aplicativo de navegação do seu celular.</p>
                    {pizz.endereco && (
                      <address className="fx-address">
                        <span className="fx-address-ico"><IcoPin s={20} /></span>
                        <span className="fx-address-text">
                          <strong>{enderecoLinha1}</strong>
                          {enderecoLinha2 && <span>{enderecoLinha2}</span>}
                        </span>
                      </address>
                    )}
                    <div className="fx-loc-btns">
                      {rotaUrl && (
                        <a className="fx-loc-btn fx-pri" href={rotaUrl} target="_blank" rel="noopener noreferrer"><IcoRota />Abrir rota</a>
                      )}
                      {mapaUrl && (
                        <a className="fx-loc-btn fx-ghost" href={mapaUrl} target="_blank" rel="noopener noreferrer">Ver no mapa</a>
                      )}
                    </div>
                  </div>
                  <div className="fx-map">
                    <svg viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice" role="img"
                      aria-label={`Mapa ilustrativo com a posição de ${pizz.nome}`}>
                      <rect className="m-base" width="640" height="480" />
                      <rect className="m-park" x="392" y="96" width="92" height="118" rx="8" />
                      <g className="m-road" strokeWidth="14" strokeLinecap="round">
                        <path d="M-10 64 L650 52" /><path d="M-10 160 L650 150" /><path d="M-10 346 L650 356" />
                        <path d="M-10 438 L650 446" /><path d="M72 -10 L64 490" /><path d="M176 -10 L170 490" />
                        <path d="M280 -10 L284 490" /><path d="M516 -10 L524 490" /><path d="M600 -10 L610 490" />
                      </g>
                      <path className="m-main" d="M-10 254 L650 252" strokeWidth="20" strokeLinecap="round" />
                      <path className="m-ave" d="M392 -10 L372 490" strokeWidth="26" strokeLinecap="round" />
                      {ruaNoMapa && <text className="m-label" x="96" y="243" fontSize="13" fontWeight="700">{ruaNoMapa}</text>}
                      <circle className="m-halo" cx="316" cy="253" r="54" opacity="0.12" />
                      <circle className="m-halo" cx="316" cy="253" r="28" opacity="0.22" />
                      <path className="m-pin" d="M316 262 C 302 246, 294 234, 294 222 a 22 22 0 0 1 44 0 C 338 234, 330 246, 316 262 Z" strokeWidth="3" />
                      <circle className="m-pin-dot" cx="316" cy="222" r="7" />
                      <g className="fx-only-desk-svg">
                        <rect className="m-tag" x="344" y="268" width={Math.min(280, 36 + nomeNoMapa.length * 8.6)} height="46" rx="14" />
                        <text className="m-tag-text" x="362" y="297" fontSize="15" fontWeight="800">{nomeNoMapa}</text>
                      </g>
                    </svg>
                  </div>
                </div>
              </section>
            )}

            {temFaq && (
              <section id="duvidas" className="fx-wrap fx-faq" aria-label={tema.faq_titulo}>
                <div className="fx-faq-head">
                  <h2 className="fx-faq-title fx-disp">{tema.faq_titulo}</h2>
                  {waUrl && <p className="fx-faq-text">Não encontrou o que procurava? Fale com a gente pelo WhatsApp.</p>}
                  {waUrl && (
                    <a className="fx-faq-wa fx-ghost fx-only-desk" href={waUrl} target="_blank" rel="noopener noreferrer">
                      <IcoWhats s={18} />{telefoneExibido || "WhatsApp"}
                    </a>
                  )}
                </div>
                <div className="fx-faq-list">
                  {(tema.faq || []).map((item, i) => {
                    const aberta = faqAberta === i;
                    return (
                      <div className="fx-faq-item" key={i}>
                        <h3>
                          <button type="button" className="fx-faq-q" aria-expanded={aberta} onClick={() => setFaqAberta(aberta ? null : i)}>
                            {item.pergunta}
                            <span className="fx-faq-ico">{aberta ? <IcoMenos /> : <IcoMais s={16} />}</span>
                          </button>
                        </h3>
                        {aberta && <p className="fx-faq-a">{item.resposta}</p>}
                      </div>
                    );
                  })}
                </div>
                {waUrl && (
                  <a className="fx-faq-wa fx-ghost fx-only-mob" href={waUrl} target="_blank" rel="noopener noreferrer">
                    <IcoWhats s={18} />WhatsApp {telefoneExibido}
                  </a>
                )}
              </section>
            )}

            <footer className="fx-footer">
              <div className="fx-wrap fx-footer-grid">
                <div className="fx-footer-brand">
                  <div className="fx-footer-brand-row">
                    <span className="fx-brand-mark">{pizz.logo_url ? <img src={pizz.logo_url} alt="" /> : <IcoFatia />}</span>
                    <span className="fx-footer-name">{pizz.nome}</span>
                  </div>
                  {tema.rodape_frase && <p>{tema.rodape_frase}</p>}
                </div>
                <nav className="fx-footer-col fx-footer-nav" aria-label="Rodapé">
                  <span className="fx-footer-h">Navegação</span>
                  <a href="#inicio" onClick={irPara("inicio")}>Início</a>
                  <a href="#cardapio" onClick={irPara("cardapio")}>Cardápio</a>
                  {temPromocoes && <a href="#promocoes" onClick={irPara("promocoes")}>Promoções</a>}
                  {temLocal && <a href="#localizacao" onClick={irPara("localizacao")}>Nossa localização</a>}
                  {temFaq && <a href="#duvidas" onClick={irPara("duvidas")}>Dúvidas</a>}
                </nav>
                {pizz.endereco && (
                  <div className="fx-footer-col">
                    <span className="fx-footer-h">Onde estamos</span>
                    <span className="v">{pizz.endereco}</span>
                  </div>
                )}
                {(waUrl || pizz.instagram) && (
                  <div className="fx-footer-col">
                    <span className="fx-footer-h">Fale com a gente</span>
                    {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer">WhatsApp {telefoneExibido}</a>}
                    {pizz.instagram && (
                      <a href={`https://instagram.com/${pizz.instagram.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "")}`} target="_blank" rel="noopener noreferrer">
                        Instagram {pizz.instagram.startsWith("@") ? pizz.instagram : `@${pizz.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "")}`}
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="fx-wrap">
                <div className="fx-footer-bottom">
                  <span>© {new Date().getFullYear()} {pizz.nome}</span>
                  <span>Cardápio digital por PizzaBot</span>
                </div>
              </div>
            </footer>

            {waUrl && (
              <a className={`fx-wa-float ${cartCount > 0 ? "is-raised" : ""} ${bagOpen && cartCount > 0 ? "is-hidden-mob" : ""}`} href={waUrl} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
                <IcoWhatsFlutuante />
              </a>
            )}
          </div>
        )}

            {accountOpen && (
              <div className="cdp-account-overlay" onClick={() => setAccountOpen(false)}>
                <section className="cdp-account-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Minha conta">
                  <button className="cdp-account-close" onClick={() => setAccountOpen(false)} aria-label="Fechar">×</button>
                  <header className="cdp-account-head">
                    <small>MINHA CONTA</small>
                    <h2>{customer ? `Olá, ${customer.nome.split(" ")[0]}` : "Acesse sua conta"}</h2>
                    <p>{customer ? "Acompanhe seus pedidos e peça seus favoritos novamente." : "Entre para ter histórico, acompanhamento rápido e recompra em poucos cliques."}</p>
                  </header>

                  {!customer ? (
                    <>
                      <div className="cdp-account-tabs" role="tablist">
                        <button type="button" className={accountTab === "login" ? "active" : ""} onClick={() => { setAccountTab("login"); setAccountError(null); }}>Entrar</button>
                        <button type="button" className={accountTab === "register" ? "active" : ""} onClick={() => { setAccountTab("register"); setAccountError(null); }}>Fazer cadastro</button>
                      </div>
                      <form className="cdp-account-form" onSubmit={submitCustomerAccount}>
                        {accountTab === "register" && (
                          <div className="cdp-account-form-row">
                            <label><span>Nome</span><input required minLength={2} autoComplete="name" value={accountForm.nome} onChange={(e) => setAccountForm((form) => ({ ...form, nome: e.target.value }))} placeholder="Como podemos chamar você?" /></label>
                            <label><span>WhatsApp</span><input required minLength={10} inputMode="tel" autoComplete="tel" value={accountForm.telefone} onChange={(e) => setAccountForm((form) => ({ ...form, telefone: e.target.value }))} placeholder="(11) 99999-9999" /></label>
                          </div>
                        )}
                        <label><span>E-mail</span><input required type="email" autoComplete="email" value={accountForm.email} onChange={(e) => setAccountForm((form) => ({ ...form, email: e.target.value }))} placeholder="voce@email.com" /></label>
                        <label><span>Senha</span><input required type="password" minLength={10} autoComplete={accountTab === "register" ? "new-password" : "current-password"} value={accountForm.senha} onChange={(e) => setAccountForm((form) => ({ ...form, senha: e.target.value }))} placeholder="Mínimo de 10 caracteres" /></label>
                        {accountError && <div className="cdp-account-error">{accountError}</div>}
                        <button className="cdp-account-submit" disabled={accountLoading}>{accountLoading ? "Aguarde..." : accountTab === "register" ? "Criar minha conta" : "Entrar"}</button>
                        <p className="cdp-account-privacy">Seus dados ficam vinculados somente a esta loja e são usados para seus pedidos.</p>
                      </form>
                    </>
                  ) : (
                    <div className="cdp-account-dashboard">
                      <div className="cdp-account-profile">
                        <span>{customer.nome.slice(0, 1).toUpperCase()}</span>
                        <div><strong>{customer.nome}</strong><small>{customer.email} · {customer.telefone}</small></div>
                        <button onClick={logoutCustomer}>Sair</button>
                      </div>
                      <section className="cdp-account-settings">
                        <header>
                          <div><small>SEUS DADOS</small><h3>Perfil e entrega</h3></div>
                          <button type="button" onClick={accountEditOpen ? fecharEdicaoConta : abrirEdicaoConta}>{accountEditOpen ? "Fechar" : "Editar dados"}</button>
                        </header>
                        {!accountEditOpen ? (
                          <div className="cdp-account-address-summary">
                            <span>ENDERECO SALVO</span>
                            <strong>{customer.endereco?.rua ? customer.endereco.rua + ", " + customer.endereco.numero + " - " + customer.endereco.bairro : "Cadastre seu endereco para pedir mais rapido."}</strong>
                            {customer.endereco?.cep && <small>CEP {customer.endereco.cep} {customer.endereco.complemento ? "- " + customer.endereco.complemento : ""}</small>}
                          </div>
                        ) : (
                          <form className="cdp-account-edit-form" onSubmit={salvarDadosConta}>
                            <div className="cdp-account-form-row">
                              <label><span>Nome</span><input required minLength={2} value={accountEditForm.nome} onChange={(e) => setAccountEditForm((form) => ({ ...form, nome: e.target.value }))} /></label>
                              <label><span>WhatsApp</span><input required minLength={10} inputMode="tel" value={accountEditForm.telefone} onChange={(e) => setAccountEditForm((form) => ({ ...form, telefone: e.target.value }))} /></label>
                            </div>
                            <label><span>E-mail</span><input required type="email" value={accountEditForm.email} onChange={(e) => setAccountEditForm((form) => ({ ...form, email: e.target.value }))} /></label>
                            <div className="cdp-account-form-row">
                              <label><span>CEP</span><input required inputMode="numeric" maxLength={9} value={accountEditForm.cep} onChange={(e) => setAccountEditForm((form) => ({ ...form, cep: e.target.value }))} placeholder="00000-000" /></label>
                              <label><span>Bairro</span><input required minLength={2} value={accountEditForm.bairro} onChange={(e) => setAccountEditForm((form) => ({ ...form, bairro: e.target.value }))} /></label>
                            </div>
                            <div className="cdp-account-form-row">
                              <label><span>Rua / Avenida</span><input required minLength={2} value={accountEditForm.rua} onChange={(e) => setAccountEditForm((form) => ({ ...form, rua: e.target.value }))} /></label>
                              <label><span>Numero</span><input required value={accountEditForm.numero} onChange={(e) => setAccountEditForm((form) => ({ ...form, numero: e.target.value }))} /></label>
                            </div>
                            <div className="cdp-account-form-row">
                              <label><span>Complemento</span><input value={accountEditForm.complemento} onChange={(e) => setAccountEditForm((form) => ({ ...form, complemento: e.target.value }))} placeholder="Apto, bloco, casa..." /></label>
                              <label><span>Referencia</span><input value={accountEditForm.referencia} onChange={(e) => setAccountEditForm((form) => ({ ...form, referencia: e.target.value }))} placeholder="Opcional" /></label>
                            </div>
                            {accountEditError && <div className="cdp-account-error">{accountEditError}</div>}
                            <button className="cdp-account-submit" disabled={accountEditSaving}>{accountEditSaving ? "Salvando..." : "Salvar dados e endereco"}</button>
                          </form>
                        )}
                      </section>

                      <div className="cdp-account-stats">
                        <div><strong>{customerOrders.length}</strong><small>pedidos recentes</small></div>
                        <div><strong>{customerOrders.filter((order) => order.em_andamento).length}</strong><small>em andamento</small></div>
                        <div><strong>{fmt(customer.total_gasto || customerOrders.reduce((sum, order) => sum + order.valor_total, 0))}</strong><small>em pedidos</small></div>
                      </div>
                      <section className="cdp-account-orders">
                        <header><div><small>SEUS PEDIDOS</small><h3>Histórico e acompanhamento</h3></div></header>
                        {accountLoading ? <div className="cdp-account-empty">Carregando seus pedidos...</div> : customerOrders.length === 0 ? (
                          <div className="cdp-account-empty"><span>⌁</span><strong>Seu histórico começa aqui</strong><p>Depois do primeiro pedido, você poderá acompanhar e repetir por esta área.</p></div>
                        ) : customerOrders.map((order) => (
                          <article key={order.id} className={order.em_andamento ? "active" : ""}>
                            <div className="cdp-account-order-top">
                              <div><strong>Pedido #{order.numero_pedido}</strong><small>{new Date(order.criado_em).toLocaleDateString("pt-BR")} · {order.itens.reduce((sum, item) => sum + item.quantidade, 0)} itens</small></div>
                              <span className={order.status === "cancelado" ? "cancelled" : order.em_andamento ? "live" : ""}>{order.status_label}</span>
                            </div>
                            <p>{order.itens.slice(0, 3).map((item) => `${item.quantidade}× ${item.nome}`).join(" · ")}{order.itens.length > 3 ? " · ..." : ""}</p>
                            <div className="cdp-account-order-bottom">
                              <strong>{fmt(order.valor_total)}</strong>
                              <div>
                                <button onClick={() => trackCustomerOrder(order)}>Acompanhar</button>
                                <button className="primary" disabled={repeatingOrderId === order.id} onClick={() => repeatCustomerOrder(order)}>{repeatingOrderId === order.id ? "Carregando..." : "Pedir novamente"}</button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </section>
                      {accountError && <div className="cdp-account-error">{accountError}</div>}
                    </div>
                  )}
                </section>
              </div>
            )}

            {trackingOpen && (
              <div className="cdp-tracking-overlay" onClick={() => setTrackingOpen(false)}>
                <section className="cdp-tracking-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Acompanhar pedido">
                  <header className="cdp-tracking-head">
                    <div><small>ATUALIZAÇÃO EM TEMPO REAL</small><h2>Acompanhar pedido</h2><p>Use o número do pedido e o mesmo telefone informado na compra.</p></div>
                    <button onClick={() => setTrackingOpen(false)} aria-label="Fechar">×</button>
                  </header>
                  <div className="cdp-tracking-form">
                    <label><span>Número do pedido</span><input type="number" min="1" value={trackingForm.numero} onChange={(e) => setTrackingForm((f) => ({ ...f, numero: e.target.value }))} placeholder="Ex: 154" /></label>
                    <label><span>Telefone com DDD</span><input type="tel" value={trackingForm.telefone} onChange={(e) => setTrackingForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="(11) 99999-9999" /></label>
                    <button onClick={consultarPedido} disabled={trackingLoading}>{trackingLoading ? "Consultando..." : "Ver andamento"}</button>
                  </div>
                  {trackingError && <div className="cdp-tracking-error">{trackingError}</div>}
                  {tracking && (
                    <div className="cdp-tracking-result">
                      <div className="cdp-tracking-summary">
                        <div><small>PEDIDO</small><strong>#{tracking.numero_pedido}</strong></div>
                        <div><small>PREVISÃO</small><strong>{tracking.tempo_estimado}</strong></div>
                        <span className={tracking.status === "cancelado" ? "cancelled" : "live"}>{tracking.status === "cancelado" ? "Cancelado" : "Em andamento"}</span>
                      </div>
                      {tracking.status === "cancelado" ? (
                        <div className="cdp-tracking-cancelled"><strong>Este pedido foi cancelado</strong><p>Entre em contato com a loja se precisar de ajuda.</p></div>
                      ) : (
                        <div className="cdp-tracking-timeline">
                          {trackingSteps.map((item, index) => {
                            const done = index <= trackingIndex;
                            const current = index === trackingIndex && tracking.status !== "entregue";
                            return (
                              <div key={item.key} className={`cdp-tracking-step ${done ? "done" : ""} ${current ? "current" : ""}`}>
                                <span className="cdp-tracking-dot">{done ? "✓" : index + 1}</span>
                                <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <p className="cdp-tracking-refresh">Atualizamos automaticamente a cada 20 segundos.</p>
                    </div>
                  )}
                  {!tracking && !trackingError && <div className="cdp-tracking-empty"><span>⌖</span><strong>Seu pedido, etapa por etapa</strong><p>Consulte para saber quando está em preparo, pronto ou a caminho.</p></div>}
                </section>
              </div>
            )}
            {/* ===== SELETOR RÁPIDO DE TAMANHO (clique no "+") ===== */}
            {quickPick && (
              <div className="cdp-quickpick-overlay" onClick={() => setQuickPick(null)}>
                <div className="cdp-quickpick" onClick={e => e.stopPropagation()}>
                  <div className="cdp-quickpick-head">
                    <span>Escolha o tamanho</span>
                    <button className="cdp-quickpick-close" onClick={() => setQuickPick(null)}>✕</button>
                  </div>
                  <p className="cdp-quickpick-prod">{quickPick.nome}</p>
                  <div className="cdp-quickpick-list">
                    {(quickPick.tamanhos || []).map(t => (
                      <button key={t.tamanho} className="cdp-quickpick-opt"
                        onClick={(e) => { animateProductToCart(e.currentTarget, quickPick); addToCart(quickPick, t.tamanho, Number(t.preco), 1, "", []); setQuickPick(null); }}>
                        <span className="cdp-quickpick-opt-name">{t.tamanho}</span>
                        <span className="cdp-quickpick-opt-price">{fmt(Number(t.preco))}</span>
                      </button>
                    ))}
                  </div>
                  <button className="cdp-quickpick-more"
                    onClick={() => { const p = quickPick; setQuickPick(null); openProduto(p); }}>
                    Mais opções (adicionais, observação) →
                  </button>
                </div>
              </div>
            )}
      </div>
    </div>
  );
}

// ============================================
// Indicador de etapas: Sacola → Dados → Pronto
const STEP_ORDER = ["carrinho", "checkout", "confirmacao"] as const;
const STEP_LABELS: Record<string, string> = { carrinho: "Sacola", checkout: "Dados", confirmacao: "Pronto" };

function Stepper({ current }: { current: "carrinho" | "checkout" }) {
  const curIdx = STEP_ORDER.indexOf(current);
  return (
    <div className="cdp-stepper">
      {STEP_ORDER.map((key, i) => {
        const state = i < curIdx ? "done" : i === curIdx ? "active" : "";
        return (
          <React.Fragment key={key}>
            {i > 0 && <span className="cdp-stepper-bar" />}
            <div className={`cdp-stepper-item ${state}`}>
              <span className="cdp-stepper-dot">{i < curIdx ? "✓" : i + 1}</span>
              <span className="cdp-stepper-label">{STEP_LABELS[key]}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
