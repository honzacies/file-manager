// Service worker: appka jde otevřít bez připojení a soubory "Zpřístupnit offline" se berou z cache.
// Názvy cache a klíč souborů musí sedět se src/lib/offline.ts.
const SHELL_CACHE = "cloud-shell-v1";
const OFFLINE_CACHE = "cloud-offline-v1";

self.addEventListener("install", (event) => {
  // Aspoň hlavní stránky, zbytek (JS, CSS) se doplní při prvním použití.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/files/", "/offline/", "/login/"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("cloud-shell-") && name !== SHELL_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// "/api/files/download?path=a&inline=true" -> "/api/files/download?path=a" (jako OfflineKey)
function OfflineKey(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("inline");
  parsed.searchParams.delete("thumb");
  parsed.searchParams.sort();
  return `${parsed.pathname}?${parsed.searchParams}`;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Soubory: vždy nejdřív server (čerstvá verze, Range pro video), cache jen když server není dostupný.
  if (url.pathname === "/api/files/download") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.open(OFFLINE_CACHE).then((cache) => cache.match(OfflineKey(request.url)));
        return cached ?? new Response("Offline", { status: 503 });
      }),
    );
    return;
  }

  // Ostatní API nikdy z cache — data musí být aktuální.
  if (url.pathname.startsWith("/api/")) return;

  // Statické soubory Next.js mají v názvu hash → klidně napořád z cache.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Stránky: síť, při výpadku poslední uložená verze (bez query — /files/?path=x je stejná stránka).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(url.pathname)) ?? (await caches.match("/offline/")) ?? Response.error()),
    );
  }
});
