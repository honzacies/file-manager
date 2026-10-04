"use client";

import { CollectionList } from "@/Components/Files/CollectionList";
import { PageHeader } from "@/Components/PageHeader";
import { t } from "@/lib/i18n";

export default function StarredPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Starred", "S hvězdičkou")} description={t("Quick access to the things you use often.", "Rychlý přístup k tomu, co potřebuješ často.")} />
      <CollectionList
        url="/api/starred"
        timeLabel={t("Added", "Přidáno")}
        empty={{
          icon: "star",
          title: t("No starred items", "Žádné hvězdičky"),
          text: t("Right-click a file and choose Organize → Add star.", "V souborech klikni pravým tlačítkem a vyber Uspořádat → Označit hvězdičkou."),
        }}
      />
    </div>
  );
}
