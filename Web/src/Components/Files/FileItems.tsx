"use client";

import { Checkbox } from "@heroui/react";
import { type ReactNode, useState } from "react";
import { useTouch } from "@/lib/touch";
import { type Entry, FormatBytes, FormatDate, FormatDateShort, HasThumb, KindOf } from "@/lib/format";
import { FileIcon } from "../FileIcon";
import { Icon } from "../Icon";
import { type Person, PersonLabel, UserAvatar } from "../UserAvatar";
import { type Action, MoreButton } from "./ActionMenu";
import { Plural, t } from "@/lib/i18n";

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
  // nastavit konkrétní stav (tažení přes checkboxy); bez něj se tažením neoznačuje
  setChecked?: (name: string, checked: boolean) => void;
  onOpen: (entry: Entry) => void;
  onContextMenu: (entry: Entry, event: React.MouseEvent) => void;
  actionsFor: (entry: Entry) => Action[];
  onAction: (entry: Entry, id: string) => void;
  // přetažení položek (názvy) do složky
  onDropInto: (folder: string, names: string[]) => void;
  // náhled (fotka / snímek videa / cover hudby); bez něj se ukazují ikony
  thumbUrl?: (entry: Entry) => string;
  isOffline?: (entry: Entry) => boolean;
  // vlastník položky (jméno + avatar); bez něj se sloupec Vlastník nezobrazí (veřejné sdílení)
  ownerOf?: (entry: Entry) => Person | null | undefined;
  readOnly?: boolean;
}

// Náhled od serveru, dokud se nepodaří načíst (404 = náhled není) → ikona typu jako záloha.
function Cover({ url, className, fallback }: { url?: string; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return fallback;
  return <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className={className} />;
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
// "Malování" výběru: stisk na checkboxu + tažení přes další položky jim nastaví stejný stav
// (první byl prázdný -> označuje, byl zaškrtnutý -> odznačuje). Jedno tažení naráz, stačí modul.
let paint: { checked: boolean } | null = null;

function StartPaint(entry: Entry, handlers: ItemHandlers, event: React.PointerEvent) {
  if (!handlers.setChecked || event.button !== 0 || event.pointerType === "touch") return;
  // bez tohohle by prohlížeč začal táhnout celý řádek (drag & drop) nebo označovat text
  event.preventDefault();
  paint = { checked: !handlers.selected.has(entry.name) };
  handlers.setChecked(entry.name, paint.checked);
  window.addEventListener("pointerup", () => (paint = null), { once: true });
}

// Dotyk: krátké ťuknutí otevírá, podržení označí a tažením prstu přes seznam se označují další.
const LONG_PRESS_MS = 450;
// Po podržení přijde ještě click (zvednutí prstu) — ten se nesmí brát jako ťuknutí.
let ignoreClickUntil = 0;

function StartLongPress(entry: Entry, handlers: ItemHandlers, event: React.PointerEvent) {
  const setChecked = handlers.setChecked;
  if (event.pointerType !== "touch" || !setChecked) return;
  const [startX, startY] = [event.clientX, event.clientY];
  const Cancel = () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointermove", OnMove);
    window.removeEventListener("pointerup", Cancel);
    window.removeEventListener("pointercancel", Cancel);
  };
  // Prst se pohnul dřív, než podržení doběhlo = posouvání stránky, ne výběr.
  const OnMove = (move: PointerEvent) => {
    if (Math.hypot(move.clientX - startX, move.clientY - startY) > 10) Cancel();
  };
  const timer = window.setTimeout(() => {
    Cancel();
    navigator.vibrate?.(15);
    setChecked(entry.name, true);
    // ponytail: bez automatického posouvání u okraje seznamu; přidat, až bude potřeba označovat dlouhé seznamy
    const OnTouchMove = (touchMove: TouchEvent) => {
      touchMove.preventDefault(); // prst teď táhne výběr, ne stránku
      const touch = touchMove.touches[0];
      const name = (document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-name]")?.dataset.name;
      if (name) setChecked(name, true);
    };
    const End = () => {
      document.removeEventListener("touchmove", OnTouchMove);
      document.removeEventListener("touchend", End);
      document.removeEventListener("touchcancel", End);
      ignoreClickUntil = Date.now() + 600;
    };
    document.addEventListener("touchmove", OnTouchMove, { passive: false });
    document.addEventListener("touchend", End);
    document.addEventListener("touchcancel", End);
  }, LONG_PRESS_MS);
  window.addEventListener("pointermove", OnMove);
  window.addEventListener("pointerup", Cancel);
  window.addEventListener("pointercancel", Cancel);
}

function useItemProps(entry: Entry, handlers: ItemHandlers) {
  const touch = useTouch();
  const selected = handlers.selected.has(entry.name);
  return {
    role: "option",
    "aria-label": entry.isDir ? `${t("Folder", "Složka")} ${entry.name}` : entry.name,
    "aria-selected": selected,
    "data-name": entry.name,
    tabIndex: -1,
    // přesouvání tažením jen myší — na dotyku podržení a tažení označuje
    draggable: !handlers.readOnly && !touch,
    onPointerDown: (event: React.PointerEvent) => StartLongPress(entry, handlers, event),
    onClick: (event: React.MouseEvent) => {
      if (Date.now() < ignoreClickUntil) return;
      // Veřejné sdílení nemá výběr — klik rovnou otevírá.
      // Na dotyku bez výběru ťuknutí rovnou otevírá (dvojklik prstem je nepohodlný).
      if (handlers.readOnly || ((event.nativeEvent as PointerEvent).pointerType === "touch" && !handlers.selected.size)) return handlers.onOpen(entry);
      // Klik označuje, dvojklik otevírá. Když už je něco označené, klik položku jen přidá/odebere —
      // výběr se tak nedá omylem "odkliknout". Druhý klik dvojkliku (detail 2) výběr nemění.
      if (event.detail > 1) return;
      const mode = ClickMode(event);
      handlers.onSelect(entry.name, mode === "replace" && handlers.selected.size ? "toggle" : mode);
    },
    onDoubleClick: () => handlers.onOpen(entry),
    // `buttons & 1` = levé tlačítko pořád drží (pointerup mimo okno by jinak nechal malování zapnuté)
    onPointerEnter: (event: React.PointerEvent) => {
      if (!paint) return;
      if (event.buttons & 1) handlers.setChecked?.(entry.name, paint.checked);
      else paint = null;
    },
    onContextMenu: (event: React.MouseEvent) => {
      // Podržení prstem vyvolá i contextmenu — na dotyku podržení označuje, menu je pod ⋮.
      if (touch) return event.preventDefault();
      handlers.onContextMenu(entry, event);
    },
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
    <span
      // capture: checkbox (react-aria usePress) zastaví bublání pointerdown, wrapper by ho neviděl
      onPointerDownCapture={(event) => StartPaint(entry, handlers, event)}
      onClickCapture={(event) => {
        // Myší klik už stav nastavil v StartPaint — label by ho jinak přepnul zpátky.
        // Klávesnice (mezerník, detail = 0) jde dál přes onChange.
        if (handlers.setChecked && event.detail > 0 && (event.nativeEvent as PointerEvent).pointerType !== "touch") {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="flex"
    >
      <Checkbox
        aria-label={`${t("Select", "Označit")} ${entry.name}`}
        isSelected={handlers.selected.has(entry.name)}
        onChange={() => handlers.onSelect(entry.name, "toggle")}
      >
        {/* Content = klikací label se skrytým inputem; bez něj checkbox na klik nereaguje */}
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox.Content>
      </Checkbox>
    </span>
  );
}

// U složky počet položek uvnitř místo velikosti (velikost = průchod celým stromem).
const SizeLabel = (entry: Entry) =>
  entry.isDir ? `${entry.items ?? 0} ${Plural(entry.items ?? 0, ["item", "items"], ["položka", "položky", "položek"])}` : FormatBytes(entry.size);

function ListRow({ entry, handlers }: { entry: Entry; handlers: ItemHandlers }) {
  const props = useItemProps(entry, handlers);
  const selected = props["aria-selected"];
  return (
    <div
      {...props}
      className={`group grid cursor-default [-webkit-touch-callout:none] ${Columns(handlers)} items-center gap-3 rounded-xl px-2 py-1.5 select-none data-[drop=true]:bg-accent/15 data-[drop=true]:ring-2 data-[drop=true]:ring-accent ${
        selected ? "bg-accent/10" : "hover:bg-default/60"
      } ${handlers.focused === entry.name ? "outline-2 -outline-offset-2 outline-focus/50" : ""}`}
    >
      {!handlers.readOnly && <SelectBox entry={entry} handlers={handlers} />}
      <div className="flex min-w-0 items-center gap-3">
        <Cover
          key={handlers.thumbUrl?.(entry)}
          url={HasThumb(entry) ? handlers.thumbUrl?.(entry) : undefined}
          className="size-7 shrink-0 rounded-md bg-surface-secondary object-cover"
          fallback={<FileIcon name={entry.name} isDir={entry.isDir} color={entry.color} className="shrink-0 text-[24px]" />}
        />
        <div className="min-w-0">
          <NameLabel entry={entry} handlers={handlers} className="text-sm" />
          {/* na mobilu metadata pod názvem místo sloupců */}
          <p className="truncate text-xs text-muted sm:hidden">
            {FormatDateShort(entry.modified)}
            {` · ${SizeLabel(entry)}`}
            {handlers.ownerOf && ` · ${handlers.ownerOf(entry)?.name ?? "—"}`}
          </p>
        </div>
      </div>
      {handlers.ownerOf && <PersonLabel person={handlers.ownerOf(entry)} className="hidden text-xs md:flex" />}
      <span className="hidden text-xs text-muted tabular-nums sm:block">{FormatDate(entry.modified)}</span>
      <span className="hidden text-right text-xs text-muted tabular-nums sm:block">{SizeLabel(entry)}</span>
      <MoreButton label={`${t("Actions for", "Akce pro")} ${entry.name}`} actions={handlers.actionsFor(entry)} onAction={(id) => handlers.onAction(entry, id)} />
    </div>
  );
}

function GridTile({ entry, handlers }: { entry: Entry; handlers: ItemHandlers }) {
  const props = useItemProps(entry, handlers);
  const selected = props["aria-selected"];
  const kind = KindOf(entry);
  return (
    <div
      {...props}
      className={`group relative flex cursor-default [-webkit-touch-callout:none] flex-col overflow-hidden rounded-2xl border select-none data-[drop=true]:border-accent data-[drop=true]:bg-accent/15 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-muted/40"
      } ${handlers.focused === entry.name ? "outline-2 outline-offset-2 outline-focus/50" : ""}`}
    >
      {handlers.ownerOf?.(entry) && (
        <div className="absolute top-2 right-2 z-10" title={handlers.ownerOf(entry)?.name}>
          <UserAvatar person={handlers.ownerOf(entry)} className="size-7! text-[11px]! ring-2 ring-surface" />
        </div>
      )}
      <div className="relative grid aspect-4/3 place-items-center overflow-hidden bg-surface-secondary">
        <Cover
          key={handlers.thumbUrl?.(entry)}
          url={HasThumb(entry) ? handlers.thumbUrl?.(entry) : undefined}
          className="h-full w-full object-cover"
          fallback={<FileIcon name={entry.name} isDir={entry.isDir} color={entry.color} className="text-[48px]" />}
        />
        {kind === "video" && (
          <span className="pointer-events-none absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <Icon name="play_arrow" filled className="text-[18px]" />
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 py-1.5 pr-1 pl-3">
        <NameLabel entry={entry} handlers={handlers} className="flex-1 text-sm" />
        <MoreButton label={`${t("Actions for", "Akce pro")} ${entry.name}`} actions={handlers.actionsFor(entry)} onAction={(id) => handlers.onAction(entry, id)} />
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
          <Checkbox aria-label={t("Select all", "Označit vše")} isSelected={allSelected} isIndeterminate={!allSelected && handlers.selected.size > 0} onChange={onSelectAll}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
        )}
        <SortHeader label={t("Name", "Název")} sortKey="name" sort={sort} onSort={onSort} />
        {handlers.ownerOf && <span className="hidden px-1 text-xs font-medium text-muted md:block">{t("Owner", "Vlastník")}</span>}
        <SortHeader label={t("Modified", "Změněno")} sortKey="modified" sort={sort} onSort={onSort} className="hidden sm:flex" />
        <SortHeader label={t("Size", "Velikost")} sortKey="size" sort={sort} onSort={onSort} className="hidden justify-self-end sm:flex" />
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

const SizeOf = (entry: Entry) => (entry.isDir ? (entry.items ?? 0) : entry.size);

export function SortEntries(entries: Entry[], sort: Sort) {
  return [...entries].sort((a, b) => {
    // složky vždy nahoře
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const diff =
      sort.key === "name" ? a.name.localeCompare(b.name, "cs", { numeric: true }) : sort.key === "size" ? SizeOf(a) - SizeOf(b) : a.modified - b.modified;
    return diff * sort.dir || a.name.localeCompare(b.name, "cs", { numeric: true });
  });
}
