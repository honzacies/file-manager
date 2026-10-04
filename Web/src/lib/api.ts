import { CurrentLang, t } from "./i18n";

// Klientské volání API. Nikdy nehází: výpadek spojení vrátí { ok: false, status: 0 }.
export async function ApiFetch<T = any>(
  url: string,
  method = "GET",
  payload?: unknown,
): Promise<{ ok: true; status: number; body: T } | { ok: false; status: number; body: { error?: string } | null }> {
  try {
    const response = await fetch(url, {
      method,
      // X-Lang = jazyk chybových hlášek z API
      headers: { "X-Lang": CurrentLang(), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    return response.ok ? { ok: true, status: response.status, body } : { ok: false, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export function ErrorText(result: { status: number; body: { error?: string } | null }) {
  if (result.status === 0) return t("The server isn't responding. Check your connection.", "Server neodpovídá. Zkontroluj připojení.");
  return result.body?.error ?? t("Something went wrong.", "Něco se pokazilo.");
}

export function Query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== false && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// XHR kvůli průběhu nahrávání — fetch upload progress neumí.
export function UploadFile(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {}
      resolve(xhr.status < 300 ? { ok: true } : { ok: false, error: error ?? t("Upload failed.", "Nahrání se nepovedlo.") });
    };
    xhr.onerror = () => resolve({ ok: false, error: t("The connection to the server was lost.", "Spojení se serverem se přerušilo.") });
    xhr.onabort = () => resolve({ ok: false, error: t("Cancelled.", "Zrušeno.") });
    signal.addEventListener("abort", () => xhr.abort());
    xhr.open("POST", url);
    xhr.setRequestHeader("X-Lang", CurrentLang());
    xhr.send(form);
  });
}
