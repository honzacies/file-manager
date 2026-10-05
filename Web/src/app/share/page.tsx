"use client";

import { Button } from "@heroui/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Brand } from "@/Components/Brand";
import { FileIcon } from "@/Components/FileIcon";
import { FileItems, type Sort, SortEntries } from "@/Components/Files/FileItems";
import { PathBreadcrumbs } from "@/Components/Files/PathBreadcrumbs";
import { PreviewModal } from "@/Components/Files/PreviewModal";
import { Icon } from "@/Components/Icon";
import { Panel } from "@/Components/Panel";
import { EmptyView, LoadingRows } from "@/Components/StateViews";
import { ThemeToggle } from "@/Components/ThemeToggle";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { CanPreview, type Entry, FormatBytes, FormatDate, JoinPath } from "@/lib/format";
import { t } from "@/lib/i18n";

interface ShareData {
  name: string;
  owner: string | null;
  expiresAt: number | null;
  isDir: boolean;
  path: string;
  size: number;
  entries: Entry[];
}

function ShareView() {
  const token = useSearchParams().get("t") ?? "";
  const [path, setPath] = useState("");
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    ApiFetch<ShareData>(`/api/public/shares/${encodeURIComponent(token)}${Query({ path })}`).then((result) =>
      result.ok ? setData(result.body) : setError(ErrorText(result)),
    );
  }, [token, path]);

  const entries = useMemo(() => SortEntries(data?.entries ?? [], sort), [data, sort]);
  const previewable = useMemo(() => entries.filter(CanPreview), [entries]);

  const FileUrl = (entry: Entry | null, inline: boolean) =>
    `/api/public/shares/${encodeURIComponent(token)}/download${Query({ path: entry ? JoinPath(path, entry.name) : "", inline })}`;

  if (error) {
    return (
      <EmptyView icon="link_off" title={t("This link doesn't work", "Odkaz nefunguje")}>
        {error}
      </EmptyView>
    );
  }
  if (!data) return <LoadingRows count={4} />;

  // Sdílený jeden soubor
  if (!data.isDir) {
    const entry: Entry = { name: data.name, isDir: false, size: data.size, modified: 0 };
    return (
      <Panel className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-8! text-center">
        <FileIcon name={data.name} isDir={false} className="text-[64px]" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold break-all">{data.name}</h1>
          <p className="text-sm text-muted">
            {FormatBytes(data.size)}
            {data.owner && ` · ${t("shared by", "sdílí")} ${data.owner}`}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {CanPreview(entry) && (
            <Button variant="secondary" onPress={() => setPreview(0)}>
              <Icon name="visibility" className="text-[18px]" />
              {t("Preview", "Náhled")}
            </Button>
          )}
          <a href={FileUrl(null, false)} download className="button button--primary">
            <Icon name="download" className="text-[18px]" />
            {t("Download", "Stáhnout")}
          </a>
        </div>
        {data.expiresAt && <p className="text-xs text-muted">{t("Link valid until", "Odkaz platí do")} {FormatDate(data.expiresAt)}.</p>}
        <PreviewModal entries={[entry]} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)} urlFor={(_, inline) => FileUrl(null, inline)} />
      </Panel>
    );
  }

  // Sdílená složka — jen procházení a stahování
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <p className="text-sm text-muted">
          {data.owner ? `${t("Shared by", "Sdílí")} ${data.owner}` : t("Shared folder", "Sdílená složka")}
          {data.expiresAt && ` · ${t("valid until", "platí do")} ${FormatDate(data.expiresAt)}`}
        </p>
      </div>
      <PathBreadcrumbs path={path} rootLabel={data.name} onNavigate={setPath} />
      {entries.length === 0 ? (
        <EmptyView icon="folder_open" title={t("This folder is empty", "Složka je prázdná")} />
      ) : (
        <FileItems
          entries={entries}
          view="list"
          sort={sort}
          onSort={setSort}
          allSelected={false}
          onSelectAll={() => {}}
          handlers={{
            readOnly: true,
            thumbUrl: (entry) =>
              `/api/public/shares/${encodeURIComponent(token)}/thumb${Query({ path: JoinPath(path, entry.name), v: Math.round(entry.modified) })}`,
            selected: new Set(),
            focused: null,
            onSelect: () => {},
            onOpen: (entry) => {
              if (entry.isDir) return setPath(JoinPath(path, entry.name));
              const index = previewable.findIndex((item) => item.name === entry.name);
              if (index >= 0) setPreview(index);
              else window.location.href = FileUrl(entry, false);
            },
            onContextMenu: () => {},
            actionsFor: (entry) =>
              entry.isDir ? [{ id: "open", label: t("Open", "Otevřít"), icon: "folder_open" }] : [{ id: "download", label: t("Download", "Stáhnout"), icon: "download" }],
            onAction: (entry, id) => (id === "open" ? setPath(JoinPath(path, entry.name)) : (window.location.href = FileUrl(entry, false))),
            onDropInto: () => {},
          }}
        />
      )}
      <PreviewModal entries={previewable} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)}
        urlFor={(entry, inline) => FileUrl(entry, inline)}
        thumbFor={(entry) => `/api/public/shares/${encodeURIComponent(token)}/thumb${Query({ path: JoinPath(path, entry.name), v: Math.round(entry.modified) })}`}
      />
    </div>
  );
}

export default function SharePage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <Brand />
        <div className="whitespace-nowrap">
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">
        <Suspense>
          <ShareView />
        </Suspense>
      </main>
    </div>
  );
}
