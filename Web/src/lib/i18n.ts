// Jazyk appky. Texty jsou přímo u místa použití: t("Files", "Soubory") — žádný slovník, který by se rozešel.
// Pořadí: volba uživatele v Účtu → jazyk prohlížeče (cs/en) → výchozí jazyk od admina → angličtina.
// Změna jazyka = znovu vykreslit celou appku (Components/Language.tsx).
export type Lang = "en" | "cs";

// Volba přihlášeného uživatele (kopie z API, ať je jazyk správně hned po načtení) a výchozí jazyk od admina.
const PREFERENCE_KEY = "cloud.lang";
const DEFAULT_KEY = "cloud.lang.default";
let lang: Lang = "en";

export const CurrentLang = () => lang;

export const t = (en: string, cs: string) => (lang === "cs" ? cs : en);

// Tvar slova podle počtu: Plural(n, ["file", "files"], ["soubor", "soubory", "souborů"])
export function Plural(n: number, en: [string, string], cs: [string, string, string]) {
  if (lang === "cs") return cs[n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2];
  return en[n === 1 ? 0 : 1];
}

// Formát čísel a dat. Angličtina bere zvyklosti prohlížeče (datum den/měsíc v Evropě, měsíc/den v USA).
export const Locale = () => (lang === "cs" ? "cs-CZ" : undefined);

const AsLang = (value: unknown): Lang | null => (value === "cs" || value === "en" ? value : null);

function Read(key: string) {
  try {
    return AsLang(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function Write(key: string, value: Lang | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

// První jazyk z nastavení prohlížeče, který appka umí ("cs-CZ" → cs). Němec s angličtinou v seznamu dostane angličtinu.
export function BrowserLang(): Lang | null {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const found = AsLang(tag.slice(0, 2).toLowerCase());
    if (found) return found;
  }
  return null;
}

export const SavePreference = (value: Lang | null) => Write(PREFERENCE_KEY, value);
export const SaveDefault = (value: Lang) => Write(DEFAULT_KEY, value);

// Jazyk, který se má teď použít, a jestli rozhodl až výchozí jazyk od admina.
export function ResolveLang(): { lang: Lang; fromDefault: boolean } {
  const chosen = Read(PREFERENCE_KEY) ?? BrowserLang();
  return chosen ? { lang: chosen, fromDefault: false } : { lang: Read(DEFAULT_KEY) ?? "en", fromDefault: true };
}

export function ApplyLang(next: Lang) {
  lang = next;
  document.documentElement.lang = next;
  return next;
}
