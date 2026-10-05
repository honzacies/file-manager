"use client";

import { Button, Drawer, Label, Meter, Separator } from "@heroui/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiFetch } from "@/lib/api";
import { FormatBytes } from "@/lib/format";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { NotificationBell } from "./Notifications";
import { usePlayer } from "./Player";
import { ForgetUser, useUser } from "./Session";
import { ClearOffline } from "@/lib/offline";
import { ThemeToggle } from "./ThemeToggle";
import { useUploads } from "./Uploads";
import { UserAvatar } from "./UserAvatar";
import { t } from "@/lib/i18n";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  // aktivní položka: stejná cesta a stejný režim `all`
  all?: boolean;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const all = params.get("all") === "1";
  const inShare = pathname === "/files/" && params.has("share");
  // Procházení cizí sdílené složky (/files/?share=…) patří pod "Sdíleno se mnou", ne pod "Moje soubory".
  const active =
    item.href === "/shared/"
      ? pathname === "/shared/" || inShare
      : pathname === item.href && (pathname !== "/files/" || (!inShare && all === !!item.all));
  return (
    <Link
      href={item.href + (item.all ? "?all=1" : "")}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors hover:bg-default focus-visible:ring-2 focus-visible:ring-focus ${
        active ? "bg-accent/10 font-medium text-accent" : "text-foreground/80"
      }`}
    >
      <Icon name={item.icon} filled={active} className="text-[20px]" />
      {item.label}
    </Link>
  );
}

interface Storage {
  total: number;
  free: number;
  quota: number | null;
  used: number | null;
}

// S kvótou ukazuje vlastní obsazení z limitu, bez ní volné místo na disku.
function StorageMeter() {
  const { version } = useUploads();
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    ApiFetch<Storage>("/api/storage").then((result) => result.ok && setStorage(result.body));
  }, [version]);

  if (!storage) return null;
  const hasQuota = storage.quota !== null;
  const max = hasQuota ? (storage.quota as number) : storage.total;
  const used = hasQuota ? (storage.used ?? 0) : storage.total - storage.free;
  const ratio = used / (max || 1);
  return (
    <Meter value={Math.min(used, max)} maxValue={max || 1} size="sm" color={ratio > 0.95 ? "danger" : ratio > 0.85 ? "warning" : "accent"} className="px-3">
      <Label className="text-xs text-muted">{hasQuota ? t("Your storage", "Tvoje místo") : t("Disk space", "Místo na disku")}</Label>
      <Meter.Track>
        <Meter.Fill />
      </Meter.Track>
      <span className="col-span-2 text-xs text-muted tabular-nums">
        {hasQuota
          ? t(`${FormatBytes(used)} of ${FormatBytes(max)} used`, `Obsazeno ${FormatBytes(used)} z ${FormatBytes(max)}`)
          : t(`${FormatBytes(storage.free)} free of ${FormatBytes(storage.total)}`, `Volných ${FormatBytes(storage.free)} z ${FormatBytes(storage.total)}`)}
      </span>
    </Meter>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const router = useRouter();
  const player = usePlayer();

  async function Logout() {
    player.Stop();
    await ApiFetch("/api/auth/logout", "POST");
    // Na sdíleném počítači nemá po odhlášení nic zůstat.
    ForgetUser();
    await ClearOffline();
    router.replace("/login/");
  }

  const main: NavItem[] = [
    { href: "/files/", label: t("My files", "Moje soubory"), icon: "folder" },
    { href: "/recent/", label: t("Recent", "Nedávné"), icon: "schedule" },
    { href: "/starred/", label: t("Starred", "S hvězdičkou"), icon: "star" },
    ...(user.role === "admin" ? [{ href: "/files/", label: t("All files", "Všechny soubory"), icon: "folder_supervised", all: true }] : []),
    { href: "/shared/", label: t("Shared with me", "Sdíleno se mnou"), icon: "folder_shared" },
    { href: "/shares/", label: t("My shares", "Moje sdílení"), icon: "share" },
    { href: "/offline/", label: "Offline", icon: "offline_pin" },
    { href: "/trash/", label: t("Trash", "Koš"), icon: "delete" },
  ];
  const admin: NavItem[] = [
    { href: "/admin/users/", label: t("Users", "Uživatelé"), icon: "group" },
    { href: "/admin/settings/", label: t("Settings", "Nastavení"), icon: "settings" },
  ];

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between gap-2 px-1">
        <Brand />
        {/* V Draweru (mobil) je zvoneček v horní liště, tady by byl dvakrát. */}
        {!onNavigate && <NotificationBell />}
      </div>
      <nav aria-label={t("Main menu", "Hlavní menu")} className="flex flex-col gap-0.5">
        {main.map((item) => (
          <NavLink key={item.label} item={item} onNavigate={onNavigate} />
        ))}
        {user.role === "admin" && (
          <>
            <p className="mt-4 mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted">{t("Administration", "Administrace")}</p>
            {admin.map((item) => (
              <NavLink key={item.label} item={item} onNavigate={onNavigate} />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <StorageMeter />
        <Separator />
        <ThemeToggle />
        <div className="flex items-center gap-1">
          <Link
            href="/account/"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
          >
            <UserAvatar person={user} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block text-xs text-muted">{user.role === "admin" ? t("Administrator", "Administrátor") : t("User", "Uživatel")}</span>
            </span>
          </Link>
          <Button isIconOnly variant="tertiary" aria-label={t("Sign out", "Odhlásit se")} onPress={Logout}>
            <Icon name="logout" className="text-[20px]" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="fixed top-0 left-0 hidden h-dvh w-64 border-r border-separator bg-surface-tertiary p-4 lg:block">
        <SidebarBody />
      </aside>

      {/* Užší než lg: horní lišta + menu v Draweru. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-separator bg-surface-tertiary px-3 lg:hidden">
        <Button isIconOnly variant="tertiary" aria-label={t("Open menu", "Otevřít menu")} onPress={() => setOpen(true)}>
          <Icon name="menu" className="text-[22px]" />
        </Button>
        <Brand />
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </header>

      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Drawer.Content placement="left">
          <Drawer.Dialog className="w-72 max-w-[85vw] p-4">
            <Drawer.CloseTrigger />
            <SidebarBody onNavigate={() => setOpen(false)} />
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}
