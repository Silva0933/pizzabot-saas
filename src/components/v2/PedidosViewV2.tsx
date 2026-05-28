/**
 * Pedidos v2 — Kanban com colunas configuráveis, arraste pra mudar status.
 * Conectado ao backend Python.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, Package, Bike, Store as StoreIcon, Clock } from "lucide-react";
import { pedidosApi, BackendPedido } from "../../lib/api";

interface Props {
  pizzariaId: string;
  columnNames?: Record<string, string>;
  liveEvent?: { tipo: string; payload: any } | null;
}

type Coluna = {
  key: string;
  titulo: string;
  col: string;      // fundo da coluna
  grad: string;     // gradiente do cabeçalho
  dot: string;      // cor do contador/acento
  bar: string;      // barra lateral do card
};

const COLUNAS_DEFAULT: Coluna[] = [
  { key: "novo",       titulo: "Novos",       col: "bg-blue-50/60 border-blue-200",       grad: "from-blue-500 to-sky-500",       dot: "bg-blue-500",     bar: "bg-blue-400" },
  { key: "confirmado", titulo: "Confirmados", col: "bg-emerald-50/60 border-emerald-200", grad: "from-emerald-500 to-teal-500",   dot: "bg-emerald-500",  bar: "bg-emerald-400" },
  { key: "no_forno",   titulo: "No forno",    col: "bg-amber-50/60 border-amber-200",     grad: "from-amber-500 to-orange-500",   dot: "bg-amber-500",    bar: "bg-amber-400" },
  { key: "a_caminho",  titulo: "A caminho",   col: "bg-violet-50/60 border-violet-200",   grad: "from-violet-500 to-fuchsia-500", dot: "bg-violet-500",   bar: "bg-violet-400" },
  { key: "entregue",   titulo: "Entregues",   col: "bg-slate-50 border-slate-200",        grad: "from-slate-500 to-slate-600",    dot: "bg-slate-500",    bar: "bg-slate-300" },
  { key: "cancelado",  titulo: "Cancelados",  col: "bg-rose-50/60 border-rose-200",       grad: "from-rose-500 to-red-500",       dot: "bg-rose-500",     bar: "bg-rose-400" },
];

export function PedidosViewV2({ pizzariaId, columnNames, liveEvent }: Props) {
  const [pedidos, setPedidos] = useState<BackendPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    return pedidosApi.list(pizzariaId).then(setPedidos).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pizzariaId]);

  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.tipo === "pedido.novo" || liveEvent.tipo === "pedido.atualizado") load();
  }, [liveEvent]);

  const colunas = useMemo(
    () => COLUNAS_DEFAULT.map((c) => ({ ...c, titulo: columnNames?.[c.key] || c.titulo })),
    [columnNames],
  );

  const grouped = useMemo(() => {
    const m: Record<string, BackendPedido[]> = {};
    for (const c of colunas) m[c.key] = [];
    for (const p of pedidos) {
      (m[p.status] ||= []).push(p);
    }
    return m;
  }, [pedidos, colunas]);

  async function moveStatus(pedidoId: string, novoStatus: string) {
    try {
      const updated = await pedidosApi.updateStatus(pizzariaId, pedidoId, novoStatus);
      setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? updated : p)));
    } catch (e: any) { setErr(e.message); }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-6">
      {err && (
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {colunas.map((col) => {
          const list = grouped[col.key] || [];
          return (
            <div
              key={col.key}
              className={`min-w-[270px] flex-1 rounded-2xl border ${col.col} p-2.5 transition-colors`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("pedido_id");
                if (id) moveStatus(id, col.key);
              }}
            >
              {/* Cabeçalho colorido */}
              <div className={`flex items-center justify-between rounded-xl px-3 py-2 mb-2.5 bg-gradient-to-r ${col.grad} text-white shadow-sm`}>
                <h3 className="text-sm font-semibold">{col.titulo}</h3>
                <span className="text-xs font-bold bg-white/25 rounded-full min-w-[20px] h-5 px-1.5 grid place-items-center">
                  {list.length}
                </span>
              </div>

              <div className="space-y-2">
                {list.map((p) => {
                  const isDelivery = (p.tipo || "").toLowerCase().includes("entrega");
                  return (
                    <article
                      key={p.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("pedido_id", p.id)}
                      className="relative bg-white border border-slate-200 rounded-xl p-3 pl-3.5 shadow-sm cursor-move hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 ${col.bar}`} />
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-bold text-slate-800">
                          #{p.numero_pedido ?? "—"}
                        </span>
                        <span className="text-sm font-bold text-emerald-600">
                          {Number(p.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </div>
                      <ul className="text-xs text-slate-600 space-y-0.5">
                        {(p.itens || []).slice(0, 3).map((it, idx) => (
                          <li key={idx} className="flex gap-1.5">
                            <span className="text-orange-500 font-semibold">{it.quantidade}×</span>
                            <span className="truncate">{it.nome}</span>
                          </li>
                        ))}
                        {(p.itens?.length ?? 0) > 3 && (
                          <li className="text-slate-400">+{p.itens.length - 3} itens</li>
                        )}
                      </ul>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          isDelivery ? "bg-sky-50 text-sky-600" : "bg-amber-50 text-amber-600"
                        }`}>
                          {isDelivery ? <Bike className="w-3 h-3" /> : <StoreIcon className="w-3 h-3" />}
                          {isDelivery ? "Entrega" : "Retirada"}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 ml-auto">
                          <Clock className="w-3 h-3" />
                          {new Date(p.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {list.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-8">
                    <Package className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
                    Nenhum pedido
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
