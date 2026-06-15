/**
 * CardapioPublico — Cardápio digital público (link da pizzaria).
 *
 * Rota: /m/:slug
 * Mobile-first, sem autenticação, tema escuro premium.
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
  id: string; // produto id + tamanho como chave
  produtoId: string;
  nome: string;
  tamanho: string | null;
  preco: number;
  quantidade: number;
  observacao: string;
  adicionais: string[];
}

type Step = "menu" | "produto" | "carrinho" | "checkout" | "confirmacao";

// ============================================
// Constantes de estilo
// ============================================
const CAT_EMOJI: Record<string, string> = {
  pizza: "🍕", lanche: "🍔", bebida: "🥤", sobremesa: "🍰", outro: "🍽️",
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
      }];
    });
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
  }

  function confirmAddToCart() {
    if (!selectedProduto) return;
    const p = selectedProduto;
    let preco = Number(p.preco);
    if (p.tamanhos && modalTamanho) {
      const t = p.tamanhos.find(t => t.tamanho === modalTamanho);
      if (t) preco = Number(t.preco);
    }
    // Soma adicionais
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
      website: "", // honeypot vazio
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
      <div className="cdp-spinner" />
      <p>Carregando cardápio...</p>
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
        {step === "confirmacao" && resultado ? (
          <div className="cdp-confirmacao">
            <div className="cdp-confirmacao-icon">✅</div>
            <h2>Pedido #{resultado.numero_pedido} enviado!</h2>
            <p className="cdp-confirmacao-sub">
              Seu pedido foi recebido com sucesso. Você receberá a confirmação no seu WhatsApp.
            </p>
            <div className="cdp-confirmacao-info">
              <div><strong>Total:</strong> {fmt(resultado.valor_total)}</div>
              {resultado.taxa_entrega > 0 && (
                <div><small>Inclui taxa de entrega: {fmt(resultado.taxa_entrega)}</small></div>
              )}
              <div><strong>Previsão:</strong> {resultado.tempo_estimado}</div>
            </div>
            <button className="cdp-btn-primary cdp-btn-lg" onClick={() => { setStep("menu"); setResultado(null); }}>
              Fazer outro pedido
            </button>
          </div>
        ) : step === "checkout" ? (
          <>
            <div className="cdp-header-bar">
              <button className="cdp-back-btn" onClick={() => setStep("carrinho")}>← Voltar</button>
              <h2>Finalizar Pedido</h2>
            </div>
            <div className="cdp-checkout">
              {/* Resumo do carrinho */}
              <div className="cdp-checkout-section">
                <h3>📋 Seu pedido</h3>
                {cart.map(item => (
                  <div key={item.id} className="cdp-checkout-item">
                    <span>{item.quantidade}x {item.nome}{item.tamanho ? ` (${item.tamanho})` : ""}</span>
                    <span className="cdp-checkout-item-price">{fmt(item.preco * item.quantidade)}</span>
                  </div>
                ))}
                {checkoutForm.tipo === "delivery" && taxaEntrega > 0 && (
                  <div className="cdp-checkout-item cdp-checkout-taxa">
                    <span>🚚 Taxa de entrega</span>
                    <span className="cdp-checkout-item-price">{fmt(taxaEntrega)}</span>
                  </div>
                )}
                <div className="cdp-checkout-item cdp-checkout-total">
                  <span><strong>Total</strong></span>
                  <span className="cdp-checkout-total-price">{fmt(cartTotal + taxaEntrega)}</span>
                </div>
              </div>

              {/* Dados pessoais */}
              <div className="cdp-checkout-section">
                <h3>👤 Seus dados</h3>
                <input
                  placeholder="Seu nome completo"
                  value={checkoutForm.nome}
                  onChange={e => setCheckoutForm({ ...checkoutForm, nome: e.target.value })}
                  className="cdp-input"
                />
                <input
                  placeholder="WhatsApp (com DDD)"
                  value={checkoutForm.telefone}
                  onChange={e => setCheckoutForm({ ...checkoutForm, telefone: e.target.value })}
                  className="cdp-input"
                  type="tel"
                />
              </div>

              {/* Tipo de entrega */}
              <div className="cdp-checkout-section">
                <h3>🚚 Como quer receber?</h3>
                <div className="cdp-toggle-group">
                  <button
                    className={`cdp-toggle-btn ${checkoutForm.tipo === "delivery" ? "active" : ""}`}
                    onClick={() => setCheckoutForm({ ...checkoutForm, tipo: "delivery" })}
                  >
                    🛵 Entrega
                  </button>
                  <button
                    className={`cdp-toggle-btn ${checkoutForm.tipo === "retirada" ? "active" : ""}`}
                    onClick={() => setCheckoutForm({ ...checkoutForm, tipo: "retirada" })}
                  >
                    🏪 Retirada
                  </button>
                </div>
              </div>

              {/* Endereço (só para delivery) */}
              {checkoutForm.tipo === "delivery" && (
                <div className="cdp-checkout-section">
                  <h3>📍 Endereço de entrega</h3>
                  <input placeholder="Rua / Avenida" value={checkoutForm.rua}
                    onChange={e => setCheckoutForm({ ...checkoutForm, rua: e.target.value })} className="cdp-input" />
                  <div className="cdp-input-row">
                    <input placeholder="Número" value={checkoutForm.numero}
                      onChange={e => setCheckoutForm({ ...checkoutForm, numero: e.target.value })} className="cdp-input" />
                    <input placeholder="Bairro" value={checkoutForm.bairro}
                      onChange={e => setCheckoutForm({ ...checkoutForm, bairro: e.target.value })} className="cdp-input" />
                  </div>
                  <input placeholder="Ponto de referência (opcional)" value={checkoutForm.referencia}
                    onChange={e => setCheckoutForm({ ...checkoutForm, referencia: e.target.value })} className="cdp-input" />
                  {/* Mostra taxa se bairro selecionado */}
                  {checkoutForm.bairro && taxaEntrega > 0 && (
                    <p className="cdp-taxa-info">Taxa de entrega para {checkoutForm.bairro}: <strong>{fmt(taxaEntrega)}</strong></p>
                  )}
                </div>
              )}

              {/* Forma de pagamento */}
              <div className="cdp-checkout-section">
                <h3>💳 Forma de pagamento</h3>
                <div className="cdp-payment-options">
                  {(pizz.formas_pagamento_aceitas.length > 0
                    ? pizz.formas_pagamento_aceitas
                    : ["pix", "cartao", "dinheiro"]
                  ).map(fp => (
                    <button
                      key={fp}
                      className={`cdp-payment-btn ${checkoutForm.pagamento === fp ? "active" : ""}`}
                      onClick={() => setCheckoutForm({ ...checkoutForm, pagamento: fp })}
                    >
                      {fp === "pix" ? "💠 Pix" : fp === "cartao" ? "💳 Cartão" : fp === "dinheiro" ? "💵 Dinheiro" : fp}
                    </button>
                  ))}
                </div>
              </div>

              {/* Observações */}
              <div className="cdp-checkout-section">
                <h3>📝 Observações (opcional)</h3>
                <textarea
                  placeholder="Ex: troco pra 100, apartamento 302..."
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
                {submitting ? "Enviando..." : `Finalizar Pedido • ${fmt(cartTotal + taxaEntrega)}`}
              </button>
            </div>
          </>
        ) : step === "carrinho" ? (
          <>
            <div className="cdp-header-bar">
              <button className="cdp-back-btn" onClick={() => setStep("menu")}>← Cardápio</button>
              <h2>Seu Pedido</h2>
            </div>
            <div className="cdp-cart">
              {cart.length === 0 ? (
                <div className="cdp-cart-empty">
                  <span className="cdp-cart-empty-icon">🛒</span>
                  <p>Seu carrinho está vazio</p>
                  <button className="cdp-btn-secondary" onClick={() => setStep("menu")}>Ver cardápio</button>
                </div>
              ) : (
                <>
                  {cart.map(item => (
                    <div key={item.id} className="cdp-cart-item">
                      <div className="cdp-cart-item-info">
                        <strong>{item.nome}</strong>
                        {item.tamanho && <span className="cdp-cart-item-tag">{item.tamanho}</span>}
                        {item.adicionais.length > 0 && (
                          <span className="cdp-cart-item-extras">+ {item.adicionais.join(", ")}</span>
                        )}
                        {item.observacao && <span className="cdp-cart-item-obs">📝 {item.observacao}</span>}
                      </div>
                      <div className="cdp-cart-item-controls">
                        <div className="cdp-qty-controls">
                          <button onClick={() => updateCartQty(item.id, -1)}>−</button>
                          <span>{item.quantidade}</span>
                          <button onClick={() => updateCartQty(item.id, 1)}>+</button>
                        </div>
                        <span className="cdp-cart-item-price">{fmt(item.preco * item.quantidade)}</span>
                        <button className="cdp-cart-remove" onClick={() => removeFromCart(item.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="cdp-cart-footer">
                    <div className="cdp-cart-total">
                      <span>Subtotal</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    <button className="cdp-btn-primary cdp-btn-lg" onClick={() => setStep("checkout")}>
                      Continuar • {fmt(cartTotal)}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : step === "produto" && selectedProduto ? (
          <>
            <div className="cdp-produto-media-header">
              {selectedProduto.imagem_url ? (
                <img src={selectedProduto.imagem_url} alt={selectedProduto.nome} className="cdp-produto-banner-img" />
              ) : (
                <div className="cdp-produto-banner-placeholder">
                  <span>{CAT_EMOJI[selectedProduto.categoria || "outro"] || "🍽️"}</span>
                </div>
              )}
              <button className="cdp-btn-back-circle" onClick={() => { setStep("menu"); setSelectedProduto(null); }}>
                ←
              </button>
            </div>
            <div className="cdp-produto-detail">
              <div className="cdp-produto-info-header">
                <h2 className="cdp-produto-title">{selectedProduto.nome}</h2>
                {selectedProduto.descricao && <p className="cdp-produto-desc">{selectedProduto.descricao}</p>}
                {!selectedProduto.tamanhos || selectedProduto.tamanhos.length === 0 ? (
                  <div className="cdp-produto-price-badge">{fmt(Number(selectedProduto.preco))}</div>
                ) : null}
              </div>

              {/* Tamanhos */}
              {selectedProduto.tamanhos && selectedProduto.tamanhos.length > 0 && (
                <div className="cdp-section">
                  <div className="cdp-section-header">
                    <h3>Escolha o tamanho</h3>
                    <span className="cdp-badge-required">Obrigatório</span>
                  </div>
                  <div className="cdp-tamanho-list">
                    {selectedProduto.tamanhos.map(t => (
                      <button
                        key={t.tamanho}
                        className={`cdp-tamanho-btn ${modalTamanho === t.tamanho ? "active" : ""}`}
                        onClick={() => setModalTamanho(t.tamanho)}
                      >
                        <div className="cdp-tamanho-info">
                          <span className="cdp-tamanho-radio-icon"></span>
                          <span className="cdp-tamanho-name">{t.tamanho}</span>
                        </div>
                        <span className="cdp-tamanho-price">{fmt(t.preco)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Adicionais/Bordas */}
              {adicionaisDisp.length > 0 && (selectedProduto.categoria === "pizza" || selectedProduto.categoria === "lanche") && (
                <div className="cdp-section">
                  <div className="cdp-section-header">
                    <h3>Adicionais</h3>
                    <span className="cdp-badge-optional">Opcional</span>
                  </div>
                  <div className="cdp-adicionais-list">
                    {adicionaisDisp.map(a => {
                      const isActive = modalAdicionais.includes(a.nome);
                      return (
                        <label key={a.nome} className={`cdp-adicional-item ${isActive ? "active" : ""}`}>
                          <div className="cdp-adicional-info">
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={e => {
                                if (e.target.checked) setModalAdicionais([...modalAdicionais, a.nome]);
                                else setModalAdicionais(modalAdicionais.filter(x => x !== a.nome));
                              }}
                              className="cdp-checkbox-input"
                            />
                            <span className="cdp-adicional-name">{a.nome}</span>
                          </div>
                          {a.preco > 0 && <span className="cdp-adicional-price">+{fmt(a.preco)}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Observação */}
              <div className="cdp-section">
                <div className="cdp-section-header">
                  <h3>Alguma observação?</h3>
                  <span className="cdp-badge-optional">Opcional</span>
                </div>
                <textarea
                  placeholder="Ex: sem cebola, borda fina..."
                  value={modalObs}
                  onChange={e => setModalObs(e.target.value)}
                  className="cdp-textarea-observacoes"
                  rows={2}
                />
              </div>

              {/* Quantidade + Adicionar */}
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
            </div>
          </>
        ) : (
          /* Menu Principal */
          <>
            {/* Header da pizzaria */}
            <header className="cdp-header">
              <div className="cdp-header-bg" />
              <div className="cdp-header-content">
                {pizz.logo_url ? (
                  <img src={pizz.logo_url} alt={pizz.nome} className="cdp-logo" />
                ) : (
                  <div className="cdp-logo-placeholder">🍕</div>
                )}
                <h1 className="cdp-name">{pizz.nome}</h1>
                <div className="cdp-status-row">
                  <span className={`cdp-status ${pizz.aberto ? "open" : "closed"}`}>
                    {pizz.aberto ? "🟢 Aberto agora" : "🔴 Fechado"}
                  </span>
                  {pizz.tempo_entrega_min && pizz.tempo_entrega_max && (
                    <span className="cdp-tempo">🕐 {pizz.tempo_entrega_min}-{pizz.tempo_entrega_max} min</span>
                  )}
                </div>
                {pizz.endereco && <p className="cdp-endereco">📍 {pizz.endereco}</p>}
              </div>
            </header>

            {/* Busca */}
            <div className="cdp-search-wrap">
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
                >
                  <span>{CAT_EMOJI[cat] || "🍽️"}</span>
                  <span>{cat === "todos" ? "Todos" : cat}</span>
                </button>
              ))}
            </nav>

            {/* Grid de Produtos */}
            <div className="cdp-products">
              {produtosFiltrados.length === 0 ? (
                <div className="cdp-empty">
                  <p>Nenhum produto encontrado</p>
                </div>
              ) : (
                produtosFiltrados.map(p => {
                  const preco = p.tamanhos && p.tamanhos.length > 0
                    ? Math.min(...p.tamanhos.map(t => Number(t.preco)))
                    : Number(p.preco);
                  const temVariacao = p.tamanhos && p.tamanhos.length > 0;
                  return (
                    <button key={p.id} className="cdp-product-card" onClick={() => openProduto(p)}>
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt={p.nome} className="cdp-product-img" loading="lazy" />
                      ) : (
                        <div className="cdp-product-img-ph">
                          <span>{CAT_EMOJI[p.categoria || "outro"] || "🍽️"}</span>
                        </div>
                      )}
                      <div className="cdp-product-info">
                        <h3 className="cdp-product-name">{p.nome}</h3>
                        {p.descricao && <p className="cdp-product-desc">{p.descricao}</p>}
                        <div className="cdp-product-price-row">
                          {temVariacao && <span className="cdp-price-from">a partir de</span>}
                          <span className="cdp-price">{fmt(preco)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Carrinho flutuante */}
            {cartCount > 0 && (
              <div className="cdp-floating-cart" onClick={() => setStep("carrinho")}>
                <div className="cdp-floating-cart-info">
                  <span className="cdp-floating-cart-badge">{cartCount}</span>
                  <span>Ver pedido</span>
                </div>
                <span className="cdp-floating-cart-total">{fmt(cartTotal)}</span>
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
// CSS completo — tema escuro premium, mobile-first
// ============================================
const CSS = `
/* ============ RESET & ROOT ============ */
.cdp-root {
  --bg: #0f1117;
  --bg2: #1a1d27;
  --bg3: #242836;
  --text: #f0f1f5;
  --text2: #9ca3b4;
  --text3: #636b80;
  --accent: #f97316;
  --accent2: #fb923c;
  --accent-glow: rgba(249,115,22,0.15);
  --green: #22c55e;
  --red: #ef4444;
  --radius: 16px;
  --radius-sm: 12px;

  min-height: 100vh;
  background: #090a0f;
  color: var(--text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex;
  justify-content: center;
}
.cdp-root *, .cdp-root *::before, .cdp-root *::after { box-sizing: border-box; margin: 0; padding: 0; }

.cdp-wrapper {
  width: 100%;
  max-width: 600px;
  min-height: 100vh;
  background: var(--bg);
  box-shadow: 0 0 50px rgba(0,0,0,0.8);
  display: flex;
  flex-direction: column;
  position: relative;
  padding-bottom: 120px;
}

/* ============ LOADING & ERROR ============ */
.cdp-loading, .cdp-error {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: var(--bg); color: var(--text);
  font-family: 'Inter', sans-serif;
}
.cdp-spinner {
  width: 40px; height: 40px; border: 3px solid var(--bg3);
  border-top-color: var(--accent); border-radius: 50%;
  animation: cdp-spin 0.8s linear infinite;
}
@keyframes cdp-spin { to { transform: rotate(360deg); } }
.cdp-error-emoji { font-size: 48px; }
.cdp-error h2 { font-size: 20px; font-weight: 700; }
.cdp-error p { color: var(--text2); font-size: 14px; }

/* ============ HEADER ============ */
.cdp-header {
  position: relative; padding: 40px 20px 24px;
  text-align: center; overflow: hidden;
}
.cdp-header-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #f9731622, #fb923c11, transparent);
}
.cdp-header-content { position: relative; z-index: 1; }
.cdp-logo {
  width: 80px; height: 80px; border-radius: 20px;
  object-fit: cover; border: 3px solid var(--bg3);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.cdp-logo-placeholder {
  width: 80px; height: 80px; border-radius: 20px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 36px; box-shadow: 0 8px 32px rgba(249,115,22,0.2);
}
.cdp-name { font-size: 24px; font-weight: 800; margin-top: 12px; letter-spacing: -0.5px; }
.cdp-status-row { display: flex; gap: 12px; align-items: center; justify-content: center; margin-top: 8px; }
.cdp-status { font-size: 13px; font-weight: 600; }
.cdp-status.open { color: var(--green); }
.cdp-status.closed { color: var(--red); }
.cdp-tempo { font-size: 13px; color: var(--text2); }
.cdp-endereco { font-size: 12px; color: var(--text3); margin-top: 6px; }

/* ============ SEARCH ============ */
.cdp-search-wrap {
  padding: 0 16px; margin-top: 8px; position: relative;
}
.cdp-search {
  width: 100%; padding: 12px 40px 12px 16px;
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); color: var(--text);
  font-size: 14px; outline: none;
  transition: border-color 0.2s;
}
.cdp-search:focus { border-color: var(--accent); }
.cdp-search::placeholder { color: var(--text3); }
.cdp-search-clear {
  position: absolute; right: 28px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--text3); cursor: pointer;
  font-size: 16px; padding: 4px;
}

/* ============ CATEGORIES ============ */
.cdp-cats {
  display: flex; gap: 8px; padding: 16px;
  overflow-x: auto; scrollbar-width: none;
}
.cdp-cats::-webkit-scrollbar { display: none; }
.cdp-cat-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 24px;
  background: var(--bg2); border: 1px solid var(--bg3);
  color: var(--text2); font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: all 0.2s;
  text-transform: capitalize;
}
.cdp-cat-btn.active {
  background: var(--accent); border-color: var(--accent);
  color: white; box-shadow: 0 4px 16px rgba(249,115,22,0.25);
}
.cdp-cat-btn:not(.active):hover { border-color: var(--accent); color: var(--text); }

/* ============ PRODUCTS GRID ============ */
.cdp-products {
  display: grid; grid-template-columns: 1fr; gap: 12px;
  padding: 0 16px;
}
@media (min-width: 480px) { .cdp-products { grid-template-columns: 1fr 1fr; } }

.cdp-product-card {
  display: flex; gap: 12px; padding: 12px;
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); cursor: pointer;
  transition: all 0.25s; text-align: left;
  color: inherit;
}
.cdp-product-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.cdp-product-img, .cdp-product-img-ph {
  width: 80px; height: 80px; border-radius: var(--radius-sm);
  object-fit: cover; flex-shrink: 0;
}
.cdp-product-img-ph {
  background: var(--bg3); display: flex; align-items: center;
  justify-content: center; font-size: 28px;
}
.cdp-product-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.cdp-product-name { font-size: 14px; font-weight: 700; line-height: 1.3; }
.cdp-product-desc {
  font-size: 12px; color: var(--text3); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.cdp-product-price-row { display: flex; align-items: baseline; gap: 4px; margin-top: 4px; }
.cdp-price-from { font-size: 10px; color: var(--text3); }
.cdp-price { font-size: 15px; font-weight: 800; color: var(--accent); }

.cdp-empty { grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text3); }

/* ============ FLOATING CART ============ */
.cdp-floating-cart {
  position: fixed; bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 32px);
  max-width: 568px;
  background: var(--accent); color: white;
  border-radius: var(--radius); padding: 14px 20px;
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; z-index: 50;
  box-shadow: 0 8px 32px rgba(249,115,22,0.3);
  transition: transform 0.2s;
  animation: cdp-slideUp 0.3s ease-out forwards;
}
.cdp-floating-cart:hover { transform: translateX(-50%) translateY(-2px); }
@keyframes cdp-slideUp {
  from { transform: translateX(-50%) translateY(100%); opacity: 0; }
  to { transform: translateX(-50%) translateY(0); opacity: 1; }
}
.cdp-floating-cart-info { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
.cdp-floating-cart-badge {
  width: 24px; height: 24px; border-radius: 50%;
  background: rgba(255,255,255,0.25); display: flex;
  align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
}
.cdp-floating-cart-total { font-weight: 800; font-size: 16px; }

/* ============ HEADER BAR ============ */
.cdp-header-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-bottom: 1px solid var(--bg3);
  background: var(--bg2);
}
.cdp-header-bar h2 { font-size: 18px; font-weight: 700; }
.cdp-back-btn {
  background: none; border: none; color: var(--accent);
  font-size: 14px; font-weight: 600; cursor: pointer;
  padding: 4px;
}

/* ============ CART ============ */
.cdp-cart { padding: 16px; }
.cdp-cart-empty {
  text-align: center; padding: 60px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.cdp-cart-empty-icon { font-size: 48px; opacity: 0.5; }
.cdp-cart-empty p { color: var(--text3); }

.cdp-cart-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px; background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius-sm); margin-bottom: 8px; gap: 12px;
}
.cdp-cart-item-info { flex: 1; min-width: 0; }
.cdp-cart-item-info strong { font-size: 14px; display: block; }
.cdp-cart-item-tag { font-size: 11px; color: var(--accent); background: var(--accent-glow); padding: 2px 8px; border-radius: 6px; margin-top: 4px; display: inline-block; }
.cdp-cart-item-extras { font-size: 11px; color: var(--text3); display: block; margin-top: 2px; }
.cdp-cart-item-obs { font-size: 11px; color: var(--text3); display: block; margin-top: 2px; }
.cdp-cart-item-controls { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.cdp-cart-item-price { font-size: 14px; font-weight: 700; color: var(--accent); white-space: nowrap; }
.cdp-cart-remove { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 16px; padding: 4px; }
.cdp-cart-remove:hover { color: var(--red); }

.cdp-cart-footer { margin-top: 16px; }
.cdp-cart-total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; margin-bottom: 16px; }

/* ============ QTY CONTROLS ============ */
.cdp-qty-controls {
  display: flex; align-items: center; gap: 0;
  background: var(--bg3); border-radius: 10px; overflow: hidden;
}
.cdp-qty-controls button {
  width: 32px; height: 32px; background: transparent; border: none;
  color: var(--text); font-size: 16px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.cdp-qty-controls button:hover { background: var(--accent); color: white; }
.cdp-qty-controls span { min-width: 24px; text-align: center; font-weight: 700; font-size: 14px; }
.cdp-qty-lg button { width: 44px; height: 44px; font-size: 20px; }
.cdp-qty-lg span { min-width: 36px; font-size: 18px; }

/* ============ PRODUTO DETAIL ============ */
.cdp-produto-media-header {
  position: relative;
  width: 100%;
  height: 280px;
  background: var(--bg2);
}
.cdp-produto-banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cdp-produto-banner-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--bg2), var(--bg3));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 80px;
}
.cdp-btn-back-circle {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.2s;
  z-index: 10;
}
.cdp-btn-back-circle:hover {
  background: rgba(0, 0, 0, 0.7);
  transform: scale(1.05);
}

.cdp-produto-detail {
  padding: 0 0 120px;
  display: flex;
  flex-direction: column;
}
.cdp-produto-info-header {
  padding: 20px 16px;
}
.cdp-produto-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--text);
  margin-bottom: 8px;
}
.cdp-produto-desc {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text2);
  margin-bottom: 12px;
}
.cdp-produto-price-badge {
  display: inline-block;
  font-size: 18px;
  font-weight: 800;
  color: var(--accent);
  background: var(--accent-glow);
  padding: 6px 12px;
  border-radius: var(--radius-sm);
}

.cdp-section {
  padding: 20px 16px;
  border-top: 1px solid var(--bg3);
}
.cdp-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.cdp-section-header h3 {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.cdp-badge-required {
  font-size: 11px;
  font-weight: 600;
  background: var(--bg3);
  color: var(--accent);
  padding: 4px 8px;
  border-radius: 20px;
}
.cdp-badge-optional {
  font-size: 11px;
  font-weight: 600;
  background: rgba(255,255,255,0.05);
  color: var(--text3);
  padding: 4px 8px;
  border-radius: 20px;
}

.cdp-tamanho-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cdp-tamanho-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: var(--bg2);
  border: 1px solid var(--bg3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
  transition: all 0.2s;
  outline: none;
}
.cdp-tamanho-btn:hover {
  border-color: var(--accent2);
}
.cdp-tamanho-btn.active {
  border-color: var(--accent);
  background: var(--accent-glow);
}
.cdp-tamanho-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cdp-tamanho-radio-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--text3);
  display: inline-block;
  position: relative;
  transition: all 0.2s;
}
.cdp-tamanho-btn.active .cdp-tamanho-radio-icon {
  border-color: var(--accent);
}
.cdp-tamanho-btn.active .cdp-tamanho-radio-icon::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.cdp-tamanho-name {
  font-size: 15px;
  font-weight: 600;
}
.cdp-tamanho-price {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
}

.cdp-adicionais-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cdp-adicional-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: var(--bg2);
  border: 1px solid var(--bg3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.cdp-adicional-item:hover {
  border-color: var(--accent2);
}
.cdp-adicional-item.active {
  border-color: var(--accent);
  background: var(--accent-glow);
}
.cdp-adicional-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cdp-checkbox-input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  cursor: pointer;
}
.cdp-adicional-name {
  font-size: 14px;
  font-weight: 500;
}
.cdp-adicional-price {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
}

.cdp-textarea-observacoes {
  width: 100%;
  padding: 14px;
  background: var(--bg2);
  border: 1px solid var(--bg3);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 14px;
  outline: none;
  resize: none;
  transition: border-color 0.2s;
  font-family: inherit;
}
.cdp-textarea-observacoes:focus {
  border-color: var(--accent);
}

.cdp-produto-footer {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 600px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg2);
  border-top: 1px solid var(--bg3);
  z-index: 50;
  box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
}
.cdp-btn-add { flex: 1; height: 48px; font-size: 16px; }

/* ============ BUTTONS ============ */
.cdp-btn-primary {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: white; border: none; border-radius: var(--radius-sm);
  font-weight: 700; font-size: 15px; cursor: pointer;
  padding: 12px 24px; transition: all 0.2s;
  box-shadow: 0 4px 16px rgba(249,115,22,0.25);
}
.cdp-btn-primary:hover { opacity: 0.92; transform: translateY(-1px); }
.cdp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.cdp-btn-lg { width: 100%; padding: 16px; font-size: 16px; }
.cdp-btn-secondary {
  background: var(--bg3); color: var(--text); border: none;
  border-radius: var(--radius-sm); font-weight: 600; font-size: 14px;
  cursor: pointer; padding: 10px 20px;
}

/* ============ CHECKOUT ============ */
.cdp-checkout { padding: 16px; }
.cdp-checkout-section {
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); padding: 16px; margin-bottom: 12px;
}
.cdp-checkout-section h3 { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
.cdp-checkout-item {
  display: flex; justify-content: space-between; padding: 6px 0;
  font-size: 14px;
}
.cdp-checkout-item-price { font-weight: 600; white-space: nowrap; }
.cdp-checkout-taxa { color: var(--text2); border-top: 1px dashed var(--bg3); margin-top: 6px; padding-top: 6px; }
.cdp-checkout-total { border-top: 2px solid var(--accent); margin-top: 8px; padding-top: 10px; font-size: 16px; }
.cdp-checkout-total-price { color: var(--accent); font-weight: 800; font-size: 18px; }

.cdp-input {
  width: 100%; padding: 12px 14px;
  background: var(--bg); border: 1px solid var(--bg3);
  border-radius: var(--radius-sm); color: var(--text);
  font-size: 14px; outline: none; margin-bottom: 8px;
  transition: border-color 0.2s;
}
.cdp-input:focus { border-color: var(--accent); }
.cdp-input::placeholder { color: var(--text3); }
.cdp-textarea {
  width: 100%; padding: 12px 14px;
  background: var(--bg); border: 1px solid var(--bg3);
  border-radius: var(--radius-sm); color: var(--text);
  font-size: 14px; outline: none; resize: vertical;
  font-family: inherit;
}
.cdp-textarea:focus { border-color: var(--accent); }
.cdp-textarea::placeholder { color: var(--text3); }
.cdp-input-row { display: flex; gap: 8px; }

.cdp-toggle-group { display: flex; gap: 8px; }
.cdp-toggle-btn {
  flex: 1; padding: 12px; background: var(--bg); border: 2px solid var(--bg3);
  border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
  font-weight: 600; cursor: pointer; transition: all 0.2s; text-align: center;
}
.cdp-toggle-btn.active { border-color: var(--accent); background: var(--accent-glow); }
.cdp-toggle-btn:hover { border-color: var(--accent); }

.cdp-payment-options { display: flex; flex-wrap: wrap; gap: 8px; }
.cdp-payment-btn {
  padding: 10px 16px; background: var(--bg); border: 2px solid var(--bg3);
  border-radius: var(--radius-sm); color: var(--text); font-size: 13px;
  font-weight: 600; cursor: pointer; transition: all 0.2s;
}
.cdp-payment-btn.active { border-color: var(--accent); background: var(--accent-glow); }
.cdp-payment-btn:hover { border-color: var(--accent); }

.cdp-taxa-info { font-size: 13px; color: var(--accent); margin-top: 4px; }
.cdp-error-inline { padding: 10px 14px; background: #ef444420; border: 1px solid #ef444440; border-radius: var(--radius-sm); color: var(--red); font-size: 13px; margin-bottom: 12px; }
.cdp-btn-submit { margin-top: 8px; }

/* ============ CONFIRMAÇÃO ============ */
.cdp-confirmacao {
  text-align: center; padding: 60px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.cdp-confirmacao-icon { font-size: 64px; animation: cdp-bounce 0.6s ease-out; }
@keyframes cdp-bounce { 0%{transform:scale(0)} 50%{transform:scale(1.2)} 100%{transform:scale(1)} }
.cdp-confirmacao h2 { font-size: 22px; font-weight: 800; }
.cdp-confirmacao-sub { color: var(--text2); font-size: 14px; max-width: 300px; line-height: 1.5; }
.cdp-confirmacao-info {
  background: var(--bg2); border: 1px solid var(--bg3);
  border-radius: var(--radius); padding: 16px 24px; margin: 12px 0;
  display: flex; flex-direction: column; gap: 6px; font-size: 14px;
}
.cdp-confirmacao-info small { color: var(--text3); }

/* ============ SCROLLBAR ============ */
.cdp-root ::-webkit-scrollbar { width: 4px; height: 4px; }
.cdp-root ::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 2px; }
`;
