/**
 * Cardápio v2 — listagem, criar/editar/remover produtos.
 * Conectado ao backend Python.
 */
import React, { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X, AlertCircle, RefreshCw } from "lucide-react";
import { cardapioApi, BackendProduto } from "../../lib/api";

interface Props { pizzariaId: string; }

const CATEGORIAS = ["pizza", "lanche", "bebida", "sobremesa", "outro"] as const;

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
  }
  function startEdit(p: BackendProduto) {
    setCreating(false);
    setEditing(p);
    setForm({
      nome: p.nome, categoria: p.categoria ?? "outro", descricao: p.descricao ?? "",
      preco: Number(p.preco), disponivel: p.disponivel, imagem_url: p.imagem_url ?? "", ordem: p.ordem,
    });
  }
  function cancel() {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY);
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
        <div>
          <h2 className="text-xl font-bold text-slate-800">Cardápio</h2>
          <p className="text-sm text-slate-500">Itens vendidos pelo seu bot.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reindex}
            disabled={reindexing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md"
          >
            {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
            Reindexar busca
          </button>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md font-medium"
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
        <div className="bg-white border border-orange-200 rounded-lg p-4 space-y-3 shadow-sm">
          <h3 className="font-semibold text-sm text-slate-800">{editing ? "Editar produto" : "Novo produto"}</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Nome" required>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={inputCls}/>
            </Field>
            <Field label="Categoria">
              <select value={form.categoria ?? "outro"} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className={inputCls}>
                {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
              </select>
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs text-slate-500 uppercase">
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2 text-right">Preço</th>
              <th className="px-3 py-2 text-center">Disponível</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {produtos.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                Sem produtos cadastrados. Comece criando o primeiro.
              </td></tr>
            )}
            {produtos.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">{p.nome}</td>
                <td className="px-3 py-2 text-slate-500 text-xs">{p.categoria || "—"}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700">
                  {Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
                <td className="px-3 py-2 text-center">
                  {p.disponivel ? "✓" : <span className="text-red-500">×</span>}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  <button onClick={() => startEdit(p)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded">
                    <Pencil className="w-3.5 h-3.5"/>
                  </button>
                  <button onClick={() => remove(p)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                    <Trash2 className="w-3.5 h-3.5"/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputCls = "w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-sm focus:border-orange-400 outline-none";

function Field({ label, children, required, full }: any) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs text-slate-600 font-medium">{label}{required && " *"}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
