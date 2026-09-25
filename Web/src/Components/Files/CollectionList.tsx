"use client";

import { toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { CanPreview, type Entry, FormatBytes, FormatDate } from "@/lib/format";
import { FileIcon } from "../FileIcon";
import { Icon } from "../Icon";
import { Panel } from "../Panel";
import { EmptyView, ErrorView, LoadingRows } from "../StateViews";
import { MoreButton } from "./ActionMenu";
import { PreviewModal } from "./PreviewModal";

// Položka z /api/recent nebo /api/starred — nese rozsah, ve kterém se otevírá.
export interface CollectionItem extends Entry {
  key: string;
  at: number;
  path: string;
  share?: number;
  all?: boolean;
  location: string;
}

const FileUrl = (item: CollectionItem, inline = false) => `/api/files/download${Query({ path: item.path, share: item.share, all: item.all, inline })}`;
const ZipUrl = (item: CollectionItem) => `/api/files/zip${Query({ paths: item.path, share: item.share, all: item.all })}`;
const FolderUrl = (item: CollectionItem, path: string) => `/files/${Query({ path, share: item.share, all: item.all ? "1" : undefined })}`;

export function CollectionList({
  url,
  timeLabel,
  empty,
}: {
  url: string;
  // "Otevřeno" / "Přidáno"
  timeLabel: string;
  empty: { icon: string; title: string; text: string };
}) {
  const router = useRouter();
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<CollectionItem[]>(url).then((result) => (result.ok ? setItems(result.body) : setError(ErrorText(result))));
  }, [url]);
  useEffect(Load, [Load]);

  // Náhled listuje jen soubory, které náhled umí.
  const previewable = useMemo(() => (items ?? []).filter((item) => !item.isDir && CanPreview(item)), [items]);

  function Open(item: CollectionItem) {
    if (item.isDir) return router.push(FolderUrl(item, item.path));
    const index = previewable.indexOf(item);
    if (index >= 0) setPreview(index);
    else window.location.href = FileUrl(item);
  }

  async function ToggleStar(item: CollectionItem) {
    const result = await ApiFetch("/api/files/star", "POST", { paths: [item.path], share: item.share, all: item.all, starred: !item.starred });
    if (!result.ok) return toast.danger(ErrorText(result));
    toast.success(item.starred ? "Odebráno z S hvězdičkou" : "Přidáno do S hvězdičkou");
    Load();
  }

  function Run(item: CollectionItem, id: string) {
    if (id === "open") return Open(item);
    if (id === "download") return void (window.location.href = item.isDir ? ZipUrl(item) : FileUrl(item));
    if (id === "reveal") return router.push(FolderUrl(item, item.path.split("/").slice(0, -1).join("/")));
    if (id === "star") return ToggleStar(item);
  }

  if (error) return <ErrorView message={error} onRetry={Load} />;
  if (!items) return <LoadingRows />;
  if (!items.length) {
    return (
      <EmptyView icon={empty.icon} title={empty.title}>
        {empty.text}
      </EmptyView>
    );
  }

  return (
    <>
      <Panel className="p-2!">
        <ul className="flex flex-col divide-y divide-separator">
          {items.map((item) => (
            <li key={item.key}>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: klávesnice jde přes menu ⋮ */}
              <div
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-default/60"
                onClick={(event) => !(event.target as HTMLElement).closest("button") && Open(item)}
              >
                <FileIcon name={item.name} isDir={item.isDir} color={item.color} className="shrink-0 text-[26px]" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1 text-sm font-medium">
                    <span className="truncate" title={item.name}>
                      {item.name}
                    </span>
                    {item.starred && <Icon name="star" filled className="shrink-0 text-[15px] text-amber-400" />}
                  </p>
                  <p className="truncate text-xs text-muted" title={item.location}>
                    {item.location}
                  </p>
                </div>
                <span className="hidden text-right text-xs text-muted tabular-nums sm:block">
                  {timeLabel} {FormatDate(item.at)}
                  {!item.isDir && <span className="block">{FormatBytes(item.size)}</span>}
                </span>
                <MoreButton
                  label={`Akce pro ${item.name}`}
                  actions={[
                    { id: "open", label: item.isDir ? "Otevřít" : CanPreview(item) ? "Náhled" : "Otevřít", icon: item.isDir ? "folder_open" : "visibility" },
                    { id: "download", label: item.isDir ? "Stáhnout jako ZIP" : "Stáhnout", icon: item.isDir ? "folder_zip" : "download" },
                    { id: "reveal", label: "Zobrazit ve složce", icon: "drive_file_move", separated: true },
                    { id: "star", label: item.starred ? "Odebrat hvězdičku" : "Označit hvězdičkou", icon: item.starred ? "star_half" : "star" },
                  ]}
                  onAction={(id) => Run(item, id)}
                />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <PreviewModal
        entries={previewable}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        urlFor={(entry, inline) => FileUrl(entry as CollectionItem, inline)}
      />
    </>
  );
}
