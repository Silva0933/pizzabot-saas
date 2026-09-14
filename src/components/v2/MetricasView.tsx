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
import {
  TrendingUp,
  TrendingDown,
  Loader2,
  AlertCircle,
  Trophy,
  Clock,
  Package,
  Inbox,
  BarChart2,
  DollarSign,
  Ban,
  History,
} from "lucide-react";
import { metricasApi, MetricasResponse } from "../../lib/api";
import { HistoricoPedidos } from "./MeuNegocioViewV2";

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
  const [area, setArea] = useState<"analise" | "historico">("analise");
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
    <div className="p-4 md:p-6 space-y-5 pb-24 md:pb-6 relative">
      {/* Linha 1: Apenas Subtabs */}
      <nav className="inline-flex gap-1 rounded-xl border border-[#1e293b] bg-[#111622] p-1" aria-label="Seções de análise">
        <button
          type="button"
          onClick={() => setArea("analise")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
            area === "analise" ? "bg-orange-500 text-white shadow-xs" : "text-slate-400 hover:text-white"
          }`}
        >
          Visão geral
        </button>
        <button
          type="button"
          onClick={() => setArea("historico")}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${
            area === "historico" ? "bg-orange-500 text-white shadow-xs" : "text-slate-400 hover:text-white"
          }`}
        >
          <History className="w-4 h-4" /> Histórico
        </button>
      </nav>

      {area === "analise" ? (
        <>
          {/* Overlay suave de carregamento ao trocar período */}
          {refreshing && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] z-10 flex items-start justify-center pt-20 rounded-xl">
              <div className="flex items-center gap-2 bg-[#111622] border border-[#1e293b] text-white rounded-full px-4 py-2 shadow-lg">
                <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                <span className="text-xs font-medium text-slate-300">Atualizando dados...</span>
              </div>
            </div>
          )}

          {/* Linha 2: Header à esquerda + Seletor de período à direita */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Análise do seu negócio</h2>
              <p className="text-xs text-slate-400 mt-1">
                Como você está indo nos últimos {days} dias.
              </p>
            </div>
            <div className="flex gap-1 bg-[#111622] border border-[#1e293b] rounded-xl p-1">
              {PERIODOS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setDays(p.value)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    days === p.value
                      ? "bg-[#24170f] text-[#f97316] border border-orange-500/30 shadow-xs"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aviso de período sem dados */}
          {resumo.pedidos === 0 && (
            <div className="bg-[#111622] border border-[#1e293b] rounded-2xl py-12 px-6 text-center shadow-sm">
              <Inbox className="w-9 h-9 mx-auto mb-2 text-slate-400 stroke-[1.5]" />
              <p className="text-sm font-bold text-white">Nenhum pedido nos últimos {days} dias</p>
              <p className="text-xs text-slate-400 mt-1">
                Os dados aparecerão conforme os pedidos forem realizados.
              </p>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              icon={<Package className="w-5 h-5" />}
              label="Pedidos"
              value={resumo.pedidos.toString()}
              delta={comparativo.pct_pedidos ?? -100}
              accent="orange"
            />
            <Kpi
              icon={<DollarSign className="w-5 h-5" />}
              label="Vendido"
              value={formatBRL(resumo.vendido)}
              delta={comparativo.pct_vendido ?? -100}
              accent="emerald"
            />
            <Kpi
              icon={<TrendingUp className="w-5 h-5" />}
              label="Ticket médio"
              value={formatBRL(resumo.ticket_medio)}
              accent="violet"
            />
            <Kpi
              icon={<Ban className="w-5 h-5" />}
              label="Cancelamento"
              value={`${resumo.taxa_cancelamento}%`}
              accent="slate"
            />
          </div>

          {/* Gráfico: vendas por dia */}
          <Card title="Vendas por dia" icon={<TrendingUp className="w-4 h-4 text-slate-400" />}>
            {serieFormat.length === 0 ? (
              <Empty icon={<BarChart2 className="w-7 h-7 text-slate-500 mb-2" />} msg="Sem pedidos no período." />
            ) : (
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={serieFormat} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="dia_label" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
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
        <Card title="Horários de pico" icon={<Clock className="w-4 h-4 text-slate-400" />}>
          {horarios_pico.length === 0 ? (
            <Empty icon={<Clock className="w-6 h-6" />} msg="Sem dados de horário." />
          ) : (
            <div className="h-56 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={horarios_pico.map((h) => ({ ...h, label: `${String(h.hora).padStart(2, "0")}h` }))}
                  margin={{ top: 5, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#1e293b" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#64748b" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
                  <RTooltip
                    formatter={(v: any) => [`${v} pedido${v > 1 ? "s" : ""}`, ""]}
                    cursor={{ fill: "#161f30" }}
                  />
                  <Bar dataKey="pedidos" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Top 5 produtos" icon={<Trophy className="w-4 h-4 text-orange-400" />}>
          {top_produtos.length === 0 ? (
            <Empty icon={<Trophy className="w-6 h-6" />} msg="Sem produtos vendidos." />
          ) : (
            <ul className="space-y-2">
              {top_produtos.map((p, idx) => (
                <li
                  key={p.nome}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-[#161f30] border border-[#1e293b]"
                >
                  <span className={`w-6 h-6 rounded-full text-xs font-black flex items-center justify-center ${
                    idx === 0 ? "bg-amber-500/20 text-amber-400" :
                    idx === 1 ? "bg-slate-700 text-slate-200" :
                    idx === 2 ? "bg-orange-500/20 text-orange-400" :
                    "bg-slate-800 text-slate-400"
                  }`}>{idx + 1}</span>
                  <span className="flex-1 text-sm font-semibold text-white truncate">{p.nome}</span>
                  <span className="text-xs font-bold text-slate-400">{p.qtd_vendida}x</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>) : (
      <HistoricoPedidos pizzariaId={pizzariaId} />
    )}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-[#111622] border border-[#1e293b] rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
        <span>{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ icon, msg }: { icon?: React.ReactNode; msg: string }) {
  return (
    <div className="text-center py-12 text-slate-500 flex flex-col items-center justify-center">
      {icon && <div className="mb-2 text-slate-500">{icon}</div>}
      <p className="text-xs text-slate-400 font-medium">{msg}</p>
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
    orange:  "bg-[#24170f] text-orange-400 border border-orange-500/20",
    emerald: "bg-emerald-950/40 text-emerald-400 border border-emerald-500/20",
    violet:  "bg-purple-950/40 text-purple-400 border border-purple-500/20",
    red:     "bg-rose-950/40 text-rose-400 border border-rose-500/20",
    slate:   "bg-slate-800/40 text-slate-400 border border-slate-700/40",
  }[accent];

  const showDelta = delta !== null && delta !== undefined;
  const positive = (delta ?? 0) >= 0;

  return (
    <div className="bg-[#111622] border border-[#1e293b] rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${styles}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
          <p className="text-xl font-black text-white leading-tight truncate mt-0.5">{value}</p>
        </div>
      </div>
      {showDelta && (
        <span className={`text-xs font-bold shrink-0 flex items-center gap-1 ${
          positive ? "text-emerald-400" : "text-rose-500"
        }`}>
          {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {positive ? "+" : ""}{delta}%
        </span>
      )}
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
