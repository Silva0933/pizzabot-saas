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
import "../../styles/cardapio-publico.css";

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
}

type Step = "menu" | "produto" | "carrinho" | "checkout" | "confirmacao";

// ============================================
// Constantes de estilo
// ============================================
const CAT_EMOJI: Record<string, string> = {
  pizza: "🍕", lanche: "🍔", bebida: "🥤", sobremesa: "🍰", outro: "🍽️",
};

const CAT_COLOR: Record<string, string> = {
  pizza: "#f97316", lanche: "#eab308", bebida: "#3b82f6", sobremesa: "#ec4899", outro: "#8b5cf6", todos: "#f97316",
};

const THEME_DEFAULTS: Record<string, TemaCardapioConfig> = {
  brasa: { modelo: "brasa", fonte_titulo: "anton", fonte_texto: "inter", cor_primaria: "#f26b21", cor_secundaria: "#ff4d22", cor_fundo: "#090907", bordas: "suaves" },
  trattoria: { modelo: "trattoria", fonte_titulo: "playfair", fonte_texto: "nunito", cor_primaria: "#a52a2a", cor_secundaria: "#d39b45", cor_fundo: "#f5ecdf", bordas: "suaves" },
  metropole: { modelo: "metropole", fonte_titulo: "outfit", fonte_texto: "montserrat", cor_primaria: "#b7f34a", cor_secundaria: "#7c5cff", cor_fundo: "#0b1020", bordas: "arredondadas" },
};
const THEME_TITLE_FONTS: Record<string, string> = {
  anton: '"Anton SC", Impact, sans-serif', bebas: '"Bebas Neue", Impact, sans-serif',
  playfair: '"Playfair Display", Georgia, serif', outfit: '"Outfit", Inter, sans-serif',
};
const THEME_BODY_FONTS: Record<string, string> = {
  inter: 'Inter, Arial, sans-serif', montserrat: 'Montserrat, Arial, sans-serif',
  nunito: 'Nunito, Arial, sans-serif', outfit: 'Outfit, Arial, sans-serif',
};
const THEME_RADII: Record<string, string> = { retas: "4px", suaves: "14px", arredondadas: "28px" };

function resolveTheme(raw?: TemaCardapioConfig | null): TemaCardapioConfig {
  const modelo = raw?.modelo && THEME_DEFAULTS[raw.modelo] ? raw.modelo : "brasa";
  return {
    ...THEME_DEFAULTS[modelo],
    chamada: "FEITO NA HORA. DO SEU JEITO.",
    titulo: "O SABOR QUE|ACENDE A FOME.",
    descricao: "Escolha seus favoritos, personalize o pedido e receba tudo quentinho onde estiver.",
    ...(raw || {}),
    modelo,
  };
}

// ============================================
// Componente Principal
// ============================================
function mapEmbedUrl(pizzaria: MenuPizzaria) {
  const rawUrl = pizzaria.endereco_maps_url || "";
  const coords = rawUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    || rawUrl.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  let query = coords ? `${coords[1]},${coords[2]}` : "";

  if (!query && rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const urlQuery = parsed.searchParams.get("query") || parsed.searchParams.get("q");
      const placePath = parsed.pathname.match(/\/place\/([^/]+)/);
      query = urlQuery
        || (placePath ? decodeURIComponent(placePath[1].replace(/\+/g, " ")) : "");
    } catch {
      // Links curtos ou incompletos usam o endereco cadastrado como alternativa.
    }
  }

  query ||= pizzaria.endereco || pizzaria.nome;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`;
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
  const [sacolaOpen, setSacolaOpen] = useState(false);
  // Seletor rápido de tamanho ao clicar no "+" (sem entrar no produto).
  const [quickPick, setQuickPick] = useState<MenuProduto | null>(null);
  const cartTargetRef = useRef<HTMLButtonElement>(null);
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



  // Modal de produto
  const [modalTamanho, setModalTamanho] = useState<string | null>(null);
  const [modalObs, setModalObs] = useState("");
  const [modalAdicionais, setModalAdicionais] = useState<string[]>([]);
  const [modalQtd, setModalQtd] = useState(1);

  // ---- Load ----
  useEffect(() => {
    let active = true;
    setLoading(true);
    menuApi.getBySlug(slug)
      .then((menu) => { if (active) { setData(menu); setError(null); } })
      .catch((e: ApiError) => { if (active) setError(e.message || "Cardápio não encontrado"); })
      .finally(() => { if (active) setLoading(false); });

    // Atualiza o aviso quando o proprietário abre/fecha a loja no painel.
    const refreshTimer = window.setInterval(() => {
      menuApi.getBySlug(slug)
        .then((menu) => { if (active) setData(menu); })
        .catch(() => { /* mantém a última versão válida em falhas transitórias */ });
    }, 30_000);

    return () => {
      active = false;
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
        setCheckoutForm((form) => ({
          ...form,
          nome: conta.nome || form.nome,
          telefone: conta.telefone || form.telefone,
        }));
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

  const taxaEntrega = useMemo(() => {
    if (!data || checkoutForm.tipo !== "delivery") return 0;
    const p = data.pizzaria;
    if (checkoutForm.bairro && p.taxas_bairro?.length) {
      const match = p.taxas_bairro.find(
        tb => tb.bairro.toLowerCase().trim() === checkoutForm.bairro.toLowerCase().trim()
      );
      if (match) return match.taxa;
    }
    return p.taxa_entrega_fixa || 0;
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

  useEffect(() => {
    if (!trackingOpen || !tracking || !trackingForm.numero || !trackingForm.telefone) return;
    const timer = window.setInterval(() => {
      menuApi.trackOrder(slug, Number(trackingForm.numero), trackingForm.telefone)
        .then(setTracking)
        .catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [trackingOpen, tracking, trackingForm.numero, trackingForm.telefone, slug]);


  function addToCart(produto: MenuProduto, tamanho: string | null, preco: number, qtd: number, obs: string, adicionais: string[]) {
    if (!data?.pizzaria.aberto) return;
    const key = `${produto.id}-${tamanho || "unico"}`;
    setCart(prev => {
      const existing = prev.find(i => i.id === key && i.observacao === obs);
      if (existing) {
        return prev.map(i => i === existing ? { ...i, quantidade: i.quantidade + qtd } : i);
      }
      return [...prev, {
        id: key, produtoId: produto.id, nome: produto.nome,
        tamanho, preco, quantidade: qtd, observacao: obs, adicionais,
        imgUrl: produto.imagem_url || undefined,
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
    const target = cartTargetRef.current;
    if (!target) return;
    const card = origin.closest(".cdp-product-card");
    const visual = card?.querySelector(".cdp-product-img, .cdp-product-img-ph") as HTMLElement | null;
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
      setCheckoutForm((form) => ({ ...form, nome: auth.cliente.nome || form.nome, telefone: auth.cliente.telefone || form.telefone }));
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

  async function repeatCustomerOrder(order: ClientePedidoConta) {
    if (!accountToken || repeatingOrderId) return;
    setRepeatingOrderId(order.id);
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
      setSacolaOpen(true);
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
    setStep("produto");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function confirmAddToCart() {
    if (!selectedProduto || !data?.pizzaria.aberto) return;
    const p = selectedProduto;
    let preco = Number(p.preco);
    if (p.tamanhos && modalTamanho) {
      const t = p.tamanhos.find(t => t.tamanho === modalTamanho);
      if (t) preco = Number(t.preco);
    }
    const adicionaisInfo = data?.pizzaria.adicionais || [];
    let precoAdicionais = 0;
    for (const a of modalAdicionais) {
      const info = adicionaisInfo.find(ai => ai.nome === a);
      if (info) precoAdicionais += info.preco;
    }
    addToCart(p, modalTamanho, preco + precoAdicionais, modalQtd, modalObs, modalAdicionais);
    setStep("menu");
    setSelectedProduto(null);
  }

  // ---- Submit pedido ----
  async function submitPedido() {
    if (!data) return;
    if (!data.pizzaria.aberto) {
      setSubmitError("A pizzaria está fechada no momento e não está recebendo novos pedidos.");
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
      setSubmitError(e.message || "Erro ao enviar pedido");
    }
    setSubmitting(false);
  }

  // Adicionais e preços calculados de forma segura para o passo de produto
  const { precoAtual, precoAdicionais, precoTotal, adicionaisDisp } = useMemo(() => {
    if (!selectedProduto || !data) return { precoAtual: 0, precoAdicionais: 0, precoTotal: 0, adicionaisDisp: [] };
    const p = selectedProduto;
    let precoAt = Number(p.preco);
    if (p.tamanhos && modalTamanho) {
      const t = p.tamanhos.find(t => t.tamanho === modalTamanho);
      if (t) precoAt = Number(t.preco);
    }
    const adsp = data.pizzaria.adicionais || [];
    let precoAds = 0;
    for (const a of modalAdicionais) {
      const info = adsp.find(ai => ai.nome === a);
      if (info) precoAds += info.preco;
    }
    return {
      precoAtual: precoAt,
      precoAdicionais: precoAds,
      precoTotal: (precoAt + precoAds) * modalQtd,
      adicionaisDisp: adsp
    };
  }, [selectedProduto, modalTamanho, modalAdicionais, modalQtd, data]);

  // ============================================
  // Renders
  // ============================================
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
  const tema = resolveTheme(pizz.tema_cardapio);
  const tituloTema = String(tema.titulo || "O SABOR QUE|ACENDE A FOME.").split("|");
  const themeStyle = {
    "--accent": tema.cor_primaria,
    "--accent2": tema.cor_secundaria,
    "--bg": tema.cor_fundo,
    "--bg2": tema.cor_superficie,
    "--text": tema.cor_texto,
    "--button": tema.cor_botao || tema.cor_primaria,
    "--button-text": tema.cor_botao_texto,
    "--theme-display": THEME_TITLE_FONTS[tema.fonte_titulo || "anton"],
    "--theme-body": THEME_BODY_FONTS[tema.fonte_texto || "inter"],
    "--theme-radius": THEME_RADII[tema.bordas || "suaves"],
  } as React.CSSProperties;
  const embedMapUrl = mapEmbedUrl(pizz);
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


  // Card de produto reutilizado pela grade plana e pelas seções por categoria.
  function renderProduct(p: MenuProduto) {
    const preco = p.tamanhos && p.tamanhos.length > 0
      ? Math.min(...p.tamanhos.map(t => Number(t.preco)))
      : Number(p.preco);
    const temVariacao = p.tamanhos && p.tamanhos.length > 0;
    return (
      <button key={p.id} className="cdp-product-card" onClick={() => openProduto(p)}>
        <div className="cdp-product-img-wrap">
          {p.imagem_url ? (
            <img src={p.imagem_url} alt={p.nome} className="cdp-product-img" loading="lazy" />
          ) : (
            <div className="cdp-product-img-ph">
              <span>{CAT_EMOJI[p.categoria || "outro"] || "🍽️"}</span>
            </div>
          )}
          {p.categoria && (
            <span className="cdp-product-cat-tag">{CAT_EMOJI[p.categoria] || "🍽️"}</span>
          )}
        </div>
        <div className="cdp-product-info">
          <h3 className="cdp-product-name">{p.nome}</h3>
          {p.descricao && <p className="cdp-product-desc">{p.descricao}</p>}
          <div className="cdp-product-footer">
            <div className="cdp-product-price-wrap">
              {temVariacao && <span className="cdp-price-from">a partir de</span>}
              <span className="cdp-price">{fmt(preco)}</span>
            </div>
            <div
              className={`cdp-product-add-btn ${!pizz.aberto ? "disabled" : ""}`}
              role="button"
              aria-label={pizz.aberto ? "Adicionar" : "Loja fechada"}
              aria-disabled={!pizz.aberto}
              onClick={(e) => handleQuickAdd(e, p)}
            >{pizz.aberto ? "+" : "—"}</div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className={`cdp-root cdp-theme-${tema.modelo || "brasa"} cdp-radius-${tema.bordas || "suaves"} cdp-cards-${tema.estilo_cartoes || "elevado"} cdp-btn-${tema.estilo_botao || "gradiente"}`} style={themeStyle}>
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
              <button className="cdp-topbar-back" onClick={() => { setStep("menu"); setSacolaOpen(true); }}>
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
                        <input placeholder="Seu bairro" value={checkoutForm.bairro}
                          onChange={e => setCheckoutForm({ ...checkoutForm, bairro: e.target.value })} className="cdp-input" />
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

              <button
                className="cdp-btn-primary cdp-btn-lg cdp-btn-submit"
                disabled={!pizz.aberto || submitting || !checkoutForm.nome || !telValido || !checkoutForm.pagamento || (checkoutForm.tipo === "delivery" && !checkoutForm.rua)}
                onClick={submitPedido}
              >
                {submitting ? (
                  <span className="cdp-btn-loading">
                    <span className="cdp-mini-spinner" /> Enviando...
                  </span>
                ) : `✅ Confirmar Pedido • ${fmt(totalEstimado)}`}
              </button>
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
                    <button className="cdp-btn-primary cdp-btn-lg" disabled={!pizz.aberto} onClick={() => setStep("checkout")}>
                      {pizz.aberto ? `Continuar • ${fmt(cartTotal)}` : "Loja fechada"}
                    </button>
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
                <h1 className="cdp-produto-hero-title">{selectedProduto.nome}</h1>
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

              {/* Tamanhos */}
              {selectedProduto.tamanhos && selectedProduto.tamanhos.length > 0 && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>Escolha o tamanho</h3>
                    <span className="cdp-badge cdp-badge-required">Obrigatório</span>
                  </div>
                  <div className="cdp-tamanho-list">
                    {selectedProduto.tamanhos.map(t => (
                      <button
                        key={t.tamanho}
                        className={`cdp-tamanho-btn ${modalTamanho === t.tamanho ? "active" : ""}`}
                        onClick={() => setModalTamanho(t.tamanho)}
                      >
                        <div className="cdp-tamanho-left">
                          <span className={`cdp-radio ${modalTamanho === t.tamanho ? "active" : ""}`} />
                          <span className="cdp-tamanho-name">{t.tamanho}</span>
                        </div>
                        <span className="cdp-tamanho-price">{fmt(t.preco)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Adicionais */}
              {adicionaisDisp.length > 0 && (selectedProduto.categoria === "pizza" || selectedProduto.categoria === "lanche") && (
                <div className="cdp-produto-section">
                  <div className="cdp-produto-section-header">
                    <h3>Adicionais</h3>
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
              <button className="cdp-btn-primary cdp-btn-add" disabled={!pizz.aberto} onClick={confirmAddToCart}>
                {pizz.aberto ? `Adicionar • ${fmt(precoTotal)}` : "Loja fechada"}
              </button>
            </div>
          </>

        ) : (
          /* ===== MENU PRINCIPAL ===== */
          <>
            {/* Banner hero da pizzaria */}
            <div className="cdp-offerbar">
              <span>Pedido direto, atendimento mais rápido</span>
              <strong>
                {pizz.aberto && <span className="cdp-kitchen-live-dot" aria-hidden="true"><i /></span>}
                {pizz.aberto ? "Cozinha aberta agora" : "Confira nosso cardápio"}
              </strong>
            </div>

            <nav className="cdp-site-header" aria-label="Navegação do cardápio">
              <button className="cdp-site-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                {pizz.logo_url ? <img src={pizz.logo_url} alt="" /> : <span>{CAT_EMOJI.pizza}</span>}
                <span><strong>{pizz.nome}</strong><small>Cardápio digital</small></span>
              </button>
              <div className="cdp-site-links">
                <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Início</button>
                <button onClick={() => document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" })}>Cardápio</button>
                {campanhasAtivas.length > 0 && <button onClick={() => document.getElementById("promocoes")?.scrollIntoView({ behavior: "smooth" })}>Promoções</button>}
                {pizz.endereco_maps_url && <a href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer">Nossa localização</a>}
                <button onClick={() => document.getElementById("como-pedir")?.scrollIntoView({ behavior: "smooth" })}>Como pedir</button>
              </div>
              <div className="cdp-site-actions">
                {pizz.endereco_maps_url && (
                  <a className="cdp-header-location" href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer" aria-label="Abrir nossa localização">
                    <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                    <span>Localização</span>
                  </a>
                )}
                {tema.mostrar_acompanhamento !== false && (
                  <button className="cdp-header-track" onClick={() => setTrackingOpen(true)}>
                    <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                    <span>Acompanhar pedido</span>
                  </button>
                )}
                {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" className="cdp-header-contact">Atendimento</a>}
                <button className="cdp-header-cart" onClick={() => setSacolaOpen(true)}>
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>
                  <span>Sacola</span><b>{cartCount}</b>
                </button>
                <button className={`cdp-header-account ${customer ? "connected" : ""}`} onClick={() => setAccountOpen(true)} aria-label="Minha conta">
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>
                  <span>{customer ? customer.nome.split(" ")[0] : "Minha conta"}</span>
                  {customer && <i aria-hidden="true" />}
                </button>
              </div>
            </nav>

            {!pizz.aberto && (
              <div className="cdp-closed-notice" role="status">
                <span>🔒</span>
                <div>
                  <strong>Pedidos pausados no momento</strong>
                  <small>Você pode consultar o cardápio, mas novos pedidos estão temporariamente bloqueados.</small>
                </div>
              </div>
            )}

            <header className="cdp-banner">
              {pizz.banner_url ? (
                <img src={pizz.banner_url} alt="" className="cdp-banner-img" />
              ) : pizz.logo_url ? (
                <div className="cdp-banner-img cdp-banner-img-blur" style={{ backgroundImage: `url(${pizz.logo_url})` }} />
              ) : (
                <div className="cdp-banner-img cdp-banner-fallback" />
              )}
              <div className="cdp-banner-scrim" />

              <div className="cdp-banner-content">
                {pizz.logo_url ? (
                  <div className="cdp-logo-ring">
                    <img src={pizz.logo_url} alt={pizz.nome} className="cdp-logo" />
                  </div>
                ) : (
                  <div className="cdp-logo-placeholder">🍕</div>
                )}
                <div className="cdp-banner-info">
                  <p className="cdp-hero-eyebrow">{tema.chamada}</p>
                  <h1 className="cdp-name">{tituloTema[0]}{tituloTema.length > 1 && <><br/><em>{tituloTema.slice(1).join(" ")}</em></>}</h1>
                  <p className="cdp-hero-description">
                    {tema.descricao}
                  </p>
                  <div className="cdp-hero-ctas">
                    <button className="cdp-hero-primary" onClick={() => document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" })}>
                      Ver cardápio <span>→</span>
                    </button>
                    {pizz.endereco_maps_url && (
                      <a className="cdp-hero-secondary" href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer">
                        Como chegar
                      </a>
                    )}
                  </div>
                  {cuponsAtivos[0] && (
                    <button className="cdp-hero-coupon" onClick={() => { setCupomInput(cuponsAtivos[0].codigo); setCupomAplicado(cuponsAtivos[0].codigo.toUpperCase()); document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" }); }}>
                      <small>USE O CUPOM</small>
                      <b>{cuponsAtivos[0].codigo}</b>
                      <span>{cuponsAtivos[0].descricao || (cuponsAtivos[0].tipo === "percentual" ? `${cuponsAtivos[0].valor}% OFF` : `${fmt(cuponsAtivos[0].valor)} OFF`)}</span>
                    </button>
                  )}
                  <div className="cdp-status-row">
                    <span className={`cdp-status-pill ${pizz.aberto ? "open" : "closed"}`}>
                      <span className={`cdp-status-dot ${pizz.aberto ? "open" : "closed"}`} />
                      {pizz.aberto ? "Aberto agora" : "Fechado"}
                    </span>
                    {pizz.tempo_entrega_min && pizz.tempo_entrega_max && (
                      <span className="cdp-tempo-pill">
                        🕐 {pizz.tempo_entrega_min}–{pizz.tempo_entrega_max} min
                      </span>
                    )}
                  </div>
                  {pizz.endereco && <p className="cdp-endereco">📍 {pizz.endereco}</p>}

                  {/* Ações: WhatsApp + Como chegar */}
                  {(waUrl || pizz.endereco_maps_url) && (
                    <div className="cdp-banner-actions">
                      {waUrl && (
                        <a className="cdp-action-btn cdp-action-wpp" href={waUrl} target="_blank" rel="noopener noreferrer">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-1 .9-1.2 2-.7 3.3.6 1.5 1.6 2.9 2.9 4.1 2 1.9 3.7 2.5 5.2 2.9 1.3.3 2.1.2 2.7-.1.4-.2 1.2-.9 1.4-1.4.2-.5.2-1 .1-1.1 0-.1-.2-.2-.5-.4zM12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2z"/></svg>
                          Falar no WhatsApp
                        </a>
                      )}
                      {pizz.endereco_maps_url && (
                        <a className="cdp-action-btn cdp-action-map" href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          Como chegar
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </header>

            <section className="cdp-trust-strip" aria-label="Diferenciais">
              <div><span>◷</span><strong>{pizz.tempo_entrega_min && pizz.tempo_entrega_max ? `${pizz.tempo_entrega_min}–${pizz.tempo_entrega_max} min` : "Entrega rápida"}</strong><small>Tempo estimado</small></div>
              <div><span>🔥</span><strong>Feito na hora</strong><small>Mais sabor no seu pedido</small></div>
              <div><span>✦</span><strong>Personalizável</strong><small>Escolha tamanhos e adicionais</small></div>
              <div><span>⌖</span><strong>{pizz.endereco ? "Retirada disponível" : "Pedido online"}</strong><small>Prático do início ao fim</small></div>
            </section>

            {/* ===== LAYOUT BODY (sidebar + main) ===== */}
            <div className="cdp-menu-body" id="cardapio">

              {/* Sidebar esquerda (desktop) / inline (mobile) */}
              <aside className="cdp-sidebar">
                {/* Busca */}
                <div className="cdp-search-wrap cdp-search-sidebar">
                  <span className="cdp-search-icon">
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Buscar no cardápio..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="cdp-search"
                  />
                  {searchQuery && (
                    <button className="cdp-search-clear" onClick={() => setSearchQuery("")}>✕</button>
                  )}
                </div>

                {/* Categorias */}
                <nav className="cdp-cats">
                  {categorias.map(cat => (
                    <button
                      key={cat}
                      className={`cdp-cat-btn ${selectedCat === cat ? "active" : ""}`}
                      onClick={() => setSelectedCat(cat)}
                      style={selectedCat === cat ? { "--cat-color": CAT_COLOR[cat] || "#f97316" } as any : {}}
                    >
                      <span className="cdp-cat-emoji-wrap" style={{ background: selectedCat === cat ? (CAT_COLOR[cat] || "#f97316") + "33" : "transparent" }}>
                        {CAT_EMOJI[cat] || "🍽️"}
                      </span>
                      <span>{cat === "todos" ? "Todos" : cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                    </button>
                  ))}
                </nav>

                {/* Botão de carrinho (desktop sidebar) */}
                {cartCount > 0 && (
                  <div className="cdp-sidebar-cart" onClick={() => setSacolaOpen(true)}>
                    <div className="cdp-sidebar-cart-header">
                      <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                      <span>Seu pedido</span>
                      <span className="cdp-sidebar-cart-count">{cartCount}</span>
                    </div>
                    {cart.slice(0, 3).map(item => (
                      <div key={item.id} className="cdp-sidebar-cart-item">
                        <span className="cdp-sidebar-cart-qty">{item.quantidade}×</span>
                        <span className="cdp-sidebar-cart-name">{item.nome}{item.tamanho ? ` (${item.tamanho})` : ""}</span>
                        <span className="cdp-sidebar-cart-price">{fmt(item.preco * item.quantidade)}</span>
                      </div>
                    ))}
                    {cart.length > 3 && (
                      <p className="cdp-sidebar-cart-more">+{cart.length - 3} mais...</p>
                    )}
                    <div className="cdp-sidebar-cart-total">
                      <span>Total</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    <div className="cdp-sidebar-cart-btn">Ver pedido completo →</div>
                  </div>
                )}
              </aside>

              {/* Área principal de produtos */}
              <main className="cdp-main-area">
                {/* Faixa de destaques (só em "Todos", sem busca) */}
                {selectedCat === "todos" && !searchQuery.trim() && data.produtos.length > 3 && (
                  <div className="cdp-destaques">
                    <div className="cdp-destaques-head">🔥 Destaques</div>
                    <div className="cdp-destaques-row">
                      {data.produtos.slice(0, 8).map(p => {
                        const preco = p.tamanhos && p.tamanhos.length > 0
                          ? Math.min(...p.tamanhos.map(t => Number(t.preco)))
                          : Number(p.preco);
                        return (
                          <button key={p.id} className="cdp-destaque-card" onClick={() => openProduto(p)}>
                            <div className="cdp-destaque-img">
                              {p.imagem_url
                                ? <img src={p.imagem_url} alt={p.nome} loading="lazy" />
                                : <span>{CAT_EMOJI[p.categoria || "outro"] || "🍽️"}</span>}
                            </div>
                            <div className="cdp-destaque-info">
                              <span className="cdp-destaque-name">{p.nome}</span>
                              <span className="cdp-destaque-price">{fmt(preco)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {produtosFiltrados.length === 0 ? (
                  <div className="cdp-empty">
                    <span>🔍</span>
                    <p>Nenhum produto encontrado</p>
                  </div>
                ) : selectedCat === "todos" && !searchQuery.trim() ? (
                  /* Menu completo, organizado em seções por categoria */
                  <div className="cdp-menu-sections">
                    {categorias.filter(c => c !== "todos").map(cat => {
                      const itens = data.produtos.filter(p => (p.categoria || "outro") === cat);
                      if (itens.length === 0) return null;
                      return (
                        <section key={cat} id={`cat-${cat}`} className="cdp-cat-section">
                          <div className="cdp-cat-section-head">
                            <span className="cdp-cat-section-emoji" style={{ background: (CAT_COLOR[cat] || "#f97316") + "26" }}>
                              {CAT_EMOJI[cat] || "🍽️"}
                            </span>
                            <h2 className="cdp-cat-section-title">
                              {cat === "outro" ? "Outros" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </h2>
                            <span className="cdp-cat-section-count">{itens.length}</span>
                          </div>
                          <div className="cdp-products">{itens.map(renderProduct)}</div>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="cdp-products">{produtosFiltrados.map(renderProduct)}</div>
                )}
              </main>
            </div>{/* fim cdp-menu-body */}

            {campanhasAtivas.length > 0 && (
              <section className="cdp-campaigns" id="promocoes">
                <header><p>OFERTAS DA CASA</p><h2>APROVEITE ANTES QUE ACABE</h2><span>Campanhas preparadas especialmente para você.</span></header>
                <div className="cdp-campaign-grid">
                  {campanhasAtivas.map((campanha, index) => (
                    <article key={campanha.id} className={index === 0 ? "featured" : ""}>
                      {campanha.imagem_url && <img src={campanha.imagem_url} alt="" loading="lazy" />}
                      <div className="cdp-campaign-scrim" />
                      <div className="cdp-campaign-content">
                        <small>{campanha.etiqueta || "OFERTA"}</small>
                        <h3>{campanha.titulo}</h3>
                        {campanha.subtitulo && <p>{campanha.subtitulo}</p>}
                        <button onClick={() => {
                          if (campanha.cupom_codigo) {
                            setCupomInput(campanha.cupom_codigo);
                            setCupomAplicado(campanha.cupom_codigo.toUpperCase());
                          }
                          document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" });
                        }}>{campanha.cta_label || "Escolher agora"} <span>→</span></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {campanhasAtivas.length === 0 && (
              <section className="cdp-promo-band">
                <div>
                  <p>PEÇA DO SEU JEITO</p>
                  <h2>SABOR DE VERDADE.<br/><em>SEM COMPLICAÇÃO.</em></h2>
                  <span>Monte seu pedido, escolha entrega ou retirada e acompanhe tudo pelo cardápio.</span>
                  <button className="cdp-hero-primary" onClick={() => document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth" })}>Escolher agora →</button>
                </div>
                <strong><small>PEDIDO</small><br/>DIRETO</strong>
              </section>
            )}

            <section className="cdp-order-steps" id="como-pedir">
              <header><p>SIMPLES COMO DEVE SER</p><h2>SEU PEDIDO EM 3 PASSOS</h2></header>
              <div>
                <article><small>01</small><i>☰</i><h3>ESCOLHA</h3><p>Navegue pelas categorias e encontre seus favoritos.</p></article>
                <article><small>02</small><i>＋</i><h3>PERSONALIZE</h3><p>Defina tamanho, adicionais e observações.</p></article>
                <article><small>03</small><i>⌖</i><h3>RECEBA</h3><p>Informe o endereço ou escolha retirada no local.</p></article>
              </div>
            </section>


            {pizz.endereco_maps_url && (
              <section className="cdp-location-section" id="localizacao">
                <div className="cdp-location-copy">
                  <p>VENHA NOS VISITAR</p>
                  <h2>NOSSA<br/><em>LOCALIZAÇÃO</em></h2>
                  <span>Abra a rota no Google Maps ou no aplicativo de navegação disponível no seu aparelho.</span>
                  <div className="cdp-location-address">
                    <svg width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                    <div><small>ENDEREÇO</small><strong>{pizz.endereco || "Veja o endereço completo no mapa"}</strong></div>
                  </div>
                  <a href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer" className="cdp-location-cta">
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18 3 21l3-6 8-8a2.8 2.8 0 0 1 4 4l-9 7Z"/><path d="m14 7 4 4"/></svg>
                    Abrir rota <span>→</span>
                  </a>
                </div>
                <div className="cdp-location-visual">
                  <iframe
                    className="cdp-map-embed"
                    src={embedMapUrl}
                    title={`Mapa de ${pizz.nome}`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <div className="cdp-map-place-card">
                    <span><svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span>
                    <div><small>LOCAL NO MAPA</small><b>{pizz.nome}</b></div>
                  </div>
                  <a className="cdp-map-open" href={pizz.endereco_maps_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${pizz.nome} no mapa`}>
                    <span>Abrir no mapa</span><svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>
                  </a>
                  <div className="cdp-map-grid" />
                  <div className="cdp-map-route" />
                  <div className="cdp-map-pin"><span>●</span><b>{pizz.nome}</b></div>
                  <small>TOQUE EM “ABRIR ROTA” PARA NAVEGAR</small>
                </div>
              </section>
            )}
            <section className="cdp-business-info">
              <div className="cdp-business-brand">
                {pizz.logo_url ? <img src={pizz.logo_url} alt="" /> : <span>{CAT_EMOJI.pizza}</span>}
                <div><strong>{pizz.nome}</strong><small>Feito com carinho, entregue com sabor.</small></div>
              </div>
              <div><small>ONDE ESTAMOS</small><strong>{pizz.endereco || "Consulte nossa área de atendimento"}</strong></div>
              <div><small>FALE COM A GENTE</small><strong>{pizz.telefone_contato || "Atendimento pelo pedido online"}</strong></div>
            </section>

            <footer className="cdp-site-footer">
              <span>© {new Date().getFullYear()} {pizz.nome}</span>
              <span>Cardápio digital • PizzaBot</span>
            </footer>

            <button
              ref={cartTargetRef}
              type="button"
              className={`cdp-cart-float ${cartPulse ? "pulse" : ""} ${cartCount > 0 ? "has-items" : ""}`}
              onClick={() => setSacolaOpen(true)}
              aria-label={`Abrir sacola, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
              title="Abrir sacola"
            >
              <svg width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>
              {cartCount > 0 && <b>{cartCount}</b>}
              <small>Sacola</small>
            </button>

            {waUrl && (
              <a className="cdp-whatsapp-float" href={waUrl} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
                <svg width="25" height="25" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-1 .9-1.2 2-.7 3.3.6 1.5 1.6 2.9 2.9 4.1 2 1.9 3.7 2.5 5.2 2.9 1.3.3 2.1.2 2.7-.1.4-.2 1.2-.9 1.4-1.4.2-.5.2-1 .1-1.1 0-.1-.2-.2-.5-.4zM12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2z"/></svg>
              </a>
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
            {/* Carrinho flutuante (mobile only) */}
            {cartCount > 0 && (

              <div className={`cdp-floating-cart ${cartPulse ? "pulse" : ""}`} onClick={() => setSacolaOpen(true)}>
                <div className="cdp-floating-cart-left">
                  <div className="cdp-floating-cart-badge">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                    <span className="cdp-floating-cart-count">{cartCount}</span>
                  </div>
                  <span className="cdp-floating-cart-label">Ver pedido</span>
                </div>
                <div className="cdp-floating-cart-right">
                  <span className="cdp-floating-cart-total">{fmt(cartTotal)}</span>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              </div>
            )}

            {/* ===== SACOLA DESLIZANTE ===== */}
            {sacolaOpen && (
              <div className="cdp-sacola-overlay" onClick={() => setSacolaOpen(false)}>
                <aside className="cdp-sacola" onClick={e => e.stopPropagation()}>
                  <div className="cdp-sacola-head">
                    <h2>🛍️ Minha sacola</h2>
                    <button className="cdp-sacola-close" onClick={() => setSacolaOpen(false)}>✕</button>
                  </div>

                  {cart.length === 0 ? (
                    <div className="cdp-sacola-empty">
                      <span>🛒</span>
                      <p>Sua sacola está vazia</p>
                      <button className="cdp-btn-secondary" onClick={() => setSacolaOpen(false)}>Ver cardápio</button>
                    </div>
                  ) : (
                    <>
                      <div className="cdp-sacola-items">
                        {cart.map(item => (
                          <div key={item.id} className="cdp-sacola-item">
                            {item.imgUrl
                              ? <img src={item.imgUrl} alt={item.nome} className="cdp-sacola-item-img" />
                              : <div className="cdp-sacola-item-ph">{CAT_EMOJI[selectedProduto?.categoria || "outro"] || "🍽️"}</div>}
                            <div className="cdp-sacola-item-body">
                              <div className="cdp-sacola-item-name">
                                {item.nome}{item.tamanho ? ` (${item.tamanho})` : ""}
                              </div>
                              {item.adicionais.length > 0 && (
                                <div className="cdp-sacola-item-extras">+ {item.adicionais.join(", ")}</div>
                              )}
                              <div className="cdp-qty-controls cdp-sacola-qty">
                                <button onClick={() => updateCartQty(item.id, -1)}>−</button>
                                <span>{item.quantidade}</span>
                                <button onClick={() => updateCartQty(item.id, 1)}>+</button>
                              </div>
                            </div>
                            <div className="cdp-sacola-item-right">
                              <span className="cdp-sacola-item-price">{fmt(item.preco * item.quantidade)}</span>
                              <button className="cdp-sacola-item-remove" onClick={() => removeFromCart(item.id)} aria-label="Remover">
                                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="cdp-sacola-footer">
                        <div className="cdp-sacola-subtotal">
                          <span>Subtotal</span>
                          <span className="cdp-sacola-subtotal-val">{fmt(cartTotal)}</span>
                        </div>
                        <button className="cdp-btn-primary cdp-btn-lg" disabled={!pizz.aberto} onClick={() => { setSacolaOpen(false); setStep("checkout"); }}>
                          {pizz.aberto ? `Continuar • ${fmt(cartTotal)}` : "Loja fechada"}
                        </button>
                        <button className="cdp-sacola-add-more" onClick={() => setSacolaOpen(false)}>
                          + Adicionar mais itens
                        </button>
                      </div>
                    </>
                  )}
                </aside>
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
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helpers
// ============================================
function fmt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Monta o link wa.me a partir do telefone de contato (normaliza DDI 55). */
function waLink(tel?: string | null): string {
  const d = (tel || "").replace(/\D/g, "");
  if (!d) return "";
  const full = d.startsWith("55") ? d : (d.length === 10 || d.length === 11 ? "55" + d : d);
  return `https://wa.me/${full}`;
}

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
