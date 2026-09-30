/**
 * Recursos do celular para o app do entregador (Capacitor).
 *
 * O APK carrega o próprio painel (server.url no capacitor.config.ts), então este
 * código roda nos dois lugares: no app usa GPS em segundo plano, notificação do
 * Android e abre o Waze/Maps; no navegador cai no equivalente web (GPS só com a
 * página aberta, Notification API, nova aba).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

export const ehApp = () => Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// Localização do turno
// ---------------------------------------------------------------------------
/** Intervalo mínimo entre dois envios de posição ao servidor. */
const ENVIO_MIN_MS = 20_000;

export type Posicao = { lat: number; lon: number; precisao?: number };
export type Rastreamento = { parar: () => Promise<void> };

/**
 * Liga o GPS enquanto o entregador está online. No app, o Android mostra a
 * notificação fixa "Você está online" e a posição continua chegando com a tela
 * desligada; no navegador, só enquanto a página está aberta.
 */
export async function iniciarRastreamento(
  enviar: (p: Posicao) => void,
  onErro?: (msg: string) => void,
): Promise<Rastreamento> {
  let ultimoEnvio = 0;
  const receber = (p: Posicao) => {
    const agora = Date.now();
    if (agora - ultimoEnvio < ENVIO_MIN_MS) return;
    ultimoEnvio = agora;
    enviar(p);
  };

  if (ehApp()) {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "Você está online no PizzaBot",
        backgroundMessage: "Recebendo entregas e compartilhando sua localização com a pizzaria.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (loc, erro) => {
        if (erro) {
          if (erro.code === "NOT_AUTHORIZED") {
            onErro?.("O app está sem permissão de localização. Permita nas configurações para a pizzaria ver onde você está e a rota partir daí.");
          }
          return;
        }
        if (loc) receber({ lat: loc.latitude, lon: loc.longitude, precisao: loc.accuracy });
      },
    );
    return { parar: () => BackgroundGeolocation.removeWatcher({ id }) };
  }

  if (!("geolocation" in navigator)) return { parar: async () => {} };
  const watchId = navigator.geolocation.watchPosition(
    (pos) => receber({ lat: pos.coords.latitude, lon: pos.coords.longitude, precisao: pos.coords.accuracy }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 15_000 },
  );
  return { parar: async () => navigator.geolocation.clearWatch(watchId) };
}

export async function abrirConfiguracoesDoApp() {
  if (ehApp()) await BackgroundGeolocation.openSettings();
}

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------
let canalPronto = false;
let proximoId = 1;

export async function prepararNotificacoes(): Promise<boolean> {
  if (ehApp()) {
    const perm = await LocalNotifications.requestPermissions();
    if (!canalPronto) {
      await LocalNotifications.createChannel({
        id: "entregas",
        name: "Novas entregas",
        description: "Aviso de entrega atribuída ou disponível",
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(() => {});
      canalPronto = true;
    }
    return perm.display === "granted";
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  return Notification.permission === "granted";
}

export async function notificar(titulo: string, corpo: string) {
  if (ehApp()) {
    await LocalNotifications.schedule({
      notifications: [{ id: proximoId++, title: titulo, body: corpo, channelId: "entregas" }],
    }).catch(() => {});
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    new Notification(titulo, { body: corpo, tag: `entrega-${proximoId++}` });
  }
}

// ---------------------------------------------------------------------------
// Links externos (Waze, Google Maps, telefone, download da atualização)
// ---------------------------------------------------------------------------
export async function abrirExterno(url: string) {
  if (ehApp()) {
    try {
      await AppLauncher.openUrl({ url });
      return;
    } catch {
      /* cai no navegador */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// Atualização do APK (distribuído pelo GitHub Releases)
// ---------------------------------------------------------------------------
const REPO = "Silva0933/pizzabot-saas";
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/pizzabot-entregador.apk`;

/** Versão nova do APK publicada? Só no app. Compara "1.0.N" do app com a tag "entregador-v1.0.M". */
export async function versaoNovaDisponivel(): Promise<string | null> {
  if (!ehApp()) return null;
  try {
    const [info, resp] = await Promise.all([
      App.getInfo(),
      fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } }),
    ]);
    if (!resp.ok) return null;
    const tag = String((await resp.json()).tag_name || "").replace(/^entregador-v/, "");
    return compararVersao(tag, info.version) > 0 ? tag : null;
  } catch {
    return null;
  }
}

export function compararVersao(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
