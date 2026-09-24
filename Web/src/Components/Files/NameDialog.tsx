"use client";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";
import { AppDialog } from "../AppDialog";

// Nová složka i přejmenování. Při přejmenování souboru se označí jen název bez přípony.
export function NameDialog({
  isOpen,
  onOpenChange,
  title,
  initial = "",
  confirmLabel,
  onSubmit,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: string;
  confirmLabel: string;
  // vrací chybovou hlášku, nebo null při úspěchu
  onSubmit: (name: string) => Promise<string | null>;
}) {
  return (
    <AppDialog isOpen={isOpen} onOpenChange={onOpenChange} title={title} size="sm">
      {/* key: při každém otevření čistý formulář */}
      {isOpen && <NameForm key={initial} initial={initial} confirmLabel={confirmLabel} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} />}
    </AppDialog>
  );
}

function NameForm({
  initial,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function Submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Zadej název.");
    if (/[/\\]/.test(trimmed)) return setError("Název nesmí obsahovat / ani \\.");
    setPending(true);
    const result = await onSubmit(trimmed);
    setPending(false);
    setError(result);
  }

  return (
    <Form onSubmit={Submit} className="flex flex-col gap-5">
      <TextField value={name} onChange={(value) => (setName(value), setError(null))} isInvalid={!!error} autoFocus>
        <Label>Název</Label>
        <Input
          autoComplete="off"
          onFocus={(event) => {
            // "dovolena.jpg" -> označí "dovolena"
            const dot = initial.lastIndexOf(".");
            event.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </TextField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="tertiary" onPress={onCancel}>
          Zrušit
        </Button>
        <Button type="submit" isPending={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Form>
  );
}
