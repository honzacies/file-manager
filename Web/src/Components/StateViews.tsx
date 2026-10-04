import { Button, EmptyState, Skeleton } from "@heroui/react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";

// Společné stavy seznamů: načítání, chyba, prázdno.
export function LoadingRows({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-12 rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
      <Icon name="error" className="text-[48px] text-danger" />
      <p className="font-medium">{t("Couldn't load data", "Nepodařilo se načíst data")}</p>
      <p className="text-sm text-muted">{message}</p>
      <Button className="mt-2" onPress={onRetry}>
        {t("Try again", "Zkusit znovu")}
      </Button>
    </EmptyState>
  );
}

export function EmptyView({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-accent/10">
        <Icon name={icon} className="text-[32px] text-accent" />
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </EmptyState>
  );
}
