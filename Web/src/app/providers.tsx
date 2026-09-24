"use client";

import { I18nProvider, Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <I18nProvider locale="cs-CZ">
        <Toast.Provider placement="bottom" />
        {children}
      </I18nProvider>
    </ThemeProvider>
  );
}
