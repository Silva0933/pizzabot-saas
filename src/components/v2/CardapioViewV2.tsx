/**
 * Cardápio v2 — listagem, criar/editar/remover produtos.
 * Conectado ao backend Python.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X, AlertCircle, RefreshCw, UtensilsCrossed, ImageOff } from "lucide-react";
import { cardapioApi, BackendProduto } from "../../lib/api";

interface Props { pizzariaId: string; }

const CATEGORIAS = ["pizza", "lanche", "bebida", "sobremesa", "outro"] as const;

const CAT_STYLE: Record<string, { emoji: string; chip: string }> = {
  pizza:     { emoji: "🍕", chip: "bg-orange-100 text-orange-700" },
  lanche:    { emoji: "🍔", chip: "bg-amber-100 text-amber-700" },
  bebida:    { emoji: "🥤", chip: "bg-sky-100 text-sky-700" },
  sobremesa: { emoji: "🍰", chip: "bg-pink-100 text-pink-700" },
  outro:     { emoji: "🍽️", chip: "bg-slate-100 text-slate-600" },
};

type Form = Omit<BackendProduto, "id" | "pizzaria_id">;

const EMPTY: Form = {
  nome: "", categoria: "pizza", descricao: "", preco: 0,
  disponivel: true, imagem_url: "", ordem: 0,
};

export function CardapioViewV2({ pizzariaId }: Props) {
  const [produtos, setProdutos] = useState<BackendProduto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<BackendProduto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState(false);

  // Categorias = padrões + as que já existem no cardápio (o dono pode adicionar novas).
  const categoriasDisponiveis = useMemo(() => {
    const set = new Set<string>(CATEGORIAS as readonly string[]);
    for (const p of produtos) if (p.categoria) set.add(p.categoria);
    if (form.categoria) set.add(form.categoria);
    return Array.from(set);
  }, [produtos, form.categoria]);

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
    setCreating(true);
    setForm(EMPTY);
    setNovaCategoria(false);
  }
  function startEdit(p: BackendProduto) {
    setCreating(false);
    setEditing(p);
    setNovaCategoria(false);
    setForm({
      nome: p.nome, categoria: p.categoria ?? "outro", descricao: p.descricao ?? "",
      preco: Number(p.preco), disponivel: p.disponivel, imagem_url: p.imagem_url ?? "", ordem: p.ordem,
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

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-orange-500"/></div>;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white grid place-items-center shadow-sm shadow-orange-500/20">
            <UtensilsCrossed className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Cardápio</h2>
            <p className="text-sm text-slate-500">{produtos.length} {produtos.length === 1 ? "item" : "itens"} vendidos pelo seu bot.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reindex}
            disabled={reindexing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium"
          >
            {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
            Reindexar busca
          </button>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 text-white rounded-xl font-medium shadow-sm shadow-orange-500/20"
          >
            <Plus className="w-4 h-4"/> Novo produto
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          <AlertCircle className="w-4 h-4"/> {err}
        </div>
      )}

      {(creating || editing) && (
        <div className="bg-white border-2 border-orange-200 rounded-2xl p-4 space-y-3 shadow-sm">
          <h3 className="font-semibold text-sm text-slate-800">{editing ? "Editar produto" : "Novo produto"}</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Nome" required>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={inputCls}/>
            </Field>
            <Field label="Categoria">
              {novaCategoria ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={form.categoria ?? ""}
                    onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                    className={inputCls}
                    placeholder="Nome da nova categoria"
                  />
                  <button type="button" onClick={() => setNovaCategoria(false)}
                    className="px-2 text-xs text-slate-500 hover:bg-slate-100 rounded-lg shrink-0">
                    Lista
                  </button>
                </div>
              ) : (
                <select
                  value={form.categoria ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "__nova__") { setNovaCategoria(true); setForm({ ...form, categoria: "" }); }
                    else setForm({ ...form, categoria: e.target.value });
                  }}
                  className={inputCls}
                >
                  {categoriasDisponiveis.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__nova__">➕ Nova categoria…</option>
                </select>
              )}
            </Field>
            <Field label="Preço (R$)" required>
              <input type="number" step="0.01" value={form.preco}
                onChange={(e) => setForm({ ...form, preco: Number(e.target.value) })} className={inputCls}/>
            </Field>
            <Field label="Ordem (menor primeiro)">
              <input type="number" value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })} className={inputCls}/>
            </Field>
            <Field label="Descrição" full>
              <textarea value={form.descricao ?? ""} rows={2}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })} className={inputCls}/>
            </Field>
            <Field label="URL da imagem" full>
              <input value={form.imagem_url ?? ""} onChange={(e) => setForm({ ...form, imagem_url: e.target.value })} className={inputCls}/>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.disponivel}
                onChange={(e) => setForm({ ...form, disponivel: e.target.checked })}/>
              Disponível
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md flex items-center gap-1">
              <X className="w-4 h-4"/> Cancelar
            </button>
            <button onClick={save} disabled={saving || !form.nome || !form.preco}
              className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center gap-1 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
              Salvar
            </button>
          </div>
        </div>
      )}

      {produtos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-orange-50 grid place-items-center mx-auto mb-3">
            <UtensilsCrossed className="w-7 h-7 text-orange-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">Cardápio vazio</p>
          <p className="text-xs text-slate-400 mt-1">Comece criando o primeiro produto.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {produtos.map((p) => {
            const cat = CAT_STYLE[p.categoria ?? "outro"] || CAT_STYLE.outro;
            return (
              <article key={p.id}
                className={`group bg-white border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all ${p.disponivel ? "border-slate-200" : "border-slate-200 opacity-70"}`}>
                <div className="relative h-28 bg-gradient-to-br from-orange-100 to-rose-100 grid place-items-center overflow-hidden">
                  {p.imagem_url ? (
                    <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl select-none">{cat.emoji}</span>
                  )}
                  <span className={`absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cat.chip}`}>
                    {p.categoria || "outro"}
                  </span>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const originalValue = p.disponivel;
                      const newValue = !originalValue;
                      
                      // Atualização otimista
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
                        });
                        // Reindexa silenciosamente no backend
                        await cardapioApi.reindex(pizzariaId);
                      } catch (err: any) {
                        setErr(err.message || "Erro ao atualizar disponibilidade.");
                        // Reverte em caso de falha
                        setProdutos((prev) =>
                          prev.map((item) => (item.id === p.id ? { ...item, disponivel: originalValue } : item))
                        );
                      }
                    }}
                    className={`absolute top-2 right-2 text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-sm transition-all cursor-pointer border ${
                      p.disponivel
                        ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                        : "bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                    }`}
                    title={p.disponivel ? "Marcar como Indisponível" : "Marcar como Disponível"}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${p.disponivel ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`} />
                    {p.disponivel ? "Disponível" : "Indisponível"}
                  </button>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-sm text-slate-800 leading-tight">{p.nome}</h4>
                    <span className="text-sm font-bold text-emerald-600 whitespace-nowrap">
                      {Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                  {p.descricao && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.descricao}</p>}
                  <div className="flex gap-1 mt-3 pt-2.5 border-t border-slate-100">
                    <button onClick={() => startEdit(p)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium">
                      <Pencil className="w-3.5 h-3.5"/> Editar
                    </button>
                    <button onClick={() => remove(p)}
                      className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg font-medium">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
