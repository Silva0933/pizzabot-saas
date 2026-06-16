import { AlertCircle } from "lucide-react";
import type { UsoPizzaria } from "../../../lib/api";

/** Aviso de cota de atendimentos do plano (perto/atingido). */
export function QuotaBanner({ uso }: { uso: UsoPizzaria | null }) {
  if (!uso || uso.atendimentos_limite <= 0) return null;

  if (uso.limite_atingido) {
    return (
      <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2.5 rounded-xl text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Limite de atendimentos do plano atingido ({uso.atendimentos}/{uso.atendimentos_limite}).</p>
          <p className="text-rose-700 text-xs mt-0.5">
            Novos clientes não estão sendo atendidos automaticamente pela IA neste mês — conversas já em
            andamento continuam normalmente. Você pode assumir os novos em <strong>Conversas</strong>, ou
            fazer upgrade do plano para liberar mais atendimentos.
          </p>
        </div>
      </div>
    );
  }

  if (uso.proximo_do_limite) {
    return (
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 px-3.5 py-2.5 rounded-xl text-sm">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Você está chegando no limite do seu plano ({uso.atendimentos}/{uso.atendimentos_limite}).</p>
          <p className="text-amber-700 text-xs mt-0.5">
            Faltam {uso.atendimentos_restante} atendimentos neste mês. Ao atingir o limite, novos clientes
            deixam de ser atendidos automaticamente pela IA.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
