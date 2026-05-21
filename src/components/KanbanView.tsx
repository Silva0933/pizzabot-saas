import React, { useState } from "react";
import { 
  ShoppingBag, 
  ChevronRight, 
  ChevronLeft, 
  Info, 
  MapPin, 
  Phone, 
  Clock, 
  DollarSign, 
  Calendar,
  X,
  Edit2,
  Trash2,
  Check,
  AlertTriangle,
  Send,
  User
} from "lucide-react";
import { Order, OrderStatus, OrderItem } from "../types";

interface KanbanViewProps {
  orders: Order[];
  onUpdateOrderStatus: (id: string, newStatus: OrderStatus, paymentStatus?: 'pending' | 'approved' | 'cancelled') => void;
  onUpdateOrderDetails: (id: string, updatedFields: Partial<Order>) => void;
  onGeneratePaymentLink?: (orderId: string) => Promise<void>;
  onCancelOrder: (id: string) => void;
  columnNames: Record<OrderStatus, string>;
  onOpenNewOrderModal?: () => void;
}

export function KanbanView({
  orders,
  onUpdateOrderStatus,
  onUpdateOrderDetails,
  onGeneratePaymentLink,
  onCancelOrder,
  columnNames,
  onOpenNewOrderModal
}: KanbanViewProps) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isEditingModal, setIsEditingModal] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'delivery' | 'retirada'>('all');
  const [filterPayment, setFilterPayment] = useState<'all' | 'pix' | 'cartao' | 'dinheiro'>('all');
  const [filterDate, setFilterDate] = useState("");
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<OrderStatus | null>(null);
  const [generatingPaymentFor, setGeneratingPaymentFor] = useState<string | null>(null);

  // Fields for editing an order details inside the modal
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPaymentStatus, setEditPaymentStatus] = useState<'pending' | 'approved' | 'cancelled'>("pending");
  const [editItems, setEditItems] = useState<OrderItem[]>([]);

  const openOrderDetails = (order: Order) => {
    setSelectedOrder(order);
    setEditAddress(order.deliveryAddress);
    setEditNotes(order.notes || "");
    setEditPaymentStatus(order.paymentStatus);
    setEditItems(order.items.map(item => ({ ...item })));
    setIsEditingModal(false);
  };

  const handleSaveDetails = () => {
    if (selectedOrder) {
      const normalizedItems = editItems
        .map(item => ({
          ...item,
          name: item.name.trim(),
          qty: Number(item.qty) || 0,
          priceUnit: Number(item.priceUnit) || 0,
          observation: item.observation?.trim() || ""
        }))
        .filter(item => item.name && item.qty > 0);
      const totalValue = normalizedItems.reduce((sum, item) => sum + item.qty * item.priceUnit, 0);

      onUpdateOrderDetails(selectedOrder.id, {
        deliveryAddress: editAddress,
        notes: editNotes,
        paymentStatus: editPaymentStatus,
        items: normalizedItems,
        totalValue
      });
      setSelectedOrder(prev => prev ? { 
        ...prev, 
        deliveryAddress: editAddress, 
        notes: editNotes,
        paymentStatus: editPaymentStatus,
        items: normalizedItems,
        totalValue
      } : null);
      setIsEditingModal(false);
    }
  };

  const updateEditItem = (index: number, fields: Partial<OrderItem>) => {
    setEditItems(current => current.map((item, idx) => idx === index ? { ...item, ...fields } : item));
  };

  const handleGeneratePayment = async () => {
    if (!selectedOrder || !onGeneratePaymentLink) return;
    setGeneratingPaymentFor(selectedOrder.id);
    await onGeneratePaymentLink(selectedOrder.id);
    setGeneratingPaymentFor(null);
  };

  // 5 main Kanban columns corresponding to OrderStatus
  const colStatuses: OrderStatus[] = ["novo", "confirmado", "no_forno", "a_caminho", "entregue"];

  const formatDateInput = (date: string) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return "";
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const handleDropOnStatus = (targetStatus: OrderStatus) => {
    if (!draggingOrderId) return;
    const order = orders.find(o => o.id === draggingOrderId);
    setDraggingOrderId(null);
    setDragOverStatus(null);

    if (!order || order.status === targetStatus) return;
    const updatePayment = targetStatus === "confirmado" && order.paymentStatus !== "approved"
      ? "approved"
      : undefined;
    onUpdateOrderStatus(order.id, targetStatus, updatePayment);
  };

  // Column styling mapper
  const getColColor = (status: OrderStatus) => {
    switch(status) {
      case "novo": return "border-t-4 border-orange-500 bg-orange-50/30";
      case "confirmado": return "border-t-4 border-emerald-500 bg-emerald-50/30";
      case "no_forno": return "border-t-4 border-purple-500 bg-purple-50/30";
      case "a_caminho": return "border-t-4 border-blue-500 bg-blue-50/30";
      case "entregue": return "border-t-4 border-slate-500 bg-slate-50/30";
      default: return "border-t-4 border-slate-200";
    }
  };

  const getColIcon = (status: OrderStatus) => {
    switch(status) {
      case "novo": return "🔔";
      case "confirmado": return "✅";
      case "no_forno": return "🔥";
      case "a_caminho": return "🏍️";
      case "entregue": return "📦";
      default: return "📋";
    }
  };

  // Filter orders based on filter states
  const filteredOrders = orders.filter(o => {
    const matchesType = filterType === 'all' || o.deliveryType === filterType;
    const matchesPayment = filterPayment === 'all' || o.paymentMethod === filterPayment;
    const matchesDate = !filterDate || formatDateInput(o.createdAt) === filterDate;
    return matchesType && matchesPayment && matchesDate && o.status !== "cancelado";
  });

  return (
    <div className="space-y-6">
      {/* Top filter row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Painel Kanban Operacional
          </h1>
          <p className="text-sm text-slate-500 font-sans">
            Gerencie o ciclo de produção das pizzas. Mude os status clicando nas ações correspondentes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenNewOrderModal && (
            <button
              onClick={onOpenNewOrderModal}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-sm font-sans"
            >
              Lançar Pedido Manual
            </button>
          )}

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg font-sans outline-hidden"
          >
            <option value="all">Todas Entregas</option>
            <option value="delivery">Apenas Delivery 🏍️</option>
            <option value="retirada">Apenas Retiradas 🚶</option>
          </select>

          <select
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value as any)}
            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg font-sans outline-hidden"
          >
            <option value="all">Forma Pgto</option>
            <option value="pix">PIX</option>
            <option value="cartao">Cartão</option>
            <option value="dinheiro">Dinheiro</option>
          </select>

          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg font-sans">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-transparent outline-hidden text-xs"
              title="Filtrar por data"
            />
            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate("")}
                className="text-slate-400 hover:text-slate-700"
                title="Limpar data"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {colStatuses.map(status => {
          const colOrders = filteredOrders.filter(o => o.status === status);
          const colSum = colOrders.reduce((sum, o) => sum + o.totalValue, 0);

          return (
            <div 
              key={status} 
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStatus(status);
              }}
              onDragLeave={() => setDragOverStatus(prev => prev === status ? null : prev)}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnStatus(status);
              }}
              className={`flex-none w-full min-h-[500px] bg-white border border-slate-100 rounded-xl p-4 flex flex-col space-y-3 shadow-xs transition-all ${getColColor(status)} ${
                dragOverStatus === status ? "ring-2 ring-orange-400 ring-offset-2 bg-orange-50/60" : ""
              }`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{getColIcon(status)}</span>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-sans">
                    {columnNames[status] || status}
                  </h3>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full font-mono">
                  {colOrders.length}
                </span>
              </div>
              
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pb-2 border-b border-slate-100">
                <span>VALOR TOTAL</span>
                <span>R$ {colSum.toFixed(2)}</span>
              </div>

              {/* Order Cards container */}
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[550px] pr-0.5">
                {colOrders.map(order => (
                  <div 
                    key={order.id} 
                    draggable
                    onDragStart={(e) => {
                      setDraggingOrderId(order.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", order.id);
                    }}
                    onDragEnd={() => {
                      setDraggingOrderId(null);
                      setDragOverStatus(null);
                    }}
                    className={`p-3 bg-white border border-slate-200 hover:border-slate-300 transition-all rounded-lg shadow-2xs space-y-2 cursor-grab active:cursor-grabbing relative ${
                      draggingOrderId === order.id ? "opacity-50 scale-[0.98]" : ""
                    }`}
                    onClick={() => openOrderDetails(order)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-800 font-mono">#{order.orderNumber}</span>
                      <span className={`text-[9px] px-1.5 rounded font-mono font-bold uppercase ${
                        order.paymentStatus === "approved" ? "bg-emerald-50 text-emerald-700" :
                        order.paymentStatus === "cancelled" ? "bg-red-50 text-red-700" :
                        "bg-amber-50 text-amber-700"
                      }`}>
                        {order.paymentStatus === "approved" ? "Pago" : "Pendente"}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <h4 className="text-xs font-semibold text-slate-800 line-clamp-1 font-sans">{order.customerName}</h4>
                      <p className="text-[11px] text-slate-500 font-sans line-clamp-2">
                        {order.items.map(it => `${it.qty}x ${it.name}`).join(", ")}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-50">
                      <span className="font-mono">R$ {order.totalValue.toFixed(2)}</span>
                      <span className="font-mono text-[9px] uppercase font-bold text-slate-500">
                        {order.paymentMethod}
                      </span>
                    </div>

                    {/* Fast movement operators */}
                    <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 onClickStop" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          const prevIdx = colStatuses.indexOf(status) - 1;
                          if (prevIdx >= 0) onUpdateOrderStatus(order.id, colStatuses[prevIdx]);
                        }}
                        disabled={colStatuses.indexOf(status) === 0}
                        title="Mover para coluna anterior"
                        className="w-7 h-7 flex items-center justify-center border border-slate-200 text-slate-400 hover:text-orange-600 hover:border-orange-300 hover:bg-orange-50/50 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:border-slate-200 disabled:hover:text-slate-400 transition-all rounded-full cursor-pointer shadow-3xs"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase font-mono">Status</span>

                      <button
                        onClick={() => {
                          const nextIdx = colStatuses.indexOf(status) + 1;
                          if (nextIdx < colStatuses.length) {
                            // If moving to confirmed or next, auto-set paid if cash on hand
                            const updatePayment = (colStatuses[nextIdx] === "confirmado") ? "approved" : undefined;
                            onUpdateOrderStatus(order.id, colStatuses[nextIdx], updatePayment);
                          }
                        }}
                        disabled={colStatuses.indexOf(status) === colStatuses.length - 1}
                        title="Avançar para próxima coluna"
                        className="w-7 h-7 flex items-center justify-center border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50/50 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:border-slate-200 disabled:hover:text-slate-500 transition-all rounded-full cursor-pointer shadow-3xs"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {colOrders.length === 0 && (
                  <div className="py-8 text-center text-[10px] text-slate-300 font-sans border border-dashed border-slate-100 rounded-lg">
                    Vazio
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal - Order Details Sheet */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-100">
            {/* Modal Header */}
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-orange-600 font-mono">Detalhes Operacionais</span>
                <h3 className="text-sm font-bold text-slate-800 font-sans">
                  Pedido #{selectedOrder.orderNumber}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedOrder(null)}
                className="p-1 hover:bg-slate-200 rounded"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[480px]">
              
              {/* Customer Profile Mini-card */}
              <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg space-y-1">
                <div className="flex items-center gap-1 text-xs font-bold text-slate-700">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span>{selectedOrder.customerName}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                  <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {selectedOrder.customerPhone}</span>
                  <span>•</span>
                  <span>Última visita: Hoje</span>
                </div>
              </div>

              {/* Items Summary list */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">ITENS DO PEDIDO</span>
                <div className="divide-y divide-slate-100">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="py-2 flex justify-between text-xs text-slate-700">
                      <div>
                        <span className="font-bold text-slate-900 font-mono mr-1.5">{item.qty}x</span>
                        <span>{item.name}</span>
                        {item.observation && (
                          <span className="block text-[10px] text-orange-500 italic">obs: {item.observation}</span>
                        )}
                      </div>
                      <span className="font-mono text-slate-600">R$ {(item.priceUnit * item.qty).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-bold text-sm text-slate-900 pt-2 border-t border-slate-100 font-mono">
                  <span>TOTAL COBRADO</span>
                  <span>R$ {selectedOrder.totalValue.toFixed(2)}</span>
                </div>
              </div>

              {/* Operational & Delivery details */}
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">OPÇÕES E PARÂMETROS</span>
                
                {isEditingModal ? (
                  <div className="space-y-3 p-3 bg-orange-50/20 rounded-lg border border-orange-100">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 font-sans mb-1">ENDEREÇO DE ENTREGA</label>
                      <input 
                        type="text" 
                        value={editAddress} 
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-sans text-slate-800 outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 font-sans mb-1">OBSERVAÇÕES DO PEDIDO</label>
                      <textarea 
                        value={editNotes} 
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={2}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-sans text-slate-800 outline-hidden"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-semibold text-slate-500 font-sans">ITENS DO PEDIDO</label>
                        <button
                          type="button"
                          onClick={() => setEditItems(items => [...items, { name: "", qty: 1, priceUnit: 0, observation: "" }])}
                          className="text-[10px] font-semibold text-orange-700 hover:text-orange-800"
                        >
                          + item
                        </button>
                      </div>
                      <div className="space-y-2">
                        {editItems.map((item, index) => (
                          <div key={index} className="grid grid-cols-12 gap-1.5 p-2 bg-white border border-slate-200 rounded-lg">
                            <input
                              type="number"
                              min="1"
                              value={item.qty}
                              onChange={(e) => updateEditItem(index, { qty: Number(e.target.value) })}
                              className="col-span-2 px-2 py-1.5 text-xs border border-slate-200 rounded font-mono outline-hidden"
                              title="Quantidade"
                            />
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateEditItem(index, { name: e.target.value })}
                              className="col-span-5 px-2 py-1.5 text-xs border border-slate-200 rounded font-sans outline-hidden"
                              placeholder="Produto"
                            />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.priceUnit}
                              onChange={(e) => updateEditItem(index, { priceUnit: Number(e.target.value) })}
                              className="col-span-3 px-2 py-1.5 text-xs border border-slate-200 rounded font-mono outline-hidden"
                              title="Preco unitario"
                            />
                            <button
                              type="button"
                              onClick={() => setEditItems(items => items.filter((_, idx) => idx !== index))}
                              className="col-span-2 text-red-500 hover:bg-red-50 rounded text-xs font-bold"
                              title="Remover item"
                            >
                              <X className="w-3.5 h-3.5 mx-auto" />
                            </button>
                            <input
                              type="text"
                              value={item.observation || ""}
                              onChange={(e) => updateEditItem(index, { observation: e.target.value })}
                              className="col-span-12 px-2 py-1.5 text-xs border border-slate-200 rounded font-sans outline-hidden"
                              placeholder="Observacao do item"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs font-bold font-mono text-slate-700 pt-1">
                        <span>Total recalculado</span>
                        <span>
                          R$ {editItems.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.priceUnit) || 0), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 font-sans mb-1">FATO DE PAGAMENTO (ASAA/GATEWAY)</label>
                      <select 
                        value={editPaymentStatus} 
                        onChange={(e: any) => setEditPaymentStatus(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono text-slate-800 outline-hidden"
                      >
                        <option value="pending">pending (aguardando PIX)</option>
                        <option value="approved">approved (confirmado pago)</option>
                        <option value="cancelled">cancelled (cancelado/falhado)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-650">
                    <div className="space-y-1">
                      <span className="text-[8px] font-bold text-slate-400 block">FORMA PGTO</span>
                      <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-bold uppercase text-slate-700">
                        {selectedOrder.paymentMethod}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[8px] font-bold text-slate-400 block">STATUS PGTO</span>
                      <span className={`inline-block font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                        selectedOrder.paymentStatus === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                      }`}>
                        {selectedOrder.paymentStatus}
                      </span>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <span className="text-[8px] font-bold text-slate-400 block">LINK DE PAGAMENTO</span>
                      {selectedOrder.paymentLink ? (
                        <a
                          href={selectedOrder.paymentLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11px] text-blue-700 underline break-all"
                        >
                          {selectedOrder.paymentLink}
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-sans">Nenhum link gerado ainda.</span>
                      )}
                    </div>
                    <div className="col-span-2 space-y-1">
                      <span className="text-[8px] font-bold text-slate-400 block">ENDEREÇO ENTREGA</span>
                      <span className="font-sans text-slate-700 flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-none mt-0.5" />
                        {selectedOrder.deliveryAddress || "Retirada Balcão"}
                      </span>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <span className="text-[8px] font-bold text-slate-400 block">OBSERVAÇÕES</span>
                      <p className="font-sans text-slate-600 bg-slate-50 p-2 rounded text-xs leading-relaxed">
                        {selectedOrder.notes || "Nenhuma observação informada."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* simulated whatsapp message copy-paste */}
              <div className="p-3 bg-indigo-50/20 border border-indigo-100/30 rounded-lg space-y-2">
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono tracking-wider block">
                  Mensagem Automática WhatsApp enviada na Transição:
                </span>
                <p className="text-[11px] text-slate-600 italic leading-relaxed">
                  {selectedOrder.status === "novo" && "⏳ Aguarda comprovação/link faturamento PIX."}
                  {selectedOrder.status === "confirmado" && "✅ \"Confirmado! Já encaminhamos para produção.\""}
                  {selectedOrder.status === "no_forno" && "🔥 \"Boa notícia! Seu pedido está no forno!\""}
                  {selectedOrder.status === "a_caminho" && "🏍️ \"Seu pedido saiu para entrega! Chegará em breve.\""}
                  {selectedOrder.status === "entregue" && "📦 \"Mensagem de agradecimento personalizada configurada.\""}
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-150 flex items-center justify-between gap-4">
              <button
                onClick={() => {
                  if (confirm(`Deseja mesmo cancelar o Pedido #${selectedOrder.orderNumber}? Isso notificará o cliente no WhatsApp.`)) {
                    onCancelOrder(selectedOrder.id);
                    setSelectedOrder(null);
                  }
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded"
              >
                Cancelar Pedido
              </button>

              <div className="flex items-center gap-2">
                {isEditingModal ? (
                  <>
                    <button
                      onClick={() => setIsEditingModal(false)}
                      className="px-3.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 font-sans"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleSaveDetails}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-xs font-sans"
                    >
                      Salvar Alterações
                    </button>
                  </>
                ) : (
                  <>
                    {selectedOrder.paymentMethod === "pix" && selectedOrder.paymentStatus !== "approved" && onGeneratePaymentLink && (
                      <button
                        onClick={handleGeneratePayment}
                        disabled={generatingPaymentFor === selectedOrder.id}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded font-sans disabled:opacity-60"
                      >
                        <DollarSign className="w-3 h-3" />
                        {generatingPaymentFor === selectedOrder.id ? "Gerando..." : selectedOrder.paymentLink ? "Regerar PIX" : "Gerar PIX"}
                      </button>
                    )}
                    <button
                      onClick={() => setIsEditingModal(true)}
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded font-sans"
                    >
                      <Edit2 className="w-3 h-3" />
                      Editar Itens/Observações
                    </button>
                    <button
                      onClick={() => setSelectedOrder(null)}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded font-sans"
                    >
                      Fechar
                    </button>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
