"use client";

import { Button, Chip, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/Components/ConfirmDialog";
import { FileIcon } from "@/Components/FileIcon";
import { MoreButton } from "@/Components/Files/ActionMenu";
import { PreviewModal } from "@/Components/Files/PreviewModal";
import { PageHeader } from "@/Components/PageHeader";
import { EmptyView, ErrorView, LoadingRows } from "@/Components/StateViews";
import { type Person, PersonLabel } from "@/Components/UserAvatar";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { CanPreview, type Entry, FormatBytes, FormatDate } from "@/lib/format";
import { ClickableRow, ListPanel } from "@/Components/ListPanel";

interface IncomingShare {
  id: number;
  name: string;
  owner: Person;
  isDir: boolean;
  canWrite: boolean;
  size: number;
  createdAt: number;
}

// Sdílený soubor je sám kořenem sdílení → stahuje se bez `path`.
const FileUrl = (share: IncomingShare, inline: boolean) => `/api/files/download${Query({ share: share.id, inline })}`;

export default function SharedWithMePage() {
  const router = useRouter();
  const [shares, setShares] = useState<IncomingShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<IncomingShare | null>(null);
  const [leave, setLeave] = useState<IncomingShare | null>(null);
  const [pending, setPending] = useState(false);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<IncomingShare[]>("/api/user-shares/incoming").then((result) => (result.ok ? setShares(result.body) : setError(ErrorText(result))));
  }, []);
  useEffect(Load, [Load]);

  function Open(share: IncomingShare) {
    if (share.isDir) return router.push(`/files/${Query({ share: share.id })}`);
    const entry = { name: share.name, isDir: false, size: 0, modified: 0 };
    if (CanPreview(entry)) setPreview(share);
    else window.location.href = FileUrl(share, false);
  }

  async function Leave() {
    if (!leave) return;
    setPending(true);
    const result = await ApiFetch(`/api/user-shares/${leave.id}`, "DELETE");
    setPending(false);
    setLeave(null);
    if (result.ok) toast.success(`„${leave.name}“ odebráno ze seznamu`);
    else toast.danger(ErrorText(result));
    Load();
  }

  const previewEntry: Entry | null = preview && { name: preview.name, isDir: false, size: preview.size, modified: 0 };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sdíleno se mnou" description="Soubory a složky, které ti nasdíleli ostatní uživatelé." />

      {error ? (
        <ErrorView message={error} onRetry={Load} />
      ) : !shares ? (
        <LoadingRows />
      ) : shares.length === 0 ? (
        <EmptyView icon="folder_shared" title="Zatím ti nikdo nic nesdílel">
          Až s tebou někdo bude sdílet soubor nebo složku, objeví se tady a přijde ti notifikace.
        </EmptyView>
      ) : (
        <ListPanel>
            {shares.map((share) => (
              <li key={share.id}>
                <ClickableRow onOpen={() => Open(share)}>
                  <FileIcon name={share.name} isDir={share.isDir} className="shrink-0 text-[28px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={share.name}>
                      {share.name}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {FormatDate(share.createdAt)}
                      {!share.isDir && ` · ${FormatBytes(share.size)}`}
                    </p>
                  </div>
                  <PersonLabel person={share.owner} className="hidden w-44 text-sm md:flex" />
                  <Chip size="sm" variant="soft" color={share.canWrite ? "accent" : "default"} className="hidden sm:flex">
                    {share.canWrite ? "Můžeš upravovat" : "Jen pro čtení"}
                  </Chip>
                  <MoreButton
                    label={`Akce pro ${share.name}`}
                    actions={[
                      { id: "open", label: share.isDir ? "Otevřít" : CanPreview({ name: share.name, isDir: false }) ? "Náhled" : "Stáhnout", icon: share.isDir ? "folder_open" : "visibility" },
                      ...(!share.isDir ? [{ id: "download", label: "Stáhnout", icon: "download" }] : []),
                      { id: "leave", label: "Odebrat ze seznamu", icon: "link_off", danger: true, separated: true },
                    ]}
                    onAction={(id) => (id === "open" ? Open(share) : id === "download" ? (window.location.href = FileUrl(share, false)) : setLeave(share))}
                  />
                </ClickableRow>
              </li>
            ))}
          </ListPanel>
      )}

      {preview && previewEntry && (
        <PreviewModal entries={[previewEntry]} index={0} onIndexChange={() => {}} onClose={() => setPreview(null)} urlFor={(_, inline) => FileUrl(preview, inline)} />
      )}

      <ConfirmDialog
        isOpen={!!leave}
        onOpenChange={(open) => !open && setLeave(null)}
        heading={`Odebrat „${leave?.name ?? ""}“?`}
        confirmLabel="Odebrat"
        status="warning"
        isPending={pending}
        onConfirm={Leave}
      >
        Ztratíš k položce přístup. U {leave?.owner.name} zůstane, jen ti ji bude muset nasdílet znovu.
      </ConfirmDialog>
    </div>
  );
}
