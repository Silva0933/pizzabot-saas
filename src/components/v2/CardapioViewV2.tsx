/**
 * Cardápio v2 — listagem, criar/editar/remover produtos.
 * Conectado ao backend Python.
 * Reformulado para visual premium, layout em Slide-over e abas.
 */
import React, { useEffect, useMemo, useState } from "react";
import { 
  Loader2, Plus, Pencil, Trash2, Save, X, AlertCircle, RefreshCw, 
  UtensilsCrossed, ImageOff, FileText, Upload, Sparkles, Search, 
  Check, Eye, EyeOff, LayoutGrid, Tag, SlidersHorizontal, Settings
} from "lucide-react";
import { cardapioApi, BackendProduto, CardapioArquivoInfo, ProdutoImport } from "../../lib/api";

interface Props { pizzariaId: string; }

const CATEGORIAS = ["pizza", "lanche", "bebida", "sobremesa", "outro"] as const;

const CAT_STYLE: Record<string, { emoji: string; chip: string; bg: string }> = {
  todos:     { emoji: "🍽️", chip: "bg-slate-100 text-slate-700", bg: "from-slate-500 to-slate-600" },
  pizza:     { emoji: "🍕", chip: "bg-orange-50 text-orange-700 border-orange-100", bg: "from-orange-500 to-rose-500" },
  lanche:    { emoji: "🍔", chip: "bg-amber-50 text-amber-700 border-amber-100", bg: "from-amber-500 to-amber-600" },
  bebida:    { emoji: "🥤", chip: "bg-sky-50 text-sky-700 border-sky-100", bg: "from-sky-500 to-blue-600" },
  sobremesa: { emoji: "🍰", chip: "bg-pink-50 text-pink-700 border-pink-100", bg: "from-pink-500 to-rose-500" },
  outro:     { emoji: "🍽️", chip: "bg-slate-50 text-slate-700 border-slate-100", bg: "from-slate-400 to-slate-500" },
};

type Form = Omit<BackendProduto, "id" | "pizzaria_id">;

const EMPTY: Form = {
  nome: "", categoria: "pizza", descricao: "", preco: 0,
  disponivel: true, imagem_url: "", ordem: 0, tamanhos: null,
  aliases: [], tags: [], 
  opcoes: { adicionais: [] }, 
  regras: { meia_meia: { permitido: false, calculo: "maior_valor", max_sabores: 2 } },
};

// =========================================================
// Componente Auxiliar: ChipsInput
// =========================================================
interface ChipsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

function ChipsInput({ value, onChange, placeholder }: ChipsInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addChip = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addChip();
    }
  };

  const removeChip = (indexToRemove: number) => {
    onChange(value.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition"
        />
        <button
          type="button"
          onClick={addChip}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
        >
          Adicionar
        </button>
      </div>
      {value && value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-100 rounded-xl max-h-32 overflow-y-auto">
          {value.map((chip, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 text-xs text-slate-700 rounded-lg font-medium shadow-sm hover:border-slate-300 transition"
            >
              {chip}
              <button
                type="button"
                onClick={() => removeChip(idx)}
                className="text-slate-400 hover:text-red-500 font-bold ml-1 transition"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-slate-400 italic">Nenhum item adicionado ainda.</p>
      )}
    </div>
  );
}

// =========================================================
// Componente Principal: CardapioViewV2
// =========================================================
export function CardapioViewV2({ pizzariaId }: Props) {
  const [produtos, setProdutos] = useState<BackendProduto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  
  // Painel lateral e Formulário
  const [editing, setEditing] = useState<BackendProduto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState(false);
  const [activeTab, setActiveTab] = useState<"geral" | "tamanhos" | "adicionais" | "seo">("geral");

  // Filtros e Busca na listagem
  const [selectedCategory, setSelectedCategory] = useState<string>("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingStatus, setLoadingStatus] = useState<Record<string, boolean>>({});

  // Categorias disponíveis no cardápio
  const categoriasDisponiveis = useMemo(() => {
    const set = new Set<string>(CATEGORIAS as readonly string[]);
    for (const p of produtos) if (p.categoria) set.add(p.categoria);
    if (form.categoria) set.add(form.categoria);
    return Array.from(set);
  }, [produtos, form.categoria]);

  // Lista única de categorias para filtrar
  const categoriasUnicasFiltro = useMemo(() => {
    const set = new Set<string>(["todos"]);
    for (const p of produtos) {
      if (p.categoria) set.add(p.categoria);
    }
    CATEGORIAS.forEach(c => set.add(c));
    return Array.from(set);
  }, [produtos]);

  function load() {
    setLoading(true);
    cardapioApi.list(pizzariaId)
      .then(setProdutos)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [pizzariaId]);

  function startCreate() {
    setEditing(null);
    setForm({
      ...EMPTY,
      opcoes: { adicionais: [] },
      regras: { meia_meia: { permitido: false, calculo: "maior_valor", max_sabores: 2 } }
    });
    setNovaCategoria(false);
    setActiveTab("geral");
    setCreating(true);
  }

  function startEdit(p: BackendProduto) {
    setCreating(false);
    setEditing(p);
    setNovaCategoria(false);
    setActiveTab("geral");

    const opcoes = p.opcoes || {};
    const regras = p.regras || {};

    setForm({
      nome: p.nome,
      categoria: p.categoria ?? "outro",
      descricao: p.descricao ?? "",
      preco: Number(p.preco),
      disponivel: p.disponivel,
      imagem_url: p.imagem_url ?? "",
      ordem: p.ordem,
      tamanhos: p.tamanhos ? p.tamanhos.map(t => ({ tamanho: t.tamanho, preco: Number(t.preco) })) : null,
      aliases: p.aliases || [],
      tags: p.tags || [],
      opcoes: {
        ...opcoes,
        adicionais: (opcoes as any)?.adicionais || []
      },
      regras: {
        ...regras,
        meia_meia: {
          permitido: Boolean((regras as any)?.meia_meia?.permitido),
          calculo: (regras as any)?.meia_meia?.calculo || "maior_valor",
          max_sabores: Number((regras as any)?.meia_meia?.max_sabores) || 2
        }
      },
    });
  }

  function cancel() {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY);
    setNovaCategoria(false);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body = { ...form, preco: Number(form.preco) || 0 };
      if (editing) {
        await cardapioApi.update(pizzariaId, editing.id, body);
      } else {
        await cardapioApi.create(pizzariaId, body);
      }
      cancel();
      load();
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  async function remove(p: BackendProduto) {
    if (!confirm(`Remover "${p.nome}"?`)) return;
    try {
      await cardapioApi.delete(pizzariaId, p.id);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function reindex() {
    setReindexing(true);
    try {
      const r = await cardapioApi.reindex(pizzariaId);
      alert(`Reindexado: ${r.produtos} produtos.`);
    } catch (e: any) { setErr(e.message); }
    setReindexing(false);
  }

  const toggleDisponivel = async (p: BackendProduto) => {
    if (loadingStatus[p.id]) return;
    
    setLoadingStatus(prev => ({ ...prev, [p.id]: true }));
    const originalValue = p.disponivel;
    const newValue = !originalValue;
    
    // Atualização otimista no UI
    setProdutos((prev) =>
      prev.map((item) => (item.id === p.id ? { ...item, disponivel: newValue } : item))
    );
    
    try {
      await cardapioApi.update(pizzariaId, p.id, {
        nome: p.nome,
        categoria: p.categoria ?? "outro",
        descricao: p.descricao ?? "",
        preco: Number(p.preco),
        imagem_url: p.imagem_url ?? "",
        ordem: p.ordem,
        disponivel: newValue,
        tamanhos: p.tamanhos ? p.tamanhos.map(t => ({ tamanho: t.tamanho, preco: Number(t.preco) })) : null,
        aliases: p.aliases || [],
        tags: p.tags || [],
        opcoes: p.opcoes || {},
        regras: p.regras || {},
      });
      // Reindexa silenciosamente no backend
      await cardapioApi.reindex(pizzariaId);
    } catch (err: any) {
      setErr(err.message || "Erro ao atualizar disponibilidade.");
      // Reverte em caso de falha
      setProdutos((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, disponivel: originalValue } : item))
      );
    } finally {
      setLoadingStatus(prev => ({ ...prev, [p.id]: false }));
    }
  };

  // Filtragem de produtos no frontend
  const produtosFiltrados = useMemo(() => {
    return produtos.filter((p) => {
      const matchesCategory = selectedCategory === "todos" || p.categoria === selectedCategory;
      const matchesSearch =
        !searchQuery.trim() ||
        p.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.descricao || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.aliases || []).some((a) => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [produtos, selectedCategory, searchQuery]);

  const isFormPanelOpen = creating || editing !== null;

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-3">
      <Loader2 className="w-8 h-8 animate-spin text-orange-500"/>
      <span className="text-sm font-medium text-slate-500">Carregando cardápio...</span>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-6 space-y-6">
      {/* Header do Cardápio */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white grid place-items-center shadow-lg shadow-orange-500/25">
            <UtensilsCrossed className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Cardápio</h2>
            <p className="text-xs text-slate-500">Total: {produtos.length} {produtos.length === 1 ? "item cadastrado" : "itens cadastrados"}.</p>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button
            onClick={reindex}
            disabled={reindexing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl font-semibold transition"
          >
            {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
            Reindexar busca
          </button>
          <ImportarCardapio pizzariaId={pizzariaId} onImported={load} />
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-95 text-white rounded-xl font-bold shadow-md shadow-orange-500/10 transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            <Plus className="w-4 h-4"/> Novo produto
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm shadow-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500"/>
          <span className="font-medium">{err}</span>
        </div>
      )}

      {/* PDF/Imagem de cardápio */}
      <CardapioArquivo pizzariaId={pizzariaId} />

      {/* Filtros e Busca */}
      <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="Pesquisar produto por nome, tag ou apelido..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
              >
                &times;
              </button>
            )}
          </div>
          <div className="text-xs text-slate-400 font-medium whitespace-nowrap self-center">
            Mostrando {produtosFiltrados.length} de {produtos.length} produtos
          </div>
        </div>

        {/* Abas das Categorias */}
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-none border-t border-slate-50 pt-3">
          {categoriasUnicasFiltro.map((catName) => {
            const style = CAT_STYLE[catName] || CAT_STYLE.outro;
            const isActive = selectedCategory === catName;
            return (
              <button
                key={catName}
                onClick={() => setSelectedCategory(catName)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl border transition-all shrink-0 ${
                  isActive
                    ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                    : "bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <span>{style.emoji}</span>
                <span className="capitalize">{catName === "todos" ? "Todos" : catName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid de Produtos */}
      {produtosFiltrados.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-3xl p-16 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 grid place-items-center mx-auto mb-4 text-orange-400 shadow-inner">
            <UtensilsCrossed className="w-7 h-7" />
          </div>
          <p className="text-slate-700 font-bold text-base">Nenhum produto encontrado</p>
          <p className="text-xs text-slate-400 mt-1.5">Experimente limpar a busca ou os filtros de categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {produtosFiltrados.map((p) => {
            const cat = CAT_STYLE[p.categoria ?? "outro"] || CAT_STYLE.outro;
            const isDisponivel = p.disponivel;
            return (
              <article 
                key={p.id}
                className={`group bg-white border rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 flex flex-col ${
                  isDisponivel ? "border-slate-100" : "border-slate-200 opacity-75"
                }`}
              >
                {/* Banner de Imagem */}
                <div className="relative h-32 bg-gradient-to-br from-slate-50 to-slate-100 grid place-items-center overflow-hidden">
                  {p.imagem_url ? (
                    <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                  ) : (
                    <span className="text-5xl select-none group-hover:scale-110 transition duration-500">{cat.emoji}</span>
                  )}
                  
                  {/* Categoria Badge */}
                  <span className={`absolute top-2.5 left-2.5 text-[9px] font-extrabold px-2.5 py-1 rounded-lg border capitalize tracking-wider ${cat.chip}`}>
                    {p.categoria || "outro"}
                  </span>
                  
                  {/* Toggle de Disponibilidade Rápido */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDisponivel(p);
                    }}
                    disabled={loadingStatus[p.id]}
                    className={`absolute top-2.5 right-2.5 text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-sm transition-all duration-200 border cursor-pointer ${
                      isDisponivel
                        ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-100"
                        : "bg-red-50 hover:bg-red-100 text-red-700 border-red-100"
                    }`}
                  >
                    {loadingStatus[p.id] ? (
                      <Loader2 className="w-3 h-3 animate-spin text-slate-500" />
                    ) : (
                      <span className={`w-1.5 h-1.5 rounded-full ${isDisponivel ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
                    )}
                    {isDisponivel ? "Ativo" : "Pausado"}
                  </button>
                </div>

                {/* Corpo do Card */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-sm text-slate-800 group-hover:text-orange-500 transition-colors duration-200 leading-tight">
                        {p.nome}
                      </h4>
                      <span className="text-sm font-extrabold text-slate-800 whitespace-nowrap text-right shrink-0">
                        {p.tamanhos && p.tamanhos.length > 0 ? (
                          <span className="block">
                            <span className="text-[9px] text-slate-400 font-medium block leading-none">A partir de</span>
                            <span className="text-emerald-600 block mt-0.5">
                              {Math.min(...p.tamanhos.map(t => Number(t.preco))).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </span>
                        ) : (
                          <span className="text-emerald-600 block">
                            {Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Descrição */}
                    {p.descricao && (
                      <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 italic leading-relaxed">
                        {p.descricao}
                      </p>
                    )}

                    {/* Listagem de Variações */}
                    {p.tamanhos && p.tamanhos.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-50 space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Tamanhos:</span>
                        <div className="flex flex-wrap gap-1">
                          {p.tamanhos.map((t, idx) => (
                            <span key={idx} className="text-[9px] bg-slate-50 border border-slate-100 px-2 py-0.5 rounded text-slate-600 font-semibold shadow-2xs">
                              {t.tamanho}: <span className="text-emerald-600 font-bold">R${Number(t.preco).toFixed(1)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tags do produto */}
                    {((p.tags && p.tags.length > 0) || (p.aliases && p.aliases.length > 0)) && (
                      <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-slate-50">
                        {p.tags?.map((t, idx) => (
                          <span key={`tag-${idx}`} className="text-[9px] bg-amber-50 text-amber-700 border border-amber-100/50 px-1.5 py-0.5 rounded-lg font-medium">
                            #{t}
                          </span>
                        ))}
                        {p.aliases?.map((a, idx) => (
                          <span key={`alias-${idx}`} className="text-[9px] bg-violet-50 text-violet-700 border border-violet-100/50 px-1.5 py-0.5 rounded-lg font-medium">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex gap-2 pt-3 border-t border-slate-50">
                    <button 
                      onClick={() => startEdit(p)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-slate-200 rounded-xl font-bold transition duration-200"
                    >
                      <Pencil className="w-3.5 h-3.5"/> Editar
                    </button>
                    <button 
                      onClick={() => remove(p)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-xl font-bold transition duration-200"
                    >
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* =========================================================
          SLIDE-OVER (PAINEL LATERAL DE CADASTRO/EDIÇÃO)
         ========================================================= */}
      <div 
        className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${
          isFormPanelOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Overlay escuro desfocado */}
        <div 
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
          onClick={cancel} 
        />
        
        <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
          <div 
            className={`w-screen max-w-xl bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
              isFormPanelOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {/* Header do Slide-over */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-extrabold text-base text-slate-800">
                  {editing ? "Editar Produto" : "Novo Produto"}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {editing ? `Alterando "${form.nome}"` : "Cadastre as informações da variação ou produto único"}
                </p>
              </div>
              <button 
                onClick={cancel} 
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Abas de Navegação do Formulário */}
            <div className="flex border-b border-slate-100 px-4 bg-slate-50/50">
              {([
                ["geral", "Geral", <LayoutGrid className="w-3.5 h-3.5" />],
                ["tamanhos", "Tamanhos & Preços", <SlidersHorizontal className="w-3.5 h-3.5" />],
                ["adicionais", "Adicionais & Regras", <Plus className="w-3.5 h-3.5" />],
                ["seo", "Busca & Tags", <Tag className="w-3.5 h-3.5" />]
              ] as const).map(([id, label, icon]) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 transition-all -mb-px ${
                      isActive
                        ? "border-orange-500 text-orange-600"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Conteúdo do Formulário */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              
              {/* ABA 1: INFORMAÇÕES GERAIS */}
              {activeTab === "geral" && (
                <div className="space-y-4 animate-fadeIn">
                  <Field label="Nome do Produto" required>
                    <input 
                      value={form.nome} 
                      onChange={(e) => setForm({ ...form, nome: e.target.value })} 
                      placeholder="Ex: Pizza Calabresa, Refrigerante Guaraná"
                      className={inputCls}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Categoria">
                      {novaCategoria ? (
                        <div className="flex gap-1.5">
                          <input
                            autoFocus
                            value={form.categoria ?? ""}
                            onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                            className={inputCls}
                            placeholder="Nome da categoria"
                          />
                          <button 
                            type="button" 
                            onClick={() => setNovaCategoria(false)}
                            className="px-2 text-xs font-bold text-orange-500 hover:bg-orange-50 rounded-xl shrink-0"
                          >
                            Lista
                          </button>
                        </div>
                      ) : (
                        <select
                          value={form.categoria ?? ""}
                          onChange={(e) => {
                            if (e.target.value === "__nova__") { 
                              setNovaCategoria(true); 
                              setForm({ ...form, categoria: "" }); 
                            } else {
                              setForm({ ...form, categoria: e.target.value });
                            }
                          }}
                          className={inputCls}
                        >
                          {categoriasDisponiveis.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          <option value="__nova__">➕ Criar categoria…</option>
                        </select>
                      )}
                    </Field>

                    <Field label="Ordem de exibição">
                      <input 
                        type="number" 
                        value={form.ordem}
                        onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} 
                        className={inputCls}
                      />
                    </Field>
                  </div>

                  {form.tamanhos === null && (
                    <Field label="Preço Unitário (R$)" required>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">R$</span>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={form.preco || ""}
                          placeholder="0,00"
                          onChange={(e) => setForm({ ...form, preco: Number(e.target.value) })} 
                          className={`${inputCls} pl-8`}
                        />
                      </div>
                    </Field>
                  )}

                  <Field label="Descrição / Ingredientes">
                    <textarea 
                      value={form.descricao ?? ""} 
                      rows={3}
                      placeholder="Massa tradicional, molho de tomate, calabresa fatiada, cebola e azeitonas pretas."
                      onChange={(e) => setForm({ ...form, descricao: e.target.value })} 
                      className={inputCls}
                    />
                  </Field>

                  <Field label="URL da Imagem do Produto">
                    <input 
                      value={form.imagem_url ?? ""} 
                      placeholder="https://suaimagem.com/foto.jpg"
                      onChange={(e) => setForm({ ...form, imagem_url: e.target.value })} 
                      className={inputCls}
                    />
                  </Field>

                  {form.imagem_url && (
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pré-visualização:</span>
                      <img 
                        src={form.imagem_url} 
                        alt="Preview" 
                        onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                        className="max-h-36 rounded-lg object-cover mx-auto" 
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={form.disponivel}
                      onChange={(e) => setForm({ ...form, disponivel: e.target.checked })}
                      className="rounded text-orange-500 focus:ring-orange-300"
                    />
                    <span className="text-xs font-bold text-slate-700">Disponível no cardápio do bot</span>
                  </label>
                </div>
              )}

              {/* ABA 2: TAMANHOS E VARIAÇÕES */}
              {activeTab === "tamanhos" && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="p-3 bg-orange-50 border border-orange-100 rounded-xl space-y-1.5">
                    <h4 className="text-xs font-bold text-orange-800">Múltiplos Tamanhos ou Preços</h4>
                    <p className="text-[10px] text-orange-600 leading-normal">
                      Habilite esta opção se o mesmo produto for vendido em formatos diferentes (Ex: Pizza P, M e G ou Refrigerante Lata e 2L).
                    </p>
                  </div>

                  <label className="flex items-center gap-2.5 p-3 border border-slate-100 bg-slate-50/50 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.tamanhos !== null}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setForm({ ...form, tamanhos: [{ tamanho: "Único", preco: Number(form.preco) || 0 }] });
                        } else {
                          setForm({ ...form, tamanhos: null });
                        }
                      }}
                      className="rounded text-orange-500 focus:ring-orange-300"
                    />
                    <span className="text-xs font-bold text-slate-700">
                      Este produto tem múltiplos tamanhos / variações
                    </span>
                  </label>

                  {form.tamanhos !== null ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-xs font-bold text-slate-700">Lista de Variações</span>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = form.tamanhos || [];
                            setForm({ ...form, tamanhos: [...cur, { tamanho: "", preco: 0 }] });
                          }}
                          className="text-xs text-orange-500 hover:text-orange-600 font-bold inline-flex items-center gap-1 bg-orange-50 px-2.5 py-1.5 rounded-lg border border-orange-100 transition"
                        >
                          <Plus className="w-3.5 h-3.5" /> Adicionar tamanho
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {(form.tamanhos || []).map((t, idx) => (
                          <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2 border border-slate-100 rounded-xl shadow-2xs">
                            <input
                              placeholder="Tamanho (ex: Grande, Lata, 2L)"
                              value={t.tamanho}
                              onChange={(e) => {
                                const newT = [...(form.tamanhos || [])];
                                newT[idx] = { ...newT[idx], tamanho: e.target.value };
                                setForm({ ...form, tamanhos: newT });
                              }}
                              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none bg-white focus:border-orange-400"
                            />
                            <div className="relative w-28 shrink-0">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">R$</span>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="0,00"
                                value={t.preco || ""}
                                onChange={(e) => {
                                  const newT = [...(form.tamanhos || [])];
                                  newT[idx] = { ...newT[idx], preco: Number(e.target.value) || 0 };
                                  setForm({ ...form, tamanhos: newT });
                                }}
                                className="w-full pl-7 pr-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none bg-white focus:border-orange-400"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newT = (form.tamanhos || []).filter((_, i) => i !== idx);
                                setForm({ ...form, tamanhos: newT.length > 0 ? newT : [] });
                              }}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg hover:text-red-700 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-slate-100 bg-slate-50 rounded-2xl">
                      <p className="text-xs text-slate-400 italic">Configure o preço único na aba "Geral" ou habilite as variações acima.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 3: ADICIONAIS E REGRAS */}
              {activeTab === "adicionais" && (
                <div className="space-y-4 animate-fadeIn">
                  
                  {/* Seção Adicionais e Bordas */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Adicionais e Bordas</h4>
                    <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                      Digite os adicionais ou complementos permitidos para este produto (Ex: Borda Catupiry, Massa Grossa, Bacon Extra). Aperte Enter para inserir.
                    </p>
                    <ChipsInput 
                      value={(form.opcoes as any)?.adicionais || []}
                      onChange={(val) => setForm({ 
                        ...form, 
                        opcoes: { ...(form.opcoes || {}), adicionais: val } 
                      })}
                      placeholder="Adicione um complemento e tecle Enter..."
                    />
                  </div>

                  {/* Seção Regras Meia-Meia (Apenas para Categoria Pizza) */}
                  {form.categoria === "pizza" ? (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Regras de Meia / Meia</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Defina se este produto aceita combinação de múltiplos sabores e como será calculado o preço.
                      </p>
                      
                      <div className="bg-slate-50 p-3.5 border border-slate-100 rounded-xl space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean((form.regras as any)?.meia_meia?.permitido)}
                            onChange={(e) => setForm({
                              ...form,
                              regras: {
                                ...(form.regras || {}),
                                meia_meia: { ...((form.regras as any)?.meia_meia || {}), permitido: e.target.checked },
                              },
                            })}
                            className="rounded text-orange-500 focus:ring-orange-300"
                          />
                          <span className="text-xs font-bold text-slate-700">Permitir divisão de sabores (meia-meia)</span>
                        </label>

                        {Boolean((form.regras as any)?.meia_meia?.permitido) && (
                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/50">
                            <Field label="Cálculo do Preço">
                              <select
                                value={(form.regras as any)?.meia_meia?.calculo || "maior_valor"}
                                onChange={(e) => setForm({
                                  ...form,
                                  regras: {
                                    ...(form.regras || {}),
                                    meia_meia: { ...((form.regras as any)?.meia_meia || {}), calculo: e.target.value },
                                  },
                                })}
                                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none bg-white"
                              >
                                <option value="maior_valor">Maior valor</option>
                                <option value="media">Média dos valores</option>
                              </select>
                            </Field>

                            <Field label="Máximo Sabores">
                              <input
                                type="number"
                                min="1"
                                max="4"
                                value={(form.regras as any)?.meia_meia?.max_sabores ?? 2}
                                onChange={(e) => setForm({
                                  ...form,
                                  regras: {
                                    ...(form.regras || {}),
                                    meia_meia: { ...((form.regras as any)?.meia_meia || {}), max_sabores: Number(e.target.value) || 2 },
                                  },
                                })}
                                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none bg-white"
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 border border-slate-100 bg-slate-50 rounded-2xl">
                      <p className="text-[10px] text-slate-400 italic">As configurações de meio-a-meio são exclusivas para a categoria "pizza".</p>
                    </div>
                  )}
                </div>
              )}

              {/* ABA 4: BUSCA E TAGS */}
              {activeTab === "seo" && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Apelidos / Buscas (Aliases)</h4>
                    <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                      Adicione sinônimos ou termos comuns que seus clientes usam no WhatsApp para chamar este produto (Ex: "coca", "refri", "lata"). Isso melhora o entendimento do bot de IA.
                    </p>
                    <ChipsInput 
                      value={form.aliases || []}
                      onChange={(val) => setForm({ ...form, aliases: val })}
                      placeholder="Escreva um apelido e tecle Enter..."
                    />
                  </div>

                  <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Tags de Identificação</h4>
                    <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                      Crie tags para categorizar ou sinalizar propriedades do produto (Ex: "semcebola", "vegano", "apimentada").
                    </p>
                    <ChipsInput 
                      value={form.tags || []}
                      onChange={(val) => setForm({ ...form, tags: val })}
                      placeholder="Escreva uma tag e tecle Enter..."
                    />
                  </div>
                </div>
              )}

            </div>

            {/* Rodapé do Slide-over */}
            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
              <button 
                type="button"
                onClick={cancel} 
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl font-bold transition flex items-center gap-1"
              >
                <X className="w-4 h-4"/> Cancelar
              </button>
              <button 
                type="button"
                onClick={save} 
                disabled={saving || !form.nome || (form.tamanhos === null && !form.preco)}
                className="px-5 py-2 text-sm bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-95 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/10 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                Salvar Produto
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// =========================================================
// Componente Auxiliar: CardapioArquivo
// =========================================================
function CardapioArquivo({ pizzariaId }: { pizzariaId: string }) {
  const [info, setInfo] = useState<CardapioArquivoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function load() {
    cardapioApi.arquivoInfo(pizzariaId).then(setInfo).catch(() => setInfo({ existe: false }));
  }
  useEffect(load, [pizzariaId]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      await cardapioApi.uploadArquivo(pizzariaId, file);
      load();
    } catch (e: any) { setErr(e.message || "Falha no upload."); }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }
  async function remover() {
    if (!confirm("Remover o arquivo de cardápio?")) return;
    setBusy(true); setErr(null);
    try { await cardapioApi.removerArquivo(pizzariaId); setInfo({ existe: false }); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const isImg = (info?.content_type || "").startsWith("image/");
  const url = info?.existe ? `${cardapioApi.arquivoUrl(pizzariaId)}?t=${Date.now()}` : "";

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-500 text-white grid place-items-center shrink-0 shadow-sm shadow-blue-500/10">
          <FileText className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-extrabold text-slate-800">Cardápio em PDF / Imagem</h3>
          <p className="text-xs text-slate-500 leading-tight mt-0.5">
            {info?.existe
              ? `Enviado: ${info.filename} · Enviado no WhatsApp quando pedem o cardápio completo.`
              : "Opcional. O bot envia este arquivo quando o cliente pede o cardápio no WhatsApp."}
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-2 w-full md:w-auto justify-end shrink-0">
        <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onPick} className="hidden" />
        <button 
          onClick={() => inputRef.current?.click()} 
          disabled={busy}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 rounded-xl font-bold transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {info?.existe ? "Trocar arquivo" : "Enviar arquivo"}
        </button>
        {info?.existe && (
          <>
            {isImg ? (
              <a href={url} target="_blank" rel="noreferrer" className="px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl font-bold transition">
                Visualizar
              </a>
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl font-bold transition">
                Abrir PDF
              </a>
            )}
            <button 
              onClick={remover} 
              disabled={busy}
              className="p-2 text-red-500 hover:bg-red-50 rounded-xl border border-transparent hover:border-red-100 transition disabled:opacity-50" 
              title="Remover arquivo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

// =========================================================
// Componente Auxiliar: ImportarCardapio
// =========================================================
type ImportMode = "imagem" | "texto" | "json";

const JSON_EXEMPLO = `[
  { "nome": "Calabresa (G)", "categoria": "pizza", "descricao": "Calabresa, cebola, mussarela", "preco": 52 },
  { "nome": "Coca-Cola 2L", "categoria": "bebida", "descricao": "", "preco": 12 }
]`;

function ImportarCardapio({ pizzariaId, onImported }: { pizzariaId: string; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("imagem");
  const [texto, setTexto] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [extraindo, setExtraindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [itens, setItens] = useState<ProdutoImport[] | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setTexto(""); setJsonText(""); setItens(null); setErr(null);
    setExtraindo(false); setSalvando(false);
    if (fileRef.current) fileRef.current.value = "";
  }
  function close() { setOpen(false); reset(); }

  async function extrairArquivo(file: File) {
    setExtraindo(true); setErr(null);
    try {
      const r = await cardapioApi.importarExtrair(pizzariaId, { file });
      setItens(r.produtos);
      if (!r.produtos.length) setErr("A IA não encontrou produtos. Tente uma imagem mais nítida ou cole o texto.");
    } catch (e: any) { setErr(e.message || "Falha ao extrair."); }
    setExtraindo(false);
  }
  async function extrairTexto() {
    if (!texto.trim()) return;
    setExtraindo(true); setErr(null);
    try {
      const r = await cardapioApi.importarExtrair(pizzariaId, { texto });
      setItens(r.produtos);
      if (!r.produtos.length) setErr("A IA não encontrou produtos no texto.");
    } catch (e: any) { setErr(e.message || "Falha ao extrair."); }
    setExtraindo(false);
  }
  function carregarJson() {
    setErr(null);
    try {
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data)) throw new Error("O JSON precisa ser uma lista [].");
      const norm: ProdutoImport[] = data.map((d: any) => ({
        nome: String(d.nome || "").trim(),
        categoria: String(d.categoria || "outro").toLowerCase(),
        descricao: String(d.descricao || ""),
        preco: Number(d.preco) || 0,
      })).filter((p: ProdutoImport) => p.nome);
      if (!norm.length) throw new Error("Nenhum produto válido no JSON.");
      setItens(norm);
    } catch (e: any) { setErr("JSON inválido: " + (e.message || "")); }
  }

  function setItem(i: number, patch: Partial<ProdutoImport>) {
    setItens((arr) => arr ? arr.map((p, idx) => idx === i ? { ...p, ...patch } : p) : arr);
  }
  function removeItem(i: number) {
    setItens((arr) => arr ? arr.filter((_, idx) => idx !== i) : arr);
  }

  async function confirmar() {
    if (!itens?.length) return;
    const validos = itens.filter((p) => p.nome.trim() && (Number(p.preco) > 0 || (p.tamanhos && p.tamanhos.length > 0)));
    if (!validos.length) { setErr("Nenhum produto com nome e preço/tamanhos válidos."); return; }
    setSalvando(true); setErr(null);
    try {
      const r = await cardapioApi.importarConfirmar(pizzariaId, validos);
      onImported();
      close();
      alert(`${r.criados} produto(s) importado(s)! 🎉`);
    } catch (e: any) { setErr(e.message || "Falha ao salvar."); setSalvando(false); }
  }

  return (
    <>
      <button 
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-xs bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-100 rounded-xl font-bold transition"
      >
        <Sparkles className="w-3.5 h-3.5 text-violet-500" /> Importar com IA
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn" onClick={() => !extraindo && !salvando && close()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white flex items-center justify-between shadow-md">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-violet-200" />
                <h3 className="font-extrabold tracking-tight">Importar Cardápio com Inteligência Artificial</h3>
              </div>
              <button onClick={close} className="p-1.5 rounded-xl hover:bg-white/20 transition"><X className="w-4.5 h-4.5" /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {!itens ? (
                <>
                  <div className="flex gap-1.5 flex-wrap">
                    {([["imagem","Imagem / PDF"],["texto","Colar texto"],["json","Colar JSON"]] as [ImportMode,string][]).map(([m,l]) => (
                      <button 
                        key={m} 
                        onClick={() => { setMode(m); setErr(null); }}
                        className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all ${
                          mode === m 
                            ? "bg-violet-600 text-white border-violet-600 shadow-sm" 
                            : "bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100"
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>

                  {mode === "imagem" && (
                    <div className="space-y-2">
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) extrairArquivo(f); }} />
                      <button 
                        onClick={() => fileRef.current?.click()} 
                        disabled={extraindo}
                        className="w-full border-2 border-dashed border-violet-200 hover:border-violet-400 rounded-2xl py-12 flex flex-col items-center justify-center text-violet-600 hover:bg-violet-50/50 disabled:opacity-50 transition duration-300"
                      >
                        {extraindo ? (
                          <div className="flex flex-col items-center space-y-2">
                            <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                            <span className="text-xs font-bold text-slate-500">Lendo arquivo e buscando produtos...</span>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 mb-2 text-violet-400" />
                            <span className="text-sm font-bold">Enviar foto ou PDF do cardápio físico</span>
                            <span className="text-[10px] text-slate-400 mt-1">PNG, JPG, WEBP ou PDF de até 12MB</span>
                          </>
                        )}
                      </button>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Nossa IA analisará a foto e listará os produtos com nome, descrição, categoria e preços. Você revisará todos os dados antes de persistir no sistema.
                      </p>
                    </div>
                  )}

                  {mode === "texto" && (
                    <div className="space-y-3">
                      <textarea 
                        value={texto} 
                        onChange={(e) => setTexto(e.target.value)} 
                        rows={8}
                        placeholder="Cole aqui o texto cru do cardápio, incluindo nomes, descrições, preços e variações de tamanho..." 
                        className={inputCls} 
                      />
                      <button 
                        onClick={extrairTexto} 
                        disabled={extraindo || !texto.trim()}
                        className="px-5 py-2.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-50 transition shadow-sm"
                      >
                        {extraindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Extrair Produtos com IA
                      </button>
                    </div>
                  )}

                  {mode === "json" && (
                    <div className="space-y-3">
                      <p className="text-[10px] text-slate-500">Cole um JSON formatado na estrutura correta:</p>
                      <pre className="text-[9px] bg-slate-50 border border-slate-100 rounded-xl p-3 overflow-x-auto text-slate-600 font-mono leading-normal">{JSON_EXEMPLO}</pre>
                      <textarea 
                        value={jsonText} 
                        onChange={(e) => setJsonText(e.target.value)} 
                        rows={6}
                        placeholder='[{ "nome": "Calabresa", "categoria": "pizza", "preco": 48.00 }]' 
                        className={`${inputCls} font-mono text-xs`} 
                      />
                      <button 
                        onClick={carregarJson} 
                        disabled={!jsonText.trim()}
                        className="px-5 py-2.5 text-xs bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold disabled:opacity-50 transition"
                      >
                        Carregar e Revisar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Tela de Revisão */
                <div className="space-y-3">
                  <div className="p-3 bg-violet-50 border border-violet-100 rounded-xl">
                    <p className="text-xs font-bold text-violet-800">Revisão de Produtos Extraídos</p>
                    <p className="text-[10px] text-violet-600">
                      Encontramos {itens.length} itens. Confira atentamente os nomes, categorias e preços e ajuste se necessário antes de confirmar.
                    </p>
                  </div>
                  
                  <div className="border border-slate-150 rounded-2xl divide-y divide-slate-100 max-h-[48vh] overflow-y-auto shadow-inner bg-slate-50/20">
                    {itens.map((p, i) => (
                      <div key={i} className="p-3 flex gap-2.5 items-center flex-wrap sm:flex-nowrap">
                        <input 
                          value={p.nome} 
                          onChange={(e) => setItem(i, { nome: e.target.value })}
                          className="flex-1 min-w-[150px] px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-violet-400 bg-white" 
                          placeholder="Nome do produto" 
                        />
                        <select 
                          value={p.categoria} 
                          onChange={(e) => setItem(i, { categoria: e.target.value })}
                          className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none bg-white font-medium"
                        >
                          {["pizza","lanche","bebida","sobremesa","outro"].map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <div className="w-36 shrink-0 text-right">
                          {p.tamanhos && p.tamanhos.length > 0 ? (
                            <span className="text-[9px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 rounded font-bold block text-center truncate">
                              {p.tamanhos.length} var. ({Math.min(...p.tamanhos.map(t => Number(t.preco)))} min)
                            </span>
                          ) : (
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold">R$</span>
                              <input 
                                type="number" 
                                step="0.01" 
                                value={p.preco} 
                                onChange={(e) => setItem(i, { preco: Number(e.target.value) })}
                                className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-violet-400 bg-white" 
                              />
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => removeItem(i)} 
                          className="p-1.5 text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-lg transition"
                          title="Remover produto da importação"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={() => setItens(null)} 
                    className="text-xs font-bold text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    ← Voltar e reenviar
                  </button>
                </div>
              )}

              {err && <p className="text-xs font-medium text-red-600 bg-red-50 p-2.5 border border-red-100 rounded-xl">{err}</p>}
            </div>

            {itens && (
              <div className="px-5 py-4 border-t border-slate-150 bg-slate-50 flex justify-end gap-2 shrink-0">
                <button 
                  onClick={close} 
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/50 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmar} 
                  disabled={salvando}
                  className="px-5 py-2 text-xs bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-95 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-md shadow-violet-500/10 disabled:opacity-50 transition"
                >
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Importar {itens.length} Produto(s)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Estilos Utilitários
const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition bg-white";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-bold block mb-1">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
