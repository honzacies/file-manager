"use client";

import { Button, FieldError, InputGroup, Label, TextField } from "@heroui/react";
import { useState } from "react";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";

// Heslo s tlačítkem pro zobrazení. `autoComplete` je povinný — bez něj prohlížeč
// nabízí uložená hesla z jiných webů (viz how-to-write-apis).
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  description,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  error?: string | null;
  description?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField value={value} onChange={onChange} isInvalid={!!error} isRequired type={visible ? "text" : "password"} autoFocus={autoFocus}>
      <Label>{label}</Label>
      <InputGroup>
        <InputGroup.Input autoComplete={autoComplete} />
        <InputGroup.Suffix className="pr-1">
          <Button isIconOnly size="sm" variant="ghost" aria-label={visible ? t("Hide password", "Skrýt heslo") : t("Show password", "Zobrazit heslo")} onPress={() => setVisible((v) => !v)}>
            <Icon name={visible ? "visibility_off" : "visibility"} className="text-[18px] text-muted" />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {description && !error && <p className="text-xs text-muted">{description}</p>}
      {error && <FieldError>{error}</FieldError>}
    </TextField>
  );
}
