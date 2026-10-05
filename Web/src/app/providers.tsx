"use client";

import { Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { LanguageProvider } from "@/Components/Language";
import { PlayerProvider } from "@/Components/Player";

export function Providers({ children }: { children: React.ReactNode }) {
  // PWA + offline. Jen v produkci (v devu by cache mátla HMR) a jen na HTTPS — jinde register() selže.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // iPhone (Safari) ignoruje user-scalable=no → přiblížení štípnutím zastavit tady: gesture* jsou události jen Safari,
  // dvouprstý touchmove pokryje zbytek. Posouvání jedním prstem zůstává.
  useEffect(() => {
    const Stop = (event: Event) => event.preventDefault();
    const StopPinch = (event: TouchEvent) => event.touches.length > 1 && event.preventDefault();
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(name, Stop, { passive: false });
    document.addEventListener("touchmove", StopPinch, { passive: false });
    return () => {
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) document.removeEventListener(name, Stop);
      document.removeEventListener("touchmove", StopPinch);
    };
  }, []);

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <LanguageProvider>
        <Toast.Provider placement="bottom" />
        <PlayerProvider>{children}</PlayerProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
