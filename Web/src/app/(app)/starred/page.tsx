"use client";

import { CollectionList } from "@/Components/Files/CollectionList";
import { PageHeader } from "@/Components/PageHeader";

export default function StarredPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="S hvězdičkou" description="Rychlý přístup k tomu, co potřebuješ často." />
      <CollectionList
        url="/api/starred"
        timeLabel="Přidáno"
        empty={{ icon: "star", title: "Žádné hvězdičky", text: "V souborech klikni pravým tlačítkem a vyber Uspořádat → Označit hvězdičkou." }}
      />
    </div>
  );
}
