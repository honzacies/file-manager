"use client";

import { Button, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { type Entry, JoinPath } from "@/lib/format";
import { AppDialog } from "../AppDialog";
import { Icon } from "../Icon";
import { PathBreadcrumbs } from "./PathBreadcrumbs";

// Výběr cílové složky pro přesun — prochází se jen složky.
export function MoveDialog({
  isOpen,
  onOpenChange,
  all,
  startPath,
  moving,
  onMove,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  all: boolean;
  startPath: string;
  // přesouvané cesty — do nich (ani do jejich podsložek) se přesouvat nedá
  moving: string[];
  onMove: (destination: string) => Promise<void>;
}) {
  const [path, setPath] = useState(startPath);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isOpen) setPath(startPath);
  }, [isOpen, startPath]);

  useEffect(() => {
    if (!isOpen) return;
    setFolders(null);
    setError(null);
    ApiFetch<{ entries: Entry[] }>(`/api/files${Query({ path, all })}`).then((result) => {
      if (!result.ok) return setError(ErrorText(result));
      setFolders(
        result.body.entries
          .filter((entry) => entry.isDir)
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b, "cs")),
      );
    });
  }, [isOpen, path, all]);

  const isBlocked = (target: string) => moving.some((source) => target === source || target.startsWith(`${source}/`));
  const isSameFolder = moving.every((source) => source.split("/").slice(0, -1).join("/") === path);

  async function Move() {
    setPending(true);
    await onMove(path);
    setPending(false);
  }

  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Přesunout ${moving.length === 1 ? `„${moving[0].split("/").pop()}“` : `${moving.length} položek`}`}
      footer={
        <>
          <Button variant="tertiary" onPress={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onPress={Move} isPending={pending} isDisabled={isBlocked(path) || isSameFolder}>
            <Icon name="drive_file_move" className="text-[18px]" />
            Přesunout sem
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <PathBreadcrumbs path={path} rootLabel={all ? "Všechny soubory" : "Moje soubory"} onNavigate={setPath} />
        <div className="h-72 overflow-y-auto rounded-xl border border-border">
          {error ? (
            <p className="p-4 text-sm text-danger">{error}</p>
          ) : !folders ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : folders.length === 0 ? (
            <p className="grid h-full place-items-center p-4 text-sm text-muted">Žádné podsložky</p>
          ) : (
            <ul className="p-1">
              {folders.map((name) => {
                const target = JoinPath(path, name);
                const blocked = isBlocked(target);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setPath(target)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Icon name="folder" filled className="text-accent text-[20px]" />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {!blocked && <Icon name="chevron_right" className="text-muted text-[18px]" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {isSameFolder && <p className="text-xs text-muted">Položky už v téhle složce jsou.</p>}
      </div>
    </AppDialog>
  );
}
