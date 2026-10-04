"use client";

import { Alert, Button, toast } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FileIcon } from "@/Components/FileIcon";
import { PreviewModal } from "@/Components/Files/PreviewModal";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { EmptyView, LoadingRows } from "@/Components/StateViews";
import { CanPreview, type Entry, FormatBytes, FormatDate } from "@/lib/format";
import { ListOffline, type OfflineFile, OfflineSupported, RemoveOffline } from "@/lib/offline";
import { ClickableRow, ListPanel } from "@/Components/ListPanel";
import { t } from "@/lib/i18n";

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
    toast.success(t(`“${entry.name}” is no longer available offline`, `„${entry.name}“ už není dostupné offline`));
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
        description={
          entries.length
            ? `${t("Files saved in this browser", "Soubory uložené v tomhle prohlížeči")} · ${FormatBytes(total)}`
            : t("Files saved in this browser for when you're offline.", "Soubory uložené v tomhle prohlížeči pro chvíle bez připojení.")
        }
      />

      {!online && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("You're offline", "Jsi offline")}</Alert.Title>
            <Alert.Description>{t("Only the files saved below work. The rest of the cloud comes back when you're online.", "Fungují jen soubory uložené níž. Zbytek cloudu se vrátí, až bude připojení.")}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!supported ? (
        <EmptyView icon="cloud_off" title={t("Offline isn't available here", "Offline tady nejde")}>
          {t("Browsers only save files offline over HTTPS. Open the cloud through the address from", "Prohlížeč ukládá soubory offline jen přes HTTPS. Otevři cloud přes adresu z")} <code>tailscale serve</code> (https://…ts.net){" "}
          {t("and install it as an app.", "a nainstaluj ho jako aplikaci.")}
        </EmptyView>
      ) : !files ? (
        <LoadingRows count={3} />
      ) : !entries.length ? (
        <EmptyView icon="offline_pin" title={t("Nothing saved", "Nic uloženého")}>
          {t("Right-click a file and choose", "V souborech klikni pravým tlačítkem na soubor a vyber")} <b>{t("Make available offline", "Zpřístupnit offline")}</b>.
        </EmptyView>
      ) : (
        <ListPanel>
            {entries.map((entry) => (
              <li key={entry.key}>
                <ClickableRow onOpen={() => Open(entry)}>
                  <FileIcon name={entry.name} isDir={false} className="shrink-0 text-[26px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="text-xs text-muted">
                      {FormatBytes(entry.size)} · {t("saved", "uloženo")} {FormatDate(entry.savedAt)}
                    </p>
                  </div>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={`${t("Download", "Stáhnout")} ${entry.name}`} onPress={() => Download(entry)}>
                    <Icon name="download" className="text-[18px]" />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={t(`Remove ${entry.name} from offline`, `Odebrat ${entry.name} z offline`)} onPress={() => Remove(entry)} className="text-danger!">
                    <Icon name="delete" className="text-[18px]" />
                  </Button>
                </ClickableRow>
              </li>
            ))}
          </ListPanel>
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
