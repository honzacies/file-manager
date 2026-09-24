"use client";

import { Button, Switch, toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/Components/ConfirmDialog";
import { FileIcon } from "@/Components/FileIcon";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { useUser } from "@/Components/Session";
import { EmptyView, ErrorView, LoadingRows } from "@/Components/StateViews";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { FormatBytes, FormatDate } from "@/lib/format";

interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  isDir: boolean;
  size: number;
  deletedAt: number;
}

export default function TrashPage() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const all = user.role === "admin" && params.get("all") === "1";
  const [data, setData] = useState<{ retentionDays: number; items: TrashItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete"; item: TrashItem } | { kind: "empty" } | null>(null);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<{ retentionDays: number; items: TrashItem[] }>(`/api/trash${Query({ all })}`).then((result) =>
      result.ok ? setData(result.body) : setError(ErrorText(result)),
    );
  }, [all]);

  useEffect(Load, [Load]);

  async function Run(url: string, payload: unknown, success: string, key: string) {
    setBusy(key);
    const result = await ApiFetch(url, "POST", payload);
    setBusy(null);
    setConfirm(null);
    if (result.ok) toast.success(success);
    else toast.danger(ErrorText(result));
    Load();
  }

  const retention = data?.retentionDays ?? 30;
  const DaysLeft = (item: TrashItem) => Math.max(0, Math.ceil((item.deletedAt + retention * 86_400_000 - Date.now()) / 86_400_000));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Koš"
        description={`Smazané položky se po ${retention} dnech odstraní natrvalo.`}
        actions={
          <>
            {user.role === "admin" && (
              <Switch isSelected={all} onChange={(checked) => router.replace(checked ? "/trash/?all=1" : "/trash/")}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <span className="text-sm">Koš všech uživatelů</span>
                </Switch.Content>
              </Switch>
            )}
            {!!data?.items.length && (
              <Button variant="danger-soft" onPress={() => setConfirm({ kind: "empty" })}>
                <Icon name="delete_forever" className="text-[18px]" />
                Vysypat koš
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <ErrorView message={error} onRetry={Load} />
      ) : !data ? (
        <LoadingRows />
      ) : data.items.length === 0 ? (
        <EmptyView icon="delete" title="Koš je prázdný">
          Co smažeš, najdeš tady a můžeš to obnovit.
        </EmptyView>
      ) : (
        <Panel className="p-2!">
          <ul className="flex flex-col divide-y divide-separator">
            {data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                <FileIcon name={item.name} isDir={item.isDir} className="shrink-0 text-[24px]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={item.name}>
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-muted" title={item.originalPath}>
                    Z /{item.originalPath.split("/").slice(0, -1).join("/")} · smazáno {FormatDate(item.deletedAt)}
                    {!item.isDir && ` · ${FormatBytes(item.size)}`}
                  </p>
                </div>
                <span className="text-xs text-muted tabular-nums">{DaysLeft(item) === 0 ? "dnes zmizí" : `zbývá ${DaysLeft(item)} d`}</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    isPending={busy === item.id}
                    onPress={() => Run("/api/trash/restore", { ids: [item.id] }, `„${item.name}“ obnoveno`, item.id)}
                  >
                    <Icon name="restore_from_trash" className="text-[18px]" />
                    Obnovit
                  </Button>
                  <Button size="sm" isIconOnly variant="ghost" aria-label={`Smazat ${item.name} natrvalo`} onPress={() => setConfirm({ kind: "delete", item })} className="text-danger!">
                    <Icon name="delete_forever" className="text-[18px]" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        heading={confirm?.kind === "empty" ? "Vysypat koš?" : `Smazat „${confirm?.kind === "delete" ? confirm.item.name : ""}“ natrvalo?`}
        confirmLabel={confirm?.kind === "empty" ? "Vysypat" : "Smazat natrvalo"}
        isPending={busy === "confirm"}
        onConfirm={() =>
          confirm?.kind === "empty"
            ? Run("/api/trash/empty", { all }, "Koš je prázdný", "confirm")
            : confirm && Run("/api/trash/delete", { ids: [confirm.item.id] }, "Smazáno natrvalo", "confirm")
        }
      >
        {confirm?.kind === "empty" ? `Všech ${data?.items.length ?? 0} položek se smaže z disku. Tohle nejde vrátit.` : "Soubor se smaže z disku. Tohle nejde vrátit."}
      </ConfirmDialog>
    </div>
  );
}
