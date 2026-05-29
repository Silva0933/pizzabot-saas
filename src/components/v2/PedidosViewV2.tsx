/**
 * Pedidos v2 — Kanban com colunas configuráveis, arraste pra mudar status.
 * Conectado ao backend Python.
 */
import React, { useEffect, useMemo, useState } from "react";
import { 
  Loader2, AlertCircle, Package, Bike, Store as StoreIcon, Clock, 
  ChevronLeft, ChevronRight, X, Phone, User, MapPin, CreditCard, Clipboard 
} from "lucide-react";
import { pedidosApi, BackendPedido } from "../../lib/api";

interface Props {
  pizzariaId: string;
  columnNames?: Record<string, string>;
  liveEvent?: { tipo: string; payload: any } | null;
}

const STATUS_FLOW = ["novo", "confirmado", "no_forno", "a_caminho", "entregue"];

function statusLabelPt(s: string): string {
  const m: Record<string, string> = {
    novo: "Novos",
    confirmado: "Confirmados",
    no_forno: "No forno",
    a_caminho: "A caminho",
    entregue: "Entregues",
    cancelado: "Cancelados",
  };
  return m[s] || s;
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
  const [selectedPedido, setSelectedPedido] = useState<BackendPedido | null>(null);
  const [activeTabMobile, setActiveTabMobile] = useState<string>("novo");

  function load() {
    // Só pedidos de hoje — o fluxo de atendimento começa zerado todo dia.
    return pedidosApi.list(pizzariaId, { hoje: true }).then(setPedidos).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [pizzariaId]);

  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.tipo === "pedidos.limpos") { setPedidos([]); setSelectedPedido(null); return; }
    if (liveEvent.tipo === "pedido.novo" || liveEvent.tipo === "pedido.atualizado") {
      load().then(() => {
        if (selectedPedido) {
          pedidosApi.get(pizzariaId, selectedPedido.id)
            .then(setSelectedPedido)
            .catch(() => {});
        }
      });
    }
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
      if (selectedPedido && selectedPedido.id === pedidoId) {
        setSelectedPedido(updated);
      }
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

      {/* Abas Mobile */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
        {colunas.map((col) => {
          const list = grouped[col.key] || [];
          const isActive = activeTabMobile === col.key;
          return (
            <button
              key={col.key}
              type="button"
              onClick={() => setActiveTabMobile(col.key)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 border cursor-pointer ${
                isActive 
                  ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              <span>{col.titulo}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${
                isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
              }`}>
                {list.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 w-full">
        {colunas.map((col) => {
          const list = grouped[col.key] || [];
          const isMobileActive = activeTabMobile === col.key;
          return (
            <div
              key={col.key}
              className={`rounded-2xl border ${col.col} p-2.5 transition-all ${
                isMobileActive 
                  ? "w-full min-w-0 flex flex-col" 
                  : "hidden md:flex md:flex-col md:min-w-[270px] md:flex-1"
              }`}
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
                  const statusIdx = STATUS_FLOW.indexOf(p.status);
                  return (
                    <article
                      key={p.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("pedido_id", p.id)}
                      onClick={() => setSelectedPedido(p)}
                      className="relative bg-white border border-slate-200 rounded-xl p-3 pl-3.5 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden"
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 ${col.bar}`} />
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                          #{p.numero_pedido ?? "—"}
                          {p.cliente?.nome && (
                            <span className="text-[11px] font-normal text-slate-500 max-w-[120px] truncate">
                              · {p.cliente.nome}
                            </span>
                          )}
                        </span>
                        <span className="text-sm font-bold text-emerald-600">
                          {Number(p.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </div>
                      <ul className="text-xs text-slate-600 space-y-0.5">
                        {(p.itens || []).slice(0, 3).map((it, idx) => (
                          <li key={idx} className="flex gap-1.5">
                            <span className="text-orange-500 font-semibold">{(it.quantidade ?? (it as any).qtd ?? 1)}×</span>
                            <span className="truncate">{it.nome}</span>
                          </li>
                        ))}
                        {(p.itens?.length ?? 0) > 3 && (
                          <li className="text-slate-400">+{p.itens.length - 3} itens</li>
                        )}
                        {(p.itens?.length ?? 0) === 0 && (
                          <li className="text-slate-400 italic text-[11px]">Rascunho (sem itens)</li>
                        )}
                      </ul>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          isDelivery ? "bg-sky-50 text-sky-600" : "bg-amber-50 text-amber-600"
                        }`}>
                          {isDelivery ? <Bike className="w-3 h-3" /> : <StoreIcon className="w-3 h-3" />}
                          {isDelivery ? "Entrega" : "Retirada"}
                        </span>
                        
                        {/* Botões de seta para mudar status */}
                        <div className="flex items-center gap-1 ml-auto">
                          {statusIdx > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveStatus(p.id, STATUS_FLOW[statusIdx - 1]);
                              }}
                              className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Voltar status"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(p.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {statusIdx < STATUS_FLOW.length - 1 && statusIdx >= 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveStatus(p.id, STATUS_FLOW[statusIdx + 1]);
                              }}
                              className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Avançar status"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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

      {/* Modal de Resumo do Pedido */}
      {selectedPedido && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setSelectedPedido(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-5 py-4 bg-gradient-to-r from-orange-500 to-rose-500 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-lg">Resumo do Pedido #{selectedPedido.numero_pedido ?? "—"}</h3>
                <p className="text-xs text-white/80">Criado em {new Date(selectedPedido.created_at).toLocaleString("pt-BR")}</p>
              </div>
              <button 
                onClick={() => setSelectedPedido(null)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors cursor-pointer text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo rolável */}
            <div className="p-6 space-y-5 overflow-y-auto">
              
              {/* Cliente */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-500" /> Dados do Cliente
                </h4>
                <div className="space-y-1 text-sm">
                  <p className="font-bold text-slate-800">{selectedPedido.cliente?.nome || "Cliente Novo"}</p>
                  <p className="text-slate-600 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {selectedPedido.cliente?.telefone ? (
                      <a href={`https://wa.me/${selectedPedido.cliente.telefone}`} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">
                        {selectedPedido.cliente.telefone}
                      </a>
                    ) : "—"}
                  </p>
                </div>
              </div>

              {/* Itens */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-slate-500" /> Itens do Pedido
                </h4>
                <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {selectedPedido.itens && selectedPedido.itens.length > 0 ? (
                    selectedPedido.itens.map((it, idx) => (
                      <div key={idx} className="p-3 bg-white flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="flex gap-2 items-center">
                            <span className="text-orange-500 font-bold shrink-0">{(it.quantidade ?? (it as any).qtd ?? 1)}×</span>
                            <span className="font-medium text-slate-800 truncate">{it.nome}</span>
                          </div>
                          {it.observacao && (
                            <p className="text-xs text-slate-400 mt-0.5 pl-6">{it.observacao}</p>
                          )}
                        </div>
                        <span className="font-semibold text-slate-700 shrink-0">
                          {(() => {
                            const pu = Number((it as any).preco_unit ?? (it as any).preco ?? 0);
                            const q = Number(it.quantidade ?? (it as any).qtd ?? 1);
                            return pu > 0 ? (pu * q).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
                          })()}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 bg-slate-50/50 text-slate-400 text-xs text-center italic">
                      Nenhum item adicionado (rascunho de pedido em criação)
                    </div>
                  )}
                  <div className="p-3 bg-slate-50/30 flex justify-between items-center text-sm border-t border-slate-100 font-bold text-slate-800">
                    <span>Total</span>
                    <span className="text-emerald-600 text-base">
                      {Number(selectedPedido.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Detalhes de entrega / pagamento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100/60">
                  <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" /> Entrega
                  </h5>
                  <p className="text-xs font-semibold text-slate-700">
                    {selectedPedido.tipo === "delivery" ? "Delivery / Entrega" : "Retirada no Balcão"}
                  </p>
                  {selectedPedido.tipo === "delivery" && (
                    <p className="text-xs text-slate-500 mt-1 break-words">{selectedPedido.endereco_entrega || "Endereço não informado"}</p>
                  )}
                </div>

                <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100/60">
                  <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5 text-slate-500" /> Pagamento
                  </h5>
                  <p className="text-xs font-semibold text-slate-700 capitalize">
                    {selectedPedido.forma_pagamento || "Não informado"}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${selectedPedido.payment_status === "approved" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    Status: {selectedPedido.payment_status === "approved" ? "Aprovado" : "Pendente"}
                  </p>
                </div>
              </div>

              {/* Observações adicionais */}
              {selectedPedido.observacoes && (
                <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3">
                  <h5 className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Clipboard className="w-3.5 h-3.5 text-amber-600" /> Observações do Pedido
                  </h5>
                  <p className="text-xs text-amber-900">{selectedPedido.observacoes}</p>
                </div>
              )}

            </div>

            {/* Rodapé / Ações rápidas de status */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2 justify-between shrink-0">
              {STATUS_FLOW.indexOf(selectedPedido.status) > 0 ? (
                <button
                  onClick={() => {
                    const statusIdx = STATUS_FLOW.indexOf(selectedPedido.status);
                    const prevStatus = STATUS_FLOW[statusIdx - 1];
                    moveStatus(selectedPedido.id, prevStatus);
                  }}
                  className="flex items-center gap-1 px-3.5 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold transition-colors shadow-sm cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Voltar para {statusLabelPt(STATUS_FLOW[STATUS_FLOW.indexOf(selectedPedido.status) - 1])}
                </button>
              ) : <div />}

              {STATUS_FLOW.indexOf(selectedPedido.status) < STATUS_FLOW.length - 1 && STATUS_FLOW.indexOf(selectedPedido.status) >= 0 ? (
                <button
                  onClick={() => {
                    const statusIdx = STATUS_FLOW.indexOf(selectedPedido.status);
                    const nextStatus = STATUS_FLOW[statusIdx + 1];
                    moveStatus(selectedPedido.id, nextStatus);
                  }}
                  className="flex items-center gap-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-orange-500/20 cursor-pointer"
                >
                  Avançar para {statusLabelPt(STATUS_FLOW[STATUS_FLOW.indexOf(selectedPedido.status) + 1])} <ChevronRight className="w-4 h-4" />
                </button>
              ) : <div />}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
