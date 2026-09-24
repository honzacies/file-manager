"use client";

import { Button, Drawer, Label, Meter, Separator } from "@heroui/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiFetch } from "@/lib/api";
import { FormatBytes } from "@/lib/format";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { useUser } from "./Session";
import { ThemeToggle } from "./ThemeToggle";
import { useUploads } from "./Uploads";
import { UserAvatar } from "./UserAvatar";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  // aktivní položka: stejná cesta a stejný režim `all`
  all?: boolean;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const all = useSearchParams().get("all") === "1";
  const active = pathname === item.href && (pathname !== "/files/" || all === !!item.all);
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

function StorageMeter() {
  const { version } = useUploads();
  const [storage, setStorage] = useState<{ total: number; free: number } | null>(null);

  useEffect(() => {
    ApiFetch<{ total: number; free: number }>("/api/storage").then((result) => result.ok && setStorage(result.body));
  }, [version]);

  if (!storage) return null;
  const used = storage.total - storage.free;
  const ratio = used / (storage.total || 1);
  return (
    <Meter value={used} maxValue={storage.total} size="sm" color={ratio > 0.95 ? "danger" : ratio > 0.85 ? "warning" : "accent"} className="px-3">
      <Label className="text-xs text-muted">Místo na disku</Label>
      <Meter.Track>
        <Meter.Fill />
      </Meter.Track>
      <span className="col-span-2 text-xs text-muted tabular-nums">
        Volných {FormatBytes(storage.free)} z {FormatBytes(storage.total)}
      </span>
    </Meter>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const router = useRouter();

  async function Logout() {
    await ApiFetch("/api/auth/logout", "POST");
    router.replace("/login/");
  }

  const main: NavItem[] = [
    { href: "/files/", label: "Moje soubory", icon: "folder" },
    ...(user.role === "admin" ? [{ href: "/files/", label: "Všechny soubory", icon: "folder_supervised", all: true }] : []),
    { href: "/shares/", label: "Sdílené odkazy", icon: "link" },
    { href: "/trash/", label: "Koš", icon: "delete" },
  ];
  const admin: NavItem[] = [
    { href: "/admin/users/", label: "Uživatelé", icon: "group" },
    { href: "/admin/settings/", label: "Nastavení", icon: "settings" },
  ];

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="px-1">
        <Brand />
      </div>
      <nav aria-label="Hlavní menu" className="flex flex-col gap-0.5">
        {main.map((item) => (
          <NavLink key={item.label} item={item} onNavigate={onNavigate} />
        ))}
        {user.role === "admin" && (
          <>
            <p className="mt-4 mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted">Administrace</p>
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
            <UserAvatar username={user.username} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.username}</span>
              <span className="block text-xs text-muted">{user.role === "admin" ? "Administrátor" : "Uživatel"}</span>
            </span>
          </Link>
          <Button isIconOnly variant="tertiary" aria-label="Odhlásit se" onPress={Logout}>
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
        <Button isIconOnly variant="tertiary" aria-label="Otevřít menu" onPress={() => setOpen(true)}>
          <Icon name="menu" className="text-[22px]" />
        </Button>
        <Brand />
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
