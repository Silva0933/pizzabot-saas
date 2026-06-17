/**
 * CardapioPublico — Cardápio digital público (link da pizzaria).
 *
 * Rota: /m/:slug
 * Mobile-first, sem autenticação, tema escuro premium nível iFood/Rappi.
 * Fluxo: Navegar → Adicionar ao carrinho → Checkout → Confirmação WhatsApp
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  menuApi,
  MenuResponse,
  MenuProduto,
  MenuPizzaria,
  PedidoDigitalPayload,
  PedidoDigitalResponse,
  ApiError,
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

// ============================================
// Componente Principal
// ============================================
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

  // Modal de produto
  const [modalTamanho, setModalTamanho] = useState<string | null>(null);
  const [modalObs, setModalObs] = useState("");
  const [modalAdicionais, setModalAdicionais] = useState<string[]>([]);
  const [modalQtd, setModalQtd] = useState(1);

  // ---- Load ----
  useEffect(() => {
    setLoading(true);
    menuApi.getBySlug(slug)
      .then(setData)
      .catch((e: ApiError) => setError(e.message || "Cardápio não encontrado"))
      .finally(() => setLoading(false));
  }, [slug]);

  // ---- Categorias ----
  const categorias = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.produtos.map(p => p.categoria || "outro"));
    return ["todos", ...Array.from(set)];
  }, [data]);

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

  function addToCart(produto: MenuProduto, tamanho: string | null, preco: number, qtd: number, obs: string, adicionais: string[]) {
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

  function updateCartQty(id: string, delta: number) {
    setCart(prev => prev.map(i => {
      if (i.id !== id) return i;
      const newQty = Math.max(0, i.quantidade + delta);
      return newQty === 0 ? null! : { ...i, quantidade: newQty };
    }).filter(Boolean));
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
    if (!selectedProduto) return;
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
      observacoes: checkoutForm.observacoes || undefined,
      itens: cart.map(i => ({
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
      const res = await menuApi.submitOrder(slug, payload);
      setResultado(res);
      setStep("confirmacao");
      setCart([]);
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

  return (
    <div className="cdp-root">
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
              <div className="cdp-confirmacao-divider" />
              <div className="cdp-confirmacao-row">
                <span>⏱️ Previsão</span>
                <span className="cdp-confirmacao-eta">{resultado.tempo_estimado}</span>
              </div>
            </div>
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
                <div className="cdp-checkout-total-row">
                  <span>Total</span>
                  <span className="cdp-checkout-total-price">{fmt(cartTotal + taxaEntrega)}</span>
                </div>
              </div>

              {/* Dados pessoais */}
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
                disabled={submitting || !checkoutForm.nome || !telValido || !checkoutForm.pagamento || (checkoutForm.tipo === "delivery" && !checkoutForm.rua)}
                onClick={submitPedido}
              >
                {submitting ? (
                  <span className="cdp-btn-loading">
                    <span className="cdp-mini-spinner" /> Enviando...
                  </span>
                ) : `✅ Confirmar Pedido • ${fmt(cartTotal + taxaEntrega)}`}
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
                    <button className="cdp-btn-primary cdp-btn-lg" onClick={() => setStep("checkout")}>
                      Continuar • {fmt(cartTotal)}
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
              <button className="cdp-btn-primary cdp-btn-add" onClick={confirmAddToCart}>
                Adicionar • {fmt(precoTotal)}
              </button>
            </div>
          </>

        ) : (
          /* ===== MENU PRINCIPAL ===== */
          <>
            {/* Header da pizzaria */}
            <header className="cdp-header">
              {pizz.logo_url && (
                <div className="cdp-header-cover" style={{ backgroundImage: `url(${pizz.logo_url})` }} />
              )}
              <div className="cdp-header-bg" />
              <div className="cdp-header-particles">
                <span /><span /><span />
              </div>
              <div className="cdp-header-content">
                {pizz.logo_url ? (
                  <div className="cdp-logo-ring">
                    <img src={pizz.logo_url} alt={pizz.nome} className="cdp-logo" />
                  </div>
                ) : (
                  <div className="cdp-logo-placeholder">🍕</div>
                )}
                <h1 className="cdp-name">{pizz.nome}</h1>
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
              </div>
            </header>

            {/* ===== LAYOUT BODY (sidebar + main) ===== */}
            <div className="cdp-menu-body">

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
                ) : (
                  <div className="cdp-products">
                    {produtosFiltrados.map(p => {
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
                              <div className="cdp-product-add-btn">+</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </main>
            </div>{/* fim cdp-menu-body */}

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
                        <button className="cdp-btn-primary cdp-btn-lg" onClick={() => { setSacolaOpen(false); setStep("checkout"); }}>
                          Continuar • {fmt(cartTotal)}
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
