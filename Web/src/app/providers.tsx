"use client";

import { Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { LanguageProvider } from "@/Components/Language";

export function Providers({ children }: { children: React.ReactNode }) {
  // PWA + offline. Jen v produkci (v devu by cache mátla HMR) a jen na HTTPS — jinde register() selže.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <LanguageProvider>
        <Toast.Provider placement="bottom" />
        {children}
      </LanguageProvider>
    </ThemeProvider>
  );
}
