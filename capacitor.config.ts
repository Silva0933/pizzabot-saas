import type { CapacitorConfig } from "@capacitor/cli";

/**
 * App Android do entregador (Fase 1).
 *
 * O APK abre o painel publicado (server.url): a interface atualiza a cada deploy
 * do painel, sem reinstalar o app. Só mudança nativa (plugin, permissão) pede um
 * APK novo — o CI (.github/workflows/android.yml) gera e publica no GitHub Releases.
 * Sem internet, cai na página local app-offline.html (copiada do public/ no build).
 */
const config: CapacitorConfig = {
  appId: "cc.eu.secretariaai.pizzabot.entregador",
  appName: "PizzaBot Entregador",
  webDir: "dist",
  server: {
    url: "https://pizzabot.secretariaai.eu.cc/entregador",
    androidScheme: "https",
    errorPath: "app-offline.html",
  },
  android: {
    backgroundColor: "#080b10",
  },
  plugins: {
    LocalNotifications: {
      iconColor: "#f97316",
    },
  },
};

export default config;
