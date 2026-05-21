import React, { useState } from "react";
import { 
  UtensilsCrossed, 
  ToggleLeft, 
  ToggleRight, 
  Edit, 
  Copy, 
  Trash2, 
  Plus, 
  Upload, 
  BookOpen, 
  X, 
  ChevronRight,
  Sparkles,
  Layers
} from "lucide-react";
import { Product, ProductGroup } from "../types";

interface MenuManagementViewProps {
  products: Product[];
  onCreateProduct: (fields: Omit<Product, 'id' | 'pizzeriaId' | 'order'>) => void;
  onUpdateProduct: (id: string, fields: Partial<Product>) => void;
  onDeleteProduct: (id: string) => void;
}

export function MenuManagementView({
  products,
  onCreateProduct,
  onUpdateProduct,
  onDeleteProduct
}: MenuManagementViewProps) {
  const [activeTab, setActiveTab] = useState<ProductGroup>("pizza");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form states
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<ProductGroup>("pizza");
  const [formPrice, setFormPrice] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");

  const categories: { value: ProductGroup; label: string; icon: string }[] = [
    { value: "pizza", label: "Pizzas", icon: "🍕" },
    { value: "lanche", label: "Lanches", icon: "🍔" },
    { value: "bebida", label: "Bebidas", icon: "🥤" },
    { value: "sobremesa", label: "Sobremesas", icon: "🍮" },
    { value: "outro", label: "Outros", icon: "🍟" }
  ];

  const handleOpenCreateModal = () => {
    setEditingProduct(null);
    setFormName("");
    setFormDescription("");
    setFormCategory(activeTab);
    setFormPrice("");
    setFormImageUrl("https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=60");
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormDescription(p.description);
    setFormCategory(p.category);
    setFormPrice(p.price.toString());
    setFormImageUrl(p.imageUrl);
    setIsEditModalOpen(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(formPrice) || 0;

    const payload = {
      name: formName,
      description: formDescription,
      category: formCategory,
      price: priceNum,
      imageUrl: formImageUrl || "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=60",
      available: editingProduct ? editingProduct.available : true
    };

    if (editingProduct) {
      onUpdateProduct(editingProduct.id, payload);
    } else {
      onCreateProduct(payload);
    }
    
    setIsEditModalOpen(false);
  };

  // Duplicate product for sizes variations (P/M/G) as described in 4.2
  const handleDuplicate = (p: Product, sizeLetter: "P" | "M" | "G") => {
    const sizeOffsets = { P: 0.8, M: 1.0, G: 1.25 };
    const labelSizes = { P: "(P)", M: "(M)", G: "(G)" };

    const payload = {
      category: p.category,
      name: `${p.name} ${labelSizes[sizeLetter]}`,
      description: `${p.description} - Tamanho individual / específico.`,
      price: parseFloat((p.price * sizeOffsets[sizeLetter]).toFixed(2)),
      imageUrl: p.imageUrl,
      available: p.available
    };

    onCreateProduct(payload);
  };

  // Simple duplicate for any category (PRD 4.2 — "Opção de duplicar produto")
  const handleSimpleCopy = (p: Product) => {
    onCreateProduct({
      category: p.category,
      name: `${p.name} (cópia)`,
      description: p.description,
      price: p.price,
      imageUrl: p.imageUrl,
      available: p.available
    });
  };

  const activeProducts = products.filter(p => p.category === activeTab);

  return (
    <div className="space-y-6">
      
      {/* Title & Actions row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Gestão do Cardápio
          </h1>
          <p className="text-sm text-slate-500 font-sans">
            Adicione pratos, modifique preços, duplique por tamanhos (P/M/G) e controle disponibilidades instantaneamente.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors rounded-lg shadow-sm font-sans"
        >
          <Plus className="w-4.5 h-4.5" />
          Adicionar Novo Produto
        </button>
      </div>

      {/* Tabs list with categories */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 overflow-x-auto pb-1 mt-2">
        {categories.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 flex items-center gap-1.5 font-sans whitespace-nowrap ${
              activeTab === tab.value
                ? "border-orange-600 text-orange-700 bg-orange-50/10 font-bold"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="text-sm leading-none">{tab.icon}</span>
            {tab.label}
            <span className="p-0.5 px-1.5 text-[9px] bg-slate-100 text-slate-500 font-mono rounded-full">
              {products.filter(p => p.category === tab.value).length}
            </span>
          </button>
        ))}
      </div>

      {/* Products list Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeProducts.map((p) => (
          <div
            key={p.id}
            className={`bg-white border border-slate-150 rounded-xl overflow-hidden shadow-2xs transition-all flex flex-col justify-between ${
              !p.available ? "opacity-55 scale-[0.98] border-dashed" : "hover:shadow-xs hover:border-slate-200"
            }`}
          >
            {/* Image frame with available trigger sticker */}
            <div className="h-40 relative bg-slate-100">
              <img
                src={p.imageUrl}
                alt={p.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              {!p.available && (
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-3xs flex items-center justify-center font-bold font-mono text-white text-xs tracking-widest uppercase">
                  Indisponível no WhatsApp
                </div>
              )}
              
              {/* Category tag */}
              <span className="absolute top-3 left-3 px-2 py-0.5 bg-slate-800/80 backdrop-blur-xs text-[9px] text-white font-mono font-bold uppercase rounded-md tracking-wider">
                {p.category}
              </span>
            </div>

            {/* Product description content */}
            <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-850 font-sans leading-snug">
                    {p.name}
                  </h3>
                  <span className="text-sm font-bold text-slate-900 font-mono flex-none">
                    R$ {p.price.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-sans leading-relaxed line-clamp-3">
                  {p.description}
                </p>
              </div>

              {/* Operations triggers row */}
              <div className="pt-3.5 border-t border-slate-50 flex items-center justify-between gap-4">
                {/* Instant green toggle switch (4.2 change instantly) */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdateProduct(p.id, { available: !p.available })}
                    className="p-1"
                    title={p.available ? "Marcar como indisponível" : "Marcar como disponível" }
                  >
                    {p.available ? (
                      <ToggleRight className="w-8 h-8 text-emerald-500 hover:text-emerald-600 transition-colors" />
                    ) : (
                      <ToggleLeft className="w-8 h-8 text-slate-350 hover:text-slate-450 transition-colors" />
                    )}
                  </button>
                  <span className="text-[10px] font-bold uppercase font-mono text-slate-400">
                    {p.available ? "Ativo" : "Pausado"}
                  </span>
                </div>

                {/* Duplication & Actions links */}
                <div className="flex items-center gap-1 onClickStop">
                  {/* Quick simple duplicate for any product */}
                  <button
                    onClick={() => handleSimpleCopy(p)}
                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                    title="Duplicar produto (criar cópia editável)"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  {/* Duplication menu quick actions for P/M/G sizing variations */}
                  {p.category === "pizza" && (
                    <div className="group relative">
                      <button
                        className="p-1.5 text-slate-400 hover:text-orange-500 hover:bg-slate-50 rounded"
                        title="Duplicar Pizza por tamanho (P/M/G)"
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                      <div className="absolute right-0 bottom-8 z-10 hidden group-hover:block bg-white border border-slate-200 shadow-lg rounded-lg p-1 text-left min-w-[120px] font-semibold text-xs text-slate-700">
                        <div className="px-2 py-1 text-[9px] text-slate-400 uppercase font-mono font-bold tracking-wider mb-1">Escolher Tamanho</div>
                        <button onClick={() => handleDuplicate(p, "P")} className="w-full px-2 py-1.5 hover:bg-slate-50 text-left rounded">Pequena (P)</button>
                        <button onClick={() => handleDuplicate(p, "M")} className="w-full px-2 py-1.5 hover:bg-slate-50 text-left rounded">Média (M)</button>
                        <button onClick={() => handleDuplicate(p, "G")} className="w-full px-2 py-1.5 hover:bg-slate-50 text-left rounded">Grande (G)</button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => handleOpenEditModal(p)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded"
                    title="Editar Informações"
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      if (confirm(`Tem certeza de que prefere apagar "${p.name}"? Esta ação não pode ser desfeita.`)) {
                        onDeleteProduct(p.id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded"
                    title="Excluir produto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {activeProducts.length === 0 && (
          <div className="col-span-1 md:col-span-3 py-16 text-center border border-dashed rounded-xl border-slate-200 text-slate-400 space-y-2">
            <UtensilsCrossed className="w-10 h-10 text-slate-300 mx-auto stroke-1" />
            <p className="text-sm font-semibold text-slate-500 font-sans">Sem itens cadastrados nesta categoria</p>
            <p className="text-xs text-slate-400 font-sans">Cadastre novas variedades clicando em Adicionar Novo Produto.</p>
          </div>
        )}
      </div>

      {/* Modal: Creation/Edition Form Sheet */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-100">
            {/* Header */}
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-orange-600 font-mono">Formulário Digital</span>
                <h3 className="text-sm font-bold text-slate-850 font-sans">
                  {editingProduct ? `Editar ${editingProduct.name}` : "Cadastrar Novo Produto"}
                </h3>
              </div>
              <button onClick={() => setIsEditModalOpen(false)} className="p-1 hover:bg-slate-200 rounded">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSaveProduct} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Nome do Produto</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Pizza Pepperoni com Mel"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden transition-all text-slate-800 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Preço Atual (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="49.90"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden transition-all text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Categoria</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden transition-all text-slate-800 font-sans"
                  >
                    <option value="pizza">Pizzas</option>
                    <option value="lanche">Lanches</option>
                    <option value="bebida">Bebidas</option>
                    <option value="sobremesa">Sobremesas</option>
                    <option value="outro font-sans">Outros</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Descrição Rica (Suporta Ingredientes / Observações)</label>
                <textarea
                  required
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Descreva detalhadamente o item e tamanho médio. Ex: Molho de tomate especial da casa, muçarela, orégano fatiado."
                  rows={3}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden transition-all text-slate-800 font-sans leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Link de Imagem Pública (URL)</label>
                <input
                  type="text"
                  value={formImageUrl}
                  onChange={(e) => setFormImageUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/photo-..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden transition-all text-slate-800 font-sans"
                />
                <span className="text-[9px] text-slate-400 mt-1 block leading-tight font-sans">
                  Insira uma URL com imagem de pizza do Unsplash ou similar.
                </span>
              </div>

              {/* Footer Buttons inside modal */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-500 hover:text-slate-700 transition-all font-semibold font-sans"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs text-white bg-orange-600 hover:bg-orange-700 transition-all rounded-lg font-bold shadow-sm font-sans"
                >
                  {editingProduct ? "Salvar Alterações" : "Cadastrar Produto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
