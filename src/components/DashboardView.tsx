import React from "react";
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  LineChart, 
  Line, 
  AreaChart, 
  Area 
} from "recharts";
import { 
  ShoppingBag, 
  Clock, 
  TrendingUp, 
  UserSquare2, 
  UtensilsCrossed, 
  CheckCircle2, 
  XCircle, 
  DollarSign, 
  Percent,
  Play,
  ArrowUpRight,
  Plus
} from "lucide-react";
import { Order, Product, Customer } from "../types";

interface DashboardViewProps {
  orders: Order[];
  products: Product[];
  customers: Customer[];
  onNavigate: (tab: string) => void;
  onOpenNewOrderModal?: () => void;
}

export function DashboardView({ 
  orders, 
  products, 
  customers, 
  onNavigate,
  onOpenNewOrderModal
}: DashboardViewProps) {
  const isToday = (date: string) => {
    const value = new Date(date);
    const now = new Date();
    return value.getFullYear() === now.getFullYear()
      && value.getMonth() === now.getMonth()
      && value.getDate() === now.getDate();
  };

  const todayOrders = orders.filter(o => isToday(o.createdAt));
  const activeOrders = todayOrders.filter(o => o.status !== "entregue" && o.status !== "cancelado");
  const awaitingPayment = todayOrders.filter(o => o.paymentStatus === "pending" && o.status !== "cancelado");
  const inOven = todayOrders.filter(o => o.status === "no_forno");
  const onTheWay = todayOrders.filter(o => o.status === "a_caminho");
  const deliveredToday = todayOrders.filter(o => o.status === "entregue");
  const cancelledToday = todayOrders.filter(o => o.status === "cancelado");

  // Sum faturado
  const totalFaturado = todayOrders
    .filter(o => o.paymentStatus === "approved" && o.status !== "cancelado")
    .reduce((acc, o) => acc + o.totalValue, 0);

  // Hourly Chart Calculation
  const hourlyData = Array.from({ length: 7 }, (_, i) => {
    const hour = 18 + i; // 18:00 to 00:00
    const count = todayOrders.filter(o => {
      const orderHour = new Date(o.createdAt).getHours();
      return orderHour === hour;
    }).length;

    return {
      hora: `${hour}:00`,
      Pedidos: count
    };
  });

  // Cumulative revenues list for line-chart
  let runningTotal = 0;
  const billingData = Array.from({ length: 7 }, (_, i) => {
    const hour = 18 + i;
    const hourOrders = todayOrders.filter(o => {
      const orderHour = new Date(o.createdAt).getHours();
      return orderHour === hour && o.paymentStatus === "approved" && o.status !== "cancelado";
    });
    
    const hourSum = hourOrders.reduce((tmp, o) => tmp + o.totalValue, 0);
    runningTotal += hourSum;

    return {
      hora: `${hour}:00`,
      Faturamento: runningTotal
    };
  });

  // Average Ticket
  const totalBilledOrders = todayOrders.filter(o => o.paymentStatus === "approved" && o.status !== "cancelado").length;
  const ticketMedio = totalBilledOrders > 0 ? totalFaturado / totalBilledOrders : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Visão Geral do Delivery
          </h1>
          <p className="text-sm text-slate-500 font-sans">
            Acompanhamento em tempo real das vendas, pedidos e interações do PizzaBot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenNewOrderModal && (
            <button
              onClick={onOpenNewOrderModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 transition-colors rounded-lg shadow-sm font-sans"
            >
              <Plus className="w-4 h-4" />
              Lançar Pedido Manual
            </button>
          )}
          <button
            onClick={() => onNavigate("kanban")}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors rounded-lg font-sans"
          >
            Ver Kanban de Pedidos
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">Pedidos Ativos</span>
            <span className="p-1 px-2.5 text-xs font-bold text-orange-700 bg-orange-50 rounded-full font-mono">{activeOrders.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{activeOrders.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Hoje em processamento</div>
        </div>

        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">Aguardando Pgto</span>
            <span className="p-1 px-2.5 text-xs font-bold text-yellow-700 bg-yellow-50 rounded-full font-mono">{awaitingPayment.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{awaitingPayment.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Links de PIX enviados</div>
        </div>

        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono font-sans">No Forno</span>
            <span className="p-1 px-2.5 text-xs font-bold text-purple-700 bg-purple-50 rounded-full font-mono">{inOven.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{inOven.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Forno a 350°C 🍕</div>
        </div>

        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">A Caminho</span>
            <span className="p-1 px-2.5 text-xs font-bold text-blue-700 bg-blue-50 rounded-full font-mono">{onTheWay.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{onTheWay.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Com o Motoqueiro</div>
        </div>

        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">Entregues hoje</span>
            <span className="p-1 px-2.5 text-xs font-bold text-emerald-700 bg-emerald-50 rounded-full font-mono">{deliveredToday.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{deliveredToday.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Encerrados hoje</div>
        </div>

        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">Cancelados</span>
            <span className="p-1 px-2.5 text-xs font-bold text-red-700 bg-red-50 rounded-full font-mono">{cancelledToday.length}</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{cancelledToday.length}</p>
          <div className="text-[10px] text-slate-400 font-sans">Desistências ou recusas</div>
        </div>
      </div>

      {/* Main Graphics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly distribution */}
        <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 font-sans">
                Pedidos por Hora (Ciclo Hoje)
              </h3>
              <p className="text-xs text-slate-400 font-sans">Fluxo de volume de atendimento das 18h às 00h</p>
            </div>
            <TrendingUp className="w-4 h-4 text-orange-500" />
          </div>
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="hora" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#1e293b", borderRadius: "8px", border: "none" }} 
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold", fontFamily: "monospace" }}
                  itemStyle={{ color: "#f8fafc", fontFamily: "sans-serif" }}
                />
                <Bar dataKey="Pedidos" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={35} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Accumulated income */}
        <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 font-sans">
                Faturamento Acumulado (R$)
              </h3>
              <p className="text-xs text-slate-400 font-sans">Evolução do caixa das vendas fechadas no dia</p>
            </div>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={billingData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorFaturamento" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="hora" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  formatter={(val) => [`R$ ${parseFloat(val as string).toFixed(2)}`, 'Acumulado']}
                  contentStyle={{ backgroundColor: "#1e293b", borderRadius: "8px", border: "none" }} 
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold", fontFamily: "monospace" }}
                  itemStyle={{ color: "#10b981", fontFamily: "sans-serif" }}
                />
                <Area type="monotone" dataKey="Faturamento" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorFaturamento)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Grid: CRM Highlights + Rapid actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Stats overview */}
        <div className="lg:col-span-1 p-5 bg-white border border-slate-100 rounded-xl shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 font-sans mb-3">
              Fórmula de Performance
            </h3>
            <p className="text-xs text-slate-400 mb-4">Conversão e rentabilidade dos últimos pedidos hoje.</p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="p-1 px-1.5 bg-emerald-100 text-emerald-800 text-[10px] uppercase font-mono rounded font-bold">Ticket Médio</div>
              </div>
              <span className="text-sm font-bold text-slate-800 font-mono">
                R$ {ticketMedio.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="p-1 px-1.5 bg-orange-100 text-orange-800 text-[10px] uppercase font-mono rounded font-bold">Taxa Conversão</div>
              </div>
              <span className="text-sm font-bold text-slate-800 font-mono">
                {todayOrders.length > 0 ? ((todayOrders.filter(o => o.status === "entregue" || o.status === "confirmado" || o.status === "no_forno").length / todayOrders.length) * 100).toFixed(0) : 0}%
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="p-1 px-1.5 bg-sky-100 text-sky-800 text-[10px] uppercase font-mono rounded font-bold">Assinantes Ativos</div>
              </div>
              <span className="text-sm font-bold text-slate-800 font-sans">
                Plano Pro Ativo
              </span>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 mt-4 text-[11px] text-slate-400 font-sans">
            Sistema de atendimento ativo e sincronizado com WhatsApp, pedidos e pagamentos.
          </div>
        </div>

        {/* Real-time incoming Order Stream list */}
        <div className="lg:col-span-2 p-5 bg-white border border-slate-100 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 font-sans">
                Últimas Atualizações de Pedidos (Live)
              </h3>
              <p className="text-xs text-slate-400 font-sans">Filtrado pelos mais recentes</p>
            </div>
            <button 
              onClick={() => onNavigate("kanban")}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors font-sans"
            >
              Ver todos no Kanban →
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-[220px] overflow-y-auto pr-1">
            {orders.slice(-4).reverse().map((order) => (
              <div key={order.id} className="py-3 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800 font-mono">Pedido #{order.orderNumber}</span>
                    <span className="text-xs text-slate-500 font-sans">{order.customerName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 font-bold font-mono rounded uppercase bg-blue-50 text-blue-700">
                      {order.deliveryType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-1 font-sans">
                    {order.items.map(it => `${it.qty}x ${it.name}`).join(", ")}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-xs font-bold text-slate-900 font-mono">R$ {order.totalValue.toFixed(2)}</p>
                  <span className={`inline-block text-[10px] px-2 py-0.5 font-bold font-mono rounded uppercase ${
                    order.status === "novo" ? "bg-orange-50 text-orange-700" :
                    order.status === "confirmado" ? "bg-emerald-50 text-emerald-700" :
                    order.status === "no_forno" ? "bg-purple-50 text-purple-700" :
                    order.status === "a_caminho" ? "bg-blue-50 text-blue-700" :
                    order.status === "entregue" ? "bg-slate-50 text-slate-400line" :
                    "bg-red-50 text-red-700"
                  }`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
            {orders.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400 font-sans">Nenhum pedido registrado hoje.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
