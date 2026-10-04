// Pořadí jazyků: volba uživatele → prohlížeč (cs/en) → výchozí od admina. `node src/lib/i18n.check.ts`
import assert from "node:assert/strict";

const store = new Map<string, string>();
const languages = { list: ["de-DE", "de"] };
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  document: { documentElement: { lang: "" } },
});
Object.defineProperty(globalThis, "navigator", { value: { get languages() { return languages.list; }, language: "de" } });
const { ResolveLang, SaveDefault, SavePreference } = await import("./i18n.ts");

assert.deepEqual(ResolveLang(), { lang: "en", fromDefault: true }, "bez ničeho angličtina");
SaveDefault("cs");
assert.deepEqual(ResolveLang(), { lang: "cs", fromDefault: true }, "němčina v prohlížeči → výchozí od admina");
languages.list = ["de-DE", "en-US", "cs"];
assert.equal(ResolveLang().lang, "en", "první podporovaný jazyk prohlížeče vyhrává nad výchozím");
languages.list = ["cs-CZ", "en"];
assert.equal(ResolveLang().lang, "cs");
SavePreference("en");
assert.equal(ResolveLang().lang, "en", "volba uživatele vyhrává nad prohlížečem");
SavePreference(null);
assert.equal(ResolveLang().lang, "cs", "Automaticky = zase podle prohlížeče");
console.log("\x1b[32m✓\x1b[0m pořadí jazyků: uživatel → prohlížeč → výchozí od admina");
