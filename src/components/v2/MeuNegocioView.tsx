/**
 * "Meu Negócio" — guarda-chuva de todas as configurações.
 *
 * Tabs:
 *  - Atendente (PersonalityBuilder + AgentTestPanel — Fase 4)
 *  - Configurações gerais (reusa SettingsView atual — dados, horários, pagamentos, equipe)
 *
 * Princípio: o dono não precisa entender que existem "subsistemas" diferentes.
 * Tudo o que define o negócio dele fica num lugar só.
 */
import React, { useState } from "react";
import { Bot, Settings as SettingsIcon, Sparkles, TrendingUp } from "lucide-react";
import { AttendantPage } from "../AttendantPage";
import { SettingsView } from "../SettingsView";
import { MetricasView } from "./MetricasView";
import type { Operator, Pizzeria } from "../../types";

export type NegocioTab = "atendente" | "geral" | "analise";

export interface MeuNegocioViewProps {
  pizzeria: Pizzeria;
  operators: Operator[];
  onUpdatePizzeria: (fields: Partial<Pizzeria>) => void;
  onInviteOperator: (email: string, role: Operator["role"]) => void;
  onDeleteOperator: (id: string) => void;
  onOpenTestAgent?: () => void;
  initialTab?: NegocioTab;
}

export function MeuNegocioView({
  pizzeria,
  operators,
  onUpdatePizzeria,
  onInviteOperator,
  onDeleteOperator,
  onOpenTestAgent,
  initialTab = "atendente",
}: MeuNegocioViewProps) {
  const [tab, setTab] = useState<NegocioTab>(initialTab);

  return (
    <div className="pb-24 md:pb-6">
      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 sticky top-[57px] z-10">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          <TabButton
            active={tab === "atendente"}
            onClick={() => setTab("atendente")}
            icon={<Bot className="w-4 h-4" />}
            label="Atendente"
            badge={<Sparkles className="w-3 h-3 text-orange-500" />}
          />
          <TabButton
            active={tab === "analise"}
            onClick={() => setTab("analise")}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Análise"
          />
          <TabButton
            active={tab === "geral"}
            onClick={() => setTab("geral")}
            icon={<SettingsIcon className="w-4 h-4" />}
            label="Geral"
          />
        </div>
      </div>

      {/* Conteúdo */}
      {tab === "atendente" && <AttendantPage pizzariaId={pizzeria.id} />}

      {tab === "analise" && <MetricasView pizzariaId={pizzeria.id} />}

      {tab === "geral" && (
        <SettingsView
          pizzeria={pizzeria}
          operators={operators}
          onUpdatePizzeria={onUpdatePizzeria}
          onInviteOperator={onInviteOperator}
          onDeleteOperator={onDeleteOperator}
          onOpenTestAgent={onOpenTestAgent}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-orange-500 text-orange-700"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {label}
      {badge}
    </button>
  );
}
