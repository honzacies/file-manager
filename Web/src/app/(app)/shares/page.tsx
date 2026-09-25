"use client";

import { Button, Chip, toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/Components/ConfirmDialog";
import { FileIcon } from "@/Components/FileIcon";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { EmptyView, ErrorView, LoadingRows } from "@/Components/StateViews";
import { type Person, PersonLabel } from "@/Components/UserAvatar";
import { ApiFetch, ErrorText } from "@/lib/api";
import { CopyText, ShareUrl } from "@/lib/clipboard";
import { FormatDate } from "@/lib/format";
import { ListPanel } from "@/Components/ListPanel";

interface LinkShare {
  token: string;
  name: string;
  path: string;
  isDir: boolean;
  expiresAt: number | null;
  createdAt: number;
}

interface UserShare {
  id: number;
  name: string;
  path: string;
  recipient: Person;
  isDir: boolean;
  canWrite: boolean;
  missing: boolean;
  createdAt: number;
}

type Revoke = { kind: "link"; share: LinkShare } | { kind: "user"; share: UserShare } | null;

function SectionTitle({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Icon name={icon} className="mt-0.5 text-[20px] text-accent" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}

export default function SharesPage() {
  const [links, setLinks] = useState<LinkShare[] | null>(null);
  const [users, setUsers] = useState<UserShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<Revoke>(null);
  const [pending, setPending] = useState(false);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<LinkShare[]>("/api/shares").then((result) => (result.ok ? setLinks(result.body) : setError(ErrorText(result))));
    ApiFetch<UserShare[]>("/api/user-shares/outgoing").then((result) => (result.ok ? setUsers(result.body) : setError(ErrorText(result))));
  }, []);
  useEffect(Load, [Load]);

  async function Copy(share: LinkShare) {
    if (await CopyText(ShareUrl(share.token))) toast.success("Odkaz zkopírován");
    else toast.danger("Kopírování se nepovedlo.");
  }

  async function Revoke() {
    if (!revoke) return;
    setPending(true);
    const result =
      revoke.kind === "link"
        ? await ApiFetch(`/api/shares/${revoke.share.token}`, "DELETE")
        : await ApiFetch(`/api/user-shares/${revoke.share.id}`, "DELETE");
    setPending(false);
    setRevoke(null);
    if (result.ok) toast.success(revoke.kind === "link" ? "Odkaz zrušen" : `${revoke.share.recipient.name} už k „${revoke.share.name}“ nemá přístup`);
    else toast.danger(ErrorText(result));
    Load();
  }

  if (error) return <ErrorView message={error} onRetry={Load} />;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Moje sdílení" description="Co jsi nasdílel ostatním uživatelům a přes veřejné odkazy." />

      <section>
        <SectionTitle icon="group" title="S uživateli" description="Uvidí to v sekci Sdíleno se mnou. Oprávnění změníš v souborech přes Sdílet s uživateli." />
        {!users ? (
          <LoadingRows count={2} />
        ) : users.length === 0 ? (
          <Panel compact>
            <p className="text-sm text-muted">
              Zatím s nikým nesdílíš. V souborech klikni pravým tlačítkem a vyber <b>Sdílet s uživateli</b>.
            </p>
          </Panel>
        ) : (
          <ListPanel>
              {users.map((share) => (
                <li key={share.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                  <FileIcon name={share.name} isDir={share.isDir} className="shrink-0 text-[24px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {share.name}
                    </p>
                    <p className="truncate text-xs text-muted">
                      /{share.path} · od {FormatDate(share.createdAt)}
                    </p>
                  </div>
                  <PersonLabel person={share.recipient} className="w-full text-sm sm:w-44" />
                  <Chip size="sm" variant="soft" color={share.missing ? "danger" : share.canWrite ? "accent" : "default"}>
                    {share.missing ? "V koši" : share.canWrite ? "Může upravovat" : "Může zobrazit"}
                  </Chip>
                  <Button
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label={`Zrušit sdílení ${share.name} s ${share.recipient.name}`}
                    onPress={() => setRevoke({ kind: "user", share })}
                    className="text-danger!"
                  >
                    <Icon name="person_remove" className="text-[18px]" />
                  </Button>
                </li>
              ))}
            </ListPanel>
        )}
      </section>

      <section>
        <SectionTitle icon="link" title="Veřejné odkazy" description="Kdokoliv s odkazem si soubory stáhne bez přihlášení." />
        {!links ? (
          <LoadingRows count={2} />
        ) : links.length === 0 ? (
          <EmptyView icon="link" title="Žádné odkazy">
            V souborech klikni pravým tlačítkem na soubor nebo složku a vyber <b>Sdílet odkazem</b>.
          </EmptyView>
        ) : (
          <ListPanel>
              {links.map((share) => {
                const expired = share.expiresAt !== null && share.expiresAt < Date.now();
                return (
                  <li key={share.token} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
                    <FileIcon name={share.name} isDir={share.isDir} className="shrink-0 text-[24px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{share.name}</p>
                      <p className="truncate text-xs text-muted">
                        /{share.path} · vytvořeno {FormatDate(share.createdAt)}
                      </p>
                    </div>
                    <Chip size="sm" color={expired ? "danger" : share.expiresAt ? "default" : "accent"} variant="soft">
                      {expired ? "Vypršel" : share.expiresAt ? `Do ${FormatDate(share.expiresAt)}` : "Bez omezení"}
                    </Chip>
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onPress={() => Copy(share)} isDisabled={expired}>
                        <Icon name="content_copy" className="text-[16px]" />
                        Kopírovat
                      </Button>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="ghost"
                        aria-label={`Zrušit odkaz na ${share.name}`}
                        onPress={() => setRevoke({ kind: "link", share })}
                        className="text-danger!"
                      >
                        <Icon name="link_off" className="text-[18px]" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ListPanel>
        )}
      </section>

      <ConfirmDialog
        isOpen={!!revoke}
        onOpenChange={(open) => !open && setRevoke(null)}
        heading={
          revoke?.kind === "user" ? `Přestat sdílet „${revoke.share.name}“ s ${revoke.share.recipient.name}?` : `Zrušit odkaz na „${revoke?.share.name ?? ""}“?`
        }
        confirmLabel={revoke?.kind === "user" ? "Přestat sdílet" : "Zrušit odkaz"}
        isPending={pending}
        onConfirm={Revoke}
      >
        {revoke?.kind === "user"
          ? "Ztratí k položce přístup a zmizí mu ze Sdíleno se mnou. Soubory samotné zůstanou."
          : "Kdo odkaz má, už se k souboru nedostane. Soubor samotný zůstane."}
      </ConfirmDialog>
    </div>
  );
}
