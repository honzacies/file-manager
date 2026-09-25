"use client";

import { toast } from "@heroui/react";
import { createContext, type ReactNode, use, useCallback, useEffect, useState } from "react";
import { ListOffline, OfflineKey, OfflineSupported, RemoveOffline, SaveOffline } from "@/lib/offline";

interface OfflineState {
  keys: Set<string>;
  IsOffline: (url: string) => boolean;
  Toggle: (url: string, name: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineState>({ keys: new Set(), IsOffline: () => false, Toggle: async () => {} });
export const useOffline = () => use(OfflineContext);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Set<string>>(new Set());

  const Refresh = useCallback(() => ListOffline().then((files) => setKeys(new Set(files.map((file) => file.key)))), []);
  useEffect(() => {
    Refresh();
  }, [Refresh]);

  const IsOffline = useCallback((url: string) => typeof window !== "undefined" && keys.has(OfflineKey(url)), [keys]);

  const Toggle = useCallback(
    async (url: string, name: string) => {
      if (!OfflineSupported()) {
        toast.warning("Offline funguje jen přes HTTPS, třeba přes adresu z tailscale serve.");
        return;
      }
      if (keys.has(OfflineKey(url))) {
        await RemoveOffline(OfflineKey(url));
        toast.success(`„${name}“ už není dostupné offline`);
      } else {
        const id = toast.info(`Ukládám „${name}“ pro offline…`);
        try {
          await SaveOffline(url, name);
          toast.success(`„${name}“ je dostupné offline`);
        } catch {
          toast.danger(`„${name}“ se nepodařilo uložit.`);
        } finally {
          toast.close(id);
        }
      }
      await Refresh();
    },
    [keys, Refresh],
  );

  return <OfflineContext value={{ keys, IsOffline, Toggle }}>{children}</OfflineContext>;
}
