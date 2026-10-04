"use client";

import { CollectionList } from "@/Components/Files/CollectionList";
import { PageHeader } from "@/Components/PageHeader";
import { t } from "@/lib/i18n";

export default function RecentPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Recent", "Nedávné")} description={t("Files you recently opened or uploaded.", "Soubory, které jsi naposledy otevřel nebo nahrál.")} />
      <CollectionList
        url="/api/recent"
        timeLabel={t("Last", "Naposledy")}
        empty={{ icon: "schedule", title: t("Nothing yet", "Zatím nic"), text: t("Whatever you open or upload shows up here.", "Co otevřeš nebo nahraješ, najdeš tady.") }}
      />
    </div>
  );
}
