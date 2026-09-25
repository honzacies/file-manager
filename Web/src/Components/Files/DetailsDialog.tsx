"use client";

import { Button, Skeleton } from "@heroui/react";
import { type ReactNode, useEffect, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { FormatBytes, FormatDate } from "@/lib/format";
import { AppDialog } from "../AppDialog";
import { FileIcon } from "../FileIcon";
import { type Person, PersonLabel } from "../UserAvatar";

interface Details {
  name: string;
  isDir: boolean;
  size: number;
  files: number;
  folders: number;
  modified: number;
  created: number;
  owner: Person | null;
  sharedWith: { username: string; canWrite: boolean }[];
  links: number;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function DetailsDialog({
  target,
  scope,
  location,
  onClose,
}: {
  target: { path: string; name: string; isDir: boolean; color?: string } | null;
  scope: { all?: boolean; share?: number };
  // kde položka leží, čitelně ("Moje soubory / Fotky")
  location: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDetails(null);
    setError(null);
    // Velikost složky se počítá průchodem — u velkých to chvíli trvá, proto skeleton.
    ApiFetch<Details>(`/api/files/details${Query({ path: target.path, ...scope })}`).then((result) =>
      result.ok ? setDetails(result.body) : setError(ErrorText(result)),
    );
    // Závislost na cestě, ne na objektu — rodič posílá při každém renderu nový objekt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.path, scope.all, scope.share]);

  return (
    <AppDialog
      isOpen={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2">
          <FileIcon name={target?.name ?? ""} isDir={!!target?.isDir} color={target?.color} className="text-[24px]" />
          <span className="truncate">{target?.name}</span>
        </span>
      }
      footer={<Button onPress={onClose}>Zavřít</Button>}
    >
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !details ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-5 rounded-lg" />
          ))}
        </div>
      ) : (
        <dl className="divide-y divide-separator">
          <Row label="Typ">{details.isDir ? "Složka" : "Soubor"}</Row>
          <Row label="Velikost">
            {FormatBytes(details.size)}
            {details.isDir && (
              <span className="text-muted">
                {" "}
                · {details.files} {details.files === 1 ? "soubor" : details.files < 5 && details.files > 0 ? "soubory" : "souborů"}, {details.folders}{" "}
                {details.folders === 1 ? "složka" : details.folders < 5 && details.folders > 0 ? "složky" : "složek"}
              </span>
            )}
          </Row>
          <Row label="Umístění">{location}</Row>
          {details.owner && (
            <Row label="Vlastník">
              <PersonLabel person={details.owner} />
            </Row>
          )}
          <Row label="Změněno">{FormatDate(details.modified)}</Row>
          <Row label="Vytvořeno">{FormatDate(details.created)}</Row>
          {(details.sharedWith.length > 0 || details.links > 0) && (
            <Row label="Sdíleno">
              {details.sharedWith.map((person) => `${person.username} (${person.canWrite ? "upravuje" : "zobrazí"})`).join(", ")}
              {details.links > 0 && (
                <span className="block text-muted">
                  {details.links} {details.links === 1 ? "veřejný odkaz" : "veřejné odkazy"}
                </span>
              )}
            </Row>
          )}
        </dl>
      )}
    </AppDialog>
  );
}
