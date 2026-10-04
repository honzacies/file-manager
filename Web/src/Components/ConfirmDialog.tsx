"use client";

import { AlertDialog, Button } from "@heroui/react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

// Jedno potvrzení pro všechny nevratné akce. Řízené a bez kořene <AlertDialog>
// (ten bez tlačítka uvnitř hlásí PressResponder varování). Potvrzovací tlačítko
// nemá slot="close" — async akce dialog zavře sama až po úspěchu.
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  heading,
  children,
  confirmLabel,
  status = "danger",
  isPending,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  heading: ReactNode;
  children: ReactNode;
  confirmLabel?: string;
  status?: "danger" | "warning";
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="blur" isDismissable={!isPending}>
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status={status} />
            <AlertDialog.Heading>{heading}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body className="text-sm text-muted">{children}</AlertDialog.Body>
          <AlertDialog.Footer className="flex flex-col-reverse items-stretch! gap-2 sm:flex-row sm:justify-end">
            <Button slot="close" variant="tertiary" isDisabled={isPending}>
              {t("Cancel", "Zrušit")}
            </Button>
            <Button variant={status === "danger" ? "danger" : "primary"} onPress={onConfirm} isPending={isPending}>
              {confirmLabel ?? t("Confirm", "Potvrdit")}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
