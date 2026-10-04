// Jazyk odpovědí: web posílá hlavičku `X-Lang: cs`, jinak angličtina.
// Drží se pro celý request (AsyncLocalStorage), takže T() funguje i hluboko ve Storage.
import { AsyncLocalStorage } from "node:async_hooks";

export type Lang = "en" | "cs";

export const LangStore = new AsyncLocalStorage<Lang>();

export const T = (en: string, cs: string) => (LangStore.getStore() === "cs" ? cs : en);

export const LangOf = (header: unknown): Lang => (header === "cs" ? "cs" : "en");
