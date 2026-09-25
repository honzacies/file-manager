"use client";

import { Spinner } from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { ApiFetch } from "@/lib/api";
import { ClearOffline } from "@/lib/offline";
import type { Person } from "./UserAvatar";

export interface User extends Person {
  role: "admin" | "user";
}

const SessionContext = createContext<User | null>(null);
// Po změně jména/avataru se přihlášený uživatel aktualizuje bez reloadu.
const SetUserContext = createContext<(user: User) => void>(() => {});
export const useSetUser = () => use(SetUserContext);

// Poslední přihlášený uživatel — bez připojení se appka otevře v offline režimu místo přesměrování na login.
const USER_KEY = "cloud.user";

export function ForgetUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {}
}

// Přihlášený uživatel. Mimo SessionGate se nepoužívá, takže je vždy definovaný.
export function useUser() {
  return use(SessionContext) as User;
}

// Web je statický export — přihlášení ověřuje API. Tohle jen přesměruje na login;
// skutečnou ochranu dělá server u každého requestu.
export function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    ApiFetch<User>("/api/auth/me").then((result) => {
      if (result.ok) {
        try {
          // Jiný účet než minule (session vypršela bez odhlášení) → cizí offline soubory pryč.
          const previous = JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as User | null;
          if (previous && previous.id !== result.body.id) ClearOffline();
          localStorage.setItem(USER_KEY, JSON.stringify(result.body));
        } catch {}
        return setUser(result.body);
      }
      // status 0 = server nedostupný (offline), ne odhlášení
      if (result.status === 0) {
        try {
          const cached = localStorage.getItem(USER_KEY);
          if (cached) return setUser(JSON.parse(cached));
        } catch {}
      }
      router.replace(`/login/?from=${encodeURIComponent(pathname + window.location.search)}`);
    });
    // Jen jednou po načtení, ne při každé navigaci.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  return (
    <SessionContext value={user}>
      <SetUserContext value={setUser}>{children}</SetUserContext>
    </SessionContext>
  );
}
