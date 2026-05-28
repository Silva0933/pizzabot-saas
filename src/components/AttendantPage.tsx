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
      <AgentTestPanel
        pizzariaId={pizzariaId}
        open={testOpen}
        onClose={() => setTestOpen(false)}
      />
    </>
  );
}
