/**
 * Cliente HTTP do novo backend Python (FastAPI).
 *
 * Substitui o uso direto do supabase-js para chamadas de negócio.
 * Continuamos compatíveis durante a transição — esse arquivo só é
 * usado pelos novos componentes (PersonalityBuilder etc).
 */

const API_BASE =
  (import.meta as any).env?.VITE_PIZZABOT_API_URL ||
  (typeof window !== "undefined" ? window.location.origin.replace(/:\d+$/, ":8000") : "");

const TOKEN_KEY = "pizzabot:access_token";
const REFRESH_KEY = "pizzabot:refresh_token";

// ============================================
// Auth helpers (token persistido em localStorage)
// ============================================
export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

export function setTokens(access: string, refresh: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ============================================
// HTTP core
// ============================================
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
  }
}

async function request<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new ApiError(res.status, body?.detail || res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.text() as any);
}

export const api = {
  get:  <T = any>(p: string)              => request<T>(p, { method: "GET" }),
  post: <T = any>(p: string, body?: any)  => request<T>(p, { method: "POST",  body: body ? JSON.stringify(body) : undefined }),
  put:  <T = any>(p: string, body?: any)  => request<T>(p, { method: "PUT",   body: body ? JSON.stringify(body) : undefined }),
  patch:<T = any>(p: string, body?: any)  => request<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete:<T = any>(p: string)             => request<T>(p, { method: "DELETE" }),
};

// ============================================
// Tipos compartilhados com o backend
// ============================================
export type EstiloAtendente = "casual" | "profissional" | "proximo";
export type NivelEmoji = "nenhum" | "pouco" | "moderado" | "muito";

export interface Personalidade {
  id?: string;
  pizzaria_id?: string;
  nome: string;
  estilo: EstiloAtendente;
  nivel_emoji: NivelEmoji;
  vocabulario_regional: string | null;
  diferenciais: string[];
  restricoes: string[];
  exemplos_conversa: Array<{ cliente: string; atendente: string }>;
  instrucoes_extras: string | null;
}

export const DEFAULT_PERSONALIDADE: Personalidade = {
  nome: "Camila",
  estilo: "casual",
  nivel_emoji: "moderado",
  vocabulario_regional: null,
  diferenciais: [],
  restricoes: [],
  exemplos_conversa: [],
  instrucoes_extras: null,
};

// ============================================
// Endpoints específicos
// ============================================
export const personalityApi = {
  get: (pizzariaId: string) =>
    api.get<Personalidade | null>(`/pizzarias/${pizzariaId}/agente/personalidade`),
  save: (pizzariaId: string, body: Personalidade) =>
    api.put<Personalidade>(`/pizzarias/${pizzariaId}/agente/personalidade`, body),
  preview: (pizzariaId: string, telefone = "5511900000000") =>
    api.get<{ prompt: string; tamanho_chars: number }>(
      `/pizzarias/${pizzariaId}/agente/prompt?telefone=${telefone}`,
    ),
  test: (pizzariaId: string, telefone: string, mensagem: string) =>
    api.post<{ texto: string | null; iteracoes: number; tool_calls: string[] }>(
      `/pizzarias/${pizzariaId}/agente/testar`,
      { telefone, mensagem },
    ),
};

// ============================================
// Métricas
// ============================================
export interface MetricasResponse {
  periodo_dias: number;
  desde: string;
  resumo: {
    pedidos: number;
    vendido: number;
    ticket_medio: number;
    cancelados: number;
    taxa_cancelamento: number;
  };
  comparativo: {
    pedidos_anterior: number;
    vendido_anterior: number;
    pct_pedidos: number | null;
    pct_vendido: number | null;
  };
  serie_diaria: Array<{ dia: string; pedidos: number; vendido: number }>;
  top_produtos: Array<{ nome: string; qtd_vendida: number }>;
  horarios_pico: Array<{ hora: number; pedidos: number }>;
}

export const metricasApi = {
  get: (pizzariaId: string, days = 30) =>
    api.get<MetricasResponse>(`/pizzarias/${pizzariaId}/metricas?days=${days}`),
};

export const authApi = {
  login: async (email: string, senha: string) => {
    const r = await api.post<{ access_token: string; refresh_token: string; user: any }>(
      "/auth/login",
      { email, senha },
    );
    setTokens(r.access_token, r.refresh_token);
    return r.user;
  },
  me: () => api.get<{ id: string; email: string; nome: string; is_platform_admin: boolean }>(`/auth/me`),
  logout: () => clearTokens(),
};
