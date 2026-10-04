"use client";

import { Button, type Key, Label, ListBox, Select, Spinner, toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { ApiFetch, ErrorText, Query } from "@/lib/api";
import { AppDialog } from "../AppDialog";
import { Icon } from "../Icon";
import { type Person, UserAvatar } from "../UserAvatar";
import { t } from "@/lib/i18n";

interface Recipient {
  id: number;
  recipient: Person;
  canWrite: boolean;
}

// Funkce, ne konstanta — texty se mají vyhodnotit v aktuálním jazyce.
const Permissions = () =>
  [
    ["read", t("Can view", "Může zobrazit")],
    ["write", t("Can edit", "Může upravovat")],
  ] as const;

function PermissionSelect({
  value,
  onChange,
  isDisabled,
  label,
  hideLabel,
  className = "w-44",
}: {
  value: Key;
  onChange: (value: Key) => void;
  isDisabled?: boolean;
  label: string;
  hideLabel?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onChange={(key) => key !== null && onChange(key)} isDisabled={isDisabled} aria-label={hideLabel ? label : undefined} className={className}>
      {!hideLabel && <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {Permissions().map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function UserShareDialog({
  isOpen,
  onOpenChange,
  target,
  all,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  target: { path: string; name: string; isDir: boolean } | null;
  all: boolean;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<Key | null>(null);
  const [permission, setPermission] = useState<Key>("read");
  const [pending, setPending] = useState(false);

  // Na cestě, ne na objektu `target` — rodič ho posílá nový při každém renderu a efekt níž
  // by se pak točil dokola.
  const targetPath = target?.path;
  const Load = useCallback(() => {
    if (targetPath === undefined) return;
    ApiFetch<Recipient[]>(`/api/user-shares${Query({ path: targetPath, all })}`).then((result) => {
      if (result.ok) setRecipients(result.body);
      else toast.danger(ErrorText(result));
    });
  }, [targetPath, all]);

  useEffect(() => {
    if (!isOpen) return;
    setRecipients(null);
    setSelectedUser(null);
    setPermission("read");
    ApiFetch<Person[]>("/api/users/directory").then((result) => result.ok && setPeople(result.body));
    Load();
  }, [isOpen, Load]);

  async function Share() {
    if (!target || selectedUser === null) return;
    setPending(true);
    const result = await ApiFetch("/api/user-shares", "POST", {
      path: target.path,
      all,
      recipientIds: [Number(selectedUser)],
      canWrite: target.isDir && permission === "write",
    });
    setPending(false);
    if (!result.ok) return toast.danger(ErrorText(result));
    const name = people?.find((person) => person.id === Number(selectedUser))?.name;
    toast.success(t(`Shared with ${name}. They'll get a notification.`, `Sdíleno s ${name}. Přijde mu notifikace.`));
    setSelectedUser(null);
    Load();
  }

  async function ChangePermission(recipient: Recipient, value: Key) {
    const result = await ApiFetch(`/api/user-shares/${recipient.id}`, "PATCH", { canWrite: value === "write" });
    if (!result.ok) toast.danger(ErrorText(result));
    Load();
  }

  async function Remove(recipient: Recipient) {
    const result = await ApiFetch(`/api/user-shares/${recipient.id}`, "DELETE");
    if (result.ok) toast.success(t(`${recipient.recipient.name} no longer has access to “${target?.name}”`, `${recipient.recipient.name} už k „${target?.name}“ nemá přístup`));
    else toast.danger(ErrorText(result));
    Load();
  }

  // V nabídce jen lidé, se kterými ještě sdíleno není.
  const available = (people ?? []).filter((person) => !recipients?.some((recipient) => recipient.recipient.id === person.id));

  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t(`Share “${target?.name ?? ""}” with users`, `Sdílet „${target?.name ?? ""}“ s uživateli`)}
      footer={<Button onPress={() => onOpenChange(false)}>{t("Done", "Hotovo")}</Button>}
    >
      <div className="flex flex-col gap-5">
        {people && people.length === 0 ? (
          <p className="text-sm text-muted">{t("Nobody else is in the cloud yet. Accounts are created by the administrator.", "V cloudu zatím nikdo další není. Účty zakládá administrátor.")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Select value={selectedUser} onChange={setSelectedUser} placeholder={available.length ? t("Choose a user", "Vyber uživatele") : t("Shared with everyone", "Sdíleno se všemi")} className="w-full" isDisabled={!available.length}>
              <Label>{t("With", "Komu")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {available.map((person) => (
                    <ListBox.Item key={person.id} id={person.id} textValue={`${person.name} ${person.username}`}>
                      <UserAvatar person={person} className="size-6! text-[10px]!" />
                      <span className="flex flex-col">
                        <span>{person.name}</span>
                        {person.name !== person.username && <span className="text-xs text-muted">{person.username}</span>}
                      </span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <div className="flex items-end gap-2">
              <PermissionSelect
                label={t("Permission", "Oprávnění")}
                value={target?.isDir ? permission : "read"}
                onChange={setPermission}
                isDisabled={!target?.isDir}
                className="min-w-0 flex-1"
              />
              <Button onPress={Share} isPending={pending} isDisabled={selectedUser === null}>
                <Icon name="send" className="text-[18px]" />
                {t("Share", "Sdílet")}
              </Button>
            </div>
          </div>
        )}
        {!target?.isDir && <p className="-mt-2 text-xs text-muted">{t("Files can only be shared for viewing and downloading.", "Soubor jde sdílet jen ke zobrazení a stažení.")}</p>}

        <div>
          <p className="mb-2 text-sm font-medium">{t("Who has access", "Kdo má přístup")}</p>
          {!recipients ? (
            <Spinner size="sm" />
          ) : recipients.length === 0 ? (
            <p className="text-sm text-muted">{t("Not shared with anyone yet.", "Zatím nesdíleno s nikým.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-separator rounded-xl border border-border">
              {recipients.map((recipient) => (
                <li key={recipient.id} className="flex items-center gap-3 px-3 py-2">
                  <UserAvatar person={recipient.recipient} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={recipient.recipient.username}>
                    {recipient.recipient.name}
                  </span>
                  {target?.isDir ? (
                    <PermissionSelect
                      hideLabel
                      label={t(`Permission for ${recipient.recipient.name}`, `Oprávnění pro ${recipient.recipient.name}`)}
                      value={recipient.canWrite ? "write" : "read"}
                      onChange={(value) => ChangePermission(recipient, value)}
                    />
                  ) : (
                    <span className="text-xs text-muted">{t("Can view", "Může zobrazit")}</span>
                  )}
                  <Button isIconOnly size="sm" variant="ghost" aria-label={t(`Remove ${recipient.recipient.name}`, `Odebrat ${recipient.recipient.name}`)} onPress={() => Remove(recipient)} className="text-danger!">
                    <Icon name="person_remove" className="text-[18px]" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
