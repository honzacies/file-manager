import { KIND_COLOR, KIND_ICON, KindOf } from "@/lib/format";
import { Icon } from "./Icon";

export function FileIcon({ name, isDir, className = "" }: { name: string; isDir: boolean; className?: string }) {
  const kind = KindOf({ name, isDir });
  return <Icon name={KIND_ICON[kind]} filled={kind === "folder"} className={`${KIND_COLOR[kind]} ${className}`} />;
}
