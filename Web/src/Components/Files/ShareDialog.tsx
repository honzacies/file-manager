"use client";

import { Button, type Key, Label, ListBox, Select } from "@heroui/react";
import { useEffect, useState } from "react";
import { ApiFetch, ErrorText } from "@/lib/api";
import { ShareUrl } from "@/lib/clipboard";
import { FormatDate } from "@/lib/format";
import { AppDialog } from "../AppDialog";
import { CopyField } from "../CopyField";
import { Icon } from "../Icon";

const EXPIRY = [
  ["never", "Bez omezení"],
  ["1", "1 den"],
  ["7", "7 dní"],
  ["30", "30 dní"],
] as const;

export function ShareDialog({
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
  const [expiry, setExpiry] = useState<Key | null>("7");
  const [link, setLink] = useState<{ url: string; expiresAt: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLink(null);
      setError(null);
    }
  }, [isOpen]);

  async function Create() {
    if (!target) return;
    setPending(true);
    const result = await ApiFetch<{ token: string; expiresAt: number | null }>("/api/shares", "POST", {
      path: target.path,
      all,
      expiresInDays: expiry === "never" ? null : Number(expiry),
    });
    setPending(false);
    if (!result.ok) return setError(ErrorText(result));
    setLink({ url: ShareUrl(result.body.token), expiresAt: result.body.expiresAt });
  }

  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Sdílet „${target?.name ?? ""}“`}
      footer={
        link ? (
          <Button onPress={() => onOpenChange(false)}>Hotovo</Button>
        ) : (
          <>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>
              Zrušit
            </Button>
            <Button onPress={Create} isPending={pending}>
              <Icon name="add_link" className="text-[18px]" />
              Vytvořit odkaz
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Kdokoliv s odkazem {target?.isDir ? "uvidí obsah složky a stáhne z ní soubory" : "si soubor zobrazí a stáhne"}, bez přihlášení.
        </p>
        {link ? (
          <>
            <CopyField value={link.url} label="Odkaz ke sdílení" />
            <p className="text-xs text-muted">
              {link.expiresAt ? `Platí do ${FormatDate(link.expiresAt)}.` : "Platí, dokud ho nezrušíš."} Zrušit ho můžeš v sekci Sdílené odkazy.
            </p>
          </>
        ) : (
          <Select value={expiry} onChange={setExpiry} className="w-full">
            <Label>Platnost odkazu</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {EXPIRY.map(([id, text]) => (
                  <ListBox.Item key={id} id={id} textValue={text}>
                    {text}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </AppDialog>
  );
}
