/**
 * Painel de Administração da Plataforma (platform admin).
 *
 * Tela exclusiva do dono do SaaS — separada do operacional de cada pizzaria.
 * Lista TODAS as pizzarias, permite criar / editar / remover e "Entrar"
 * em qualquer uma para ver o painel operacional dela.
 */
import React, { useState } from "react";
import {
  Pizza, LogOut, Plus, Pencil, Trash2, Save, X, Loader2,
  AlertCircle, LogIn, Store, Bot, Power,
} from "lucide-react";
import { BackendPizzaria, pizzariasApi } from "../../lib/api";

interface Props {
  userName: string;
  pizzarias: BackendPizzaria[];
  onRefresh: () => Promise<void> | void;
  onEnter: (p: BackendPizzaria) => void;
  onLogout: () => void;
}

type FormState = { nome: string; endereco: string; telefone_admin: string; instancia: string };
const EMPTY_FORM: FormState = { nome: "", endereco: "", telefone_admin: "", instancia: "" };

export function PlatformAdminView({ userName, pizzarias, onRefresh, onEnter, onLogout }: Props) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ativas = pizzarias.filter((p) => p.bot_ativo_global).length;

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  }
  function startEdit(p: BackendPizzaria) {
    setCreating(false);
    setEditingId(p.id);
    setForm({
      nome: p.nome,
      endereco: p.endereco ?? "",
      telefone_admin: p.telefone_admin ?? "",
      instancia: p.instancia ?? "",
    });
  }
  function cancel() {
    setCreating(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body = {
        nome: form.nome.trim(),
        endereco: form.endereco.trim() || undefined,
        telefone_admin: form.telefone_admin.trim() || undefined,
        instancia: form.instancia.trim() || undefined,
      };
      if (editingId) {
        await pizzariasApi.update(editingId, body);
      } else {
        await pizzariasApi.create(body);
      }
      cancel();
      await onRefresh();
    } catch (e: any) {
      setErr(e.message || "Erro ao salvar.");
    }
    setSaving(false);
  }

  async function remove(p: BackendPizzaria) {
    if (!confirm(`Remover a pizzaria "${p.nome}"? Isso apaga equipe, cardápio e pedidos dela. Esta ação é irreversível.`)) return;
    setBusyId(p.id);
    setErr(null);
    try {
      await pizzariasApi.delete(p.id);
      await onRefresh();
    } catch (e: any) {
      setErr(e.message || "Erro ao remover.");
    }
    setBusyId(null);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
            <Pizza className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">PizzaBot — Administração</h1>
            <p className="text-xs text-slate-500">Painel da plataforma</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-500">{userName}</span>
          <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 max-w-5xl w-full mx-auto space-y-5">
        {/* Resumo */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<Store className="w-4 h-4 text-orange-500" />} label="Pizzarias cadastradas" value={pizzarias.length} />
          <StatCard icon={<Bot className="w-4 h-4 text-emerald-500" />} label="Com bot ativo" value={ativas} />
        </div>

        {/* Barra de ações */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Pizzarias</h2>
            <p className="text-sm text-slate-500">Empresas cadastradas na plataforma.</p>
          </div>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md font-medium"
          >
            <Plus className="w-4 h-4" /> Nova pizzaria
          </button>
        </div>

        {err && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}

        {/* Form criar/editar */}
        {(creating || editingId) && (
          <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3 shadow-sm">
            <h3 className="font-semibold text-sm text-slate-800">
              {editingId ? "Editar pizzaria" : "Nova pizzaria"}
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nome" required>
                <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className={inputCls} placeholder="Ex.: Pizzaria do Zé" />
              </Field>
              <Field label="WhatsApp do dono">
                <input value={form.telefone_admin} onChange={(e) => setForm({ ...form, telefone_admin: e.target.value })}
                  className={inputCls} placeholder="5511999999999" />
              </Field>
              <Field label="Endereço" full>
                <input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  className={inputCls} placeholder="Rua, número, bairro" />
              </Field>
              <Field label="Instância Evolution (opcional)" full>
                <input value={form.instancia} onChange={(e) => setForm({ ...form, instancia: e.target.value })}
                  className={inputCls} placeholder="pizzaria-do-ze" />
              </Field>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancel} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md flex items-center gap-1">
                <X className="w-4 h-4" /> Cancelar
              </button>
              <button onClick={save} disabled={saving || !form.nome.trim()}
                className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md flex items-center gap-1 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="space-y-2">
          {pizzarias.length === 0 && !creating && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
              Nenhuma pizzaria cadastrada ainda. Clique em <strong>Nova pizzaria</strong> para começar.
            </div>
          )}
          {pizzarias.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {p.logo_url
                  ? <img src={p.logo_url} alt="" className="w-full h-full object-cover" />
                  : <Store className="w-5 h-5 text-slate-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm truncate">{p.nome}</span>
                  <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{p.plano}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    p.bot_ativo_global ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    <Power className="w-2.5 h-2.5" /> {p.bot_ativo_global ? "Bot on" : "Bot off"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {p.instancia ? `Instância: ${p.instancia}` : "Sem instância Evolution"}
                  {p.endereco ? ` · ${p.endereco}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onEnter(p)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-md font-medium">
                  <LogIn className="w-3.5 h-3.5" /> Entrar
                </button>
                <button onClick={() => startEdit(p)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(p)} disabled={busyId === p.id}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-50" title="Remover">
                  {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-xl font-bold text-slate-800 leading-none">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
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
