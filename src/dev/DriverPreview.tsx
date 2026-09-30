/**
 * Prévia do app do entregador com dados de exemplo (só em `npm run dev`,
 * rota /preview-entregador). Serve para ver e ajustar a tela sem conta nem
 * backend: as chamadas do entregadorApi são trocadas por respostas fixas.
 * Não vai para o build de produção (main.tsx só carrega em import.meta.env.DEV).
 */
import { DriverApp } from "../components/driver/DriverApp";
import { BackendPedido, entregadorApi, UserMe } from "../lib/api";

const PID = "00000000-0000-0000-0000-000000000001";
const agora = Date.now();

function pedido(n: number, status: string, extra: Partial<BackendPedido> = {}): BackendPedido {
  return {
    id: `p${n}`, pizzaria_id: PID, cliente_id: `c${n}`, numero_pedido: n,
    itens: [{ nome: "Frango Catupiry (G)", quantidade: 1, preco_unit: 42 }, { nome: "Fanta 1L", quantidade: 1, preco_unit: 10 }],
    valor_total: 55, status, tipo: "delivery", endereco_entrega: "Rua Jerusalém, nº 3 - Vila Cascavel",
    endereco_lat: -2.5912, endereco_lon: -44.2224, forma_pagamento: "dinheiro", observacoes: null,
    payment_status: "pending", link_pagamento: null, bot_ativo: false, tem_codigo_entrega: status === "a_caminho",
    created_at: new Date(agora).toISOString(), updated_at: new Date(agora).toISOString(),
    cliente: { nome: "Ana Souza", telefone: "5598999990000" },
    ...extra,
  } as BackendPedido;
}

const cenario = new URLSearchParams(window.location.search).get("cenario") || "cheio";
const repasse = cenario !== "sem-repasse";

Object.assign(entregadorApi, {
  minhasEntregas: async () => cenario === "vazio" ? [] : [
    pedido(14, "a_caminho", { observacoes: "Levar troco para R$ 100" }),
    pedido(15, "pronto_entrega", { cliente: { nome: "Carlos Lima", telefone: "5598988887777" }, forma_pagamento: "pix", payment_status: "approved", valor_total: 72.9 }),
  ],
  disponiveis: async () => cenario === "vazio" ? [] : [pedido(16, "pronto_entrega", { cliente: { nome: "Paulo", telefone: "5598984734911" } })],
  resumo: async () => ({
    entregas_total: 128, entregas_hoje: 6, entregas_semana: 41, repasse_ativo: repasse,
    repasse_valor: repasse ? 7 : null, ganhos_hoje: repasse ? 42 : null, ganhos_semana: repasse ? 287 : null,
    ganhos_total: repasse ? 896 : null,
  }),
  historico: async () => ({
    repasse_ativo: repasse,
    entregas: [0, 1, 2, 26, 27, 50].map((h, i) => ({
      pedido_id: `h${i}`, numero_pedido: 10 - i, cliente: ["Ana", "Paulo", "Jailson", "Maria", "Bruno", "Lia"][i],
      endereco: "Rua Jerusalém, 5 - Vila Cascavel", entregue_em: new Date(agora - h * 3600_000).toISOString(),
      valor_total: 57, forma_pagamento: i % 2 ? "pix" : "dinheiro", repasse: repasse ? 7 : null,
    })),
  }),
  rota: async () => ({
    paradas: [
      { tipo: "coleta", nome: "Pizzaria Palazio", endereco: "Av. Lourenço Vieira da Silva", lat: -2.57, lon: -44.21, waze_url: "https://waze.com/ul" },
      { tipo: "entrega", pedido_id: "p14", numero_pedido: 14, cliente: "Ana Souza", endereco: "Rua Jerusalém, 3", lat: -2.59, lon: -44.22, distancia_km: 2.1, waze_url: "https://waze.com/ul" },
    ],
    distancia_km: 2.1, google_maps_url: "https://www.google.com/maps", sem_coordenada: 0, origem: "posicao_atual",
  }),
  setDisponibilidade: async (_: string, d: boolean) => ({ ok: true, disponivel: d }),
  localizacao: async () => ({ ok: true }),
  pegar: async () => pedido(16, "pronto_entrega"),
  updateStatus: async () => pedido(14, "entregue"),
});

const user = {
  id: "u1", email: "jose@exemplo.com", nome: "Jose",
  entregador: { id: "e1", pizzaria_id: PID, nome: "Jose", disponivel: cenario !== "offline" },
} as UserMe;

export default function DriverPreview() {
  return <DriverApp user={user} onLogout={() => {}} />;
}
