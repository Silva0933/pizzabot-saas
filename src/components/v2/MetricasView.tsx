/**
 * View de análise histórica — vai dentro de "Meu Negócio → Análise".
 *
 * Mostra:
 *  - 4 KPIs do período (pedidos, vendido, ticket, cancelamento) com Δ vs período anterior
 *  - Gráfico de linha: vendas por dia
 *  - Bar chart: horários de pico
 *  - Lista: top 5 produtos
 */
import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  BarChart,
  Bar,
} from "recharts";
import { TrendingUp, TrendingDown, Loader2, AlertCircle, Trophy, Clock, ShoppingBag, DollarSign, Ban } from "lucide-react";
import { metricasApi, MetricasResponse } from "../../lib/api";

export interface MetricasViewProps {
  pizzariaId: string;
}

const PERIODOS = [
  { label: "7 dias",  value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

export function MetricasView({ pizzariaId }: MetricasViewProps) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<MetricasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // overlay ao trocar período
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Se já há dados exibidos, usa overlay suave em vez de loading total.
    if (data) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErro(null);
    metricasApi
      .get(pizzariaId, days)
      .then((d) => { if (!cancelled) { setData(d); } })
      .catch((e) => { if (!cancelled) setErro(e.message); })
      .finally(() => {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      });
    return () => {
      cancelled = true;
    };
  }, [pizzariaId, days]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {erro}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { resumo, comparativo, serie_diaria, top_produtos, horarios_pico } = data;
  const serieFormat = serie_diaria.map((d) => ({
    ...d,
    dia_label: formatDayShort(d.dia),
  }));

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto pb-24 md:pb-6 relative">
      {/* Overlay suave de carregamento ao trocar período (mantém dados visíveis) */}
      {refreshing && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-start justify-center pt-20 rounded-xl">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-2 shadow-sm">
            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
            <span className="text-xs font-medium text-slate-600">Atualizando dados...</span>
          </div>
        </div>
      )}
      {/* Header + seletor de período */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Análise do seu negócio</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Como você está indo nos últimos {days} dias.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setDays(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === p.value
                  ? "bg-white text-orange-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aviso de período sem dados */}
      {resumo.pedidos === 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
          <ShoppingBag className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Nenhum pedido nos últimos {days} dias</p>
          <p className="text-xs text-slate-400 mt-1">Os dados aparecerão conforme os pedidos forem realizados.</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          icon={<ShoppingBag className="w-4 h-4" />}
          label="Pedidos"
          value={resumo.pedidos.toString()}
          delta={comparativo.pct_pedidos}
          accent="orange"
        />
        <Kpi
          icon={<DollarSign className="w-4 h-4" />}
          label="Vendido"
          value={formatBRL(resumo.vendido)}
          delta={comparativo.pct_vendido}
          accent="emerald"
        />
        <Kpi
          icon={<TrendingUp className="w-4 h-4" />}
          label="Ticket médio"
          value={formatBRL(resumo.ticket_medio)}
          accent="violet"
        />
        <Kpi
          icon={<Ban className="w-4 h-4" />}
          label="Cancelamento"
          value={`${resumo.taxa_cancelamento}%`}
          accent={resumo.taxa_cancelamento > 10 ? "red" : "slate"}
        />
      </div>

      {/* Gráfico: vendas por dia */}
      <Card title="Vendas por dia" icon={<TrendingUp className="w-4 h-4" />}>
        {serieFormat.length === 0 ? (
          <Empty msg="Sem pedidos no período." />
        ) : (
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={serieFormat} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis dataKey="dia_label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <RTooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="vendido"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  name="Vendido"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Grid: horários + top produtos */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Horários de pico" icon={<Clock className="w-4 h-4" />}>
          {horarios_pico.length === 0 ? (
            <Empty msg="Sem dados de horário." />
          ) : (
            <div className="h-56 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={horarios_pico.map((h) => ({ ...h, label: `${String(h.hora).padStart(2, "0")}h` }))}
                  margin={{ top: 5, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                  <RTooltip
                    formatter={(v: any) => [`${v} pedido${v > 1 ? "s" : ""}`, ""]}
                    cursor={{ fill: "#fff7ed" }}
                  />
                  <Bar dataKey="pedidos" fill="#fdba74" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Top 5 produtos" icon={<Trophy className="w-4 h-4 text-amber-500" />}>
          {top_produtos.length === 0 ? (
            <Empty msg="Sem produtos vendidos." />
          ) : (
            <ul className="space-y-2">
              {top_produtos.map((p, idx) => (
                <li
                  key={p.nome}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50"
                >
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                    idx === 0 ? "bg-amber-100 text-amber-700" :
                    idx === 1 ? "bg-slate-200 text-slate-600" :
                    idx === 2 ? "bg-orange-100 text-orange-700" :
                    "bg-slate-100 text-slate-500"
                  }`}>{idx + 1}</span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{p.nome}</span>
                  <span className="text-xs font-semibold text-slate-500">{p.qtd_vendida}x</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ============================================
// Helpers
// ============================================
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-3">
        <span className="text-slate-500">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="text-center py-10">
      <p className="text-xs text-slate-400">{msg}</p>
    </div>
  );
}

function Kpi({
  icon, label, value, delta, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: number | null;
  accent: "orange" | "emerald" | "violet" | "red" | "slate";
}) {
  const styles = {
    orange:  "bg-orange-100 text-orange-700",
    emerald: "bg-emerald-100 text-emerald-700",
    violet:  "bg-violet-100 text-violet-700",
    red:     "bg-red-100 text-red-700",
    slate:   "bg-slate-100 text-slate-600",
  }[accent];

  const showDelta = delta !== null && delta !== undefined;
  const positive = (delta ?? 0) >= 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${styles}`}>
          {icon}
        </div>
        {showDelta && (
          <span className={`text-[11px] font-semibold flex items-center gap-0.5 ${
            positive ? "text-emerald-600" : "text-red-600"
          }`}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {positive ? "+" : ""}{delta}%
          </span>
        )}
      </div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
      <p className="text-lg font-bold text-slate-800">{value}</p>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-slate-800 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg">
      <div className="font-semibold">{label}</div>
      <div>{p.pedidos} pedido{p.pedidos > 1 ? "s" : ""}</div>
      <div className="text-orange-300">{formatBRL(p.vendido)}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDayShort(iso: string): string {
  // "2026-05-15" → "15/05"
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
