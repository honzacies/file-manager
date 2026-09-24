"use client";

import { Breadcrumbs } from "@heroui/react";
import { Icon } from "../Icon";

// "a/b/c" -> Domů › a › b › c; klik na úroveň volá onNavigate s cestou té úrovně.
export function PathBreadcrumbs({ path, rootLabel, onNavigate }: { path: string; rootLabel: string; onNavigate: (path: string) => void }) {
  const parts = path ? path.split("/") : [];
  const levels = [{ label: rootLabel, path: "" }, ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join("/") }))];

  return (
    <Breadcrumbs className="min-w-0 flex-wrap text-sm">
      {levels.map((level, i) => {
        const isCurrent = i === levels.length - 1;
        return (
          <Breadcrumbs.Item
            key={level.path}
            // aktuální úroveň = poslední položka (řeší React Aria sám)
            onPress={isCurrent ? undefined : () => onNavigate(level.path)}
            className={isCurrent ? "font-medium text-foreground" : "text-muted hover:text-accent"}
          >
            {i === 0 && <Icon name="home" className="mr-1 text-[18px]" />}
            <span className="max-w-48 truncate">{level.label}</span>
          </Breadcrumbs.Item>
        );
      })}
    </Breadcrumbs>
  );
}
