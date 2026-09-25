"use client";

import { CollectionList } from "@/Components/Files/CollectionList";
import { PageHeader } from "@/Components/PageHeader";

export default function RecentPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Nedávné" description="Soubory, které jsi naposledy otevřel nebo nahrál." />
      <CollectionList
        url="/api/recent"
        timeLabel="Naposledy"
        empty={{ icon: "schedule", title: "Zatím nic", text: "Co otevřeš nebo nahraješ, najdeš tady." }}
      />
    </div>
  );
}
