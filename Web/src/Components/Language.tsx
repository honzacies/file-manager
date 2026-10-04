"use client";

import { I18nProvider, Label, ListBox, Select } from "@heroui/react";
import { createContext, Fragment, useCallback, useContext, useLayoutEffect, useState } from "react";
import { ApiFetch } from "@/lib/api";
import { ApplyLang, type Lang, ResolveLang, SaveDefault, SavePreference, t } from "@/lib/i18n";

// setPreference(null) = automaticky (prohlížeč, jinak výchozí od admina).
const LangContext = createContext<{ lang: Lang; setPreference: (value: Lang | null) => void }>({ lang: "en", setPreference: () => {} });
export const useLanguage = () => useContext(LangContext);

// Statický export se předrenderuje anglicky; jazyk se určí před prvním vykreslením v prohlížeči.
// `key` = při změně jazyka se celá appka vykreslí znovu (t() čte jazyk z modulu, ne z kontextu).
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");

  useLayoutEffect(() => {
    const resolved = ResolveLang();
    setLang(ApplyLang(resolved.lang));
    // Výchozí jazyk od admina se může změnit — obnovit ho na pozadí (rozhoduje jen, když prohlížeč neumí cs ani en).
    ApiFetch<{ defaultLang: Lang }>("/api/public/lang").then((result) => {
      if (!result.ok) return;
      SaveDefault(result.body.defaultLang);
      if (resolved.fromDefault) setLang(ApplyLang(ResolveLang().lang));
    });
  }, []);

  const setPreference = useCallback((value: Lang | null) => {
    SavePreference(value);
    setLang(ApplyLang(ResolveLang().lang));
  }, []);

  return (
    <LangContext.Provider value={{ lang, setPreference }}>
      <I18nProvider locale={lang === "cs" ? "cs-CZ" : "en-US"}>
        <Fragment key={lang}>{children}</Fragment>
      </I18nProvider>
    </LangContext.Provider>
  );
}

// Výběr jazyka v Účtu (s "Automaticky") a v nastavení serveru (výchozí jazyk). Názvy jazyků vždy v originále.
export function LanguageSelect({
  label,
  value,
  onChange,
  auto = false,
  isDisabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  auto?: boolean;
  isDisabled?: boolean;
}) {
  const options = [...(auto ? [["auto", t("Automatic", "Automaticky")]] : []), ["en", "English"], ["cs", "Čeština"]];
  return (
    <Select value={value} onChange={(key) => key !== null && onChange(String(key))} isDisabled={isDisabled} className="w-full sm:w-72">
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
