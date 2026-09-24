"use client";

import type { ReactNode } from "react";
import { useUser } from "./Session";
import { EmptyView } from "./StateViews";

// Jen UI — skutečnou ochranu dělá API (403 na /api/admin/*).
export function AdminOnly({ children }: { children: ReactNode }) {
  const user = useUser();
  if (user.role !== "admin") return <EmptyView icon="lock" title="Sem nemáš přístup" />;
  return children;
}
