"use client";

import { Spinner } from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { ApiFetch } from "@/lib/api";

export interface User {
  id: number;
  username: string;
  role: "admin" | "user";
}

const SessionContext = createContext<User | null>(null);

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
      if (result.ok) return setUser(result.body);
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
  return <SessionContext value={user}>{children}</SessionContext>;
}
