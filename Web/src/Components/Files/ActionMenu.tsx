"use client";

import { Button, Dropdown, Kbd, Label, Separator } from "@heroui/react";
import { Fragment } from "react";
import { Icon } from "../Icon";

export interface Action {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
  shortcut?: string;
  // oddělovač před položkou
  separated?: boolean;
}

function Menu({ actions, onAction }: { actions: Action[]; onAction: (id: string) => void }) {
  return (
    <Dropdown.Popover placement="bottom start" className="min-w-56">
      <Dropdown.Menu aria-label="Akce" onAction={(key) => onAction(String(key))}>
        {actions.map((action) => (
          <Fragment key={action.id}>
            {action.separated && <Separator />}
            <Dropdown.Item id={action.id} textValue={action.label} variant={action.danger ? "danger" : "default"}>
              <Icon name={action.icon} className={`shrink-0 text-[18px] ${action.danger ? "" : "text-muted"}`} />
              <Label>{action.label}</Label>
              {action.shortcut && (
                <Kbd className="ms-auto" slot="keyboard" variant="light">
                  <Kbd.Content>{action.shortcut}</Kbd.Content>
                </Kbd>
              )}
            </Dropdown.Item>
          </Fragment>
        ))}
      </Dropdown.Menu>
    </Dropdown.Popover>
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
  if (!position || !actions.length) return null;
  return (
    <Dropdown key={`${position.x},${position.y}`} isOpen onOpenChange={(open) => !open && onClose()}>
      <Dropdown.Trigger
        aria-label="Kontextové menu"
        className="pointer-events-none fixed size-px opacity-0"
        style={{ left: position.x, top: position.y }}
      />
      <Menu actions={actions} onAction={onAction} />
    </Dropdown>
  );
}

// Tlačítko "⋮" u položky — stejné menu i pro klávesnici a dotyk.
export function MoreButton({ actions, onAction, label }: { actions: Action[]; onAction: (id: string) => void; label: string }) {
  return (
    <Dropdown>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} className="shrink-0 text-muted">
        <Icon name="more_vert" className="text-[20px]" />
      </Button>
      <Menu actions={actions} onAction={onAction} />
    </Dropdown>
  );
}
