/**
 * Cálculo de funcionamento da pizzaria (aberto/fechado) no fuso horário do Brasil (America/Sao_Paulo).
 * Compatível com o backend em Python (business_hours.py).
 */

export const WEEKDAY_KEYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export interface DiaHorarioConfig {
  abre?: string;
  fecha?: string;
  fechado?: boolean;
}

/** Retorna um objeto Date com a hora atual no fuso de São Paulo / Brasília. */
export function getBrazilDate(): Date {
  try {
    const now = new Date();
    const spString = now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
    return new Date(spString);
  } catch {
    return new Date();
  }
}

function toMinutes(hhmm?: string | null): number | null {
  if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Retorna true se a loja está aberta no momento.
 * - Se overrideManual !== null e !== undefined, ele prevalece imediatamente (true = forçar aberto, false = forçar fechado).
 * - Se overrideManual === null ou undefined, calcula pela grade de horários configurada no fuso de SP.
 */
export function calcEstaAberto(
  horarios?: Record<string, any> | null,
  overrideManual?: boolean | null,
  nowDate?: Date
): boolean {
  if (overrideManual !== null && overrideManual !== undefined) {
    return Boolean(overrideManual);
  }
  if (!horarios || Object.keys(horarios).length === 0) {
    return true;
  }
  const now = nowDate || getBrazilDate();
  const dayKey = WEEKDAY_KEYS[now.getDay()];
  const cfg = horarios[dayKey];

  if (!cfg || typeof cfg !== "object") {
    return true;
  }
  if (cfg.fechado) {
    return false;
  }

  const abre = toMinutes(cfg.abre);
  const fecha = toMinutes(cfg.fecha);
  if (abre === null || fecha === null) {
    return true;
  }

  const agora = now.getHours() * 60 + now.getMinutes();
  if (fecha <= abre) {
    // Vira a meia-noite (ex: 18:00 às 02:00)
    return agora >= abre || agora < fecha;
  }
  return agora >= abre && agora < fecha;
}

/**
 * Retorna texto amigável do próximo horário de abertura (ex: "Abre hoje às 18:00" ou "Abre amanhã às 18:00").
 */
export function getTextoProximaAbertura(horarios?: Record<string, any> | null, nowDate?: Date): string | null {
  if (!horarios) return null;
  const now = nowDate || getBrazilDate();
  const hojeIdx = now.getDay();
  const agoraMinutos = now.getHours() * 60 + now.getMinutes();

  // Verifica hoje
  const hojeCfg = horarios[WEEKDAY_KEYS[hojeIdx]];
  if (hojeCfg && typeof hojeCfg === "object" && !hojeCfg.fechado && hojeCfg.abre) {
    const abreHoje = toMinutes(hojeCfg.abre);
    if (abreHoje !== null && agoraMinutos < abreHoje) {
      return `Abre hoje às ${hojeCfg.abre}`;
    }
  }

  // Procura nos próximos dias
  const diasLabel = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  for (let offset = 1; offset <= 7; offset++) {
    const idx = (hojeIdx + offset) % 7;
    const cfg = horarios[WEEKDAY_KEYS[idx]];
    if (cfg && typeof cfg === "object" && !cfg.fechado && cfg.abre) {
      if (offset === 1) return `Abre amanhã às ${cfg.abre}`;
      return `Abre ${diasLabel[idx]} às ${cfg.abre}`;
    }
  }
  return null;
}
