"use client";

import { Checkbox } from "@heroui/react";
import { type Entry, FormatBytes, FormatDate, KindOf } from "@/lib/format";
import { FileIcon } from "../FileIcon";
import { Icon } from "../Icon";
import { type Person, PersonLabel, UserAvatar } from "../UserAvatar";
import { type Action, MoreButton } from "./ActionMenu";

export type SortKey = "name" | "modified" | "size";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

export const DRAG_TYPE = "application/x-cloud-items";

// Sloupce seznamu: [checkbox] název [vlastník] [změněno velikost] akce. Vlastník od md, datum a velikost od sm.
// Celé literály kvůli Tailwindu (poskládané třídy by nevygeneroval).
const COLUMNS = {
  select: {
    owner: "grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_10rem_6rem_auto] md:grid-cols-[auto_1fr_11rem_10rem_6rem_auto]",
    plain: "grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_10rem_6rem_auto]",
  },
  readOnly: {
    owner: "grid-cols-[1fr_auto] sm:grid-cols-[1fr_10rem_6rem_auto] md:grid-cols-[1fr_11rem_10rem_6rem_auto]",
    plain: "grid-cols-[1fr_auto] sm:grid-cols-[1fr_10rem_6rem_auto]",
  },
};
const Columns = (handlers: ItemHandlers) => COLUMNS[handlers.readOnly ? "readOnly" : "select"][handlers.ownerOf ? "owner" : "plain"];

export interface ItemHandlers {
  selected: Set<string>;
  focused: string | null;
  // modifikátory z události: ctrl/meta přidá, shift rozsah
  onSelect: (name: string, mode: "replace" | "toggle" | "range") => void;
  onOpen: (entry: Entry) => void;
  onContextMenu: (entry: Entry, event: React.MouseEvent) => void;
  actionsFor: (entry: Entry) => Action[];
  onAction: (entry: Entry, id: string) => void;
  // přetažení položek (názvy) do složky
  onDropInto: (folder: string, names: string[]) => void;
  thumbUrl?: (entry: Entry) => string;
  isOffline?: (entry: Entry) => boolean;
  // vlastník položky (jméno + avatar); bez něj se sloupec Vlastník nezobrazí (veřejné sdílení)
  ownerOf?: (entry: Entry) => Person | null | undefined;
  readOnly?: boolean;
}

// Název s odznaky. Ve výsledcích hledání je `name` cesta ("2024/leto.jpg") → složka šedě před názvem.
function NameLabel({ entry, handlers, className = "" }: { entry: Entry; handlers: ItemHandlers; className?: string }) {
  const slash = entry.name.lastIndexOf("/");
  const base = entry.name.slice(slash + 1);
  const parent = slash > 0 ? entry.name.slice(0, slash) : "";
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate" title={entry.name}>
        {parent && <span className="text-muted">{parent}/</span>}
        {base}
      </span>
      {entry.starred && <Icon name="star" filled className="shrink-0 text-[15px] text-amber-400" />}
      {handlers.isOffline?.(entry) && <Icon name="offline_pin" filled className="shrink-0 text-[15px] text-success" />}
    </span>
  );
}

function ClickMode(event: React.MouseEvent) {
  return event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace";
}

// Společné chování řádku v seznamu i dlaždice v mřížce.
function useItemProps(entry: Entry, handlers: ItemHandlers) {
  const selected = handlers.selected.has(entry.name);
  return {
    role: "option",
    "aria-label": entry.isDir ? `Složka ${entry.name}` : entry.name,
    "aria-selected": selected,
    "data-name": entry.name,
    tabIndex: -1,
    draggable: !handlers.readOnly,
    onClick: (event: React.MouseEvent) => {
      // Na dotyku se neoznačuje, ale rovnou otevírá (dvojklik prstem je nepohodlný).
      // Veřejné sdílení nemá výběr — klik rovnou otevírá.
      if (handlers.readOnly || ((event.nativeEvent as PointerEvent).pointerType === "touch" && !handlers.selected.size)) return handlers.onOpen(entry);
      handlers.onSelect(entry.name, ClickMode(event));
    },
    onDoubleClick: () => handlers.onOpen(entry),
    onContextMenu: (event: React.MouseEvent) => handlers.onContextMenu(entry, event),
    onDragStart: (event: React.DragEvent) => {
      const names = selected ? [...handlers.selected] : [entry.name];
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(names));
      event.dataTransfer.effectAllowed = "move";
    },
    ...(entry.isDir && !handlers.readOnly
      ? {
          onDragOver: (event: React.DragEvent) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            event.currentTarget.setAttribute("data-drop", "true");
          },
          onDragLeave: (event: React.DragEvent) => event.currentTarget.removeAttribute("data-drop"),
          onDrop: (event: React.DragEvent) => {
            event.currentTarget.removeAttribute("data-drop");
            const data = event.dataTransfer.getData(DRAG_TYPE);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            const names = (JSON.parse(data) as string[]).filter((name) => name !== entry.name);
            if (names.length) handlers.onDropInto(entry.name, names);
          },
        }
      : {}),
  };
}

function SortHeader({ label, sortKey, sort, onSort, className = "" }: { label: string; sortKey: SortKey; sort: Sort; onSort: (sort: Sort) => void; className?: string }) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: sortKey, dir: active ? (-sort.dir as 1 | -1) : 1 })}
      className={`flex items-center gap-1 rounded px-1 text-xs font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus ${className}`}
    >
      {label}
      <Icon name={active && sort.dir === -1 ? "arrow_downward" : "arrow_upward"} className={`text-[14px] ${active ? "" : "invisible"}`} />
    </button>
  );
}

function SelectBox({ entry, handlers }: { entry: Entry; handlers: ItemHandlers }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: jen zastaví klik, aby se nepropsal do řádku
    <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} className="flex">
      <Checkbox
        aria-label={`Označit ${entry.name}`}
        isSelected={handlers.selected.has(entry.name)}
        onChange={() => handlers.onSelect(entry.name, "toggle")}
      >
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox>
    </span>
  );
}

function ListRow({ entry, handlers }: { entry: Entry; handlers: ItemHandlers }) {
  const props = useItemProps(entry, handlers);
  const selected = props["aria-selected"];
  return (
    <div
      {...props}
      className={`group grid cursor-default ${Columns(handlers)} items-center gap-3 rounded-xl px-2 py-1.5 select-none data-[drop=true]:bg-accent/15 data-[drop=true]:ring-2 data-[drop=true]:ring-accent ${
        selected ? "bg-accent/10" : "hover:bg-default/60"
      } ${handlers.focused === entry.name ? "outline-2 -outline-offset-2 outline-focus/50" : ""}`}
    >
      {!handlers.readOnly && <SelectBox entry={entry} handlers={handlers} />}
      <div className="flex min-w-0 items-center gap-3">
        <FileIcon name={entry.name} isDir={entry.isDir} color={entry.color} className="shrink-0 text-[24px]" />
        <div className="min-w-0">
          <NameLabel entry={entry} handlers={handlers} className="text-sm" />
          {/* na mobilu metadata pod názvem místo sloupců */}
          <p className="text-xs text-muted sm:hidden">
            {handlers.ownerOf && `${handlers.ownerOf(entry)?.name ?? "—"} · `}
            {FormatDate(entry.modified)}
            {!entry.isDir && ` · ${FormatBytes(entry.size)}`}
          </p>
        </div>
      </div>
      {handlers.ownerOf && <PersonLabel person={handlers.ownerOf(entry)} className="hidden text-xs md:flex" />}
      <span className="hidden text-xs text-muted tabular-nums sm:block">{FormatDate(entry.modified)}</span>
      <span className="hidden text-right text-xs text-muted tabular-nums sm:block">{entry.isDir ? "—" : FormatBytes(entry.size)}</span>
      <MoreButton label={`Akce pro ${entry.name}`} actions={handlers.actionsFor(entry)} onAction={(id) => handlers.onAction(entry, id)} />
    </div>
  );
}

function GridTile({ entry, handlers }: { entry: Entry; handlers: ItemHandlers }) {
  const props = useItemProps(entry, handlers);
  const selected = props["aria-selected"];
  const showThumb = handlers.thumbUrl && KindOf(entry) === "image";
  return (
    <div
      {...props}
      className={`group relative flex cursor-default flex-col overflow-hidden rounded-2xl border select-none data-[drop=true]:border-accent data-[drop=true]:bg-accent/15 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-muted/40"
      } ${handlers.focused === entry.name ? "outline-2 outline-offset-2 outline-focus/50" : ""}`}
    >
      {handlers.ownerOf?.(entry) && (
        <div className="absolute top-2 right-2 z-10" title={handlers.ownerOf(entry)?.name}>
          <UserAvatar person={handlers.ownerOf(entry)} className="size-7! text-[11px]! ring-2 ring-surface" />
        </div>
      )}
      <div className="grid aspect-4/3 place-items-center overflow-hidden bg-surface-secondary">
        {showThumb ? (
          // ponytail: náhled = originál s loading="lazy"; generovat miniatury, až to bude na mobilních datech pomalé
          <img src={handlers.thumbUrl?.(entry)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <FileIcon name={entry.name} isDir={entry.isDir} color={entry.color} className="text-[48px]" />
        )}
      </div>
      <div className="flex items-center gap-1 py-1.5 pr-1 pl-3">
        <NameLabel entry={entry} handlers={handlers} className="flex-1 text-sm" />
        <MoreButton label={`Akce pro ${entry.name}`} actions={handlers.actionsFor(entry)} onAction={(id) => handlers.onAction(entry, id)} />
      </div>
      {!handlers.readOnly && (
        <div className={`absolute top-2 left-2 z-10 rounded-md bg-surface/80 p-0.5 backdrop-blur ${selected ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
          <SelectBox entry={entry} handlers={handlers} />
        </div>
      )}
    </div>
  );
}

export function FileItems({
  entries,
  view,
  sort,
  onSort,
  handlers,
  allSelected,
  onSelectAll,
}: {
  entries: Entry[];
  view: "list" | "grid";
  sort: Sort;
  onSort: (sort: Sort) => void;
  handlers: ItemHandlers;
  allSelected: boolean;
  onSelectAll: (select: boolean) => void;
}) {
  if (view === "grid") {
    return (
      <div role="listbox" aria-label="Soubory" aria-multiselectable className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
        {entries.map((entry) => (
          <GridTile key={entry.name} entry={entry} handlers={handlers} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className={`sticky top-14 z-10 grid ${Columns(handlers)} items-center gap-3 border-b border-separator bg-background px-2 py-2 lg:top-0`}>
        {!handlers.readOnly && (
          <Checkbox aria-label="Označit vše" isSelected={allSelected} isIndeterminate={!allSelected && handlers.selected.size > 0} onChange={onSelectAll}>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox>
        )}
        <SortHeader label="Název" sortKey="name" sort={sort} onSort={onSort} />
        {handlers.ownerOf && <span className="hidden px-1 text-xs font-medium text-muted md:block">Vlastník</span>}
        <SortHeader label="Změněno" sortKey="modified" sort={sort} onSort={onSort} className="hidden sm:flex" />
        <SortHeader label="Velikost" sortKey="size" sort={sort} onSort={onSort} className="hidden justify-self-end sm:flex" />
        <span className="w-8" />
      </div>
      <div role="listbox" aria-label="Soubory" aria-multiselectable className="flex flex-col gap-0.5 pt-1">
        {entries.map((entry) => (
          <ListRow key={entry.name} entry={entry} handlers={handlers} />
        ))}
      </div>
    </div>
  );
}

export function SortEntries(entries: Entry[], sort: Sort) {
  return [...entries].sort((a, b) => {
    // složky vždy nahoře
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const diff =
      sort.key === "name" ? a.name.localeCompare(b.name, "cs", { numeric: true }) : sort.key === "size" ? a.size - b.size : a.modified - b.modified;
    return diff * sort.dir || a.name.localeCompare(b.name, "cs", { numeric: true });
  });
}
