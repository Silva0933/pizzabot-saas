/**
 * Cardápio v2 — listagem, criar/editar/remover produtos.
 * Conectado ao backend Python.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X, AlertCircle, RefreshCw, UtensilsCrossed, ImageOff, FileText, Upload, Sparkles } from "lucide-react";
import { cardapioApi, BackendProduto, CardapioArquivoInfo, ProdutoImport } from "../../lib/api";

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
  disponivel: true, imagem_url: "", ordem: 0, tamanhos: null
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
      tamanhos: p.tamanhos ? p.tamanhos.map(t => ({ tamanho: t.tamanho, preco: Number(t.preco) })) : null,
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
          <ImportarCardapio pizzariaId={pizzariaId} onImported={load} />
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

      <CardapioArquivo pizzariaId={pizzariaId} />

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
            <Field label="Preço (R$)" required={form.tamanhos === null}>
              <input type="number" step="0.01" 
                value={form.tamanhos !== null && form.tamanhos.length > 0 ? Math.min(...form.tamanhos.map(t => t.preco)) : form.preco}
                disabled={form.tamanhos !== null}
                onChange={(e) => setForm({ ...form, preco: Number(e.target.value) })} className={inputCls}/>
            </Field>

            <div className="md:col-span-2 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
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
                />
                Este produto tem múltiplos tamanhos / variações
              </label>

              {form.tamanhos !== null && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Tamanhos e Preços</span>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = form.tamanhos || [];
                        setForm({ ...form, tamanhos: [...cur, { tamanho: "", preco: 0 }] });
                      }}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Adicionar Variação
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {(form.tamanhos || []).map((t, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          placeholder="Nome do tamanho (ex: P, M, G, 2 Litros)"
                          value={t.tamanho}
                          onChange={(e) => {
                            const newT = [...(form.tamanhos || [])];
                            newT[idx] = { ...newT[idx], tamanho: e.target.value };
                            setForm({ ...form, tamanhos: newT });
                          }}
                          className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-orange-400"
                        />
                        <div className="relative w-28 shrink-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">R$</span>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Preço"
                            value={t.preco || ""}
                            onChange={(e) => {
                              const newT = [...(form.tamanhos || [])];
                              newT[idx] = { ...newT[idx], preco: Number(e.target.value) || 0 };
                              setForm({ ...form, tamanhos: newT });
                            }}
                            className="w-full pl-7 pr-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-orange-400"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newT = (form.tamanhos || []).filter((_, i) => i !== idx);
                            setForm({ ...form, tamanhos: newT.length > 0 ? newT : [] });
                          }}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
                    <span className="text-sm font-bold text-emerald-600 whitespace-nowrap text-right shrink-0">
                      {p.tamanhos && p.tamanhos.length > 0 ? (
                        <span className="text-[10px] text-slate-400 font-normal block">
                          A partir de{" "}
                          <span className="text-sm font-bold text-emerald-600 block">
                            {Math.min(...p.tamanhos.map(t => Number(t.preco))).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </span>
                        </span>
                      ) : (
                        Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      )}
                    </span>
                  </div>
                  {p.tamanhos && p.tamanhos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 mb-2">
                      {p.tamanhos.map((t, idx) => (
                        <span key={idx} className="text-[9px] bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-medium">
                          {t.tamanho}: R${Number(t.preco).toFixed(1)}
                        </span>
                      ))}
                    </div>
                  )}
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
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-500 text-white grid place-items-center shrink-0">
          <FileText className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">Cardápio em PDF/imagem</h3>
          <p className="text-xs text-slate-500">
            {info?.existe
              ? `Enviado: ${info.filename} · o bot manda este arquivo quando pedem o cardápio completo.`
              : "Opcional. O bot envia este arquivo quando o cliente pede o cardápio completo."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onPick} className="hidden" />
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl font-medium disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {info?.existe ? "Trocar" : "Enviar arquivo"}
          </button>
          {info?.existe && (
            <button onClick={remover} disabled={busy}
              className="p-2 text-red-500 hover:bg-red-50 rounded-xl disabled:opacity-50" title="Remover">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

      {info?.existe && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {isImg ? (
            <img src={url} alt="Cardápio" className="max-h-60 rounded-lg border border-slate-200" />
          ) : (
            <a href={url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:underline">
              <FileText className="w-3.5 h-3.5" /> Abrir PDF enviado
            </a>
          )}
        </div>
      )}
    </div>
  );
}

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
    const validos = itens.filter((p) => p.nome.trim() && Number(p.preco) > 0);
    if (!validos.length) { setErr("Nenhum produto com nome e preço válidos."); return; }
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
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-xs bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-xl font-medium">
        <Sparkles className="w-3.5 h-3.5" /> Importar com IA
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => !extraindo && !salvando && close()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5" />
                <h3 className="font-bold">Importar cardápio com IA</h3>
              </div>
              <button onClick={close} className="p-1.5 rounded-lg hover:bg-white/20"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {!itens ? (
                <>
                  {/* Modos */}
                  <div className="flex gap-1.5 flex-wrap">
                    {([["imagem","Imagem / PDF"],["texto","Colar texto"],["json","Colar JSON"]] as [ImportMode,string][]).map(([m,l]) => (
                      <button key={m} onClick={() => { setMode(m); setErr(null); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full ${mode===m ? "bg-violet-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
                    ))}
                  </div>

                  {mode === "imagem" && (
                    <div>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) extrairArquivo(f); }} />
                      <button onClick={() => fileRef.current?.click()} disabled={extraindo}
                        className="w-full border-2 border-dashed border-violet-200 rounded-xl py-8 grid place-items-center text-violet-600 hover:bg-violet-50 disabled:opacity-50">
                        {extraindo ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Upload className="w-6 h-6 mb-1" /><span className="text-sm font-medium">Enviar foto ou PDF do cardápio</span></>}
                      </button>
                      <p className="text-[11px] text-slate-400 mt-2">A IA lê a imagem/PDF e extrai os produtos. Você revisa antes de salvar.</p>
                    </div>
                  )}

                  {mode === "texto" && (
                    <div>
                      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8}
                        placeholder="Cole aqui o cardápio em texto (nomes, descrições, preços, tamanhos)…" className={inputCls} />
                      <button onClick={extrairTexto} disabled={extraindo || !texto.trim()}
                        className="mt-2 px-4 py-2 text-sm bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                        {extraindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Extrair com IA
                      </button>
                    </div>
                  )}

                  {mode === "json" && (
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Cole um JSON pronto (sem gastar IA). Formato:</p>
                      <pre className="text-[10px] bg-slate-50 border border-slate-200 rounded-lg p-2 mb-2 overflow-x-auto text-slate-500">{JSON_EXEMPLO}</pre>
                      <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={7}
                        placeholder='[{ "nome": "...", "categoria": "pizza", "preco": 0 }]' className={`${inputCls} font-mono text-xs`} />
                      <button onClick={carregarJson} disabled={!jsonText.trim()}
                        className="mt-2 px-4 py-2 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-medium disabled:opacity-50">
                        Carregar para revisão
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Revisão */
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">Revise antes de cadastrar ({itens.length} itens). Confira os preços!</p>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[48vh] overflow-y-auto">
                    {itens.map((p, i) => (
                      <div key={i} className="p-2 flex gap-2 items-center">
                        <input value={p.nome} onChange={(e) => setItem(i, { nome: e.target.value })}
                          className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm" placeholder="Nome" />
                        <select value={p.categoria} onChange={(e) => setItem(i, { categoria: e.target.value })}
                          className="px-1 py-1 border border-slate-200 rounded text-xs w-24">
                          {["pizza","lanche","bebida","sobremesa","outro"].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div className="w-32 text-right">
                          {p.tamanhos && p.tamanhos.length > 0 ? (
                            <span className="text-[10px] text-slate-500 font-medium block">
                              {p.tamanhos.length} var. (A partir de{" "}
                              <strong>
                                {Math.min(...p.tamanhos.map(t => Number(t.preco))).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </strong>
                              )
                            </span>
                          ) : (
                            <div className="relative w-full">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                              <input type="number" step="0.01" value={p.preco} onChange={(e) => setItem(i, { preco: Number(e.target.value) })}
                                className="w-full pl-7 pr-1 py-1 border border-slate-200 rounded text-sm" />
                            </div>
                          )}
                        </div>
                        <button onClick={() => removeItem(i)} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setItens(null)} className="text-xs text-slate-500 hover:underline">← voltar</button>
                </div>
              )}

              {err && <p className="text-xs text-red-600">{err}</p>}
            </div>

            {itens && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                <button onClick={close} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200/60 rounded-lg font-medium">Cancelar</button>
                <button onClick={confirmar} disabled={salvando}
                  className="px-4 py-2 text-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                  {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Importar {itens.length} produto(s)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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
