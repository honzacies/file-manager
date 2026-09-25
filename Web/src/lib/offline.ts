// Soubory "Zpřístupnit offline" leží v Cache Storage prohlížeče. Service worker (public/sw.js)
// je odtud vrátí, když server není dostupný. Stejný název cache a stejný klíč jako v sw.js!
export const OFFLINE_CACHE = "cloud-offline-v1";

export interface OfflineFile {
  key: string;
  name: string;
  size: number;
  savedAt: number;
}

// Cache API a service worker fungují jen na HTTPS (nebo localhost), ne na http://192.168.x.x.
export function OfflineSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "caches" in window && "serviceWorker" in navigator;
}

// "/api/files/download?path=a.jpg&inline=true" -> "/api/files/download?path=a.jpg"
// (náhled i stažení mají jeden záznam, parametry seřazené)
export function OfflineKey(url: string) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.delete("inline");
  parsed.searchParams.delete("thumb");
  parsed.searchParams.sort();
  return `${parsed.pathname}?${parsed.searchParams}`;
}

export async function SaveOffline(url: string, name: string) {
  const inline = new URL(url, window.location.origin);
  inline.searchParams.set("inline", "true");
  const response = await fetch(inline);
  if (!response.ok) throw new Error("Soubor se nepodařilo stáhnout.");
  const blob = await response.blob();
  const headers = new Headers({
    "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
    "Content-Length": String(blob.size),
    // metadata pro stránku Offline (hlavičky musí být ASCII)
    "X-Cloud-Name": encodeURIComponent(name),
    "X-Cloud-Saved": String(Date.now()),
  });
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(OfflineKey(url), new Response(blob, { headers }));
}

export async function RemoveOffline(key: string) {
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.delete(key);
}

export async function ListOffline(): Promise<OfflineFile[]> {
  if (!OfflineSupported()) return [];
  const cache = await caches.open(OFFLINE_CACHE);
  const requests = await cache.keys();
  const files = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      const url = new URL(request.url);
      return {
        key: url.pathname + url.search,
        name: decodeURIComponent(response?.headers.get("X-Cloud-Name") ?? "soubor"),
        size: Number(response?.headers.get("Content-Length") ?? 0),
        savedAt: Number(response?.headers.get("X-Cloud-Saved") ?? 0),
      };
    }),
  );
  return files.sort((a, b) => b.savedAt - a.savedAt);
}

// Při odhlášení: soubory nemají zůstat v prohlížeči pro dalšího, kdo zasedne k počítači.
export async function ClearOffline() {
  if ("caches" in window) await caches.delete(OFFLINE_CACHE);
}
