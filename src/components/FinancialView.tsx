import React, { useState } from "react";
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell, 
  Legend, 
  LineChart, 
  Line 
} from "recharts";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent, 
  ShoppingBag, 
  Download, 
  Calendar,
  Award
} from "lucide-react";
import { Order } from "../types";

interface FinancialViewProps {
  orders: Order[];
}

type PeriodType = 'hoje' | 'semana' | 'mes' | 'personalizado' | 'todos';

export function FinancialView({ orders }: FinancialViewProps) {
  const [activePeriod, setActivePeriod] = useState<PeriodType>("todos");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Filtering based on simulation period
  const filterByPeriod = (o: Order) => {
    const orderDate = new Date(o.createdAt);
    const elapsedMs = Date.now() - new Date(o.createdAt).getTime();
    if (activePeriod === 'hoje') {
      return elapsedMs < 24 * 60 * 60 * 1000;
    } else if (activePeriod === 'semana') {
      return elapsedMs < 7 * 24 * 60 * 60 * 1000;
    } else if (activePeriod === 'mes') {
      return elapsedMs < 30 * 24 * 60 * 60 * 1000;
    } else if (activePeriod === 'personalizado') {
      const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
      const end = customEndDate ? new Date(`${customEndDate}T23:59:59`) : null;
      if (start && orderDate < start) return false;
      if (end && orderDate > end) return false;
      return true;
    }
    return true; // Todos
  };

  const periodOrders = orders.filter(filterByPeriod);
  
  // Calculate billing metrics
  const approvedOrders = periodOrders.filter(o => o.paymentStatus === "approved" && o.status !== "cancelado");
  const cancelledOrders = periodOrders.filter(o => o.status === "cancelado");

  const totalFaturado = approvedOrders.reduce((sum, o) => sum + o.totalValue, 0);
  const totalOrdersCount = periodOrders.length;
  const approvedCount = approvedOrders.length;
  
  const ticketMedio = approvedCount > 0 ? totalFaturado / approvedCount : 0;
  
  const totalCanceladosPerdidos = cancelledOrders.reduce((sum, o) => sum + o.totalValue, 0);
  const taxaConversao = totalOrdersCount > 0 ? (approvedCount / totalOrdersCount) * 100 : 0;

  // Payments breakout for Pie chart
  const paymentBreakdownData = [
    { name: "PIX copia-e-cola", value: approvedOrders.filter(o => o.paymentMethod === "pix").reduce((s,o)=>s+o.totalValue, 0), color: "#06b6d4" },
    { name: "Cartão Online/Maquininha", value: approvedOrders.filter(o => o.paymentMethod === "cartao").reduce((s,o)=>s+o.totalValue, 0), color: "#6366f1" },
    { name: "Dinheiro Entregador", value: approvedOrders.filter(o => o.paymentMethod === "dinheiro").reduce((s,o)=>s+o.totalValue, 0), color: "#10b981" }
  ].filter(item => item.value > 0);

  const finalPaymentData = paymentBreakdownData;

  // Most sold products list
  const itemMap: Record<string, { qty: number; value: number }> = {};
  approvedOrders.forEach(o => {
    o.items.forEach(it => {
      if (itemMap[it.name]) {
        itemMap[it.name].qty += it.qty;
        itemMap[it.name].value += it.priceUnit * it.qty;
      } else {
        itemMap[it.name] = { qty: it.qty, value: it.priceUnit * it.qty };
      }
    });
  });

  const topProducts = Object.entries(itemMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const dailyTotals = approvedOrders.reduce<Record<string, number>>((acc, order) => {
    const label = new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    acc[label] = (acc[label] || 0) + order.totalValue;
    return acc;
  }, {});

  const displayDailyData = Object.entries(dailyTotals)
    .map(([dia, Faturamento]) => ({ dia, Faturamento: Number(Faturamento.toFixed(2)) }))
    .sort((a, b) => {
      const [dayA, monthA] = a.dia.split('/').map(Number);
      const [dayB, monthB] = b.dia.split('/').map(Number);
      return new Date(new Date().getFullYear(), monthA - 1, dayA).getTime()
        - new Date(new Date().getFullYear(), monthB - 1, dayB).getTime();
    });

  // Dynamic Browser CSV Export simulation
  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "ID Pedido,Numero Pedido,Data,Cliente,Itens,Total Cobrado,Forma Pagamento,Status,Status Pagamento\n";

    periodOrders.forEach(o => {
      const itemsStr = o.items.map(it => `${it.qty}x ${it.name}`).join(" | ");
      const row = `"${o.id}","${o.orderNumber}","${o.createdAt}","${o.customerName}","${itemsStr}","R$ ${o.totalValue.toFixed(2)}","${o.paymentMethod}","${o.status}","${o.paymentStatus}"\n`;
      csvContent += row;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_pizzabot_${activePeriod}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Upper row header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 font-sans">
            Financeiro e Métricas
          </h1>
          <p className="text-sm text-slate-500 font-sans font-normal">
            Acompanhe o faturamento, ticket de consumo, desistências e exporte relatórios consolidados em CSV.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Calendar selector Period */}
          <div className="inline-flex rounded-lg border border-slate-250 bg-white p-1">
            <button
              onClick={() => setActivePeriod('hoje')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all font-sans ${
                activePeriod === 'hoje' ? "bg-orange-50/70 text-orange-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Hoje
            </button>
            <button
              onClick={() => setActivePeriod('semana')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all font-sans ${
                activePeriod === 'semana' ? "bg-orange-50/70 text-orange-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Esta Semana
            </button>
            <button
              onClick={() => setActivePeriod('mes')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all font-sans ${
                activePeriod === 'mes' ? "bg-orange-50/70 text-orange-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Este Mês
            </button>
            <button
              onClick={() => setActivePeriod('personalizado')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all font-sans ${
                activePeriod === 'personalizado' ? "bg-orange-50/70 text-orange-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Personalizado
            </button>
            <button
              onClick={() => setActivePeriod('todos')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all font-sans ${
                activePeriod === 'todos' ? "bg-orange-50/70 text-orange-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Histórico Geral
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all rounded-lg font-sans"
            title="Exportar dados de faturamentos listados"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
        </div>
      </div>

      {activePeriod === 'personalizado' && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 p-4 bg-white border border-slate-100 rounded-xl shadow-2xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">
              Data inicial
            </label>
            <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-transparent text-xs text-slate-700 outline-none font-sans"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">
              Data final
            </label>
            <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-slate-50">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-transparent text-xs text-slate-700 outline-none font-sans"
              />
            </div>
          </div>
          {(customStartDate || customEndDate) && (
            <button
              type="button"
              onClick={() => {
                setCustomStartDate("");
                setCustomEndDate("");
              }}
              className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-sans"
            >
              Limpar período
            </button>
          )}
        </div>
      )}

      {/* Financial Indicators Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Billed approved */}
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-emerald-600 tracking-wider block font-mono">Faturamento Líquido</span>
          <p className="text-2xl font-bold text-slate-850 font-mono">R$ {totalFaturado.toFixed(2)}</p>
          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-sans">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span>Soma dos aprovados</span>
          </div>
        </div>

        {/* Sales concluded */}
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 tracking-wider block font-mono">Aprovados Conversão</span>
          <p className="text-2xl font-bold text-slate-850 font-mono">#{approvedCount} <span className="text-[11px] text-slate-400 font-sans">vendas</span></p>
          <span className="text-[10px] text-slate-400 leading-none block font-sans">De um total de #{totalOrdersCount} pedidos</span>
        </div>

        {/* Ticket value */}
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 tracking-wider block font-mono">Ticket Médio</span>
          <p className="text-2xl font-bold text-slate-850 font-mono">R$ {ticketMedio.toFixed(2)}</p>
          <span className="text-[10px] text-slate-400 block font-sans">Consumo médio por ticket</span>
        </div>

        {/* Cancellations perdu */}
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-red-600 tracking-wider block font-mono">Perda Cancelados</span>
          <p className="text-2xl font-bold text-red-600 font-mono">R$ {totalCanceladosPerdidos.toFixed(2)}</p>
          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-sans">
            <TrendingDown className="w-3 h-3 text-red-500" />
            <span>Total de {cancelledOrders.length} cancelamentos</span>
          </div>
        </div>

        {/* conversion percentage */}
        <div className="p-4 bg-white border border-slate-100 rounded-xl shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-amber-600 tracking-wider block font-mono">Taxa de Conversão</span>
          <p className="text-2xl font-bold text-slate-850 font-mono">{taxaConversao.toFixed(0)}%</p>
          <span className="text-[10px] text-slate-400 block font-sans">Aprovados contra criados</span>
        </div>
      </div>

      {/* Figures Breakdown Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly sales bars */}
        <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-sans">Estatística Semanal Consolidade</h3>
              <p className="text-xs text-slate-400 font-sans">Análise histórica do faturamento por dia de semana</p>
            </div>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>

          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={displayDailyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="dia" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  formatter={(val) => [`R$ ${val}`, 'Faturamento']}
                  contentStyle={{ backgroundColor: "#1e293b", borderRadius: "8px", border: "none" }} 
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold", fontFamily: "monospace" }}
                  itemStyle={{ color: "#10b981", fontFamily: "sans-serif" }}
                />
                <Bar dataKey="Faturamento" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={35} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payments breakdown pie chart */}
        <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-xs lg:col-span-1">
          <div className="flex flex-col mb-4">
            <h3 className="text-sm font-bold text-slate-900 font-sans">Meios de Pagamento</h3>
            <span className="text-xs text-slate-400 font-sans">Breakdown das vendas aprovadas</span>
          </div>

          <div className="h-44 mt-2 relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={finalPaymentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {finalPaymentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val) => `R$ ${parseFloat(val as string).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Legends list */}
          <div className="mt-4 space-y-2">
            {finalPaymentData.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs text-slate-650">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="font-sans text-slate-700">{item.name}</span>
                </div>
                <span className="font-mono font-bold text-slate-800">
                  R$ {item.value.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Sold Products statistics */}
      <div className="p-5 bg-white border border-slate-100 rounded-xl shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 font-sans mb-1 flex items-center gap-1.5">
          <Award className="w-4 h-4 text-orange-500" />
          Ranking de Produtos Mais Vendidos (Volume)
        </h3>
        <p className="text-xs text-slate-400 font-sans pb-3 border-b mb-3">Volume de pedidos e faturamento gerados por prato/bebida</p>

        <div className="divide-y divide-slate-100">
          {topProducts.map((p, index) => (
            <div key={p.name} className="py-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-orange-100 font-bold font-mono text-orange-850 text-[10px]">
                  {index + 1}
                </span>
                <span className="font-bold text-slate-800 font-sans">{p.name}</span>
              </div>
              <div className="text-right flex items-center gap-6 font-mono font-bold">
                <span className="text-slate-400">Qtd: {p.qty}</span>
                <span className="text-slate-900">R$ {p.value.toFixed(2)}</span>
              </div>
            </div>
          ))}
          {topProducts.length === 0 && (
            <div className="py-12 text-center text-xs text-slate-400 font-sans">Nenhum faturamento de pratos aprovado neste período de simulação.</div>
          )}
        </div>
      </div>

    </div>
  );
}
