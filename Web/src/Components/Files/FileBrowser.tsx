"use client";

import { Button, Dropdown, EmptyState, Label, SearchField, Skeleton, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { FilesFromDrop, FilesFromInput } from "@/lib/dropFiles";
import { CanPreview, type Entry, JoinPath } from "@/lib/format";
import { ConfirmDialog } from "../ConfirmDialog";
import { Icon } from "../Icon";
import { PageHeader } from "../PageHeader";
import { useUser } from "../Session";
import { useUploads } from "../Uploads";
import { type Action, ContextMenu } from "./ActionMenu";
import { DRAG_TYPE, FileItems, type ItemHandlers, type Sort, SortEntries } from "./FileItems";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { PathBreadcrumbs } from "./PathBreadcrumbs";
import { PreviewModal } from "./PreviewModal";
import { ShareDialog } from "./ShareDialog";

type DialogState =
  | { kind: "newFolder" }
  | { kind: "rename"; entry: Entry }
  | { kind: "move"; names: string[] }
  | { kind: "share"; entry: Entry }
  | { kind: "delete"; names: string[] }
  | null;

const VIEW_KEY = "cloud.view";

function ReadView(): "list" | "grid" {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export function FileBrowser() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path") ?? "";
  const all = user.role === "admin" && params.get("all") === "1";
  const uploads = useUploads();

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => setView(ReadView()), []);
  const ChangeView = (next: "list" | "grid") => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const Reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Při změně složky začít načítat nanovo a zrušit výběr.
  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    setAnchor(null);
    setFilter("");
  }, [path, all]);

  useEffect(() => {
    let cancelled = false;
    ApiFetch<{ entries: Entry[] }>(`/api/files${Query({ path, all })}`).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setError(ErrorText(result));
      setError(null);
      setEntries(result.body.entries);
      // Po obnovení nechat označené jen to, co ještě existuje.
      const names = new Set(result.body.entries.map((entry) => entry.name));
      setSelected((current) => new Set([...current].filter((name) => names.has(name))));
    });
    return () => {
      cancelled = true;
    };
  }, [path, all, reloadKey, uploads.version]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("cs");
    const filtered = (entries ?? []).filter((entry) => !needle || entry.name.toLocaleLowerCase("cs").includes(needle));
    return SortEntries(filtered, sort);
  }, [entries, filter, sort]);

  const previewable = useMemo(() => visible.filter(CanPreview), [visible]);
  const selectedEntries = visible.filter((entry) => selected.has(entry.name));

  const Navigate = useCallback((next: string) => router.push(`/files/${Query({ path: next, all: all ? "1" : undefined })}`), [router, all]);
  const FileUrl = (entry: Entry, inline: boolean) => `/api/files/download${Query({ path: JoinPath(path, entry.name), all, inline })}`;

  function Open(entry: Entry) {
    if (entry.isDir) return Navigate(JoinPath(path, entry.name));
    const index = previewable.findIndex((item) => item.name === entry.name);
    if (index >= 0) setPreview(index);
    else Download([entry]);
  }

  function Download(targets: Entry[]) {
    // Víc souborů = víc stažení; prohlížeč se napoprvé zeptá, jestli je povolit.
    targets
      .filter((entry) => !entry.isDir)
      .forEach((entry, i) => {
        setTimeout(() => {
          const link = document.createElement("a");
          link.href = FileUrl(entry, false);
          link.download = entry.name;
          link.click();
        }, i * 300);
      });
  }

  // ---- Výběr ------------------------------------------------------------

  function Select(name: string, mode: "replace" | "toggle" | "range") {
    if (mode === "range" && anchor) {
      const names = visible.map((entry) => entry.name);
      const [from, to] = [names.indexOf(anchor), names.indexOf(name)].sort((a, b) => a - b);
      setSelected(new Set(names.slice(from, to + 1)));
      return;
    }
    setAnchor(name);
    setSelected((current) => {
      if (mode === "replace") return new Set([name]);
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ---- Akce -------------------------------------------------------------

  function ActionsFor(targets: Entry[]): Action[] {
    if (!targets.length) return [];
    const single = targets.length === 1 ? targets[0] : null;
    const hasFiles = targets.some((entry) => !entry.isDir);
    return [
      ...(single ? [{ id: "open", label: single.isDir ? "Otevřít" : CanPreview(single) ? "Náhled" : "Otevřít", icon: single.isDir ? "folder_open" : "visibility", shortcut: "Enter" }] : []),
      ...(hasFiles ? [{ id: "download", label: targets.length > 1 ? "Stáhnout soubory" : "Stáhnout", icon: "download" }] : []),
      ...(single ? [{ id: "share", label: "Sdílet odkazem", icon: "link", separated: true }] : []),
      ...(single ? [{ id: "rename", label: "Přejmenovat", icon: "edit", shortcut: "F2", separated: !single }] : []),
      { id: "move", label: "Přesunout", icon: "drive_file_move", separated: !single },
      { id: "delete", label: "Přesunout do koše", icon: "delete", danger: true, shortcut: "Del", separated: true },
    ];
  }

  const BACKGROUND_ACTIONS: Action[] = [
    { id: "newFolder", label: "Nová složka", icon: "create_new_folder" },
    { id: "uploadFiles", label: "Nahrát soubory", icon: "upload_file" },
    { id: "uploadFolder", label: "Nahrát složku", icon: "drive_folder_upload" },
    { id: "refresh", label: "Obnovit", icon: "refresh", separated: true },
  ];

  function RunAction(id: string, targets: Entry[]) {
    const names = targets.map((entry) => entry.name);
    switch (id) {
      case "open":
        return Open(targets[0]);
      case "download":
        return Download(targets);
      case "share":
        return setDialog({ kind: "share", entry: targets[0] });
      case "rename":
        return setDialog({ kind: "rename", entry: targets[0] });
      case "move":
        return setDialog({ kind: "move", names });
      case "delete":
        return setDialog({ kind: "delete", names });
      case "newFolder":
        return setDialog({ kind: "newFolder" });
      case "uploadFiles":
        return fileInput.current?.click();
      case "uploadFolder":
        return folderInput.current?.click();
      case "refresh":
        return Reload();
    }
  }

  async function Mutate(url: string, payload: unknown) {
    const result = await ApiFetch(url, "POST", { ...(payload as object), all });
    if (!result.ok) toast.danger(ErrorText(result));
    Reload();
    return result;
  }

  async function Delete(names: string[]) {
    setPending(true);
    const result = await Mutate("/api/files/delete", { paths: names.map((name) => JoinPath(path, name)) });
    setPending(false);
    setDialog(null);
    if (result.ok) toast.success(names.length === 1 ? `„${names[0]}“ je v koši` : `${names.length} položek přesunuto do koše`);
  }

  async function MoveInto(destination: string, names: string[]) {
    const result = await Mutate("/api/files/move", { paths: names.map((name) => JoinPath(path, name)), destination });
    if (result.ok) {
      setDialog(null);
      toast.success(names.length === 1 ? `„${names[0]}“ přesunuto` : `${names.length} položek přesunuto`);
    }
  }

  // ---- Klávesnice -------------------------------------------------------

  // Bez závislostí = po každém renderu znovu, takže handler vždy vidí aktuální stav
  // (dřív se registroval jednou a volal Open() se starým, prázdným seznamem).
  useEffect(() => {
    function OnKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (dialog || menu || preview !== null || target.closest("input, textarea, [role=dialog], [role=menu]")) return;
      const current = visible.filter((entry) => selected.has(entry.name));

      if (event.key === "Delete" && current.length) setDialog({ kind: "delete", names: current.map((e) => e.name) });
      else if (event.key === "F2" && current.length === 1) setDialog({ kind: "rename", entry: current[0] });
      else if (event.key === "Enter" && current.length === 1) Open(current[0]);
      else if (event.key === "Escape") setSelected(new Set());
      else if (event.key === "a" && (event.ctrlKey || event.metaKey)) setSelected(new Set(visible.map((e) => e.name)));
      else if (event.key === "Backspace" && path) Navigate(path.split("/").slice(0, -1).join("/"));
      else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key) && visible.length) {
        const index = visible.findIndex((e) => e.name === anchor);
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + step))];
        Select(next.name, event.shiftKey ? "toggle" : "replace");
        document.querySelector(`[data-name="${CSS.escape(next.name)}"]`)?.scrollIntoView({ block: "nearest" });
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", OnKey);
    return () => window.removeEventListener("keydown", OnKey);
  });

  // ---- Drag & drop z plochy ---------------------------------------------

  const isOsDrag = (event: React.DragEvent) => event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(DRAG_TYPE);

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!isOsDrag(event)) return;
      dragDepth.current++;
      setDropActive(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isOsDrag(event)) return;
      dragDepth.current--;
      if (dragDepth.current <= 0) setDropActive(false);
    },
    onDragOver: (event: React.DragEvent) => {
      if (isOsDrag(event)) event.preventDefault();
    },
    onDrop: async (event: React.DragEvent) => {
      if (!isOsDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDropActive(false);
      const files = await FilesFromDrop(event.dataTransfer);
      if (files.length) uploads.Enqueue(files, { path, all });
    },
  };

  const handlers: ItemHandlers = {
    selected,
    focused: anchor,
    onSelect: Select,
    onOpen: Open,
    onContextMenu: (entry, event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selected.has(entry.name)) {
        setSelected(new Set([entry.name]));
        setAnchor(entry.name);
      }
      setMenu({ x: event.clientX, y: event.clientY, entry });
    },
    actionsFor: (entry) => ActionsFor([entry]),
    onAction: (entry, id) => RunAction(id, [entry]),
    onDropInto: (folder, names) => MoveInto(JoinPath(path, folder), names),
    thumbUrl: (entry) => FileUrl(entry, true),
  };

  // Cíl kontextového menu: pravý klik na označenou položku = celý výběr.
  const menuTargets = menu?.entry ? (selected.has(menu.entry.name) ? selectedEntries : [menu.entry]) : [];
  const title = all ? "Všechny soubory" : "Moje soubory";
  const renameEntry = dialog?.kind === "rename" ? dialog.entry : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zóna a kontextové menu pozadí
    <div
      className="relative flex min-h-[calc(100dvh-7rem)] flex-col gap-4 lg:min-h-[calc(100dvh-4rem)]"
      {...dropHandlers}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("[role=option], input, a, button")) return;
        event.preventDefault();
        setSelected(new Set());
        setMenu({ x: event.clientX, y: event.clientY, entry: null });
      }}
      onClick={(event) => {
        // klik do prázdna zruší výběr
        if (!(event.target as HTMLElement).closest("[role=option], button, input, label, a, [role=menu]")) setSelected(new Set());
      }}
    >
      <PageHeader
        title={title}
        description={all ? "Celý kořen cloudu včetně složek všech uživatelů." : undefined}
        actions={
          <>
            <Button variant="secondary" onPress={() => setDialog({ kind: "newFolder" })}>
              <Icon name="create_new_folder" className="text-[18px]" />
              Nová složka
            </Button>
            <Dropdown>
              <Button>
                <Icon name="upload" className="text-[18px]" />
                Nahrát
                <Icon name="expand_more" className="-mr-1 text-[18px]" />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label="Nahrát" onAction={(key) => RunAction(String(key), [])}>
                  <Dropdown.Item id="uploadFiles" textValue="Soubory">
                    <Icon name="upload_file" className="text-[18px] text-muted" />
                    <Label>Soubory</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="uploadFolder" textValue="Složku">
                    <Icon name="drive_folder_upload" className="text-[18px] text-muted" />
                    <Label>Složku</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </>
        }
      />

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          uploads.Enqueue(FilesFromInput(event.target.files), { path, all });
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          uploads.Enqueue(FilesFromInput(event.target.files), { path, all });
          event.target.value = "";
        }}
      />

      {/* Lišta výběru nahrazuje řádek s cestou — stejná výška, seznam neposkočí. */}
      <div className="flex min-h-10 flex-wrap items-center gap-3">
        {selected.size > 0 ? (
          <div className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-2xl bg-accent/10 py-1 pr-2 pl-4" role="toolbar" aria-label="Akce s výběrem">
            <span className="mr-auto text-sm font-medium text-accent">
              Označeno: {selected.size}
            </span>
            {selectedEntries.some((entry) => !entry.isDir) && (
              <Button size="sm" variant="tertiary" onPress={() => Download(selectedEntries)}>
                <Icon name="download" className="text-[18px]" />
                <span className="hidden sm:inline">Stáhnout</span>
              </Button>
            )}
            {selectedEntries.length === 1 && (
              <Button size="sm" variant="tertiary" onPress={() => RunAction("share", selectedEntries)}>
                <Icon name="link" className="text-[18px]" />
                <span className="hidden sm:inline">Sdílet</span>
              </Button>
            )}
            <Button size="sm" variant="tertiary" onPress={() => RunAction("move", selectedEntries)}>
              <Icon name="drive_file_move" className="text-[18px]" />
              <span className="hidden sm:inline">Přesunout</span>
            </Button>
            <Button size="sm" variant="tertiary" onPress={() => RunAction("delete", selectedEntries)} className="text-danger!">
              <Icon name="delete" className="text-[18px]" />
              <span className="hidden sm:inline">Smazat</span>
            </Button>
            <Button size="sm" isIconOnly variant="tertiary" aria-label="Zrušit výběr" onPress={() => setSelected(new Set())}>
              <Icon name="close" className="text-[18px]" />
            </Button>
          </div>
        ) : (
          <>
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <PathBreadcrumbs path={path} rootLabel={title} onNavigate={Navigate} />
            </div>
            <SearchField aria-label="Hledat v této složce" value={filter} onChange={setFilter} className="min-w-0 flex-1 sm:w-56 sm:flex-none">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Hledat ve složce…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ToggleButtonGroup
              aria-label="Zobrazení"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([view])}
              onSelectionChange={(keys) => ChangeView([...keys][0] as "list" | "grid")}
              size="sm"
            >
              <ToggleButton id="list" isIconOnly aria-label="Seznam">
                <Icon name="view_list" className="text-[20px]" />
              </ToggleButton>
              <ToggleButton id="grid" isIconOnly aria-label="Mřížka">
                <ToggleButtonGroup.Separator />
                <Icon name="grid_view" className="text-[20px]" />
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        )}
      </div>

      <div className="flex-1">
        {error ? (
          <EmptyState className="py-16">
            <Icon name="error" className="text-[48px] text-danger" />
            <p className="font-medium">Složku se nepodařilo načíst</p>
            <p className="text-sm text-muted">{error}</p>
            <div className="mt-2 flex gap-2">
              {path && (
                <Button variant="secondary" onPress={() => Navigate("")}>
                  Na začátek
                </Button>
              )}
              <Button onPress={Reload}>Zkusit znovu</Button>
            </div>
          </EmptyState>
        ) : !entries ? (
          <div className="flex flex-col gap-2 pt-10">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState className="py-16">
            <span className="grid size-16 place-items-center rounded-full bg-accent/10">
              <Icon name={filter ? "search_off" : "cloud_upload"} className="text-[32px] text-accent" />
            </span>
            <p className="font-medium">{filter ? "Nic nenalezeno" : "Složka je prázdná"}</p>
            <p className="max-w-xs text-sm text-muted">
              {filter ? `V téhle složce nic neodpovídá „${filter}“.` : "Přetáhni sem soubory nebo složky, nebo použij tlačítko Nahrát."}
            </p>
            {!filter && (
              <Button className="mt-2" onPress={() => fileInput.current?.click()}>
                <Icon name="upload" className="text-[18px]" />
                Nahrát soubory
              </Button>
            )}
          </EmptyState>
        ) : (
          <FileItems
            entries={visible}
            view={view}
            sort={sort}
            onSort={setSort}
            handlers={handlers}
            allSelected={selected.size > 0 && selected.size === visible.length}
            onSelectAll={(select) => setSelected(select ? new Set(visible.map((entry) => entry.name)) : new Set())}
          />
        )}
      </div>

      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Icon name="cloud_upload" className="text-[56px]" />
            <p className="font-medium">Pusť soubory pro nahrání do „{path.split("/").pop() || title}“</p>
          </div>
        </div>
      )}

      <ContextMenu
        position={menu}
        actions={menu?.entry ? ActionsFor(menuTargets) : BACKGROUND_ACTIONS}
        onAction={(id) => RunAction(id, menuTargets)}
        onClose={() => setMenu(null)}
      />

      <NameDialog
        isOpen={dialog?.kind === "newFolder"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Nová složka"
        initial=""
        confirmLabel="Vytvořit"
        onSubmit={async (name) => {
          const result = await ApiFetch("/api/files/folder", "POST", { path, name, all });
          if (!result.ok) return ErrorText(result);
          setDialog(null);
          Reload();
          return null;
        }}
      />
      <NameDialog
        isOpen={!!renameEntry}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Přejmenovat"
        initial={renameEntry?.name ?? ""}
        confirmLabel="Přejmenovat"
        onSubmit={async (name) => {
          if (!renameEntry || name === renameEntry.name) return setDialog(null), null;
          const result = await ApiFetch("/api/files/rename", "POST", { path: JoinPath(path, renameEntry.name), name, all });
          if (!result.ok) return ErrorText(result);
          setDialog(null);
          setSelected(new Set([name]));
          Reload();
          return null;
        }}
      />
      <MoveDialog
        isOpen={dialog?.kind === "move"}
        onOpenChange={(open) => !open && setDialog(null)}
        all={all}
        startPath={path}
        moving={dialog?.kind === "move" ? dialog.names.map((name) => JoinPath(path, name)) : []}
        onMove={(destination) => MoveInto(destination, dialog?.kind === "move" ? dialog.names : [])}
      />
      <ShareDialog
        isOpen={dialog?.kind === "share"}
        onOpenChange={(open) => !open && setDialog(null)}
        all={all}
        target={dialog?.kind === "share" ? { path: JoinPath(path, dialog.entry.name), name: dialog.entry.name, isDir: dialog.entry.isDir } : null}
      />
      <ConfirmDialog
        isOpen={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        heading={
          dialog?.kind === "delete" && dialog.names.length === 1 ? `Přesunout „${dialog.names[0]}“ do koše?` : `Přesunout ${dialog?.kind === "delete" ? dialog.names.length : 0} položek do koše?`
        }
        confirmLabel="Přesunout do koše"
        isPending={pending}
        onConfirm={() => dialog?.kind === "delete" && Delete(dialog.names)}
      >
        Z koše je můžeš 30 dní obnovit, potom se smažou natrvalo.
      </ConfirmDialog>

      <PreviewModal entries={previewable} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)} urlFor={FileUrl} />
    </div>
  );
}
