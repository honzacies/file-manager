"use client";

import { Button, ProgressBar } from "@heroui/react";
import { createContext, type ReactNode, use, useCallback, useRef, useState } from "react";
import { Query, UploadFile } from "@/lib/api";
import { FormatBytes } from "@/lib/format";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";

interface UploadItem {
  id: number;
  name: string;
  size: number;
  loaded: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

export interface UploadRequest {
  file: File;
  // cesta uvnitř nahrávané složky ("Fotky/a.jpg"), u samotných souborů jen název
  relative: string;
}

interface UploadContextValue {
  Enqueue: (files: UploadRequest[], target: { path: string; all: boolean }) => void;
  // zvýší se po každém dokončeném souboru — seznam souborů se podle toho obnoví
  version: number;
}

const UploadContext = createContext<UploadContextValue>({ Enqueue: () => {}, version: 0 });
export const useUploads = () => use(UploadContext);

const CONCURRENCY = 3;

export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [version, setVersion] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const queue = useRef<{ id: number; request: UploadRequest; url: string }[]>([]);
  const running = useRef(0);
  const nextId = useRef(1);
  const abort = useRef(new AbortController());

  const Update = (id: number, patch: Partial<UploadItem>) => setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const Pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!;
      running.current++;
      Update(job.id, { status: "uploading" });
      UploadFile(job.url, job.request.file, (loaded) => Update(job.id, { loaded }), abort.current.signal).then((result) => {
        running.current--;
        Update(job.id, result.ok ? { status: "done", loaded: job.request.file.size } : { status: "error", error: result.error });
        if (result.ok) setVersion((v) => v + 1);
        Pump();
      });
    }
  }, []);

  const Enqueue = useCallback(
    (files: UploadRequest[], target: { path: string; all: boolean }) => {
      const jobs = files.map((request) => ({
        id: nextId.current++,
        request,
        url: `/api/files/upload${Query({ path: target.path, all: target.all, relative: request.relative })}`,
      }));
      queue.current.push(...jobs);
      setItems((list) => [
        ...list,
        ...jobs.map((job) => ({ id: job.id, name: job.request.relative, size: job.request.file.size, loaded: 0, status: "queued" as const })),
      ]);
      setCollapsed(false);
      Pump();
    },
    [Pump],
  );

  function Close() {
    abort.current.abort();
    abort.current = new AbortController();
    queue.current = [];
    setItems([]);
  }

  const active = items.filter((item) => item.status === "queued" || item.status === "uploading");
  const failed = items.filter((item) => item.status === "error").length;
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const loaded = items.reduce((sum, item) => sum + (item.status === "error" ? item.size : item.loaded), 0);

  return (
    <UploadContext value={{ Enqueue, version }}>
      {children}
      {items.length > 0 && (
        <div
          className="fixed right-4 bottom-4 left-4 z-40 overflow-hidden rounded-2xl border border-border bg-overlay text-overlay-foreground shadow-2xl sm:left-auto sm:w-96"
          role="region"
          aria-label="Nahrávání souborů"
        >
          <div className="flex items-center gap-2 px-4 py-3">
            <Icon name={active.length ? "upload" : failed ? "error" : "check_circle"} className={active.length ? "text-accent" : failed ? "text-danger" : "text-success"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {active.length
                  ? `Nahrávám ${items.length - active.length + 1} z ${items.length}`
                  : failed
                    ? `Hotovo, ${failed} ${failed === 1 ? "soubor selhal" : "souborů selhalo"}`
                    : `Nahráno ${items.length} ${items.length === 1 ? "soubor" : items.length < 5 ? "soubory" : "souborů"}`}
              </p>
              <p className="text-xs text-muted tabular-nums">
                {FormatBytes(loaded)} z {FormatBytes(total)}
              </p>
            </div>
            <Button isIconOnly size="sm" variant="tertiary" aria-label={collapsed ? "Rozbalit" : "Sbalit"} onPress={() => setCollapsed((c) => !c)}>
              <Icon name={collapsed ? "expand_less" : "expand_more"} className="text-[20px]" />
            </Button>
            <Button isIconOnly size="sm" variant="tertiary" aria-label={active.length ? "Zrušit nahrávání" : "Zavřít"} onPress={Close}>
              <Icon name="close" className="text-[20px]" />
            </Button>
          </div>
          {active.length > 0 && (
            <ProgressBar aria-label="Celkový průběh" value={loaded} maxValue={total || 1} size="sm" className="px-4 pb-3">
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          )}
          {!collapsed && (
            <ul className="max-h-64 overflow-y-auto border-t border-separator">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                  <FileIcon name={item.name} isDir={false} className="text-[20px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={item.name}>
                      {item.name}
                    </p>
                    {item.status === "error" ? (
                      <p className="text-xs text-danger">{item.error}</p>
                    ) : (
                      <p className="text-xs text-muted tabular-nums">
                        {item.status === "queued" ? "Čeká…" : item.status === "done" ? FormatBytes(item.size) : `${Math.round((item.loaded / (item.size || 1)) * 100)} %`}
                      </p>
                    )}
                  </div>
                  {item.status === "done" && <Icon name="check" className="text-success text-[18px]" />}
                  {item.status === "uploading" && <Icon name="progress_activity" className="animate-spin text-accent text-[18px]" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </UploadContext>
  );
}
