import { Surface } from "@heroui/react";
import type { ComponentProps } from "react";

// Karta na podkladu motivu (HeroUI Surface) — stejný vzor jako Tool Suite.
export function Panel({ className = "", compact = false, ...props }: ComponentProps<typeof Surface> & { compact?: boolean }) {
  return <Surface className={`rounded-2xl ${compact ? "p-4" : "p-5"} ${className}`} {...props} />;
}
