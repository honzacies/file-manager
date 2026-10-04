// Jazyk appky. Texty jsou přímo u místa použití: t("Files", "Soubory") — žádný slovník, který by se rozešel.
// Výchozí angličtina; volba se pamatuje v prohlížeči. Změna jazyka = znovu vykreslit celou appku (providers.tsx).
export type Lang = "en" | "cs";

const KEY = "cloud.lang";
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

export function LoadLang(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "cs" || stored === "en") lang = stored;
  } catch {}
  document.documentElement.lang = lang;
  return lang;
}

export function SaveLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  lang = next;
  document.documentElement.lang = next;
}
