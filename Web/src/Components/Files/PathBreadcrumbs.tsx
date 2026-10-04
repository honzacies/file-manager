"use client";

import { Breadcrumbs } from "@heroui/react";
import { Icon } from "../Icon";

// "a/b/c" -> Domů › a › b › c; klik na úroveň volá onNavigate s cestou té úrovně.
export function PathBreadcrumbs({ path, rootLabel, onNavigate }: { path: string; rootLabel: string; onNavigate: (path: string) => void }) {
  const parts = path ? path.split("/") : [];
  const levels = [{ label: rootLabel, path: "" }, ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join("/") }))];

  return (
    // Nezalamovat (na mobilu by řádek spadl pod tlačítka) — místo toho se zkrátí nadřazené úrovně.
    <Breadcrumbs className="min-w-0 flex-nowrap text-sm">
      {levels.map((level, i) => {
        const isCurrent = i === levels.length - 1;
        return (
          <Breadcrumbs.Item
            key={level.path}
            // aktuální úroveň = poslední položka (řeší React Aria sám)
            onPress={isCurrent ? undefined : () => onNavigate(level.path)}
            // Na mobilu se vejdou jen poslední dvě úrovně, zbytek je schovaný.
            // Ubírá se z nadřazených úrovní, aktuální složka zůstává čitelná celá.
            className={`${i < levels.length - 2 ? "max-sm:hidden " : ""}${isCurrent ? "shrink-0 font-medium text-foreground" : "min-w-0 text-muted hover:text-accent"}`}
          >
            {i === 0 && <Icon name="home" className="mr-1 text-[18px]" />}
            <span className="min-w-0 truncate sm:max-w-48">{level.label}</span>
          </Breadcrumbs.Item>
        );
      })}
    </Breadcrumbs>
  );
}
