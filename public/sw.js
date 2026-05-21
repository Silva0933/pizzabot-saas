// PizzaBot Service Worker
// PRD seção 4 / NFR — PWA installable + push notifications

const CACHE_VERSION = "pizzabot-v1";
const SHELL_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg"
];

// Install — pre-cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => null)
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for API/Supabase, cache-first for assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase / Evolution / n8n API calls — they must hit network
  if (
    url.hostname.includes("supabase") ||
    url.hostname.includes("evolution") ||
    url.hostname.includes("n8n") ||
    url.hostname.includes("api.")
  ) {
    return;
  }

  // For navigations, try network first then fall back to cached shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/"))
    );
    return;
  }

  // Static assets — cache first, fall back to network and cache
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp.ok && (event.request.url.endsWith(".svg") || event.request.url.endsWith(".css") || event.request.url.endsWith(".js"))) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone)).catch(() => null);
        }
        return resp;
      }).catch(() => cached || Response.error());
    })
  );
});

// Push notification handler (from push server) — fallback only; we mostly use Notification API direct
self.addEventListener("push", (event) => {
  let data = { title: "PizzaBot", body: "Nova notificação", url: "/" };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      vibrate: [200, 100, 200],
      tag: data.tag || "pizzabot-order",
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target).catch(() => null);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
