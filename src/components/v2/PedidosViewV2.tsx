/**
 * Pedidos v2 — Kanban com colunas configuráveis, arraste pra mudar status.
 * Conectado ao backend Python.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, Package } from "lucide-react";
import { pedidosApi, BackendPedido } from "../../lib/api";

interface Props {
  pizzariaId: string;
  columnNames?: Record<string, string>;
  liveEvent?: { tipo: string; payload: any } | null;
}

const COLUNAS_DEFAULT: Array<{ key: string; titulo: string; cor: string }> = [
  { key: "novo",        titulo: "Novos",         cor: "bg-blue-50 border-blue-200" },
  { key: "confirmado",  titulo: "Confirmados",   cor: "bg-emerald-50 border-emerald-200" },
  { key: "no_forno",    titulo: "No forno",      cor: "bg-amber-50 border-amber-200" },
  { key: "a_caminho",   titulo: "A caminho",     cor: "bg-purple-50 border-purple-200" },
  { key: "entregue",    titulo: "Entregues",     cor: "bg-slate-50 border-slate-200" },
  { key: "cancelado",   titulo: "Cancelados",    cor: "bg-red-50 border-red-200" },
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
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          <AlertCircle className="w-4 h-4" /> {err}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {colunas.map((col) => (
          <div
            key={col.key}
            className={`min-w-[260px] flex-1 rounded-lg border ${col.cor} p-3`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("pedido_id");
              if (id) moveStatus(id, col.key);
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">{col.titulo}</h3>
              <span className="text-xs text-slate-500">{grouped[col.key]?.length || 0}</span>
            </div>
            <div className="space-y-2">
              {(grouped[col.key] || []).map((p) => (
                <article
                  key={p.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("pedido_id", p.id)}
                  className="bg-white border border-slate-200 rounded-md p-2.5 shadow-sm cursor-move hover:shadow-md"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-800">
                      #{p.numero_pedido ?? "—"}
                    </span>
                    <span className="text-xs font-semibold text-orange-600">
                      {Number(p.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                  <ul className="text-xs text-slate-600 space-y-0.5">
                    {(p.itens || []).slice(0, 3).map((it, idx) => (
                      <li key={idx}>
                        {it.quantidade}× {it.nome}
                      </li>
                    ))}
                    {(p.itens?.length ?? 0) > 3 && (
                      <li className="text-slate-400">+{p.itens.length - 3} itens</li>
                    )}
                  </ul>
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    {new Date(p.created_at).toLocaleString("pt-BR")}
                  </div>
                </article>
              ))}
              {(grouped[col.key] || []).length === 0 && (
                <div className="text-xs text-slate-400 text-center py-6">
                  <Package className="w-4 h-4 mx-auto mb-1 opacity-50" />
                  Vazio
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
