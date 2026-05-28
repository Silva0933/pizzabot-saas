import { existsSync, readFileSync } from "node:fs";

const envPath = ".env";

const required = [
  { key: "VITE_SUPABASE_URL", type: "url", label: "Supabase URL" },
  { key: "VITE_SUPABASE_ANON_KEY", type: "secret", label: "Supabase public key" },
  { key: "VITE_N8N_SECRETARIA_WEBHOOK_URL", type: "url", label: "Webhook secretaria" },
  { key: "VITE_N8N_STATUS_WEBHOOK_URL", type: "url", label: "Webhook status pedido" },
  { key: "VITE_N8N_PAYMENT_WEBHOOK_URL", type: "url", label: "Webhook pagamento" },
  { key: "VITE_N8N_RAG_WEBHOOK_URL", type: "url", label: "Webhook historico cliente" },
  { key: "VITE_N8N_THANKS_WEBHOOK_URL", type: "url", label: "Webhook agradecimento" },
  { key: "VITE_EVOLUTION_API_URL", type: "url", label: "Evolution API URL" },
  { key: "VITE_EVOLUTION_API_KEY", type: "secret", label: "Evolution API key" }
];

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function isUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

if (!existsSync(envPath)) {
  console.error("MVP check failed: arquivo .env nao encontrado.");
  process.exit(1);
}

const env = parseEnv(readFileSync(envPath, "utf8"));
let failed = false;

console.log("PizzaBot MVP check\n");

for (const item of required) {
  const value = env[item.key];
  const present = Boolean(value);
  const valid = present && (item.type === "url" ? isUrl(value) : value.length >= 8);
  const status = valid ? "OK " : "ERR";
  console.log(`${status} ${item.label} (${item.key})`);
  if (!valid) failed = true;
}

console.log("\nChecklist manual antes do primeiro cliente:");
console.log("- Criar pizzaria pelo admin SaaS.");
console.log("- Entrar com o email do dono e abrir Configuracao Rapida.");
console.log("- Conectar WhatsApp pelo QR Code.");
console.log("- Cadastrar pelo menos 3 produtos reais.");
console.log("- Configurar Asaas ou Mercado Pago com chave da pizzaria.");
console.log("- Fazer pedido teste e confirmar link de pagamento.");
console.log("- Confirmar que Central Chat e Kanban atualizam.");

if (failed) {
  console.error("\nResultado: ambiente incompleto para MVP operacional.");
  process.exit(1);
}

console.log("\nResultado: ambiente minimo configurado para teste operacional.");
