/**
 * EntregadoresView — gestão de entregadores pelo dono.
 *
 * Lista a equipe de entrega, permite cadastrar/editar/remover e liga/desliga o
 * "self-claim" (entregador pegar pedidos livres). A atribuição de um pedido a um
 * entregador acontece no card de Pedidos.
 */
import { useEffect, useState } from "react";
import {
  Bike, Plus, Pencil, Trash2, Loader2, AlertCircle, Phone, Mail, User, Lock, PackageCheck,
} from "lucide-react";
import { entregadoresApi, BackendEntregador } from "../../lib/api";
import { Button, Card, CardHeader, Badge, Modal, Field, Input } from "../ui";

interface FormState {
  id: string | null;
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  ativo: boolean;
}

const EMPTY: FormState = { id: null, nome: "", email: "", senha: "", telefone: "", ativo: true };

export function EntregadoresView({ pizzariaId }: { pizzariaId: string }) {
  const [lista, setLista] = useState<BackendEntregador[]>([]);
  const [autoatribuicao, setAutoatribuicao] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [togglingConfig, setTogglingConfig] = useState(false);

  function load() {
    return entregadoresApi
      .list(pizzariaId)
      .then((r) => {
        setLista(r.entregadores);
        setAutoatribuicao(r.permitir_autoatribuicao);
      })
      .catch((e: any) => setErr(e.message));
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pizzariaId]);

  function openCreate() {
    setForm(EMPTY);
    setFormErr(null);
    setModalOpen(true);
  }

  function openEdit(e: BackendEntregador) {
    setForm({ id: e.id, nome: e.nome, email: e.email, senha: "", telefone: e.telefone || "", ativo: e.ativo });
    setFormErr(null);
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    setFormErr(null);
    try {
      if (form.id) {
        await entregadoresApi.update(pizzariaId, form.id, {
          nome: form.nome,
          telefone: form.telefone || undefined,
          ativo: form.ativo,
          nova_senha: form.senha || undefined,
        });
      } else {
        await entregadoresApi.create(pizzariaId, {
          nome: form.nome,
          email: form.email.trim().toLowerCase(),
          senha: form.senha,
          telefone: form.telefone || undefined,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFormErr(e.status === 409 ? "Este email já está em uso." : (e.message || "Erro ao salvar."));
    } finally {
      setSaving(false);
    }
  }

  async function remover(e: BackendEntregador) {
    if (!window.confirm(`Remover o entregador ${e.nome}? A conta de acesso dele será excluída.`)) return;
    try {
      await entregadoresApi.remove(pizzariaId, e.id);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function toggleAutoatribuicao() {
    const novo = !autoatribuicao;
    setAutoatribuicao(novo);
    setTogglingConfig(true);
    try {
      await entregadoresApi.setConfig(pizzariaId, novo);
    } catch {
      setAutoatribuicao(!novo);
    } finally {
      setTogglingConfig(false);
    }
  }

  const podeSalvar = form.nome.trim() && (form.id || (form.email.trim() && form.senha.length >= 6));

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6 max-w-4xl mx-auto space-y-4">
      {err && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}

      {/* Cabeçalho */}
      <Card>
        <CardHeader
          icon={Bike}
          title="Entregadores"
          subtitle={`${lista.length} cadastrado${lista.length === 1 ? "" : "s"}`}
          action={<Button icon={Plus} onClick={openCreate}>Novo entregador</Button>}
        />
      </Card>

      {/* Self-claim toggle */}
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ink">Entregador pode pegar pedidos livres</p>
            <p className="text-xs text-ink-muted mt-0.5">
              Quando ligado, os entregadores veem os pedidos prontos sem entregador e podem pegar.
              Desligado, só você atribui as entregas.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAutoatribuicao}
            disabled={togglingConfig}
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${autoatribuicao ? "bg-brand-500" : "bg-slate-300"}`}
          >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${autoatribuicao ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </Card>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
        </div>
      ) : lista.length === 0 ? (
        <Card className="text-center py-12">
          <Bike className="w-8 h-8 mx-auto mb-2 text-ink-subtle opacity-50" />
          <p className="text-sm text-ink-muted">Nenhum entregador cadastrado ainda.</p>
          <div className="mt-3">
            <Button icon={Plus} onClick={openCreate}>Cadastrar primeiro entregador</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {lista.map((e) => (
            <Card key={e.id} className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0 font-bold">
                {e.nome.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink truncate">{e.nome}</p>
                  {e.disponivel
                    ? <Badge tone="success" dot>Disponível</Badge>
                    : <Badge tone="neutral" dot>Offline</Badge>}
                  {!e.ativo && <Badge tone="danger">Inativo</Badge>}
                </div>
                <p className="text-xs text-ink-muted truncate">{e.email}</p>
                {e.telefone && (
                  <p className="text-xs text-ink-subtle flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" /> {e.telefone}
                  </p>
                )}
                <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-0.5">
                  <PackageCheck className="w-3 h-3" />
                  {e.entregas_concluidas ?? 0} entrega{(e.entregas_concluidas ?? 0) === 1 ? "" : "s"} concluída{(e.entregas_concluidas ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button type="button" onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-muted" title="Editar">
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => remover(e)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" title="Remover">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        icon={Bike}
        title={form.id ? "Editar entregador" : "Novo entregador"}
        subtitle={form.id ? form.email : "Crie o acesso do entregador ao painel"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={save} isLoading={saving} disabled={!podeSalvar}>
              {form.id ? "Salvar" : "Cadastrar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formErr && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" /> {formErr}
            </div>
          )}
          <Field label="Nome" required>
            <Input icon={User} value={form.nome} onChange={(e: any) => setForm({ ...form, nome: e.target.value })} placeholder="Nome do entregador" />
          </Field>
          {!form.id && (
            <Field label="Email (login)" required>
              <Input icon={Mail} type="email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} placeholder="entregador@email.com" />
            </Field>
          )}
          <Field label={form.id ? "Nova senha (deixe em branco para manter)" : "Senha"} required={!form.id} hint="Mínimo 6 caracteres">
            <Input icon={Lock} type="password" value={form.senha} onChange={(e: any) => setForm({ ...form, senha: e.target.value })} placeholder="••••••" />
          </Field>
          <Field label="Telefone (opcional)">
            <Input icon={Phone} value={form.telefone} onChange={(e: any) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" />
          </Field>
          {form.id && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Conta ativa (pode fazer login e receber entregas)
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
