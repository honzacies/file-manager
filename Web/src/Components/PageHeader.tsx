import type { ReactNode } from "react";

// Jedna hlavička pro všechny stránky: nadpis = název položky v menu (dřív měly
// Domů i Správa oba "Tools"), popis a akce, které se na úzké obrazovce zalomí
// pod nadpis místo aby ho rozmáčkly.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
