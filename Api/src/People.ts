import path from "node:path";
import { Db } from "./Db.ts";
import { Env } from "./Env.ts";

// Jak se uživatel ukazuje ostatním: celé jméno (nebo login) a verze avataru (null = iniciály).
export interface Person {
  id: number;
  username: string;
  name: string;
  firstName: string;
  lastName: string;
  avatar: number | null;
}

interface PersonRow {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_version: number | null;
}

export const AVATAR_DIR = path.join(Env.DataDir, "avatars");
export const AvatarPath = (userId: number) => path.join(AVATAR_DIR, `${userId}.webp`);

function ToPerson(row: PersonRow): Person {
  const firstName = row.first_name ?? "";
  const lastName = row.last_name ?? "";
  return {
    id: row.id,
    username: row.username,
    name: `${firstName} ${lastName}`.trim() || row.username,
    firstName,
    lastName,
    avatar: row.avatar_version,
  };
}

const COLUMNS = "id, username, first_name, last_name, avatar_version";

export function PersonById(id: number) {
  const row = Db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as PersonRow | undefined;
  return row ? ToPerson(row) : null;
}

// username -> Person pro všechny zmíněné vlastníky (složky mimo účty, třeba "Media" v kořeni, chybí).
export function PeopleByUsername(usernames: Iterable<string>) {
  const unique = [...new Set(usernames)].filter(Boolean);
  if (!unique.length) return {};
  const rows = Db.prepare(`SELECT ${COLUMNS} FROM users WHERE username IN (SELECT value FROM json_each(?))`).all(JSON.stringify(unique)) as unknown as PersonRow[];
  return Object.fromEntries(rows.map((row) => [row.username, ToPerson(row)]));
}

export function AllPeople() {
  return (Db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY COALESCE(NULLIF(first_name, ''), username) COLLATE NOCASE`).all() as unknown as PersonRow[]).map(ToPerson);
}

// "  jan   NOVÁK-dvořák " -> "Jan NOVÁK-Dvořák": mezery srovnat, první písmeno každé části velké.
export function NormalizeName(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("cs"));
}
