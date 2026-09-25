import { Avatar } from "@heroui/react";

// Jak API posílá uživatele (vlastník, příjemce sdílení, přihlášený).
export interface Person {
  id: number;
  username: string;
  name: string;
  firstName?: string;
  lastName?: string;
  // verze avataru (čas nahrání), null = iniciály
  avatar: number | null;
}

// "Alice Nováková" -> "AN", "honza" -> "H"
export function Initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const AvatarUrl = (person: Pick<Person, "id" | "avatar">) => `/api/users/${person.id}/avatar?v=${person.avatar}`;

export function UserAvatar({ person, size = "sm", className = "" }: { person: Person | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <Avatar size={size} color="accent" variant="soft" className={`shrink-0 rounded-full! ${className}`}>
      {person?.avatar && <Avatar.Image alt="" src={AvatarUrl(person)} />}
      <Avatar.Fallback>{person ? Initials(person.name) : "?"}</Avatar.Fallback>
    </Avatar>
  );
}

// Malý avatar + jméno do řádků (vlastník, příjemce).
export function PersonLabel({ person, fallback = "—", className = "" }: { person: Person | null | undefined; fallback?: string; className?: string }) {
  if (!person) return <span className={`text-muted ${className}`}>{fallback}</span>;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <UserAvatar person={person} className="size-6! text-[10px]!" />
      <span className="truncate" title={person.username}>
        {person.name}
      </span>
    </span>
  );
}
