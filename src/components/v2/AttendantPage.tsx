/**
 * Página completa do atendente: builder de personalidade + teste integrado.
 *
 * Esta é a tela que vai entrar no menu "Meu Negócio → Atendente" na Fase 5.
 * Por enquanto pode ser montada em qualquer lugar:
 *
 *   <AttendantPage pizzariaId={pizzeria.id} />
 */
import React, { useState } from "react";
import { PersonalityBuilder } from "./PersonalityBuilder";
import { AgentTestPanel } from "./AgentTestPanel";
import { BaseConhecimento } from "./ChamadosInternos";

export interface AttendantPageProps {
  pizzariaId: string;
}

export function AttendantPage({ pizzariaId }: AttendantPageProps) {
  const [testOpen, setTestOpen] = useState(false);

  return (
    <>
      <PersonalityBuilder
        pizzariaId={pizzariaId}
        onOpenTest={() => setTestOpen(true)}
      />
      <div className="mx-auto max-w-7xl px-4 pb-8 md:px-6">
        <BaseConhecimento pizzariaId={pizzariaId} />
      </div>
      <AgentTestPanel
        pizzariaId={pizzariaId}
        open={testOpen}
        onClose={() => setTestOpen(false)}
      />
    </>
  );
}
