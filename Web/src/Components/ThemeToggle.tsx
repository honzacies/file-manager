"use client";

import { Switch } from "@heroui/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";

// next-themes si volbu drží sám v localStorage (klíč "theme") a při dalších
// návštěvách ji respektuje — žádný vlastní perzistenční kód netřeba.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Server neví, jaké téma má prohlížeč uložené — vykreslit až po mountu,
  // ať nedojde k hydration mismatchi/bliknutí špatného stavu přepínače.
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-9" />;

  const isDark = resolvedTheme === "dark";

  return (
    <Switch
      isSelected={isDark}
      onChange={(checked) => setTheme(checked ? "dark" : "light")}
      className="px-3"
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb>
            <Switch.Icon>
              <Icon
                name={isDark ? "dark_mode" : "light_mode"}
                className="text-[12px]"
              />
            </Switch.Icon>
          </Switch.Thumb>
        </Switch.Control>
        <span className="text-sm text-muted">
          {isDark ? t("Dark mode", "Tmavý režim") : t("Light mode", "Světlý režim")}
        </span>
      </Switch.Content>
    </Switch>
  );
}
