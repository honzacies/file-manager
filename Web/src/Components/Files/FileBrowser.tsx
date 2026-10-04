"use client";

import { Button, Dropdown, EmptyState, Kbd, Label, SearchField, Skeleton, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { FilesFromDrop, FilesFromInput } from "@/lib/dropFiles";
import { CanPreview, type Entry, JoinPath } from "@/lib/format";
import { ConfirmDialog } from "../ConfirmDialog";
import { Icon } from "../Icon";
import { useOffline } from "../Offline";
import { PageHeader } from "../PageHeader";
import { useUser } from "../Session";
import { type UploadRequest, useUploads } from "../Uploads";
import type { Person } from "../UserAvatar";
import { type Action, ContextMenu } from "./ActionMenu";
import { DetailsDialog } from "./DetailsDialog";
import { DRAG_TYPE, FileItems, type ItemHandlers, type Sort, SortEntries, type SortKey } from "./FileItems";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { PathBreadcrumbs } from "./PathBreadcrumbs";
import { PreviewModal } from "./PreviewModal";
import { ShareDialog } from "./ShareDialog";
import { UserShareDialog } from "./UserShareDialog";
import { Plural, t } from "@/lib/i18n";

type DialogState =
  | { kind: "newFolder" }
  | { kind: "rename"; entry: Entry }
  | { kind: "move"; names: string[] }
  | { kind: "share"; entry: Entry }
  | { kind: "shareUsers"; entry: Entry }
  | { kind: "details"; entry: Entry }
  | { kind: "delete"; names: string[] }
  | null;

const VIEW_KEY = "cloud.view";

// Řazení v menu — na mobilu a v mřížce, kde nejsou hlavičky sloupců.
const SortLabels = (): Record<SortKey, string> => ({ name: t("Name", "Název"), modified: t("Modified", "Změněno"), size: t("Size", "Velikost") });

// Sdílení, které mi někdo poslal (z /api/user-shares/incoming).
interface IncomingShare {
  id: number;
  name: string;
  owner: Person;
  canWrite: boolean;
}

function ReadView(): "list" | "grid" {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

// "sub/leto.jpg" -> "leto.jpg" (výsledky hledání mají v názvu cestu)
const BaseName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

export function FileBrowser() {
  const user = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path") ?? "";
  const all = user.role === "admin" && params.get("all") === "1";
  // Cizí sdílená složka: rozsah posílaný s každým requestem, server ověří, že jsem příjemce.
  const share = Number(params.get("share")) || undefined;
  // Hledání v podsložkách (Enter v hledání nebo "Vyhledat ve složce").
  const q = params.get("q") ?? "";
  const uploads = useUploads();
  const offline = useOffline();

  const [entries, setEntries] = useState<Entry[] | null>(null);
  // login -> jméno a avatar vlastníků z odpovědi API
  const [people, setPeople] = useState<Record<string, Person>>({});
  // Prohlížeč z dialogu pustí vždycky jen jednu složku (`multiple` se u webkitdirectory ignoruje),
  // tak se vybrané složky hromadí tady a nahrají se naráz.
  const [folderPick, setFolderPick] = useState<UploadRequest[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [shareInfo, setShareInfo] = useState<IncomingShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState(q);
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  const dragDepth = useRef(0);
  const lastEmptyTap = useRef(-Infinity);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => setView(ReadView()), []);
  const ChangeView = (next: "list" | "grid") => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const Reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const scope = { all, share };

  // Při změně složky začít načítat nanovo a zrušit výběr.
  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    setAnchor(null);
    setFilter(q);
  }, [path, all, share, q]);

  useEffect(() => {
    setShareInfo(null);
    if (!share) return;
    ApiFetch<IncomingShare[]>("/api/user-shares/incoming").then((result) => result.ok && setShareInfo(result.body.find((item) => item.id === share) ?? null));
  }, [share]);

  useEffect(() => {
    let cancelled = false;
    const url = q ? `/api/files/search${Query({ path, q, all, share })}` : `/api/files${Query({ path, all, share })}`;
    ApiFetch<{ entries: Entry[]; readOnly: boolean; truncated?: boolean; people: Record<string, Person> }>(url).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setError(ErrorText(result));
      setError(null);
      setEntries(result.body.entries);
      setPeople(result.body.people ?? {});
      setReadOnly(result.body.readOnly);
      setTruncated(!!result.body.truncated);
      // Po obnovení nechat označené jen to, co ještě existuje.
      const names = new Set(result.body.entries.map((entry) => entry.name));
      setSelected((current) => new Set([...current].filter((name) => names.has(name))));
    });
    return () => {
      cancelled = true;
    };
  }, [path, all, share, q, reloadKey, uploads.version]);

  // "Vyhledat ve složce": po otevření složky skočit kurzorem do hledání.
  useEffect(() => {
    if (focusSearch && entries) {
      searchInput.current?.focus();
      setFocusSearch(false);
    }
  }, [focusSearch, entries]);

  const visible = useMemo(() => {
    // Výsledky hledání už filtruje server, živý filtr jen v běžné složce.
    const needle = q ? "" : filter.trim().toLocaleLowerCase("cs");
    const filtered = (entries ?? []).filter((entry) => !needle || entry.name.toLocaleLowerCase("cs").includes(needle));
    return SortEntries(filtered, sort);
  }, [entries, filter, sort, q]);

  // Názvy vybraných složek (první část cesty) v pořadí výběru.
  const pickedFolders = useMemo(() => [...new Set(folderPick.map((item) => item.relative.split("/")[0]))], [folderPick]);

  const previewable = useMemo(() => visible.filter(CanPreview), [visible]);
  const selectedEntries = visible.filter((entry) => selected.has(entry.name));

  const Navigate = useCallback(
    (next: string, search?: string) => router.push(`/files/${Query({ path: next, all: all ? "1" : undefined, share, q: search })}`),
    [router, all, share],
  );
  const FileUrl = (entry: Entry, inline: boolean) => `/api/files/download${Query({ path: JoinPath(path, entry.name), all, share, inline })}`;
  // Víc položek nebo složka -> ZIP (parametr `paths` se opakuje)
  const ZipUrl = (targets: Entry[]) => {
    const search = new URLSearchParams(Query({ all, share }).slice(1));
    for (const entry of targets) search.append("paths", JoinPath(path, entry.name));
    return `/api/files/zip?${search}`;
  };

  function Open(entry: Entry) {
    if (entry.isDir) return Navigate(JoinPath(path, entry.name));
    const index = previewable.findIndex((item) => item.name === entry.name);
    if (index >= 0) setPreview(index);
    else Download([entry]);
  }

  function Download(targets: Entry[]) {
    if (!targets.length) return;
    const link = document.createElement("a");
    const single = targets.length === 1 && !targets[0].isDir;
    link.href = single ? FileUrl(targets[0], false) : ZipUrl(targets);
    if (single) link.download = BaseName(targets[0].name);
    link.click();
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

  // Struktura podle Google Drive: podmenu Sdílet / Uspořádat / Informace.
  function ActionsFor(targets: Entry[]): Action[] {
    if (!targets.length) return [];
    const single = targets.length === 1 ? targets[0] : null;
    const allStarred = targets.every((entry) => entry.starred);
    const star: Action = { id: allStarred ? "unstar" : "star", label: allStarred ? t("Remove star", "Odebrat hvězdičku") : t("Add star", "Označit hvězdičkou"), icon: allStarred ? "star_half" : "star" };
    const canShare = !readOnly && !share;
    const download: Action = {
      id: "download",
      label: single && !single.isDir ? t("Download", "Stáhnout") : t("Download as ZIP", "Stáhnout jako ZIP"),
      icon: single && !single.isDir ? "download" : "folder_zip",
    };
    const shareMenu: Action = {
      id: "shareMenu",
      label: t("Share", "Sdílet"),
      icon: "person_add",
      separated: true,
      children: [
        { id: "shareUsers", label: t("Share with users", "Sdílet s uživateli"), icon: "group_add" },
        { id: "share", label: t("Public link", "Veřejný odkaz"), icon: "link" },
      ],
    };
    const trash: Action = { id: "delete", label: t("Move to trash", "Přesunout do koše"), icon: "delete", danger: true, shortcut: "Del", separated: true };

    if (!single) {
      return [
        download,
        { id: "organize", label: t("Organize", "Uspořádat"), icon: "folder_open", separated: true, children: [...(readOnly ? [] : [{ id: "move", label: t("Move", "Přesunout"), icon: "drive_file_move" }]), star] },
        ...(readOnly ? [] : [trash]),
      ];
    }

    if (single.isDir) {
      return [
        { id: "open", label: t("Open", "Otevřít"), icon: "folder_open", shortcut: "Enter" },
        download,
        ...(readOnly ? [] : [{ id: "rename", label: t("Rename", "Přejmenovat"), icon: "edit", shortcut: "F2" }]),
        ...(canShare ? [shareMenu] : []),
        {
          id: "organize",
          label: t("Organize", "Uspořádat"),
          icon: "folder_open",
          separated: !canShare,
          children: [...(readOnly ? [] : [{ id: "move", label: t("Move", "Přesunout"), icon: "drive_file_move" }]), star],
          ...(!readOnly && { palette: { value: single.color, onPick: (color: string | null) => SetColor(single, color) } }),
        },
        {
          id: "info",
          label: t("Folder info", "Informace o složce"),
          icon: "info",
          children: [
            { id: "details", label: t("Details", "Podrobnosti"), icon: "info" },
            { id: "searchIn", label: t("Search in folder", "Vyhledat ve složce"), icon: "search" },
          ],
        },
        ...(readOnly ? [] : [trash]),
      ];
    }

    const saved = offline.IsOffline(FileUrl(single, false));
    return [
      {
        id: "openWith",
        label: t("Open with", "Otevřít pomocí"),
        icon: "open_with",
        children: [
          ...(CanPreview(single) ? [{ id: "open", label: t("Preview in Cloud", "Náhled v cloudu"), icon: "visibility" }] : []),
          { id: "newTab", label: t("Open in new tab", "Otevřít v nové kartě"), icon: "open_in_new" },
        ],
      },
      { ...download, separated: true },
      ...(readOnly
        ? []
        : [
            { id: "rename", label: t("Rename", "Přejmenovat"), icon: "edit", shortcut: "F2" },
            { id: "copy", label: t("Make a copy", "Vytvořit kopii"), icon: "content_copy" },
          ]),
      ...(canShare ? [shareMenu] : []),
      { id: "organize", label: t("Organize", "Uspořádat"), icon: "folder_open", separated: !canShare, children: [...(readOnly ? [] : [{ id: "move", label: t("Move", "Přesunout"), icon: "drive_file_move" }]), star] },
      { id: "details", label: t("File info", "Informace o souboru"), icon: "info" },
      { id: "offline", label: saved ? t("Remove from offline", "Odebrat z offline") : t("Make available offline", "Zpřístupnit offline"), icon: saved ? "offline_pin" : "download_for_offline" },
      ...(readOnly ? [] : [trash]),
    ];
  }

  const backgroundActions: Action[] = [
    ...(readOnly
      ? []
      : [
          { id: "newFolder", label: t("New folder", "Nová složka"), icon: "create_new_folder" },
          { id: "uploadFiles", label: t("Upload files", "Nahrát soubory"), icon: "upload_file" },
          { id: "uploadFolder", label: t("Upload folder", "Nahrát složku"), icon: "drive_folder_upload" },
        ]),
    { id: "refresh", label: t("Refresh", "Obnovit"), icon: "refresh", separated: !readOnly },
  ];

  function RunAction(id: string, targets: Entry[]) {
    const names = targets.map((entry) => entry.name);
    const first = targets[0];
    switch (id) {
      case "open":
        return Open(first);
      case "newTab":
        return window.open(FileUrl(first, true), "_blank", "noopener");
      case "download":
        return Download(targets);
      case "share":
        return setDialog({ kind: "share", entry: first });
      case "shareUsers":
        return setDialog({ kind: "shareUsers", entry: first });
      case "rename":
        return setDialog({ kind: "rename", entry: first });
      case "copy":
        return Copy(targets);
      case "move":
        return setDialog({ kind: "move", names });
      case "star":
      case "unstar":
        return Star(targets, id === "star");
      case "details":
        return setDialog({ kind: "details", entry: first });
      case "searchIn":
        setFocusSearch(true);
        return Navigate(JoinPath(path, first.name));
      case "offline":
        return offline.Toggle(FileUrl(first, false), BaseName(first.name));
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
    const result = await ApiFetch(url, "POST", { ...(payload as object), all, share });
    if (!result.ok) toast.danger(ErrorText(result));
    Reload();
    return result;
  }

  const PathsOf = (names: string[]) => names.map((name) => JoinPath(path, name));

  async function Delete(names: string[]) {
    setPending(true);
    const result = await Mutate("/api/files/delete", { paths: PathsOf(names) });
    setPending(false);
    setDialog(null);
    if (result.ok) toast.success(
        names.length === 1
          ? t(`“${BaseName(names[0])}” moved to trash`, `„${BaseName(names[0])}“ je v koši`)
          : t(`${names.length} items moved to trash`, `${names.length} ${Plural(names.length, ["", ""], ["položka přesunuta", "položky přesunuty", "položek přesunuto"])} do koše`),
      );
  }

  async function MoveInto(destination: string, names: string[]) {
    const result = await Mutate("/api/files/move", { paths: PathsOf(names), destination });
    if (result.ok) {
      setDialog(null);
      toast.success(
        names.length === 1
          ? t(`“${BaseName(names[0])}” moved`, `„${BaseName(names[0])}“ přesunuto`)
          : t(`${names.length} items moved`, `${names.length} ${Plural(names.length, ["", ""], ["položka přesunuta", "položky přesunuty", "položek přesunuto"])}`),
      );
    }
  }

  async function Copy(targets: Entry[]) {
    const result = await Mutate("/api/files/copy", { paths: PathsOf(targets.map((entry) => entry.name)) });
    if (result.ok) toast.success(
        targets.length === 1
          ? t(`Copy of “${BaseName(targets[0].name)}” created`, `Vytvořena kopie „${BaseName(targets[0].name)}“`)
          : t(`${targets.length} copies created`, `Vytvořeno ${targets.length} ${Plural(targets.length, ["", ""], ["kopie", "kopie", "kopií"])}`),
      );
  }

  async function Star(targets: Entry[], starred: boolean) {
    const result = await Mutate("/api/files/star", { paths: PathsOf(targets.map((entry) => entry.name)), starred });
    if (result.ok) toast.success(starred ? t("Added to Starred", "Přidáno do S hvězdičkou") : t("Removed from Starred", "Odebráno z S hvězdičkou"));
  }

  async function SetColor(entry: Entry, color: string | null) {
    await Mutate("/api/files/color", { paths: [JoinPath(path, entry.name)], color });
  }

  // ---- Klávesnice -------------------------------------------------------

  // Bez závislostí = po každém renderu znovu, takže handler vždy vidí aktuální stav
  // (dřív se registroval jednou a volal Open() se starým, prázdným seznamem).
  useEffect(() => {
    function OnKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (dialog || menu || preview !== null || target.closest("input, textarea, [role=dialog], [role=menu]")) return;
      const current = visible.filter((entry) => selected.has(entry.name));

      if (event.key === "Delete" && current.length && !readOnly) setDialog({ kind: "delete", names: current.map((e) => e.name) });
      else if (event.key === "F2" && current.length === 1 && !readOnly) setDialog({ kind: "rename", entry: current[0] });
      else if (event.key === "Enter" && current.length === 1) Open(current[0]);
      else if (event.key === "Escape") setSelected(new Set());
      else if (event.key === "a" && (event.ctrlKey || event.metaKey)) setSelected(new Set(visible.map((e) => e.name)));
      else if (event.key === "Backspace" && (path || q)) Navigate(q ? path : path.split("/").slice(0, -1).join("/"));
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
      if (!isOsDrag(event) || readOnly) return;
      dragDepth.current++;
      setDropActive(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isOsDrag(event)) return;
      dragDepth.current--;
      if (dragDepth.current <= 0) setDropActive(false);
    },
    onDragOver: (event: React.DragEvent) => {
      if (isOsDrag(event) && !readOnly) event.preventDefault();
    },
    onDrop: async (event: React.DragEvent) => {
      if (!isOsDrag(event) || readOnly) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDropActive(false);
      const files = await FilesFromDrop(event.dataTransfer);
      if (files.length) uploads.Enqueue(files, { path, all, share });
    },
  };

  const handlers: ItemHandlers = {
    selected,
    focused: anchor,
    onSelect: Select,
    setChecked: (name, checked) => {
      setAnchor(name);
      setSelected((current) => {
        if (current.has(name) === checked) return current;
        const next = new Set(current);
        if (checked) next.add(name);
        else next.delete(name);
        return next;
      });
    },
    onOpen: Open,
    onContextMenu: (entry, event) => {
      event.preventDefault();
      event.stopPropagation();
      // Bez výběru položku označit (vidět, na co se menu vztahuje). Existující výběr nechat být —
      // menu pak platí jen pro tuhle položku (menuTargets).
      if (!selected.size) {
        setSelected(new Set([entry.name]));
        setAnchor(entry.name);
      }
      setMenu({ x: event.clientX, y: event.clientY, entry });
    },
    actionsFor: (entry) => ActionsFor([entry]),
    onAction: (entry, id) => RunAction(id, [entry]),
    onDropInto: (folder, names) => MoveInto(JoinPath(path, folder), names),
    // `v` = čas změny → po přepsání souboru nový náhled, jinak z cache prohlížeče
    thumbUrl: (entry) => `/api/files/thumb${Query({ path: JoinPath(path, entry.name), all, share, v: Math.round(entry.modified) })}`,
    isOffline: (entry) => !entry.isDir && offline.IsOffline(FileUrl(entry, false)),
    ownerOf: (entry) => (entry.owner ? people[entry.owner] : null),
    readOnly,
  };

  // Cíl kontextového menu: pravý klik na označenou položku = celý výběr.
  const menuTargets = menu?.entry ? (selected.has(menu.entry.name) ? selectedEntries : [menu.entry]) : [];
  const rootTitle = share ? (shareInfo?.name ?? t("Shared folder", "Sdílená složka")) : all ? t("All files", "Všechny soubory") : t("My files", "Moje soubory");
  const description = share
    ? shareInfo &&
      `${t("Shared by", "Sdílí")} ${shareInfo.owner.name} · ${readOnly ? t("read-only", "jen pro čtení") : t("you can edit", "můžeš upravovat")}`
    : all
      ? t("The whole cloud root, including every user's folder.", "Celý kořen cloudu včetně složek všech uživatelů.")
      : undefined;
  const folderName = path.split("/").pop() || rootTitle;
  const renameEntry = dialog?.kind === "rename" ? dialog.entry : null;
  const detailsEntry = dialog?.kind === "details" ? dialog.entry : null;
  const allStarred = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.starred);

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
        if ((event.target as HTMLElement).closest("[role=option], button, input, label, a, [role=menu]")) return;
        // Výběr se ruší jen úmyslně: Ctrl/Cmd+klik do prázdna, na dotyku dvojité ťuknutí (+ Esc, ✕ v liště).
        const touch = (event.nativeEvent as PointerEvent).pointerType === "touch";
        if (event.ctrlKey || event.metaKey) setSelected(new Set());
        else if (touch && event.timeStamp - lastEmptyTap.current < 350) setSelected(new Set());
        if (touch) lastEmptyTap.current = event.timeStamp;
      }}
    >
      <PageHeader
        title={rootTitle}
        description={description}
        actions={
          !readOnly && (
            <>
              <Button variant="secondary" onPress={() => setDialog({ kind: "newFolder" })}>
                <Icon name="create_new_folder" className="text-[18px]" />
                {t("New folder", "Nová složka")}
              </Button>
              <Dropdown>
                <Button>
                  <Icon name="upload" className="text-[18px]" />
                  {t("Upload", "Nahrát")}
                  <Icon name="expand_more" className="-mr-1 text-[18px]" />
                </Button>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu aria-label={t("Upload", "Nahrát")} onAction={(key) => RunAction(String(key), [])}>
                    <Dropdown.Item id="uploadFiles" textValue={t("Files", "Soubory")}>
                      <Icon name="upload_file" className="text-[18px] text-muted" />
                      <Label>{t("Files", "Soubory")}</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="uploadFolder" textValue={t("Folder", "Složku")}>
                      <Icon name="drive_folder_upload" className="text-[18px] text-muted" />
                      <Label>{t("Folder", "Složku")}</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </>
          )
        }
      />

      <SearchField
        aria-label={t("Search this folder; Enter also searches subfolders", "Hledat v této složce, Enter hledá i v podsložkách")}
        value={filter}
        onChange={setFilter}
        // Enter = hledat i v podsložkách, psaní = živý filtr aktuální složky
        onSubmit={(value) => value.trim() && Navigate(path, value.trim())}
        onClear={() => q && Navigate(path)}
        className="w-full max-w-2xl"
      >
        <SearchField.Group className="h-11 rounded-full! px-2 shadow-sm sm:h-12">
          <SearchField.SearchIcon className="ml-1" />
          <SearchField.Input ref={searchInput} placeholder={t(`Search in “${folderName}”`, `Hledat v „${folderName}“`)} className="text-base" />
          {/* nápověda jen při psaní — Enter spustí hledání i v podsložkách */}
          {filter.trim() && filter !== q && (
            <Kbd className="hidden shrink-0 sm:inline-flex" variant="light">
              <Kbd.Content>↵ {t("incl. subfolders", "i v podsložkách")}</Kbd.Content>
            </Kbd>
          )}
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          uploads.Enqueue(FilesFromInput(event.target.files), { path, all, share });
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          const picked = FilesFromInput(event.target.files);
          // Stejná složka vybraná dvakrát se nepřidá znovu.
          const names = new Set(picked.map((item) => item.relative.split("/")[0]));
          if (picked.length) setFolderPick((current) => [...current.filter((item) => !names.has(item.relative.split("/")[0])), ...picked]);
          event.target.value = "";
        }}
      />

      {folderPick.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
          <Icon name="drive_folder_upload" className="text-accent" />
          <p className="mr-auto min-w-0 text-sm">
            <b className="break-words">{pickedFolders.join(", ")}</b>
            <span className="text-muted">
              {" · "}
              {folderPick.length} {Plural(folderPick.length, ["file", "files"], ["soubor", "soubory", "souborů"])}
            </span>
            {/* dialog prohlížeče pustí jen jednu složku, přetažení jich vezme víc naráz */}
            <span className="block text-xs text-muted max-sm:hidden">
              {t("Several folders at once: select them in your file manager and drag them here.", "Víc složek najednou: označ je v Průzkumníku a přetáhni sem.")}
            </span>
          </p>
          <Button size="sm" variant="tertiary" onPress={() => folderInput.current?.click()}>
            <Icon name="add" className="text-[18px]" />
            {t("Another folder", "Další složka")}
          </Button>
          <Button
            size="sm"
            onPress={() => {
              uploads.Enqueue(folderPick, { path, all, share });
              setFolderPick([]);
            }}
          >
            <Icon name="upload" className="text-[18px]" />
            {t("Upload", "Nahrát")}
          </Button>
          <Button size="sm" isIconOnly variant="tertiary" aria-label={t("Clear chosen folders", "Zrušit výběr složek")} onPress={() => setFolderPick([])}>
            <Icon name="close" className="text-[18px]" />
          </Button>
        </div>
      )}

      {/* Lišta výběru nahrazuje řádek s cestou — stejná výška, seznam neposkočí. */}
      <div className="flex min-h-10 flex-wrap items-center gap-3">
        {selected.size > 0 ? (
          <div className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-2xl bg-accent/10 py-1 pr-2 pl-4" role="toolbar" aria-label={t("Selection actions", "Akce s výběrem")}>
            <span className="mr-auto text-sm font-medium text-accent">
              {t("Selected", "Označeno")}: {selected.size}
              <span className="hidden font-normal text-muted lg:inline">
                {" · "}
                {t("click adds/removes, Esc or ✕ clears", "klik přidá/odebere, Esc nebo ✕ zruší výběr")}
              </span>
            </span>
            <Button size="sm" variant="tertiary" onPress={() => Download(selectedEntries)}>
              <Icon name={selectedEntries.length === 1 && !selectedEntries[0].isDir ? "download" : "folder_zip"} className="text-[18px]" />
              <span className="hidden sm:inline">{t("Download", "Stáhnout")}</span>
            </Button>
            {selectedEntries.length === 1 && !share && !readOnly && (
              <Button size="sm" variant="tertiary" onPress={() => RunAction("shareUsers", selectedEntries)}>
                <Icon name="group_add" className="text-[18px]" />
                <span className="hidden sm:inline">{t("Share", "Sdílet")}</span>
              </Button>
            )}
            <Button size="sm" variant="tertiary" onPress={() => Star(selectedEntries, !allStarred)}>
              <Icon name={allStarred ? "star_half" : "star"} className="text-[18px]" />
              <span className="hidden sm:inline">{allStarred ? t("Remove star", "Odebrat hvězdičku") : t("Star", "Hvězdička")}</span>
            </Button>
            {!readOnly && (
              <>
                <Button size="sm" variant="tertiary" onPress={() => RunAction("move", selectedEntries)}>
                  <Icon name="drive_file_move" className="text-[18px]" />
                  <span className="hidden sm:inline">{t("Move", "Přesunout")}</span>
                </Button>
                <Button size="sm" variant="tertiary" onPress={() => RunAction("delete", selectedEntries)} className="text-danger!">
                  <Icon name="delete" className="text-[18px]" />
                  <span className="hidden sm:inline">{t("Delete", "Smazat")}</span>
                </Button>
              </>
            )}
            <Button size="sm" isIconOnly variant="tertiary" aria-label={t("Clear selection (Esc)", "Zrušit výběr (Esc)")} onPress={() => setSelected(new Set())}>
              <Icon name="close" className="text-[18px]" />
            </Button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1 overflow-hidden">
              <PathBreadcrumbs path={path} rootLabel={rootTitle} onNavigate={(next) => Navigate(next)} />
            </div>
            <Dropdown>
              {/* V seznamu na širší obrazovce se řadí klikem na hlavičku sloupce. */}
              <Button size="sm" variant="tertiary" aria-label={`${t("Sort by", "Řadit podle")}: ${SortLabels()[sort.key]}`} className={view === "grid" ? "" : "sm:hidden"}>
                <Icon name="swap_vert" className="text-[18px]" />
                {/* Na mobilu jen ikony — na název sloupce v řádku s cestou není místo. */}
                <span className="hidden sm:inline">{SortLabels()[sort.key]}</span>
                <Icon name={sort.dir === 1 ? "arrow_upward" : "arrow_downward"} className="-mr-1 text-[16px] text-muted" />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label={t("Sort by", "Řadit podle")}
                  // Stejný sloupec znovu = obrátit směr (jako klik na hlavičku).
                  onAction={(key) => setSort((current) => ({ key: key as SortKey, dir: current.key === key ? ((current.dir * -1) as 1 | -1) : 1 }))}
                >
                  {(Object.keys(SortLabels()) as SortKey[]).map((key) => (
                    <Dropdown.Item key={key} id={key} textValue={SortLabels()[key]}>
                      <Icon
                        name={sort.dir === 1 ? "arrow_upward" : "arrow_downward"}
                        className={`text-[18px] text-muted ${sort.key === key ? "" : "invisible"}`}
                      />
                      <Label>{SortLabels()[key]}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <ToggleButtonGroup
              aria-label={t("View", "Zobrazení")}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([view])}
              onSelectionChange={(keys) => ChangeView([...keys][0] as "list" | "grid")}
              size="sm"
            >
              <ToggleButton id="list" isIconOnly aria-label={t("List", "Seznam")}>
                <Icon name="view_list" className="text-[20px]" />
              </ToggleButton>
              <ToggleButton id="grid" isIconOnly aria-label={t("Grid", "Mřížka")}>
                <ToggleButtonGroup.Separator />
                <Icon name="grid_view" className="text-[20px]" />
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        )}
      </div>

      {q && (
        <div className="-mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Icon name="manage_search" className="text-[20px] text-accent" />
          <span>
            {t("Results for", "Výsledky pro")} „<b>{q}</b>“ {t("in", "ve složce")} „{folderName}“ {t("and subfolders", "a podsložkách")}
            {entries && (
              <span className="text-muted">
                {" · "}
                {truncated ? t("first ", "prvních ") : ""}
                {entries.length}
              </span>
            )}
          </span>
          <Button size="sm" variant="ghost" onPress={() => Navigate(path)}>
            {t("Clear search", "Zrušit hledání")}
          </Button>
        </div>
      )}

      <div className="flex-1">
        {error ? (
          <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
            <Icon name="error" className="text-[48px] text-danger" />
            <p className="font-medium">{t("Couldn't load the folder", "Složku se nepodařilo načíst")}</p>
            <p className="text-sm text-muted">{error}</p>
            <div className="mt-2 flex gap-2">
              {path && (
                <Button variant="secondary" onPress={() => Navigate("")}>
                  {t("Back to start", "Na začátek")}
                </Button>
              )}
              <Button onPress={Reload}>{t("Try again", "Zkusit znovu")}</Button>
            </div>
          </EmptyState>
        ) : !entries ? (
          <div className="flex flex-col gap-2 pt-10">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-accent/10">
              <Icon name={filter || q ? "search_off" : "cloud_upload"} className="text-[32px] text-accent" />
            </span>
            <p className="font-medium">{filter || q ? t("Nothing found", "Nic nenalezeno") : t("This folder is empty", "Složka je prázdná")}</p>
            <p className="max-w-xs text-sm text-muted">
              {q
                ? t(`Nothing in “${folderName}” or its subfolders matches “${q}”.`, `Ve složce „${folderName}“ ani jejích podsložkách nic neodpovídá „${q}“.`)
                : filter
                  ? t(`Nothing in this folder matches “${filter}”. Press Enter to search subfolders too.`, `V téhle složce nic neodpovídá „${filter}“. Enterem hledáš i v podsložkách.`)
                  : readOnly
                    ? t("When the owner uploads something, you'll see it here.", "Až sem vlastník něco nahraje, uvidíš to tady.")
                    : t("Drag files or folders here, or use the Upload button.", "Přetáhni sem soubory nebo složky, nebo použij tlačítko Nahrát.")}
            </p>
            {!filter && !q && !readOnly && (
              <Button className="mt-2" onPress={() => fileInput.current?.click()}>
                <Icon name="upload" className="text-[18px]" />
                {t("Upload files", "Nahrát soubory")}
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
            <p className="font-medium">{t(`Drop files to upload to “${folderName}”`, `Pusť soubory pro nahrání do „${folderName}“`)}</p>
          </div>
        </div>
      )}

      <ContextMenu
        position={menu}
        actions={menu?.entry ? ActionsFor(menuTargets) : backgroundActions}
        onAction={(id) => RunAction(id, menuTargets)}
        onClose={() => setMenu(null)}
      />

      <NameDialog
        isOpen={dialog?.kind === "newFolder"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("New folder", "Nová složka")}
        initial=""
        confirmLabel={t("Create", "Vytvořit")}
        onSubmit={async (name) => {
          const result = await ApiFetch("/api/files/folder", "POST", { path, name, all, share });
          if (!result.ok) return ErrorText(result);
          setDialog(null);
          Reload();
          return null;
        }}
      />
      <NameDialog
        isOpen={!!renameEntry}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("Rename", "Přejmenovat")}
        initial={renameEntry ? BaseName(renameEntry.name) : ""}
        confirmLabel={t("Rename", "Přejmenovat")}
        onSubmit={async (name) => {
          if (!renameEntry || name === BaseName(renameEntry.name)) return setDialog(null), null;
          const result = await ApiFetch("/api/files/rename", "POST", { path: JoinPath(path, renameEntry.name), name, all, share });
          if (!result.ok) return ErrorText(result);
          setDialog(null);
          if (!q) setSelected(new Set([name]));
          Reload();
          return null;
        }}
      />
      <MoveDialog
        isOpen={dialog?.kind === "move"}
        onOpenChange={(open) => !open && setDialog(null)}
        all={all}
        share={share}
        rootLabel={rootTitle}
        startPath={path}
        moving={dialog?.kind === "move" ? PathsOf(dialog.names) : []}
        onMove={(destination) => MoveInto(destination, dialog?.kind === "move" ? dialog.names : [])}
      />
      <ShareDialog
        isOpen={dialog?.kind === "share"}
        onOpenChange={(open) => !open && setDialog(null)}
        all={all}
        target={dialog?.kind === "share" ? { path: JoinPath(path, dialog.entry.name), name: BaseName(dialog.entry.name), isDir: dialog.entry.isDir } : null}
      />
      <UserShareDialog
        isOpen={dialog?.kind === "shareUsers"}
        onOpenChange={(open) => !open && setDialog(null)}
        all={all}
        target={dialog?.kind === "shareUsers" ? { path: JoinPath(path, dialog.entry.name), name: BaseName(dialog.entry.name), isDir: dialog.entry.isDir } : null}
      />
      <DetailsDialog
        target={detailsEntry && { path: JoinPath(path, detailsEntry.name), name: BaseName(detailsEntry.name), isDir: detailsEntry.isDir, color: detailsEntry.color }}
        scope={scope}
        location={[rootTitle, ...JoinPath(path, detailsEntry?.name ?? "").split("/").slice(0, -1)].filter(Boolean).join(" / ")}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        isOpen={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        heading={
          dialog?.kind === "delete" && dialog.names.length === 1
            ? t(`Move “${BaseName(dialog.names[0])}” to trash?`, `Přesunout „${BaseName(dialog.names[0])}“ do koše?`)
            : t(`Move ${dialog?.kind === "delete" ? dialog.names.length : 0} items to trash?`, `Přesunout ${dialog?.kind === "delete" ? dialog.names.length : 0} položek do koše?`)
        }
        confirmLabel={t("Move to trash", "Přesunout do koše")}
        isPending={pending}
        onConfirm={() => dialog?.kind === "delete" && Delete(dialog.names)}
      >
        {t("You can restore them from the trash for 30 days, then they're deleted for good.", "Z koše je můžeš 30 dní obnovit, potom se smažou natrvalo.")}
      </ConfirmDialog>

      <PreviewModal entries={previewable} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)} urlFor={FileUrl} />
    </div>
  );
}
