"use client";

import { Description, Label, NumberField } from "@heroui/react";

const GB = 1024 ** 3;

// Kvóta v GB. Prázdné pole = bez limitu (null v API).
export function QuotaField({ bytes, onChange, autoFocus }: { bytes: number | null; onChange: (bytes: number | null) => void; autoFocus?: boolean }) {
  return (
    <NumberField
      value={bytes === null ? Number.NaN : bytes / GB}
      onChange={(gb) => onChange(gb === undefined || Number.isNaN(gb) ? null : Math.round(gb * GB))}
      minValue={0}
      step={1}
      formatOptions={{ maximumFractionDigits: 1 }}
      autoFocus={autoFocus}
    >
      <Label>Kvóta (GB)</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input placeholder="Bez limitu" />
        <NumberField.IncrementButton />
      </NumberField.Group>
      <Description>Prázdné = bez limitu. Koš se do kvóty nepočítá.</Description>
    </NumberField>
  );
}
