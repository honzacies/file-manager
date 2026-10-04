"use client";

import { I18nProvider, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { createContext, Fragment, useContext, useLayoutEffect, useState } from "react";
import { type Lang, LoadLang, SaveLang } from "@/lib/i18n";

const LangContext = createContext<{ lang: Lang; setLang: (next: Lang) => void }>({ lang: "en", setLang: () => {} });

// Statický export se předrenderuje anglicky; uložený jazyk se načte před prvním vykreslením v prohlížeči.
// `key` = při změně jazyka se celá appka vykreslí znovu (t() čte jazyk z modulu, ne z kontextu).
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setCurrent] = useState<Lang>("en");
  useLayoutEffect(() => setCurrent(LoadLang()), []);
  const setLang = (next: Lang) => {
    SaveLang(next);
    setCurrent(next);
  };
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <I18nProvider locale={lang === "cs" ? "cs-CZ" : "en-US"}>
        <Fragment key={lang}>{children}</Fragment>
      </I18nProvider>
    </LangContext.Provider>
  );
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = useContext(LangContext);
  return (
    <ToggleButtonGroup
      aria-label="Language / Jazyk"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[lang]}
      onSelectionChange={(keys) => setLang([...keys][0] as Lang)}
      size="sm"
      className={className}
    >
      <ToggleButton id="en" aria-label="English">
        EN
      </ToggleButton>
      <ToggleButton id="cs" aria-label="Čeština">
        CS
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
