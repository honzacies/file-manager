import { KIND_COLOR, KIND_ICON, KindOf } from "@/lib/format";
import { Icon } from "./Icon";

// `color` = vlastní barva složky (#rrggbb), jinak barva podle typu.
export function FileIcon({ name, isDir, color, className = "" }: { name: string; isDir: boolean; color?: string; className?: string }) {
  const kind = KindOf({ name, isDir });
  return (
    <Icon
      name={KIND_ICON[kind]}
      filled={kind === "folder"}
      className={`${color ? "" : KIND_COLOR[kind]} ${className}`}
      style={color ? { color } : undefined}
    />
  );
}
