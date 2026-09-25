"use client";

import { Suspense } from "react";
import { SessionGate } from "@/Components/Session";
import { NotificationProvider } from "@/Components/Notifications";
import { Sidebar } from "@/Components/Sidebar";
import { UploadProvider } from "@/Components/Uploads";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Suspense kvůli useSearchParams ve statickém exportu.
  return (
    <SessionGate>
      <UploadProvider>
        <NotificationProvider>
          <Suspense>
            <Sidebar />
            <main className="min-w-0 p-4 sm:p-6 lg:ml-64 lg:p-8">{children}</main>
          </Suspense>
        </NotificationProvider>
      </UploadProvider>
    </SessionGate>
  );
}
