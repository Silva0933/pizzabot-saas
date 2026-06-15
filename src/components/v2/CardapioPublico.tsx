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

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);

  // Checkout
  const [checkoutForm, setCheckoutForm] = useState({
    nome: "", telefone: "", tipo: "delivery" as "delivery" | "retirada",
    rua: "", numero: "", bairro: "", referencia: "",
    pagamento: "", observacoes: "",
  });
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
              <button className="cdp-topbar-back" onClick={() => setStep("carrinho")}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
              </button>
              <h2 className="cdp-topbar-title">Finalizar Pedido</h2>
              <div style={{ width: 32 }} />
            </div>

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
                    className="cdp-input"
                    type="tel"
                  />
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
                disabled={submitting || !checkoutForm.nome || !checkoutForm.telefone || !checkoutForm.pagamento || (checkoutForm.tipo === "delivery" && !checkoutForm.rua)}
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
                  <div className="cdp-sidebar-cart" onClick={() => setStep("carrinho")}>
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
              <div className={`cdp-floating-cart ${cartPulse ? "pulse" : ""}`} onClick={() => setStep("carrinho")}>
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
          </>
        )}
      </div>

      <style>{CSS}</style>
    </div>
  );
}

// ============================================
// Helpers
// ============================================
function fmt(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ============================================
// CSS completo — redesign profissional nível iFood/Rappi
// ============================================
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

/* ============ RESET & ROOT ============ */
.cdp-root {
  --bg: #0d0e14;
  --bg2: #181a24;
  --bg3: #22253a;
  --bg4: #2d3147;
  --text: #f2f3f8;
  --text2: #9aa0bc;
  --text3: #5a6080;
  --accent: #f97316;
  --accent2: #fb923c;
  --accent-glow: rgba(249,115,22,0.18);
  --accent-glow2: rgba(249,115,22,0.08);
  --green: #22c55e;
  --green-bg: rgba(34,197,94,0.15);
  --red: #ef4444;
  --radius: 16px;
  --radius-sm: 12px;
  --radius-xs: 8px;
  --shadow: 0 4px 24px rgba(0,0,0,0.35);
  --shadow-accent: 0 8px 32px rgba(249,115,22,0.3);

  min-height: 100vh;
  background: #07080d;
  color: var(--text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  justify-content: center;
}
.cdp-root *, .cdp-root *::before, .cdp-root *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}

.cdp-wrapper {
  width: 100%;
  max-width: 600px;
  min-height: 100vh;
  background: var(--bg);
  box-shadow: 0 0 80px rgba(0,0,0,0.8);
  display: flex;
  flex-direction: column;
  position: relative;
  padding-bottom: 100px;
}

/* ============ LOADING ============ */
.cdp-loading {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif;
}
.cdp-spinner-wrap {
  position: relative; width: 64px; height: 64px;
}
.cdp-spinner {
  width: 64px; height: 64px; border: 3px solid var(--bg3);
  border-top-color: var(--accent); border-radius: 50%;
  animation: cdp-spin 0.8s linear infinite;
  position: absolute; inset: 0;
}
.cdp-spinner-logo {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-size: 24px;
}
.cdp-loading-text { color: var(--text2); font-size: 14px; font-weight: 500; }
@keyframes cdp-spin { to { transform: rotate(360deg); } }

/* ============ ERROR ============ */
.cdp-error {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; padding: 24px;
  text-align: center;
}
.cdp-error-emoji { font-size: 64px; }
.cdp-error h2 { font-size: 22px; font-weight: 800; }
.cdp-error p { color: var(--text2); font-size: 14px; }

/* ============ HEADER PIZZARIA ============ */
.cdp-header {
  position: relative; padding: 48px 24px 32px;
  text-align: center; overflow: hidden;
}
.cdp-header-bg {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(249,115,22,0.22) 0%, rgba(249,115,22,0.05) 60%, transparent 100%);
}
.cdp-header-particles {
  position: absolute; inset: 0; pointer-events: none;
}
.cdp-header-particles span {
  position: absolute; border-radius: 50%;
  background: var(--accent); opacity: 0.12;
  animation: cdp-float 6s ease-in-out infinite;
}
.cdp-header-particles span:nth-child(1) { width: 80px; height: 80px; top: -20px; left: 10%; animation-delay: 0s; }
.cdp-header-particles span:nth-child(2) { width: 50px; height: 50px; top: 40px; right: 15%; animation-delay: 2s; }
.cdp-header-particles span:nth-child(3) { width: 30px; height: 30px; bottom: 0; left: 40%; animation-delay: 4s; }
@keyframes cdp-float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-12px) scale(1.05); }
}
.cdp-header-content { position: relative; z-index: 1; }

.cdp-logo-ring {
  display: inline-block;
  padding: 3px;
  border-radius: 24px;
  background: linear-gradient(135deg, var(--accent), var(--accent2), #fbbf24);
  box-shadow: 0 0 40px rgba(249,115,22,0.35);
  margin-bottom: 4px;
}
.cdp-logo {
  width: 84px; height: 84px; border-radius: 21px;
  object-fit: cover; display: block;
  border: 3px solid var(--bg);
}
.cdp-logo-placeholder {
  width: 90px; height: 90px; border-radius: 24px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 40px;
  box-shadow: 0 0 40px rgba(249,115,22,0.35);
  margin-bottom: 4px;
}
.cdp-name {
  font-size: 26px; font-weight: 900; margin-top: 14px;
  letter-spacing: -0.5px; color: var(--text);
}
.cdp-status-row {
  display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 10px;
  flex-wrap: wrap;
}
.cdp-status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 20px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.3px;
}
.cdp-status-pill.open { background: var(--green-bg); color: var(--green); }
.cdp-status-pill.closed { background: rgba(239,68,68,0.15); color: var(--red); }
.cdp-status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.cdp-status-dot.open { background: var(--green); box-shadow: 0 0 6px var(--green); animation: cdp-pulse-dot 2s infinite; }
.cdp-status-dot.closed { background: var(--red); }
@keyframes cdp-pulse-dot {
  0%, 100% { box-shadow: 0 0 6px var(--green); }
  50% { box-shadow: 0 0 12px var(--green); }
}
.cdp-tempo-pill {
  display: inline-flex; align-items: center;
  padding: 5px 12px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
  background: var(--bg3); color: var(--text2);
}
.cdp-endereco {
  font-size: 12px; color: var(--text3); margin-top: 8px; line-height: 1.4;
}

/* ============ SEARCH ============ */
.cdp-search-wrap {
  padding: 8px 16px 0; position: relative;
}
.cdp-search-icon {
  position: absolute; left: 28px; top: 50%; transform: translateY(-50%);
  color: var(--text3); display: flex; pointer-events: none;
  margin-top: 4px;
}
.cdp-search {
  width: 100%; padding: 13px 42px 13px 42px;
  background: var(--bg2); border: 1.5px solid var(--bg3);
  border-radius: var(--radius); color: var(--text);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.2s, background 0.2s;
}
.cdp-search:focus { border-color: var(--accent); background: var(--bg2); }
.cdp-search::placeholder { color: var(--text3); }
.cdp-search-clear {
  position: absolute; right: 28px; top: 50%; transform: translateY(-50%);
  background: var(--bg3); border: none; color: var(--text3); cursor: pointer;
  font-size: 12px; padding: 3px 6px; border-radius: 6px; margin-top: 4px;
  transition: all 0.2s;
}
.cdp-search-clear:hover { color: var(--text); background: var(--bg4); }

/* ============ CATEGORIES ============ */
.cdp-cats {
  display: flex; gap: 8px; padding: 16px;
  overflow-x: auto; scrollbar-width: none;
}
.cdp-cats::-webkit-scrollbar { display: none; }
.cdp-cat-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 14px 8px 10px; border-radius: 30px;
  background: var(--bg2); border: 1.5px solid var(--bg3);
  color: var(--text2); font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: all 0.2s; text-transform: capitalize;
  font-family: inherit;
}
.cdp-cat-btn.active {
  background: var(--accent-glow); border-color: var(--accent);
  color: var(--accent); box-shadow: 0 0 16px var(--accent-glow);
}
.cdp-cat-btn:not(.active):hover { border-color: var(--bg4); color: var(--text); }
.cdp-cat-emoji-wrap {
  width: 26px; height: 26px; border-radius: 8px; display: flex;
  align-items: center; justify-content: center; font-size: 15px;
  transition: background 0.2s; flex-shrink: 0;
}

/* ============ PRODUCTS GRID ============ */
.cdp-products {
  display: grid; grid-template-columns: 1fr;
  gap: 10px; padding: 4px 16px 16px;
}
@media (min-width: 460px) { .cdp-products { grid-template-columns: 1fr 1fr; } }

.cdp-product-card {
  display: flex; flex-direction: column;
  background: var(--bg2); border: 1.5px solid var(--bg3);
  border-radius: var(--radius); cursor: pointer;
  transition: all 0.25s; text-align: left; color: inherit;
  overflow: hidden; position: relative;
  padding: 0;
}
.cdp-product-card:hover {
  border-color: var(--accent); transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.3), 0 0 0 1px var(--accent-glow);
}
.cdp-product-img-wrap {
  position: relative; width: 100%; height: 140px; overflow: hidden; flex-shrink: 0;
}
@media (min-width: 460px) { .cdp-product-img-wrap { height: 130px; } }
.cdp-product-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.cdp-product-card:hover .cdp-product-img { transform: scale(1.06); }
.cdp-product-img-ph {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, var(--bg3), var(--bg4));
  display: flex; align-items: center; justify-content: center; font-size: 40px;
}
.cdp-product-cat-tag {
  position: absolute; top: 8px; left: 8px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  border-radius: 8px; padding: 3px 7px; font-size: 14px;
}
.cdp-product-info {
  flex: 1; display: flex; flex-direction: column; padding: 12px; gap: 4px;
}
.cdp-product-name { font-size: 14px; font-weight: 700; line-height: 1.3; color: var(--text); }
.cdp-product-desc {
  font-size: 11px; color: var(--text3); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  flex: 1;
}
.cdp-product-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.cdp-product-price-wrap { display: flex; flex-direction: column; gap: 1px; }
.cdp-price-from { font-size: 9px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; }
.cdp-price { font-size: 15px; font-weight: 800; color: var(--accent); }
.cdp-product-add-btn {
  width: 30px; height: 30px; border-radius: 10px;
  background: var(--accent); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 300; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(249,115,22,0.4);
  transition: transform 0.2s;
}
.cdp-product-card:hover .cdp-product-add-btn { transform: scale(1.1); }

.cdp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 60px 20px; color: var(--text3); font-size: 14px;
}
.cdp-empty span { font-size: 40px; opacity: 0.5; }

/* ============ FLOATING CART ============ */
.cdp-floating-cart {
  position: fixed; bottom: 20px;
  left: 50%; transform: translateX(-50%);
  width: calc(100% - 32px); max-width: 568px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: white; border-radius: var(--radius); padding: 14px 20px;
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; z-index: 200;
  box-shadow: var(--shadow-accent);
  animation: cdp-slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  transition: box-shadow 0.2s, transform 0.2s;
}
.cdp-floating-cart:hover {
  box-shadow: 0 12px 40px rgba(249,115,22,0.45);
  transform: translateX(-50%) translateY(-2px);
}
.cdp-floating-cart.pulse { animation: cdp-cart-pulse 0.5s ease-out; }
@keyframes cdp-slideUp {
  from { transform: translateX(-50%) translateY(120%); opacity: 0; }
  to { transform: translateX(-50%) translateY(0); opacity: 1; }
}
@keyframes cdp-cart-pulse {
  0% { transform: translateX(-50%) scale(1); }
  30% { transform: translateX(-50%) scale(1.04); }
  60% { transform: translateX(-50%) scale(0.98); }
  100% { transform: translateX(-50%) scale(1); }
}
.cdp-floating-cart-left { display: flex; align-items: center; gap: 12px; }
.cdp-floating-cart-badge {
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.cdp-floating-cart-count {
  position: absolute; top: -8px; right: -8px;
  background: white; color: var(--accent);
  width: 18px; height: 18px; border-radius: 50%;
  font-size: 10px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
}
.cdp-floating-cart-label { font-weight: 700; font-size: 15px; }
.cdp-floating-cart-right { display: flex; align-items: center; gap: 6px; }
.cdp-floating-cart-total { font-weight: 800; font-size: 16px; }

/* ============ TOPBAR (CARRINHO / CHECKOUT) ============ */
.cdp-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; background: var(--bg2);
  border-bottom: 1px solid var(--bg3);
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(10px);
}
.cdp-topbar-back {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--bg3); border: none; color: var(--text);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.2s;
}
.cdp-topbar-back:hover { background: var(--bg4); }
.cdp-topbar-title { font-size: 17px; font-weight: 800; color: var(--text); }

/* ============ PRODUTO DETAIL ============ */
.cdp-produto-hero {
  position: relative; width: 100%; height: 280px; overflow: hidden;
}
.cdp-produto-hero-img { width: 100%; height: 100%; object-fit: cover; }
.cdp-produto-hero-ph {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, var(--bg3), var(--bg4));
  display: flex; align-items: center; justify-content: center; font-size: 80px;
}
.cdp-produto-hero-gradient {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(13,14,20,0.95) 0%, rgba(13,14,20,0.4) 50%, transparent 100%);
}
.cdp-btn-back-circle {
  position: absolute; top: 16px; left: 16px; width: 40px; height: 40px;
  border-radius: 50%; background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.15);
  color: white; display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 10; transition: all 0.2s;
}
.cdp-btn-back-circle:hover { background: rgba(0,0,0,0.75); transform: scale(1.05); }
.cdp-produto-hero-overlay {
  position: absolute; bottom: 0; left: 0; right: 0; padding: 20px 16px 16px;
}
.cdp-produto-hero-title {
  font-size: 26px; font-weight: 900; color: white;
  letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 6px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.cdp-produto-hero-price {
  display: inline-block; font-size: 16px; font-weight: 700; color: var(--accent2);
  background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);
  padding: 4px 12px; border-radius: 20px;
}

.cdp-produto-body {
  flex: 1; padding-bottom: 90px;
}
.cdp-produto-desc-block {
  padding: 16px; background: var(--bg);
  border-bottom: 1px solid var(--bg3);
}
.cdp-produto-desc { font-size: 14px; color: var(--text2); line-height: 1.6; }

.cdp-produto-section {
  padding: 20px 16px; border-bottom: 1px solid var(--bg3);
}
.cdp-produto-section-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;
}
.cdp-produto-section-header h3 { font-size: 16px; font-weight: 700; color: var(--text); }

.cdp-badge {
  font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 20px; letter-spacing: 0.3px;
}
.cdp-badge-required { background: var(--accent-glow); color: var(--accent); border: 1px solid var(--accent-glow2); }
.cdp-badge-optional { background: var(--bg3); color: var(--text3); }

.cdp-tamanho-list { display: flex; flex-direction: column; gap: 8px; }
.cdp-tamanho-btn {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; background: var(--bg2); border: 1.5px solid var(--bg3);
  border-radius: var(--radius-sm); cursor: pointer; color: var(--text);
  font-family: inherit; transition: all 0.2s; outline: none;
}
.cdp-tamanho-btn:hover { border-color: var(--accent2); }
.cdp-tamanho-btn.active { border-color: var(--accent); background: var(--accent-glow); box-shadow: 0 0 0 1px var(--accent-glow); }
.cdp-tamanho-left { display: flex; align-items: center; gap: 12px; }
.cdp-radio {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--text3); display: inline-flex;
  align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s;
}
.cdp-radio.active { border-color: var(--accent); }
.cdp-radio.active::after {
  content: ''; width: 10px; height: 10px;
  border-radius: 50%; background: var(--accent); display: block;
}
.cdp-tamanho-name { font-size: 15px; font-weight: 600; }
.cdp-tamanho-price { font-size: 15px; font-weight: 800; color: var(--accent); }

.cdp-adicionais-list { display: flex; flex-direction: column; gap: 8px; }
.cdp-adicional-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; background: var(--bg2); border: 1.5px solid var(--bg3);
  border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; user-select: none;
}
.cdp-adicional-item:hover { border-color: var(--accent2); }
.cdp-adicional-item.active { border-color: var(--accent); background: var(--accent-glow); }
.cdp-adicional-left { display: flex; align-items: center; gap: 12px; }
.cdp-checkbox {
  width: 20px; height: 20px; border-radius: 6px; border: 2px solid var(--text3);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.2s;
}
.cdp-checkbox.active { background: var(--accent); border-color: var(--accent); }
.cdp-adicional-name { font-size: 14px; font-weight: 500; }
.cdp-adicional-price { font-size: 14px; font-weight: 700; color: var(--accent); }

.cdp-textarea { width: 100%; padding: 12px 14px; background: var(--bg2); border: 1.5px solid var(--bg3); border-radius: var(--radius-sm); color: var(--text); font-size: 14px; outline: none; resize: none; font-family: inherit; transition: border-color 0.2s; }
.cdp-textarea:focus { border-color: var(--accent); }
.cdp-textarea::placeholder { color: var(--text3); }
.cdp-textarea-obs { resize: none; }

.cdp-produto-footer {
  position: fixed; bottom: 0;
  left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 600px;
  background: var(--bg2); border-top: 1px solid var(--bg3);
  padding: 14px 16px;
  display: flex; gap: 12px; align-items: center; z-index: 150;
  box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
}
.cdp-btn-add { flex: 1; height: 50px; font-size: 16px; }

/* ============ QTY CONTROLS ============ */
.cdp-qty-controls {
  display: flex; align-items: center; gap: 0;
  background: var(--bg3); border-radius: 12px; overflow: hidden; flex-shrink: 0;
}
.cdp-qty-controls button {
  width: 36px; height: 36px; background: transparent; border: none;
  color: var(--text); font-size: 18px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; flex-shrink: 0;
}
.cdp-qty-controls button:hover { background: var(--accent); color: white; }
.cdp-qty-controls span { min-width: 28px; text-align: center; font-weight: 700; font-size: 14px; }
.cdp-qty-lg button { width: 48px; height: 48px; font-size: 22px; }
.cdp-qty-lg span { min-width: 36px; font-size: 17px; }

/* ============ BUTTONS ============ */
.cdp-btn-primary {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%);
  color: white; border: none; border-radius: var(--radius-sm);
  font-weight: 800; font-size: 15px; cursor: pointer; font-family: inherit;
  padding: 14px 24px; transition: all 0.2s;
  box-shadow: 0 4px 20px rgba(249,115,22,0.3);
  letter-spacing: 0.2px;
}
.cdp-btn-primary:hover { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 8px 28px rgba(249,115,22,0.4); }
.cdp-btn-primary:active { transform: translateY(0); }
.cdp-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; box-shadow: none; }
.cdp-btn-lg { width: 100%; padding: 16px; font-size: 16px; border-radius: var(--radius); }
.cdp-btn-secondary {
  background: var(--bg3); color: var(--text); border: none; font-family: inherit;
  border-radius: var(--radius-sm); font-weight: 600; font-size: 14px;
  cursor: pointer; padding: 12px 24px; transition: background 0.2s;
}
.cdp-btn-secondary:hover { background: var(--bg4); }
.cdp-btn-loading { display: flex; align-items: center; gap: 8px; justify-content: center; }
.cdp-mini-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4);
  border-top-color: white; border-radius: 50%;
  animation: cdp-spin 0.7s linear infinite; display: inline-block;
}
.cdp-btn-submit { margin-top: 8px; }

/* ============ CARRINHO (PÁGINA) ============ */
.cdp-cart-page { flex: 1; display: flex; flex-direction: column; padding-bottom: 0; }
.cdp-cart-empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  padding: 40px 24px; text-align: center;
}
.cdp-cart-empty-icon-wrap { font-size: 60px; opacity: 0.3; }
.cdp-cart-empty h3 { font-size: 18px; font-weight: 700; color: var(--text); }
.cdp-cart-empty p { font-size: 14px; color: var(--text2); margin-bottom: 8px; }

.cdp-cart-items { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.cdp-cart-item {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius-sm); padding: 12px;
  transition: border-color 0.2s;
}
.cdp-cart-item:hover { border-color: var(--bg4); }
.cdp-cart-item-img {
  width: 64px; height: 64px; border-radius: 10px; object-fit: cover; flex-shrink: 0;
}
.cdp-cart-item-img-ph {
  width: 64px; height: 64px; border-radius: 10px; flex-shrink: 0;
  background: var(--bg3); display: flex; align-items: center; justify-content: center;
  font-size: 24px;
}
.cdp-cart-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cdp-cart-item-name { font-size: 14px; font-weight: 700; color: var(--text); line-height: 1.3; }
.cdp-cart-item-tag {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 2px 7px; background: var(--accent-glow); color: var(--accent);
  border-radius: 6px; margin-left: 6px;
}
.cdp-cart-item-extras { font-size: 11px; color: var(--accent); }
.cdp-cart-item-obs { font-size: 11px; color: var(--text3); font-style: italic; }
.cdp-cart-item-price-row { margin-top: 4px; }
.cdp-cart-item-price { font-size: 15px; font-weight: 800; color: var(--accent); }
.cdp-cart-item-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
.cdp-cart-remove {
  background: transparent; border: none; color: var(--text3);
  cursor: pointer; padding: 4px; transition: color 0.2s; display: flex;
}
.cdp-cart-remove:hover { color: var(--red); }

.cdp-cart-summary {
  margin: 0 16px;
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 10px;
}
.cdp-cart-summary-row { display: flex; justify-content: space-between; font-size: 14px; color: var(--text2); }
.cdp-cart-summary-row-muted { color: var(--text3); font-size: 13px; }
.cdp-cart-summary-total {
  display: flex; justify-content: space-between;
  font-size: 17px; font-weight: 800; color: var(--text);
  padding-top: 10px; border-top: 1px solid var(--bg3);
}

.cdp-cart-cta {
  padding: 16px; display: flex; flex-direction: column; gap: 10px;
}
.cdp-cart-add-more {
  background: transparent; border: 1.5px solid var(--bg3); color: var(--text2);
  border-radius: var(--radius-sm); font-weight: 600; font-size: 14px;
  cursor: pointer; padding: 12px; font-family: inherit; transition: all 0.2s;
}
.cdp-cart-add-more:hover { border-color: var(--accent); color: var(--accent); }

/* ============ CHECKOUT ============ */
.cdp-checkout { padding: 16px; display: flex; flex-direction: column; gap: 4px; padding-bottom: 32px; }
.cdp-section-label {
  font-size: 13px; font-weight: 700; color: var(--text3);
  text-transform: uppercase; letter-spacing: 0.8px;
  padding: 16px 0 8px;
}
.cdp-checkout-card {
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); padding: 16px; margin-bottom: 4px;
}
.cdp-checkout-card-inputs { display: flex; flex-direction: column; gap: 8px; }
.cdp-checkout-item {
  display: flex; align-items: baseline; gap: 8px;
  padding: 7px 0; border-bottom: 1px solid var(--bg3);
  font-size: 13px; color: var(--text2);
}
.cdp-checkout-item:last-of-type { border-bottom: none; }
.cdp-checkout-item-qty { font-weight: 700; color: var(--accent); flex-shrink: 0; min-width: 22px; }
.cdp-checkout-item-name { flex: 1; }
.cdp-checkout-item-extras { display: block; font-size: 11px; color: var(--text3); }
.cdp-checkout-item-price { font-weight: 700; color: var(--text); white-space: nowrap; }
.cdp-checkout-item-taxa { color: var(--text3); }
.cdp-checkout-total-row {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 12px; margin-top: 8px; border-top: 2px solid var(--accent);
  font-size: 16px; font-weight: 800; color: var(--text);
}
.cdp-checkout-total-price { color: var(--accent); font-size: 20px; }

.cdp-input-group { display: flex; flex-direction: column; gap: 4px; }
.cdp-input-label { font-size: 11px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; }
.cdp-input {
  width: 100%; padding: 12px 14px;
  background: var(--bg); border: 1.5px solid var(--bg3);
  border-radius: var(--radius-xs); color: var(--text);
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color 0.2s;
}
.cdp-input:focus { border-color: var(--accent); }
.cdp-input::placeholder { color: var(--text3); }
.cdp-input-row { display: flex; gap: 8px; }

.cdp-delivery-toggle { display: flex; gap: 10px; margin-bottom: 4px; }
.cdp-delivery-btn {
  flex: 1; padding: 14px 12px; display: flex; flex-direction: column;
  align-items: center; gap: 6px; position: relative;
  background: var(--bg2); border: 2px solid var(--bg3);
  border-radius: var(--radius); cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.cdp-delivery-btn.active { border-color: var(--accent); background: var(--accent-glow); }
.cdp-delivery-btn:not(.active):hover { border-color: var(--bg4); }
.cdp-delivery-btn-icon { font-size: 28px; }
.cdp-delivery-btn-label { font-size: 13px; font-weight: 700; color: var(--text); }
.cdp-delivery-check {
  position: absolute; top: 8px; right: 10px;
  color: var(--accent); font-weight: 900; font-size: 14px;
}

.cdp-payment-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; margin-bottom: 4px; }
.cdp-payment-card {
  padding: 14px 12px; display: flex; flex-direction: column; align-items: center;
  gap: 6px; position: relative;
  background: var(--bg2); border: 2px solid var(--bg3);
  border-radius: var(--radius-sm); cursor: pointer; font-family: inherit; transition: all 0.2s;
}
.cdp-payment-card.active { border-color: var(--accent); background: var(--accent-glow); }
.cdp-payment-card:not(.active):hover { border-color: var(--bg4); }
.cdp-payment-icon { font-size: 26px; }
.cdp-payment-label { font-size: 12px; font-weight: 700; color: var(--text); }
.cdp-payment-check {
  position: absolute; top: 6px; right: 8px;
  color: var(--accent); font-weight: 900; font-size: 12px;
}

.cdp-taxa-info {
  font-size: 13px; color: var(--text2); margin-top: 4px;
  padding: 8px 10px; background: var(--accent-glow); border-radius: 8px;
}
.cdp-taxa-info strong { color: var(--accent); }
.cdp-error-inline {
  padding: 12px 14px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
  border-radius: var(--radius-sm); color: var(--red); font-size: 13px; margin-top: 4px;
}

/* ============ CONFIRMAÇÃO ============ */
.cdp-confirmacao {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 48px 24px; gap: 14px; text-align: center;
}
.cdp-confirmacao-ring {
  width: 100px; height: 100px; border-radius: 50%;
  background: rgba(34,197,94,0.12); border: 2px solid rgba(34,197,94,0.4);
  display: flex; align-items: center; justify-content: center;
  animation: cdp-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 40px rgba(34,197,94,0.2);
}
.cdp-confirmacao-icon { font-size: 52px; }
@keyframes cdp-bounce {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); opacity: 1; }
}
.cdp-confirmacao-badge {
  display: inline-block; padding: 4px 14px;
  background: var(--green-bg); color: var(--green);
  border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px;
}
.cdp-confirmacao-title { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
.cdp-confirmacao-sub { color: var(--text2); font-size: 14px; max-width: 300px; line-height: 1.6; }
.cdp-confirmacao-card {
  width: 100%; max-width: 320px;
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); padding: 18px;
  display: flex; flex-direction: column; gap: 10px;
}
.cdp-confirmacao-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 14px; color: var(--text2);
}
.cdp-confirmacao-row-sm { font-size: 12px; color: var(--text3); }
.cdp-confirmacao-price { font-size: 20px; font-weight: 900; color: var(--accent); }
.cdp-confirmacao-eta { font-weight: 700; color: var(--text); }
.cdp-confirmacao-divider { height: 1px; background: var(--bg3); margin: 0; }

/* ============ SCROLLBAR ============ */
.cdp-root ::-webkit-scrollbar { width: 4px; height: 4px; }
.cdp-root ::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 2px; }
.cdp-root ::-webkit-scrollbar-track { background: transparent; }

/* ============ MOBILE — layout padrão (sidebar inline) ============ */
.cdp-menu-body { display: flex; flex-direction: column; }
.cdp-sidebar { display: contents; } /* no mobile: sidebar é transparente no flow */
.cdp-main-area { display: contents; }
.cdp-search-sidebar { padding: 8px 16px 0; }
.cdp-sidebar-cart { display: none; } /* só aparece no desktop */

/* ============ DESKTOP — layout de duas colunas ============ */
@media (min-width: 860px) {
  /* Fundo do body com gradiente sutil no desktop */
  .cdp-root {
    background: radial-gradient(ellipse 60% 40% at 50% 0%, rgba(249,115,22,0.08) 0%, #07080d 60%);
    align-items: flex-start;
  }

  /* Wrapper expande para caber o layout completo */
  .cdp-wrapper {
    max-width: 1180px;
    width: 95%;
    margin: 0 auto;
    border-radius: 20px;
    box-shadow: 0 0 80px rgba(0,0,0,0.6), 0 0 0 1px var(--bg3);
    min-height: auto;
    padding-bottom: 40px;
    overflow: hidden;
  }

  /* Header redesenhado para desktop */
  .cdp-header {
    padding: 40px 32px 32px;
    text-align: center;
    background: linear-gradient(180deg, rgba(249,115,22,0.15) 0%, transparent 100%);
  }
  .cdp-logo { width: 96px; height: 96px; border-radius: 24px; }
  .cdp-name { font-size: 30px; }

  /* Layout 2 colunas: sidebar 260px + conteúdo */
  .cdp-menu-body {
    display: grid;
    grid-template-columns: 260px 1fr;
    align-items: start;
    gap: 0;
    padding: 0;
    border-top: 1px solid var(--bg3);
  }

  /* Sidebar esquerda — sticky */
  .cdp-sidebar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    padding: 20px 16px;
    border-right: 1px solid var(--bg3);
    background: var(--bg2);
    scrollbar-width: thin;
  }

  /* Título da sidebar */
  .cdp-sidebar::before {
    content: 'CATEGORIAS';
    display: block;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: var(--text3);
    padding: 0 4px 8px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--bg3);
  }

  /* Busca fica inline no topo da sidebar */
  .cdp-search-sidebar {
    padding: 0;
    margin-bottom: 12px;
    order: -1; /* garante que fica no topo */
  }

  /* Categorias viram lista vertical na sidebar */
  .cdp-cats {
    flex-direction: column;
    padding: 0;
    gap: 4px;
    overflow-x: visible;
    overflow-y: visible;
  }
  .cdp-cat-btn {
    width: 100%;
    justify-content: flex-start;
    border-radius: 10px;
    padding: 10px 12px;
  }

  /* Carrinho da sidebar — visível no desktop */
  .cdp-sidebar-cart {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    border-radius: var(--radius);
    padding: 14px;
    cursor: pointer;
    transition: box-shadow 0.2s;
    animation: cdp-slideUp 0.3s ease-out;
  }
  .cdp-sidebar-cart:hover { box-shadow: 0 4px 20px rgba(249,115,22,0.2); }
  .cdp-sidebar-cart-header {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 800; color: var(--text);
    padding-bottom: 8px; border-bottom: 1px solid var(--bg3);
  }
  .cdp-sidebar-cart-count {
    margin-left: auto;
    background: var(--accent); color: white;
    width: 20px; height: 20px; border-radius: 50%;
    font-size: 11px; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
  }
  .cdp-sidebar-cart-item {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text2);
  }
  .cdp-sidebar-cart-qty { color: var(--accent); font-weight: 700; flex-shrink: 0; }
  .cdp-sidebar-cart-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cdp-sidebar-cart-price { font-weight: 700; color: var(--text); white-space: nowrap; }
  .cdp-sidebar-cart-more { font-size: 11px; color: var(--text3); }
  .cdp-sidebar-cart-total {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; font-weight: 800; color: var(--text);
    padding-top: 8px; border-top: 1px solid var(--bg3);
  }
  .cdp-sidebar-cart-btn {
    text-align: center; background: var(--accent);
    color: white; border-radius: 8px; padding: 10px;
    font-size: 13px; font-weight: 700;
    transition: opacity 0.2s;
  }
  .cdp-sidebar-cart-btn:hover { opacity: 0.9; }

  /* Área principal de produtos */
  .cdp-main-area {
    display: block;
    padding: 20px;
    min-height: 600px;
  }

  /* Grid de 3 colunas no desktop */
  .cdp-products {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 14px;
    padding: 0;
  }

  /* Imagem dos cards maior no desktop */
  .cdp-product-img-wrap { height: 150px; }

  /* Floating cart some no desktop (substituído pela sidebar) */
  .cdp-floating-cart { display: none; }

  /* Wrapper de outras telas (carrinho, checkout, produto) */
  .cdp-cart-page,
  .cdp-checkout,
  .cdp-produto-hero,
  .cdp-produto-body,
  .cdp-confirmacao { max-width: 700px; margin: 0 auto; width: 100%; }

  .cdp-produto-footer {
    max-width: 1180px;
    left: 50%;
    transform: translateX(-50%);
  }

  /* Topbar fica melhor no desktop */
  .cdp-topbar { border-radius: 0; }
}

/* ============ TABLET (460-860px) — 2 colunas de produto ============ */
@media (min-width: 460px) and (max-width: 859px) {
  .cdp-products { grid-template-columns: 1fr 1fr; }
  .cdp-product-img-wrap { height: 130px; }
}
`;
