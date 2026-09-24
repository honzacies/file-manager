"use client";

import { Alert, Button, Form, Input, Label, Meter, Spinner, TextField, toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { AdminOnly } from "@/Components/AdminOnly";
import { AppDialog } from "@/Components/AppDialog";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { ErrorView, LoadingRows } from "@/Components/StateViews";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { FormatBytes } from "@/lib/format";

interface Settings {
  rootDir: string;
  defaultRootDir: string;
  disk: { total: number; free: number } | null;
}

// Procházení složek na serveru (jen složky) pro výběr kořene.
function FolderPicker({ isOpen, start, onClose, onPick }: { isOpen: boolean; start: string; onClose: () => void; onPick: (path: string) => void }) {
  const [path, setPath] = useState(start);
  const [data, setData] = useState<{ path: string; parent: string | null; dirs: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setPath(start);
  }, [isOpen, start]);

  useEffect(() => {
    if (!isOpen) return;
    setData(null);
    setError(null);
    ApiFetch<{ path: string; parent: string | null; dirs: string[] }>(`/api/admin/browse${Query({ path })}`).then((result) =>
      result.ok ? setData(result.body) : setError(ErrorText(result)),
    );
  }, [isOpen, path]);

  const Join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);

  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="Vybrat složku na serveru"
      footer={
        <>
          <Button variant="tertiary" onPress={onClose}>
            Zrušit
          </Button>
          <Button onPress={() => data && onPick(data.path)} isDisabled={!data}>
            Vybrat tuhle složku
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button isIconOnly size="sm" variant="secondary" aria-label="O úroveň výš" isDisabled={!data?.parent} onPress={() => data?.parent && setPath(data.parent)}>
            <Icon name="arrow_upward" className="text-[18px]" />
          </Button>
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-secondary px-3 py-1.5 text-sm">{data?.path ?? path}</code>
        </div>
        <div className="h-72 overflow-y-auto rounded-xl border border-border">
          {error ? (
            <p className="p-4 text-sm text-danger">{error}</p>
          ) : !data ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : data.dirs.length === 0 ? (
            <p className="grid h-full place-items-center text-sm text-muted">Žádné podsložky</p>
          ) : (
            <ul className="p-1">
              {data.dirs.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setPath(Join(data.path, name))}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Icon name="folder" filled className="text-accent text-[20px]" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Icon name="chevron_right" className="text-muted text-[18px]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppDialog>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rootDir, setRootDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picker, setPicker] = useState(false);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<Settings>("/api/admin/settings").then((result) => {
      if (!result.ok) return setError(ErrorText(result));
      setSettings(result.body);
      setRootDir(result.body.rootDir);
    });
  }, []);
  useEffect(Load, [Load]);

  async function Save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setSaveError(null);
    const result = await ApiFetch("/api/admin/settings", "PUT", { rootDir: rootDir.trim() });
    setPending(false);
    if (!result.ok) return setSaveError(ErrorText(result));
    toast.success("Kořenová složka uložena");
    Load();
  }

  const used = settings?.disk ? settings.disk.total - settings.disk.free : 0;
  const changed = settings && rootDir.trim() !== settings.rootDir;

  return (
    <AdminOnly>
      <div className="flex max-w-2xl flex-col gap-6">
        <PageHeader title="Nastavení" description="Kde cloud ukládá soubory." />
        {error ? (
          <ErrorView message={error} onRetry={Load} />
        ) : !settings ? (
          <LoadingRows count={2} />
        ) : (
          <>
            <Panel>
              <h2 className="mb-1 font-semibold">Kořenová složka</h2>
              <p className="mb-5 text-sm text-muted">
                Každý uživatel má v ní vlastní podsložku podle jména. Smazané položky čekají ve skryté <code>.trash</code>.
              </p>
              <Form onSubmit={Save} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <TextField value={rootDir} onChange={(value) => (setRootDir(value), setSaveError(null))} isInvalid={!!saveError} className="flex-1" isRequired>
                    <Label>Cesta na serveru</Label>
                    <Input className="font-mono text-sm" autoComplete="off" spellCheck={false} />
                  </TextField>
                  <Button variant="secondary" onPress={() => setPicker(true)}>
                    <Icon name="folder_open" className="text-[18px]" />
                    Procházet…
                  </Button>
                </div>
                {saveError && <p className="-mt-2 text-sm text-danger">{saveError}</p>}
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Soubory se nepřesouvají</Alert.Title>
                    <Alert.Description>
                      Po změně cloud začne používat novou složku a stávající soubory zůstanou ve staré. Chceš-li je zachovat, přesuň je na serveru ručně. V Dockeru jsou
                      trvalé jen složky namountované z hostitele (výchozí <code>{settings.defaultRootDir}</code>).
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
                <div className="flex gap-2">
                  <Button type="submit" isPending={pending} isDisabled={!changed}>
                    Uložit
                  </Button>
                  {changed && (
                    <Button variant="tertiary" onPress={() => setRootDir(settings.rootDir)}>
                      Vrátit
                    </Button>
                  )}
                </div>
              </Form>
            </Panel>

            {settings.disk && (
              <Panel>
                <Meter value={used} maxValue={settings.disk.total} color={used / settings.disk.total > 0.9 ? "danger" : "accent"}>
                  <Label className="font-semibold">Disk s kořenovou složkou</Label>
                  <Meter.Output className="tabular-nums" />
                  <Meter.Track>
                    <Meter.Fill />
                  </Meter.Track>
                </Meter>
                <p className="mt-2 text-sm text-muted tabular-nums">
                  Obsazeno {FormatBytes(used)} z {FormatBytes(settings.disk.total)}, volných {FormatBytes(settings.disk.free)}.
                </p>
              </Panel>
            )}
          </>
        )}

        <FolderPicker
          isOpen={picker}
          start={rootDir || "/"}
          onClose={() => setPicker(false)}
          onPick={(path) => {
            setRootDir(path);
            setPicker(false);
          }}
        />
      </div>
    </AdminOnly>
  );
}
