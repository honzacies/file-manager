"use client";

import { Button, Dropdown, Kbd, Label, Separator } from "@heroui/react";
import { Fragment, useEffect, useState } from "react";
import { FOLDER_COLORS } from "@/lib/format";
import { Icon } from "../Icon";
import { t } from "@/lib/i18n";

export interface Action {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
  shortcut?: string;
  // oddělovač před položkou
  separated?: boolean;
  // podmenu (Sdílet ▸, Uspořádat ▸ …)
  children?: Action[];
  // paleta barev pod položkami podmenu; `null` = výchozí barva
  palette?: { value?: string; onPick: (color: string | null) => void };
}

function Items({ actions, onAction, close }: { actions: Action[]; onAction: (id: string) => void; close: () => void }) {
  return (
    <Dropdown.Menu aria-label={t("Actions", "Akce")} onAction={(key) => onAction(String(key))}>
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.separated && <Separator />}
          {action.children ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id={action.id} textValue={action.label}>
                <Icon name={action.icon} className="shrink-0 text-[18px] text-muted" />
                <Label>{action.label}</Label>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="min-w-60">
                <Items actions={action.children} onAction={onAction} close={close} />
                {action.palette && <Palette palette={action.palette} close={close} />}
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : (
            <Dropdown.Item id={action.id} textValue={action.label} variant={action.danger ? "danger" : "default"}>
              <Icon name={action.icon} className={`shrink-0 text-[18px] ${action.danger ? "" : "text-muted"}`} />
              <Label>{action.label}</Label>
              {action.shortcut && (
                <Kbd className="ms-auto" slot="keyboard" variant="light">
                  <Kbd.Content>{action.shortcut}</Kbd.Content>
                </Kbd>
              )}
            </Dropdown.Item>
          )}
        </Fragment>
      ))}
    </Dropdown.Menu>
  );
}

// Barvy složky v podmenu Uspořádat. Tlačítka mimo Menu → po výběru se celé menu zavře ručně.
function Palette({ palette, close }: { palette: NonNullable<Action["palette"]>; close: () => void }) {
  const Pick = (color: string | null) => {
    palette.onPick(color);
    close();
  };
  return (
    <div className="border-t border-separator px-3 pt-2 pb-3">
      <p className="mb-2 text-xs text-muted">{t("Folder color", "Barva složky")}</p>
      <div className="grid grid-cols-8 gap-1.5">
        {FOLDER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${t("Color", "Barva")} ${color}`}
            aria-pressed={palette.value === color}
            onClick={() => Pick(color)}
            className="grid size-6 place-items-center rounded-full outline-none ring-offset-2 ring-offset-overlay hover:scale-110 focus-visible:ring-2 focus-visible:ring-focus"
            style={{ background: color }}
          >
            {palette.value === color && <Icon name="check" className="text-[16px] text-white" />}
          </button>
        ))}
      </div>
      {palette.value && (
        <button type="button" onClick={() => Pick(null)} className="mt-2 text-xs text-muted underline-offset-2 hover:underline">
          {t("Default color", "Výchozí barva")}
        </button>
      )}
    </div>
  );
}

// Pravý klik: neviditelná spoušť na pozici kurzoru. `key` podle pozice menu
// při dalším pravém kliku přemístí (jinak by zůstalo na staré pozici).
export function ContextMenu({
  position,
  actions,
  onAction,
  onClose,
}: {
  position: { x: number; y: number } | null;
  actions: Action[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const open = !!position && actions.length > 0;

  // Nemodální popover React Aria nezavře klik do prázdna (fokus jde na body) — zavírat ručně
  // při stisku myši mimo menu. Pravý klik na jinou položku tak menu zavře a hned otevře nové.
  useEffect(() => {
    if (!open) return;
    const OnPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('[data-slot="dropdown-popover"]')) onClose();
    };
    document.addEventListener("pointerdown", OnPointerDown, true);
    return () => document.removeEventListener("pointerdown", OnPointerDown, true);
  }, [open, onClose]);

  if (!position || !open) return null;
  return (
    <Dropdown key={`${position.x},${position.y}`} isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dropdown.Trigger aria-label={t("Context menu", "Kontextové menu")} className="pointer-events-none fixed size-px opacity-0" style={{ left: position.x, top: position.y }} />
      {/* Nemodální: stránka zůstane klikatelná, takže pravý klik na jinou položku rovnou otevře menu u ní
          (modální popover by zbytek stránky označil jako inert). Zavírá Esc a klik mimo menu. */}
      <Dropdown.Popover placement="bottom start" className="min-w-60" isNonModal>
        <Items actions={actions} onAction={onAction} close={onClose} />
      </Dropdown.Popover>
    </Dropdown>
  );
}

// Tlačítko "⋮" u položky — stejné menu i pro klávesnici a dotyk.
export function MoreButton({ actions, onAction, label }: { actions: Action[]; onAction: (id: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} className="shrink-0 text-muted">
        <Icon name="more_vert" className="text-[20px]" />
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-60">
        <Items actions={actions} onAction={onAction} close={() => setOpen(false)} />
      </Dropdown.Popover>
    </Dropdown>
  );
}
