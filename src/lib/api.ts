/**
 * Cliente HTTP do backend Python (FastAPI).
 *
 * Substitui completamente o supabase-js no fluxo do painel.
 *
 * Padrão: backend usa snake_case, frontend convive com camelCase no UI.
 * Algumas funções transformam (toCamel/toSnake) para compatibilidade com
 * tipos antigos em types.ts; outras passam objetos crus do backend.
 */

const API_BASE =
  (import.meta as any).env?.VITE_PIZZABOT_API_URL ||
  (typeof window !== "undefined" ? window.location.origin.replace(/:\d+$/, ":8000") : "");

const TOKEN_KEY = "pizzabot:access_token";
const REFRESH_KEY = "pizzabot:refresh_token";

// ============================================
// Auth tokens (localStorage)
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
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    if (res.status === 401 && !path.includes("/auth/login")) {
      clearTokens();
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new ApiError(res.status, body?.detail || res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.text() as any);
}

export const api = {
  get:    <T = any>(p: string)              => request<T>(p, { method: "GET" }),
  post:   <T = any>(p: string, body?: any)  => request<T>(p, { method: "POST",  body: body ? JSON.stringify(body) : undefined }),
  put:    <T = any>(p: string, body?: any)  => request<T>(p, { method: "PUT",   body: body ? JSON.stringify(body) : undefined }),
  patch:  <T = any>(p: string, body?: any)  => request<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(p: string)              => request<T>(p, { method: "DELETE" }),
};

// ============================================
// Auth
// ============================================
export interface UserMe {
  id: string;
  email: string;
  nome: string;
  is_platform_admin: boolean;
  /** Presente quando a conta é de um entregador (define a shell do entregador). */
  entregador?: { id: string; pizzaria_id: string; nome: string; disponivel: boolean } | null;
}

export interface BackendEntregador {
  id: string;
  nome: string;
  email: string;
  telefone?: string | null;
  disponivel: boolean;
  ativo: boolean;
  created_at: string;
}

export const authApi = {
  login: async (email: string, senha: string) => {
    const r = await api.post<{ access_token: string; refresh_token: string; user: UserMe }>(
      "/auth/login",
      { email, senha },
    );
    setTokens(r.access_token, r.refresh_token);
    return r.user;
  },
  me: () => api.get<UserMe>(`/auth/me`),
  signup: async (body: { nome_pizzaria: string; nome?: string; email: string; senha: string }) => {
    const r = await api.post<{ access_token: string; refresh_token: string; user: UserMe }>(
      "/auth/signup", body
    );
    setTokens(r.access_token, r.refresh_token);
    return r.user;
  },
  logout: () => clearTokens(),
};

// ============================================
// Tipos do backend (raw snake_case)
// ============================================
export interface BackendPizzaria {
  id: string;
  nome: string;
  slug?: string | null;
  instancia: string | null;
  whatsapp_estado?: string | null; // 'open' | 'connecting' | 'close'
  plano: string;
  bot_ativo_global: boolean;
  endereco: string | null;
  endereco_maps_url?: string | null;
  telefone_admin: string | null;
  telefone_contato?: string | null;
  logo_url: string | null;
  horario_funcionamento: Record<string, any> | null;
  formas_pagamento_aceitas?: string[] | null;
  mensagens_status: Record<string, string> | null;
  nomes_colunas: Record<string, string> | null;
  gateway_pagamento: string;
  asaas_api_key: string | null;
  mp_access_token: string | null;
  modo_pagamento_online?: string | null;
  pix_manual_copia_cola?: string | null;
  pix_manual_titular?: string | null;
  tempo_entrega_min?: number | null;
  tempo_entrega_max?: number | null;
  tempo_retirada_min?: number | null;
  tempo_retirada_max?: number | null;
  taxa_entrega_info?: string | null;
  taxa_entrega_fixa?: number | null;
  taxas_bairro?: Array<{ bairro: string; taxa: number }> | null;
  adicionais?: Array<{ nome: string; preco: number; tipo?: string }> | null;
  suspensa?: boolean;
  suspensa_motivo?: string | null;
  plano_vence_em?: string | null;
  trial_fim?: string | null;
  pipeline_fsm?: boolean;
  created_at?: string | null;
}

export interface BackendProduto {
  id: string;
  pizzaria_id: string;
  categoria: string | null;
  nome: string;
  descricao: string | null;
  preco: number;
  disponivel: boolean;
  imagem_url: string | null;
  ordem: number;
  tamanhos?: Array<{ tamanho: string; preco: number }> | null;
  aliases?: string[];
  tags?: string[];
  opcoes?: Record<string, unknown>;
  regras?: Record<string, unknown>;
}

export interface BackendPedido {
  id: string;
  pizzaria_id: string;
  cliente_id: string;
  numero_pedido: number | null;
  itens: Array<{ nome: string; quantidade: number; preco_unit?: number; observacao?: string }>;
  valor_total: number;
  status: string;
  tipo: string;
  endereco_entrega: string | null;
  forma_pagamento: string | null;
  observacoes: string | null;
  payment_status: string;
  link_pagamento: string | null;
  bot_ativo: boolean;
  nps_nota?: number | null;
  nps_comentario?: string | null;
  entregador_id?: string | null;
  atribuido_em?: string | null;
  entregador?: { id: string; nome: string } | null;
  created_at: string;
  updated_at: string;
  cliente?: {
    nome: string | null;
    telefone: string;
  } | null;
}

export interface BackendConversa {
  id: string;
  pizzaria_id: string;
  cliente_telefone: string;
  cliente_nome: string | null;
  last_message: string | null;
  last_timestamp: string;
  bot_ativo: boolean;
  status: string;
  unread_count: number;
}

export interface BackendMensagem {
  id: string;
  conversa_id: string;
  origem: "cliente" | "bot" | "humano" | "sistema";
  tipo: "texto" | "audio" | "imagem" | "figurinha" | "localizacao";
  conteudo: string;
  metadata: Record<string, any>;
  created_at: string;
}

// ============================================
// Pizzarias
// ============================================
export const pizzariasApi = {
  list: () => api.get<BackendPizzaria[]>("/pizzarias"),
  get: (id: string) => api.get<BackendPizzaria>(`/pizzarias/${id}`),
  uso: (id: string) => api.get<UsoPizzaria>(`/pizzarias/${id}/uso`),
  assinatura: (id: string) => api.get<AssinaturaInfo>(`/pizzarias/${id}/assinatura`),
  contratarAssinatura: (id: string, body: { plano: string; cobranca_email: string; cobranca_cpf_cnpj: string }) =>
    api.post<{ ok: boolean; subscription_id?: string; primeira_fatura?: FaturaInfo | null }>(`/pizzarias/${id}/assinatura`, body),
  faturaPix: (id: string, faturaId: string) =>
    api.get<PixCheckout>(`/pizzarias/${id}/assinatura/fatura/${faturaId}/pix`),
  create: (body: {
    nome: string; instancia?: string; telefone_admin?: string; endereco?: string;
    owner_email?: string; owner_senha?: string; owner_nome?: string;
  }) => api.post<BackendPizzaria>("/pizzarias", body),
  update: (id: string, patch: Partial<BackendPizzaria>) =>
    api.patch<BackendPizzaria>(`/pizzarias/${id}`, patch),
  delete: (id: string) => api.delete(`/pizzarias/${id}`),

  // WhatsApp / Evolution
  whatsappConectar: (id: string, instancia?: string) =>
    api.post<WhatsAppConnect>(`/pizzarias/${id}/whatsapp/conectar`, { instancia }),
  whatsappStatus: (id: string) =>
    api.get<WhatsAppStatus>(`/pizzarias/${id}/whatsapp/status`),
  whatsappQrcode: (id: string) =>
    api.get<WhatsAppConnect>(`/pizzarias/${id}/whatsapp/qrcode`),
};

export interface WhatsAppQr {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
}
export interface WhatsAppConnect {
  instancia: string;
  qrcode: WhatsAppQr | null;
  state: string;
  conectado: boolean;
  webhook_url?: string;
}
export interface WhatsAppStatus {
  instancia: string | null;
  state: string;
  conectado: boolean;
}

// ============================================
// Cardápio
// ============================================
export const cardapioApi = {
  list: (pizzariaId: string) => api.get<BackendProduto[]>(`/pizzarias/${pizzariaId}/cardapio`),
  create: (pizzariaId: string, body: Omit<BackendProduto, "id" | "pizzaria_id">) =>
    api.post<BackendProduto>(`/pizzarias/${pizzariaId}/cardapio`, body),
  update: (pizzariaId: string, produtoId: string, body: Omit<BackendProduto, "id" | "pizzaria_id">) =>
    api.patch<BackendProduto>(`/pizzarias/${pizzariaId}/cardapio/${produtoId}`, body),
  delete: (pizzariaId: string, produtoId: string) =>
    api.delete(`/pizzarias/${pizzariaId}/cardapio/${produtoId}`),
  reindex: (pizzariaId: string) =>
    api.post<{ ok: boolean; produtos: number }>(`/pizzarias/${pizzariaId}/cardapio/reindex`),

  // Arquivo do cardápio (PDF/imagem)
  arquivoInfo: (pizzariaId: string) =>
    api.get<CardapioArquivoInfo>(`/pizzarias/${pizzariaId}/cardapio/arquivo/info`),
  arquivoUrl: (pizzariaId: string) => `${API_BASE}/pizzarias/${pizzariaId}/cardapio/arquivo`,
  removerArquivo: (pizzariaId: string) =>
    api.delete(`/pizzarias/${pizzariaId}/cardapio/arquivo`),
  uploadArquivo: async (pizzariaId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/pizzarias/${pizzariaId}/cardapio/arquivo`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      let b: any = null;
      try { b = await res.json(); } catch { /* ignore */ }
      throw new ApiError(res.status, b?.detail || res.statusText, b);
    }
    return res.json() as Promise<{ ok: boolean; filename: string; content_type: string; tamanho: number; url: string }>;
  },

  // Importação de cardápio com IA
  importarExtrair: async (pizzariaId: string, opts: { file?: File; texto?: string }) => {
    const fd = new FormData();
    if (opts.file) fd.append("file", opts.file);
    if (opts.texto) fd.append("texto", opts.texto);
    const token = getToken();
    const res = await fetch(`${API_BASE}/pizzarias/${pizzariaId}/cardapio/importar/extrair`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      let b: any = null; try { b = await res.json(); } catch { /* */ }
      throw new ApiError(res.status, b?.detail || res.statusText, b);
    }
    return res.json() as Promise<{ produtos: ProdutoImport[]; total: number }>;
  },
  importarConfirmar: (pizzariaId: string, produtos: ProdutoImport[]) =>
    api.post<{ ok: boolean; criados: number }>(`/pizzarias/${pizzariaId}/cardapio/importar/confirmar`, { produtos }),
};

export interface ProdutoImport {
  nome: string;
  categoria?: string;
  descricao?: string;
  preco: number;
  tamanhos?: Array<{ tamanho: string; preco: number }> | null;
}

export interface CardapioArquivoInfo {
  existe: boolean;
  filename?: string;
  content_type?: string;
  tamanho?: number;
  atualizado_em?: string | null;
  url?: string;
}

// ============================================
// Pedidos
// ============================================
export const pedidosApi = {
  /** opts.hoje=true → só pedidos de hoje; limit alto p/ histórico. */
  list: (pizzariaId: string, opts?: { status?: string; hoje?: boolean; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.hoje) qs.set("hoje", "true");
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const q = qs.toString();
    return api.get<BackendPedido[]>(`/pizzarias/${pizzariaId}/pedidos${q ? `?${q}` : ""}`);
  },
  get: (pizzariaId: string, pedidoId: string) =>
    api.get<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}`),
  updateStatus: (pizzariaId: string, pedidoId: string, status: string, motivo?: string) =>
    api.patch<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}/status`, { status, motivo }),
  apagarTodos: (pizzariaId: string) =>
    request<{ ok: boolean; pedidos_deletados: number }>(
      `/pizzarias/${pizzariaId}/pedidos/todos`,
      { method: "DELETE", headers: { "X-Confirm-Delete": "true" } as any },
    ),
  remover: (pizzariaId: string, pedidoId: string) =>
    api.delete<{ ok: boolean }>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}`),
  confirmarPagamento: (pizzariaId: string, pedidoId: string) =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}/pagamento/confirmar`),
  rejeitarPagamento: (pizzariaId: string, pedidoId: string) =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}/pagamento/rejeitar`),
  atribuir: (pizzariaId: string, pedidoId: string, entregadorId: string) =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}/atribuir`, { entregador_id: entregadorId }),
  desatribuir: (pizzariaId: string, pedidoId: string) =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/pedidos/${pedidoId}/desatribuir`),
};

// ============================================
// Entregadores — gestão pelo dono
// ============================================
export interface EntregadoresResp {
  entregadores: BackendEntregador[];
  permitir_autoatribuicao: boolean;
}

export const entregadoresApi = {
  list: (pizzariaId: string) =>
    api.get<EntregadoresResp>(`/pizzarias/${pizzariaId}/entregadores`),
  create: (pizzariaId: string, body: { nome: string; email: string; senha: string; telefone?: string }) =>
    api.post<BackendEntregador>(`/pizzarias/${pizzariaId}/entregadores`, body),
  update: (pizzariaId: string, entregadorId: string, body: { nome?: string; telefone?: string; ativo?: boolean; nova_senha?: string }) =>
    api.patch<BackendEntregador>(`/pizzarias/${pizzariaId}/entregadores/${entregadorId}`, body),
  remove: (pizzariaId: string, entregadorId: string) =>
    api.delete<{ ok: boolean }>(`/pizzarias/${pizzariaId}/entregadores/${entregadorId}`),
  setConfig: (pizzariaId: string, permitirAutoatribuicao: boolean) =>
    api.put<EntregadoresResp>(`/pizzarias/${pizzariaId}/entregadores/config`, { permitir_autoatribuicao: permitirAutoatribuicao }),
};

// ============================================
// Entregador — visão do próprio entregador
// ============================================
export const entregadorApi = {
  minhasEntregas: (pizzariaId: string) =>
    api.get<BackendPedido[]>(`/pizzarias/${pizzariaId}/entregador/minhas-entregas`),
  disponiveis: (pizzariaId: string) =>
    api.get<BackendPedido[]>(`/pizzarias/${pizzariaId}/entregador/disponiveis`),
  pegar: (pizzariaId: string, pedidoId: string) =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/entregador/pedidos/${pedidoId}/pegar`),
  updateStatus: (pizzariaId: string, pedidoId: string, status: "a_caminho" | "entregue") =>
    api.post<BackendPedido>(`/pizzarias/${pizzariaId}/entregador/pedidos/${pedidoId}/status`, { status }),
  setDisponibilidade: (pizzariaId: string, disponivel: boolean) =>
    api.patch<{ ok: boolean; disponivel: boolean }>(`/pizzarias/${pizzariaId}/entregador/disponibilidade`, { disponivel }),
};

// ============================================
// Conversas + mensagens
// ============================================
export const conversasApi = {
  list: (pizzariaId: string) => api.get<BackendConversa[]>(`/pizzarias/${pizzariaId}/conversas`),
  mensagens: (pizzariaId: string, conversaId: string) =>
    api.get<BackendMensagem[]>(`/pizzarias/${pizzariaId}/conversas/${conversaId}/mensagens`),
  enviar: (pizzariaId: string, conversaId: string, conteudo: string) =>
    api.post(`/pizzarias/${pizzariaId}/conversas/${conversaId}/enviar`, { conteudo }),
  toggleBot: (pizzariaId: string, conversaId: string, botAtivo: boolean) =>
    api.patch(`/pizzarias/${pizzariaId}/conversas/${conversaId}/bot`, { bot_ativo: botAtivo }),
  marcarLida: (pizzariaId: string, conversaId: string) =>
    api.post(`/pizzarias/${pizzariaId}/conversas/${conversaId}/lida`),
  limparTodas: (pizzariaId: string) =>
    request<{ ok: boolean; conversas_deletadas: number }>(
      `/pizzarias/${pizzariaId}/conversas/todas`,
      { method: "DELETE", headers: { "X-Confirm-Delete": "true" } as any },
    ),
};

// ============================================
// Personalidade do atendente (Fase 4)
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

// ============================================
// Admin da plataforma (visão agregada — platform admin)
// ============================================
export interface PlanLimites {
  produtos: number;
  conversas_mes: number;
  mensagens_ia_mes: number;
  equipe: number;
}
export interface PlanCatalogo {
  id: string;
  nome: string;
  preco_mensal: number;
  ordem: number;
  limites: PlanLimites;
}
export interface Assinatura {
  id: string;
  nome: string;
  plano: string;
  plano_nome: string;
  preco_mensal: number;
  ativa: boolean;
  instancia_conectada: boolean;
  created_at: string | null;
  uso: { produtos: number; conversas: number };
  limites: PlanLimites;
}
export interface AdminOverview {
  periodo_dias: number;
  desde: string;
  resumo: {
    total_pizzarias: number;
    pizzarias_ativas: number;
    pizzarias_inativas: number;
    pizzarias_novas: number;
    mrr: number;
    arr: number;
    ticket_medio_plano: number;
  };
  planos: Array<{ plano: string; nome: string; preco: number; qtd: number; subtotal: number }>;
  catalogo: PlanCatalogo[];
  assinaturas: Assinatura[];
  serie_novas: Array<{ dia: string; qtd: number }>;
}

export interface LLMConfig {
  provider: string;
  model: string;
  providers: Record<string, { nome: string; modelos: string[] }>;
  keys_mascaradas: Record<string, string>;
  keys_configuradas: Record<string, boolean>;
  modelos_plano?: Record<string, string>;
  planos?: string[];
  transcription_model?: string;
  fallback_provider?: string;
  fallback_model?: string;
  nlu_model?: string;
}

export interface AssinaturaItem {
  pizzaria_id: string;
  nome: string;
  plano: string;
  plano_nome: string;
  preco_mensal: number;
  ativado_em: string | null;
  vence_em: string | null;
  dias_restantes: number | null;
  alerta: "sem_plano" | "em_dia" | "vence_amanha" | "vencida";
  suspensa: boolean;
  ia_mensagens: number;   // atendimentos do mês (cota do plano)
  ia_limite: number;      // cota de atendimentos do plano
  ia_rodadas?: number;    // rodadas de IA (referência)
  ia_tokens: number;
  ia_custo?: number;
  custo_por_atendimento?: number | null; // custo médio de IA por atendimento (R$)
  margem?: number | null;                // preço do plano − custo de IA do mês (R$)
}
export interface AssinaturasResp {
  assinaturas: AssinaturaItem[];
  alertas: { vence_amanha: number; vencida: number; suspensas: number; limite_ia: number };
  ciclo_dias: number;
  custo?: {
    tokens_total: number;
    custo_total_estimado: number;
    receita_total: number;
    margem_estimada: number;
    preco_por_1m_tokens: number;
  };
}
export interface FaturaInfo {
  id: string;
  valor: number;
  status: "pendente" | "paga" | "vencida" | "cancelada" | string;
  vencimento: string | null;
  pago_em: string | null;
  link_pagamento: string | null;
  created_at: string | null;
}

export interface PixCheckout {
  ok: boolean;
  qr_base64?: string;       // PNG base64 (sem o prefixo data:)
  copia_cola?: string;      // código Pix copia-e-cola
  expira_em?: string | null;
  valor?: number;
  link_pagamento?: string | null; // fallback boleto/cartão (página Asaas)
}

export interface PlanoCatalogo {
  id: string;
  nome: string;
  preco_mensal: number;
  ordem: number;
  limites: { produtos: number; conversas_mes: number; equipe: number; [k: string]: number };
}

export interface AssinaturaInfo {
  plano: string;
  plano_info: PlanoCatalogo;
  status: "trial" | "em_dia" | "vence_breve" | "vencida" | "suspensa" | "sem_assinatura" | string;
  vence_em: string | null;
  trial_fim: string | null;
  suspensa_motivo: string | null;
  carencia_dias: number;
  tem_assinatura: boolean;
  cobranca_email: string | null;
  cobranca_cpf_cnpj: string | null;
  billing_disponivel: boolean;
  fatura_aberta: FaturaInfo | null;       // pagar AGORA (vencida/vencendo)
  proxima_cobranca?: FaturaInfo | null;   // próxima cobrança futura (plano já ativo)
  faturas: FaturaInfo[];
  planos: PlanoCatalogo[];
}

export interface UsoPizzaria {
  plano: string;
  atendimentos: number;            // conversas distintas atendidas pela IA no mês
  atendimentos_limite: number;     // cota do plano
  atendimentos_restante: number;
  ia_mensagens: number;            // rodadas de IA (referência)
  ia_tokens: number;
  percentual: number;
  limite_atingido: boolean;
  proximo_do_limite: boolean;
}

export interface AlertaItem {
  id: string;
  pizzaria_id: string | null;
  pizzaria_nome: string | null;
  tipo: "preco_suspeito" | "falha_envio" | "falha_ia" | "falha_pagamento" | string;
  nivel: "info" | "warning" | "error" | string;
  detalhe: string | null;
  resolvido: boolean;
  created_at: string | null;
}
export interface AlertasResp { alertas: AlertaItem[]; abertos: number; }

export const adminApi = {
  overview: (days = 30) => api.get<AdminOverview>(`/admin/overview?days=${days}`),
  alertas: (apenasAbertos = true) => api.get<AlertasResp>(`/admin/alertas?apenas_abertos=${apenasAbertos}`),
  resolverAlerta: (id: string) => api.patch<{ ok: boolean }>(`/admin/alertas/${id}/resolver`, {}),
  alterarPlano: (pizzariaId: string, plano: string) =>
    api.patch<{ ok: boolean; plano: string; vence_em?: string | null }>(`/admin/pizzarias/${pizzariaId}/plano`, { plano }),
  assinaturas: () => api.get<AssinaturasResp>(`/admin/assinaturas`),
  renovar: (pizzariaId: string) =>
    api.patch<{ ok: boolean; vence_em: string | null }>(`/admin/pizzarias/${pizzariaId}/renovar`, {}),
  suspender: (pizzariaId: string, suspensa: boolean, motivo?: string) =>
    api.patch<{ ok: boolean; suspensa: boolean }>(`/admin/pizzarias/${pizzariaId}/suspensao`, { suspensa, motivo }),
  togglePipeline: (pizzariaId: string, fsm: boolean) =>
    api.patch<{ ok: boolean; pipeline_fsm: boolean }>(`/admin/pizzarias/${pizzariaId}/pipeline`, { fsm }),
  llm: () => api.get<LLMConfig>(`/admin/llm`),
  salvarLlm: (body: { provider: string; model: string; keys: Record<string, string>; modelos_plano?: Record<string, string>; transcription_model?: string; fallback_provider?: string; fallback_model?: string; nlu_model?: string }) =>
    api.put<{ ok: boolean }>(`/admin/llm`, body),
  testarLlm: () =>
    api.post<{ ok: boolean; provider: string; model: string; resposta?: string; erro?: string }>(`/admin/llm/test`, {}),
  llmUsage: (days = 30) => api.get<LLMUsage>(`/admin/llm/usage?days=${days}`),
  zerarLlmUsage: () => api.delete(`/admin/llm/usage`),
  faturas: (limit = 50) =>
    api.get<{ faturas: AdminFaturaItem[]; recebido_mes: number; pendentes: number; vencidas: number }>(`/admin/faturas?limit=${limit}`),
};

export interface AdminFaturaItem {
  id: string;
  pizzaria_id: string;
  pizzaria_nome: string;
  valor: number;
  status: string;
  vencimento: string | null;
  pago_em: string | null;
  link_pagamento: string | null;
  created_at: string | null;
}

export interface LLMUsage {
  periodo_dias: number;
  total: { prompt: number; completion: number; total: number; calls: number };
  por_pizzaria: Array<{ pizzaria_id: string | null; nome: string; tokens: number; calls: number }>;
  por_dia: Array<{ dia: string; tokens: number }>;
}

// ============================================
// WebSocket — live updates do painel
// ============================================
export interface WsEvent {
  tipo:
    | "mensagem.nova"
    | "conversa.atualizada"
    | "pedido.novo"
    | "pedido.atualizado"
    | "bot.toggled"
    | "bot.digitando"
    | "atendimento.humano"
    | "conversas.limpas"
    | "pedidos.limpos"
    | "whatsapp.status"
    | "system.hello";
  pizzaria_id: string;
  payload: Record<string, any>;
}

/**
 * Conecta ao WebSocket com reconexão automática (backoff exponencial).
 * Heartbeat a cada 30s para manter conexão viva.
 */
export function connectWebSocket(
  pizzariaId: string,
  onEvent: (e: WsEvent) => void,
  onStatusChange?: (connected: boolean) => void,
): WebSocket {
  const base = API_BASE.replace(/^https/, "wss").replace(/^http/, "ws");
  const token = getToken();
  const url = `${base}/ws/${pizzariaId}?token=${token ?? ""}`;

  let ws: WebSocket;
  let retryCount = 0;
  const maxRetries = 10;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let intentionalClose = false;

  function connect(): WebSocket {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.info("WS conectado");
      retryCount = 0;
      onStatusChange?.(true);
      // Heartbeat a cada 30s
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 30_000);
    };

    ws.onmessage = (msg) => {
      try {
        const data: WsEvent = JSON.parse(msg.data);
        onEvent(data);
      } catch {
        // pong ou payload inválido
      }
    };

    ws.onerror = () => {
      console.warn("WS erro");
    };

    ws.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      onStatusChange?.(false);
      if (!intentionalClose && retryCount < maxRetries) {
        const delay = Math.min(1000 * 2 ** retryCount, 30_000);
        retryCount++;
        console.info(`WS reconectando em ${delay}ms (tentativa ${retryCount})`);
        setTimeout(() => connect(), delay);
      }
    };

    return ws;
  }

  ws = connect();

  // Sobrescreve close para marcar como intencional
  const originalClose = ws.close.bind(ws);
  ws.close = (...args: any[]) => {
    intentionalClose = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    originalClose(...args);
  };

  return ws;
}

// ============================================
// Adapters: backend snake_case → types antigos camelCase
// (Usado por views v2 que ainda esperam Pizzeria/Product/etc.)
// ============================================
import type { Pizzeria, Product, Order, Conversation, ProductGroup, OrderStatus } from "../types";

export function backendToPizzeria(b: BackendPizzaria): Pizzeria {
  return {
    id: b.id,
    name: b.nome,
    address: b.endereco ?? undefined,
    logoUrl: b.logo_url ?? undefined,
    instance: b.instancia ?? "",
    phoneAdmin: b.telefone_admin ?? "",
    plan: (b.plano as Pizzeria["plan"]) ?? "basico",
    botActiveGlobal: b.bot_ativo_global,
    promptPersonalized: "",
    asaasApiKey: b.asaas_api_key ?? "",
    mpAccessToken: b.mp_access_token ?? "",
    gatewayPayment: (b.gateway_pagamento as Pizzeria["gatewayPayment"]) ?? "nenhum",
    hoursOfOperation: b.horario_funcionamento ?? {},
    messageDelivered: (b.mensagens_status as any)?.entregue ?? "",
    statusMessages: b.mensagens_status ?? {},
    columnNames: b.nomes_colunas ?? {},
  };
}

export function backendToProduct(b: BackendProduto): Product {
  return {
    id: b.id,
    pizzeriaId: b.pizzaria_id,
    category: (b.categoria as ProductGroup) ?? "outro",
    name: b.nome,
    description: b.descricao ?? "",
    price: Number(b.preco),
    available: b.disponivel,
    imageUrl: b.imagem_url ?? "",
    order: b.ordem,
    tamanhos: b.tamanhos ?? null,
  };
}

export function backendToOrder(b: BackendPedido): Order {
  return {
    id: b.id,
    pizzeriaId: b.pizzaria_id,
    customerId: b.cliente_id,
    customerName: b.cliente?.nome || b.cliente?.telefone || "Cliente Novo",
    customerPhone: b.cliente?.telefone || "",
    orderNumber: b.numero_pedido ?? 0,
    items: (b.itens || []).map((it) => ({
      name: it.nome,
      qty: it.quantidade,
      priceUnit: it.preco_unit ?? 0,
      observation: it.observacao,
    })),
    totalValue: Number(b.valor_total),
    status: b.status as OrderStatus,
    deliveryType: (b.tipo as Order["deliveryType"]) ?? "delivery",
    deliveryAddress: b.endereco_entrega ?? "",
    paymentMethod: (b.forma_pagamento as Order["paymentMethod"]) ?? "pix",
    paymentStatus: (b.payment_status as Order["paymentStatus"]) ?? "pending",
    paymentLink: b.link_pagamento ?? undefined,
    notes: b.observacoes ?? undefined,
    botActive: b.bot_ativo,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

export function backendToConversation(b: BackendConversa): Conversation & { unreadCount: number } {
  return {
    id: b.id,
    pizzeriaId: b.pizzaria_id,
    customerName: b.cliente_nome ?? b.cliente_telefone,
    customerPhone: b.cliente_telefone,
    lastMessage: b.last_message ?? "",
    lastTimestamp: b.last_timestamp,
    botActive: b.bot_ativo,
    status: b.bot_ativo ? "Bot ativo" : "Humano necessário",
    messages: [],
    unreadCount: b.unread_count,
  } as Conversation & { unreadCount: number };
}

// ============================================
// Cardápio Digital Público (sem autenticação)
// ============================================
export interface MenuPizzaria {
  nome: string;
  slug: string | null;
  logo_url: string | null;
  endereco: string | null;
  telefone_contato: string | null;
  instagram: string | null;
  horario_funcionamento: Record<string, any>;
  formas_pagamento_aceitas: string[];
  taxa_entrega_info: string | null;
  taxa_entrega_fixa: number | null;
  taxas_bairro: Array<{ bairro: string; taxa: number }>;
  adicionais: Array<{ nome: string; preco: number; tipo?: string }>;
  tempo_entrega_min: number | null;
  tempo_entrega_max: number | null;
  tempo_retirada_min: number | null;
  tempo_retirada_max: number | null;
  aberto: boolean;
}

export interface MenuProduto {
  id: string;
  categoria: string | null;
  nome: string;
  descricao: string | null;
  preco: number;
  imagem_url: string | null;
  ordem: number;
  tamanhos?: Array<{ tamanho: string; preco: number }> | null;
  opcoes?: Record<string, unknown>;
  regras?: Record<string, unknown>;
}

export interface MenuResponse {
  pizzaria: MenuPizzaria;
  produtos: MenuProduto[];
}

export interface PedidoDigitalPayload {
  nome_cliente: string;
  telefone: string;
  tipo: 'delivery' | 'retirada';
  endereco_rua?: string;
  endereco_numero?: string;
  endereco_bairro?: string;
  endereco_referencia?: string;
  forma_pagamento: string;
  observacoes?: string;
  itens: Array<{
    nome: string;
    quantidade: number;
    tamanho?: string;
    preco_unit: number;
    observacao?: string;
    adicionais?: string[];
  }>;
  website?: string; // honeypot
}

export interface PedidoDigitalResponse {
  ok: boolean;
  numero_pedido: number;
  valor_total: number;
  taxa_entrega: number;
  tempo_estimado: string;
}

/**
 * API pública do cardápio digital (sem autenticação).
 * Não usa Bearer token — é consumida pelo link público da pizzaria.
 */
export const menuApi = {
  getBySlug: async (slug: string): Promise<MenuResponse> => {
    const res = await fetch(`${API_BASE}/menu/${slug}`, { method: 'GET' });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ApiError(res.status, b?.detail || 'Cardápio não encontrado', b);
    }
    return res.json();
  },
  submitOrder: async (slug: string, data: PedidoDigitalPayload): Promise<PedidoDigitalResponse> => {
    const res = await fetch(`${API_BASE}/menu/${slug}/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ApiError(res.status, b?.detail || 'Erro ao enviar pedido', b);
    }
    return res.json();
  },
};
