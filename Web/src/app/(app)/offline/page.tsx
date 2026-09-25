"use client";

import { Alert, Button, toast } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FileIcon } from "@/Components/FileIcon";
import { PreviewModal } from "@/Components/Files/PreviewModal";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { EmptyView, LoadingRows } from "@/Components/StateViews";
import { CanPreview, type Entry, FormatBytes, FormatDate } from "@/lib/format";
import { ListOffline, type OfflineFile, OfflineSupported, RemoveOffline } from "@/lib/offline";

// navigator.onLine jako React stav (bez setState v efektu)
function useOnline() {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

type OfflineEntry = Entry & { key: string; savedAt: number };

export default function OfflinePage() {
  const online = useOnline();
  const [files, setFiles] = useState<OfflineFile[] | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  // Na serveru (statický export) se neví → true, v prohlížeči skutečná hodnota bez hydratační chyby.
  const supported = useSyncExternalStore(
    () => () => {},
    () => OfflineSupported(),
    () => true,
  );

  const Load = useCallback(() => {
    ListOffline().then(setFiles);
  }, []);
  useEffect(Load, [Load]);

  const entries: OfflineEntry[] = useMemo(
    () => (files ?? []).map((file) => ({ name: file.name, isDir: false, size: file.size, modified: file.savedAt, key: file.key, savedAt: file.savedAt })),
    [files],
  );
  const previewable = useMemo(() => entries.filter((entry) => CanPreview(entry)), [entries]);

  async function Remove(entry: OfflineEntry) {
    await RemoveOffline(entry.key);
    toast.success(`„${entry.name}“ už není dostupné offline`);
    Load();
  }

  function Open(entry: OfflineEntry) {
    const index = previewable.indexOf(entry);
    if (index >= 0) setPreview(index);
    else Download(entry);
  }

  function Download(entry: OfflineEntry) {
    const link = document.createElement("a");
    link.href = entry.key;
    link.download = entry.name;
    link.click();
  }

  const total = entries.reduce((sum, entry) => sum + entry.size, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Offline"
        description={entries.length ? `Soubory uložené v tomhle prohlížeči · ${FormatBytes(total)}` : "Soubory uložené v tomhle prohlížeči pro chvíle bez připojení."}
      />

      {!online && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Jsi offline</Alert.Title>
            <Alert.Description>Fungují jen soubory uložené níž. Zbytek cloudu se vrátí, až bude připojení.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!supported ? (
        <EmptyView icon="cloud_off" title="Offline tady nejde">
          Prohlížeč ukládá soubory offline jen přes HTTPS. Otevři cloud přes adresu z <code>tailscale serve</code> (https://…ts.net) a nainstaluj ho jako
          aplikaci.
        </EmptyView>
      ) : !files ? (
        <LoadingRows count={3} />
      ) : !entries.length ? (
        <EmptyView icon="offline_pin" title="Nic uloženého">
          V souborech klikni pravým tlačítkem na soubor a vyber <b>Zpřístupnit offline</b>.
        </EmptyView>
      ) : (
        <Panel className="p-2!">
          <ul className="flex flex-col divide-y divide-separator">
            {entries.map((entry) => (
              <li key={entry.key}>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: klávesnice jde přes tlačítka vpravo */}
                <div
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-default/60"
                  onClick={(event) => !(event.target as HTMLElement).closest("button") && Open(entry)}
                >
                  <FileIcon name={entry.name} isDir={false} className="shrink-0 text-[26px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="text-xs text-muted">
                      {FormatBytes(entry.size)} · uloženo {FormatDate(entry.savedAt)}
                    </p>
                  </div>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={`Stáhnout ${entry.name}`} onPress={() => Download(entry)}>
                    <Icon name="download" className="text-[18px]" />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={`Odebrat ${entry.name} z offline`} onPress={() => Remove(entry)} className="text-danger!">
                    <Icon name="delete" className="text-[18px]" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <PreviewModal
        entries={previewable}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        // inline kvůli PDF/textu; service worker ho při hledání v cache ignoruje
        urlFor={(entry) => `${(entry as OfflineEntry).key}&inline=true`}
      />
    </div>
  );
}
