const CACHE_NAME = "campus-prints-shell-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icononly.png", "/pwa-192.png", "/pwa-512.png"];
const PDF_ASSETS = new Set(["/pdf.min.mjs", "/pdf.worker.min.mjs"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("campus-prints-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url ?? "/ccadmin", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const adminClient = clients.find((client) => new URL(client.url).pathname === "/ccadmin");
      if (adminClient) return adminClient.focus();
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);

  if (PDF_ASSETS.has(url.pathname)) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => (await caches.match(request)) ?? Response.error()),
    );
    return;
  }

  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, copy));
      }
      return response;
    }).catch(async () => {
      return (await caches.match(url.pathname)) ?? (await caches.match("/")) ?? Response.error();
    }),
  );
});