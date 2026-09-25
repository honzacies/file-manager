"use client";

import { Badge, Button, Popover, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, use, useCallback, useEffect, useRef, useState } from "react";
import { ApiFetch, Query } from "@/lib/api";
import { FormatDate } from "@/lib/format";
import { Icon } from "./Icon";

interface Notification {
  id: number;
  text: string;
  shareId: number | null;
  // sdílená složka se otevře rovnou, soubor na stránce Sdíleno se mnou
  isDir: boolean | null;
  createdAt: number;
  readAt: number | null;
}

interface NotificationState {
  unread: number;
  items: Notification[];
  MarkRead: (ids?: number[]) => void;
}

const NotificationContext = createContext<NotificationState>({ unread: 0, items: [], MarkRead: () => {} });

const POLL_MS = 30_000;

// Jedno dotazování pro celou appku — zvoneček je v sidebaru i v mobilní liště zároveň.
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const seen = useRef<Set<number> | null>(null);

  const Load = useCallback(() => {
    ApiFetch<{ unread: number; items: Notification[] }>("/api/notifications").then((result) => {
      if (!result.ok) return;
      // Nové nepřečtené od posledního dotazu ukázat i jako toast (ne při prvním načtení stránky).
      if (seen.current) {
        for (const item of result.body.items) {
          if (!item.readAt && !seen.current.has(item.id)) toast.info(item.text);
        }
      }
      seen.current = new Set(result.body.items.map((item) => item.id));
      setState(result.body);
    });
  }, []);

  useEffect(() => {
    Load();
    const timer = setInterval(() => document.visibilityState === "visible" && Load(), POLL_MS);
    window.addEventListener("focus", Load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", Load);
    };
  }, [Load]);

  const MarkRead = useCallback(
    (ids?: number[]) => {
      ApiFetch("/api/notifications/read", "POST", ids ? { ids } : {}).then(Load);
    },
    [Load],
  );

  return <NotificationContext value={{ ...state, MarkRead }}>{children}</NotificationContext>;
}

export function NotificationBell() {
  const { unread, items, MarkRead } = use(NotificationContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function Open(item: Notification) {
    if (!item.readAt) MarkRead([item.id]);
    setOpen(false);
    router.push(item.shareId && item.isDir ? `/files/${Query({ share: item.shareId })}` : "/shared/");
  }

  return (
    <Badge.Anchor>
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly variant="tertiary" aria-label={unread ? `Notifikace, ${unread} ${unread === 1 ? "nová" : unread < 5 ? "nové" : "nových"}` : "Notifikace"}>
        <Icon name="notifications" filled={unread > 0} className="text-[22px]" />
      </Button>
      <Popover.Content placement="bottom start" className="w-[22rem]! max-w-[calc(100vw-2rem)]!">
        <Popover.Dialog className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-separator px-4 py-3">
            <Popover.Heading className="text-sm font-semibold">Notifikace</Popover.Heading>
            {unread > 0 && (
              <Button size="sm" variant="ghost" onPress={() => MarkRead()}>
                Označit vše jako přečtené
              </Button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Zatím žádné notifikace.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto p-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => Open(item)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Icon name="folder_shared" className="mt-0.5 text-[20px] text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${item.readAt ? "text-muted" : "font-medium"}`}>{item.text}</span>
                      <span className="block text-xs text-muted">{FormatDate(item.createdAt)}</span>
                    </span>
                    {!item.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Nepřečteno" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
      {unread > 0 && (
        <Badge color="danger" size="sm">
          {unread > 9 ? "9+" : unread}
        </Badge>
      )}
    </Badge.Anchor>
  );
}

