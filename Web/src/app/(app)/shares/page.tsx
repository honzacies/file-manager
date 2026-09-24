"use client";

import { Button, Chip, toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/Components/ConfirmDialog";
import { FileIcon } from "@/Components/FileIcon";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { EmptyView, ErrorView, LoadingRows } from "@/Components/StateViews";
import { ApiFetch, ErrorText } from "@/lib/api";
import { CopyText, ShareUrl } from "@/lib/clipboard";
import { FormatDate } from "@/lib/format";

interface Share {
  token: string;
  name: string;
  path: string;
  isDir: boolean;
  expiresAt: number | null;
  createdAt: number;
}

export default function SharesPage() {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<Share | null>(null);
  const [pending, setPending] = useState(false);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<Share[]>("/api/shares").then((result) => (result.ok ? setShares(result.body) : setError(ErrorText(result))));
  }, []);
  useEffect(Load, [Load]);

  async function Copy(share: Share) {
    if (await CopyText(ShareUrl(share.token))) toast.success("Odkaz zkopírován");
    else toast.danger("Kopírování se nepovedlo.");
  }

  async function Revoke() {
    if (!revoke) return;
    setPending(true);
    const result = await ApiFetch(`/api/shares/${revoke.token}`, "DELETE");
    setPending(false);
    setRevoke(null);
    if (result.ok) toast.success("Odkaz zrušen");
    else toast.danger(ErrorText(result));
    Load();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sdílené odkazy" description="Odkazy, přes které si kdokoliv stáhne tvoje soubory bez přihlášení." />

      {error ? (
        <ErrorView message={error} onRetry={Load} />
      ) : !shares ? (
        <LoadingRows />
      ) : shares.length === 0 ? (
        <EmptyView icon="link" title="Zatím nic nesdílíš">
          V souborech klikni pravým tlačítkem na soubor nebo složku a vyber <b>Sdílet odkazem</b>.
        </EmptyView>
      ) : (
        <Panel className="p-2!">
          <ul className="flex flex-col divide-y divide-separator">
            {shares.map((share) => {
              const expired = share.expiresAt !== null && share.expiresAt < Date.now();
              return (
                <li key={share.token} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                  <FileIcon name={share.name} isDir={share.isDir} className="shrink-0 text-[24px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{share.name}</p>
                    <p className="truncate text-xs text-muted">
                      /{share.path} · vytvořeno {FormatDate(share.createdAt)}
                    </p>
                  </div>
                  <Chip size="sm" color={expired ? "danger" : share.expiresAt ? "default" : "accent"} variant="soft">
                    {expired ? "Vypršel" : share.expiresAt ? `Do ${FormatDate(share.expiresAt)}` : "Bez omezení"}
                  </Chip>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onPress={() => Copy(share)} isDisabled={expired}>
                      <Icon name="content_copy" className="text-[16px]" />
                      Kopírovat
                    </Button>
                    <Button size="sm" isIconOnly variant="ghost" aria-label={`Zrušit odkaz na ${share.name}`} onPress={() => setRevoke(share)} className="text-danger!">
                      <Icon name="link_off" className="text-[18px]" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <ConfirmDialog
        isOpen={!!revoke}
        onOpenChange={(open) => !open && setRevoke(null)}
        heading={`Zrušit odkaz na „${revoke?.name ?? ""}“?`}
        confirmLabel="Zrušit odkaz"
        isPending={pending}
        onConfirm={Revoke}
      >
        Kdo odkaz má, už se k souboru nedostane. Soubor samotný zůstane.
      </ConfirmDialog>
    </div>
  );
}
