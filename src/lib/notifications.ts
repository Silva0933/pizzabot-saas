// Browser/PWA notifications — PRD 4.1
// Usa a Notification API nativa (não precisa de servidor push).
// Quando o painel está em foreground, o AudioAlert.ts cuida do som; aqui só notificamos visualmente quando blur/background.

export type NotifyOptions = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

let permissionRequested = false;
let storedPermission: NotificationPermission = "default";

/** Inicializa o estado de permissão. Idempotente. */
export function initNotifications(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  storedPermission = Notification.permission;
  return storedPermission;
}

/** Pede permissão ao usuário se ainda não foi pedida. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") {
    storedPermission = Notification.permission;
    return storedPermission;
  }
  if (permissionRequested) return storedPermission;
  permissionRequested = true;
  try {
    storedPermission = await Notification.requestPermission();
  } catch {
    storedPermission = "denied";
  }
  return storedPermission;
}

/** Mostra uma notificação se a permissão foi concedida e o painel não está em foco. */
export function notify({ title, body, tag, url }: NotifyOptions): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Só dispara se a página está em background/blur — em foreground o alerta sonoro + badge bastam
  const isHidden = document.hidden || !document.hasFocus();
  if (!isHidden) return;

  try {
    // Prefer SW notification when available (permite clicar na notification → focar tab)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, {
          body,
          icon: "/icon-192.svg",
          badge: "/icon-192.svg",
          tag: tag || "pizzabot-order",
          data: { url: url || "/" },
          vibrate: [200, 100, 200],
          requireInteraction: false
        } as any);
      }).catch(() => {
        // Fallback to direct Notification
        new Notification(title, { body, icon: "/icon-192.svg", tag });
      });
      return;
    }
    new Notification(title, { body, icon: "/icon-192.svg", tag });
  } catch (err) {
    console.warn("notify() failed:", err);
  }
}
