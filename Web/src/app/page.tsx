"use client";

import { Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();
  useEffect(() => router.replace("/files/"), [router]);
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner size="lg" />
    </div>
  );
}
