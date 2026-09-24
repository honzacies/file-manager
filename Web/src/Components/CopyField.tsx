"use client";

import { Button, InputGroup, toast } from "@heroui/react";
import { CopyText } from "@/lib/clipboard";
import { Icon } from "./Icon";

export function CopyField({ value, label }: { value: string; label: string }) {
  async function Copy() {
    if (await CopyText(value)) toast.success("Odkaz zkopírován");
    else toast.danger("Kopírování se nepovedlo, označ odkaz ručně.");
  }

  return (
    <InputGroup fullWidth>
      <InputGroup.Input aria-label={label} value={value} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
      <InputGroup.Suffix className="pr-1">
        <Button size="sm" variant="secondary" onPress={Copy}>
          <Icon name="content_copy" className="text-[16px]" />
          Kopírovat
        </Button>
      </InputGroup.Suffix>
    </InputGroup>
  );
}
