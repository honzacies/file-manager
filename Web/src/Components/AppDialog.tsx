"use client";

import { Modal } from "@heroui/react";
import type { ReactNode } from "react";

// Řízený dialog bez kořene <Modal> — dialogy se otevírají z kontextového menu,
// ne z tlačítka, a kořen (DialogTrigger) by držel vlastní, nezávislý stav.
export function AppDialog({
  isOpen,
  onOpenChange,
  title,
  icon,
  children,
  footer,
  size = "md",
  isDismissable = true,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  isDismissable?: boolean;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="blur" isDismissable={isDismissable}>
      <Modal.Container placement="center" scroll="inside" size={size}>
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            {icon}
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          {footer && (
            <Modal.Footer className="flex flex-col-reverse items-stretch! gap-2 sm:flex-row sm:justify-end sm:items-center!">{footer}</Modal.Footer>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
