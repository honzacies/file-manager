import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionUser } from "./Auth.ts";
import { Db, GetSetting } from "./Db.ts";
import { Env } from "./Env.ts";
import { T } from "./Lang.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const TRASH_DIR = ".trash";
export const UPLOAD_PREFIX = ".upload-";

export function GetRootDir() {
  return GetSetting("root_dir") ?? Env.DefaultRootDir;
}

// Co uživatel vidí jako "/":
// - vlastní soubory (i admin v "Moje soubory"): <root>/<username>
// - admin v režimu "Všechny soubory": celý kořen
// - sdílení od jiného uživatele: sdílená složka (nebo soubor) vlastníka
export interface View {
  root: string;
  base: string;
  // cesta `base` relativně ke kořeni ("", "username" nebo "vlastnik/Fotky")
  prefix: string;
  // čí kvóta se při nahrávání hlídá (null = bez hlídání) a jeho domovská složka
  quotaUserId: number | null;
  home: string;
  readOnly: boolean;
  // sdílený je jen soubor, ne složka
  isFile: boolean;
}

export interface Scope {
  all?: boolean;
  share?: number;
}

export function GetView(user: SessionUser, scope: Scope = {}): View {
  const root = GetRootDir();
  if (scope.share) {
    // Příjemce je součástí dotazu — cizí sdílení vypadá stejně jako neexistující.
    const row = Db.prepare(`
      SELECT s.owner_id, s.path, s.is_dir, s.can_write, u.username AS owner
      FROM user_shares s JOIN users u ON u.id = s.owner_id
      WHERE s.id = ? AND s.recipient_id = ?
    `).get(scope.share, user.id) as { owner_id: number; path: string; is_dir: number; can_write: number; owner: string } | undefined;
    if (!row) throw new HttpError(404, T("This share does not exist or was removed.", "Sdílení neexistuje nebo ti bylo odebráno."));
    const base = path.join(root, ...row.path.split("/"));
    return {
      root,
      base,
      prefix: row.path,
      quotaUserId: row.owner_id,
      home: path.join(root, row.owner),
      readOnly: !row.can_write || !row.is_dir,
      isFile: !row.is_dir,
    };
  }
  if (scope.all && user.role === "admin") return { root, base: root, prefix: "", quotaUserId: null, home: root, readOnly: false, isFile: false };
  const base = path.join(root, user.username);
  mkdirSync(base, { recursive: true });
  return { root, base, prefix: user.username, quotaUserId: user.id, home: base, readOnly: false, isFile: false };
}

// Rozsah posílaný klientem s každým souborovým requestem: `all` = admin v "Všech souborech"
// (běžnému uživateli se ignoruje), `share` = id sdílení, které mu někdo poslal.
export const ScopeProps = {
  all: { type: "boolean", default: false },
  share: { type: "integer", minimum: 1 },
} as const;

export interface ScopeT {
  all: boolean;
  share?: number;
}

export const ViewFor = (request: FastifyRequest, scope: ScopeT) => GetView(request.user, { all: scope.all, share: scope.share });

// Absolutní cesta -> relativní ke kořeni cloudu ("/cloud/alice/Fotky" -> "alice/Fotky")
export const RelFromRoot = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");
export const RelToRoot = (view: View, abs: string) => RelFromRoot(view.root, abs);

export function AssertWritable(view: View) {
  if (view.readOnly) throw new HttpError(403, T("This share is read-only.", "Tohle sdílení je jen pro čtení."));
}

// Cesta od klienta -> absolutní cesta uvnitř `view.base`.
// Normalizace přes "/" na začátku pohltí všechna "..", takže ven se nedá dostat.
// "a/b/../c/" -> "a/c"
// ponytail: symlinky se neřeší — vytvořit je může jen někdo s přístupem na server, a ten je důvěryhodný.
export function Resolve(view: Pick<View, "base" | "prefix">, clientPath = "") {
  if (clientPath.includes("\0")) throw new HttpError(400, T("Invalid path.", "Neplatná cesta."));
  const rel = path.posix.normalize(`/${clientPath.replaceAll("\\", "/")}`).replace(/^\/+|\/+$/g, "");
  const abs = rel ? path.join(view.base, ...rel.split("/")) : view.base;
  const relToRoot = [view.prefix, rel].filter(Boolean).join("/");
  return { abs, rel, relToRoot };
}

export function ValidName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  // limit 255 bajtů (ne znaků) — tolik unese název souboru na ext4; "ž" jsou 2 bajty
  if (!value || value === "." || value === ".." || Buffer.byteLength(value) > 255 || /[/\\\0]/.test(value) || value.startsWith(UPLOAD_PREFIX)) {
    throw new HttpError(400, T("Invalid name.", "Neplatný název."));
  }
  return value;
}

// "foto.jpg" -> "foto (1).jpg", pokud už existuje
export async function UniquePath(dir: string, name: string) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i ? `${stem} (${i})${ext}` : name);
    if (!existsSync(candidate)) return candidate;
  }
}

// rename nejde přes hranici disku (EXDEV) — kořen může mít namountované další disky
export async function MovePath(from: string, to: string) {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(from, { recursive: true, force: true });
  }
}

export async function StatOrThrow(abs: string) {
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) throw new HttpError(404, T("File or folder not found.", "Soubor nebo složka neexistuje."));
  return stat;
}

export interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  // počet položek ve složce (jen o úroveň níž)
  items?: number;
  modified: number;
  color?: string;
  starred?: boolean;
  // login vlastníka = první část cesty od kořene (u složek mimo účty jejich název)
  owner?: string;
}

// `dirRel` = cesta složky relativně ke kořeni; s ní se k položkám doplní barva a hvězdička uživatele.
export async function ListDir(abs: string, isRoot: boolean, dirRel?: string, userId?: number): Promise<Entry[]> {
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((d) => !d.name.startsWith(UPLOAD_PREFIX) && !(isRoot && d.name === TRASH_DIR))
      .map(async (d) => {
        const stat = await fs.stat(path.join(abs, d.name)).catch(() => null);
        if (!stat) return null;
        if (!stat.isDirectory()) return { name: d.name, isDir: false, size: stat.size, modified: stat.mtimeMs };
        const inside = await fs.readdir(path.join(abs, d.name)).catch(() => []);
        const items = inside.filter((name) => !name.startsWith(UPLOAD_PREFIX)).length;
        return { name: d.name, isDir: true, size: 0, items, modified: stat.mtimeMs };
      }),
  );
  const list = entries.filter((e) => e !== null);
  if (dirRel === undefined) return list;
  return Decorate(list, (entry) => [dirRel, entry.name].filter(Boolean).join("/"), userId);
}

// Doplní barvu složky a hvězdičku. `relOf` vrátí cestu položky relativně ke kořeni.
export function Decorate<T extends Entry>(entries: T[], relOf: (entry: T) => string, userId?: number): (T & { owner: string })[] {
  if (!entries.length) return [];
  const rels = JSON.stringify(entries.map(relOf));
  const colors = new Map(
    (Db.prepare("SELECT path, color FROM folder_colors WHERE path IN (SELECT value FROM json_each(?))").all(rels) as { path: string; color: string }[]).map(
      (row) => [row.path, row.color],
    ),
  );
  const stars = new Set(
    userId === undefined
      ? []
      : (Db.prepare("SELECT path FROM stars WHERE user_id = ? AND path IN (SELECT value FROM json_each(?))").all(userId, rels) as { path: string }[]).map(
          (row) => row.path,
        ),
  );
  return entries.map((entry) => {
    const rel = relOf(entry);
    return { ...entry, owner: rel.split("/")[0], ...(colors.has(rel) && { color: colors.get(rel) }), ...(stars.has(rel) && { starred: true }) };
  });
}

// Otevřený/nahraný soubor do "Nedávné" (drží se posledních 100).
export function TouchRecent(userId: number, relToRoot: string, shareId?: number) {
  Db.prepare(`
    INSERT INTO recent (user_id, path, share_id, opened_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, path) DO UPDATE SET opened_at = excluded.opened_at, share_id = excluded.share_id
  `).run(userId, relToRoot, shareId ?? null, Date.now());
  Db.prepare(`
    DELETE FROM recent WHERE user_id = ? AND path NOT IN (SELECT path FROM recent WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100)
  `).run(userId, userId);
}

// Součet velikostí všech souborů ve složce (rekurzivně).
// ponytail: prochází disk při každém volání; cache/průběžný součet v DB, až to bude u velkých složek pomalé
export async function DirSize(abs: string) {
  const dirents = await fs.readdir(abs, { withFileTypes: true, recursive: true }).catch(() => []);
  let total = 0;
  for (const d of dirents) {
    if (!d.isFile()) continue;
    const stat = await fs.stat(path.join(d.parentPath, d.name)).catch(() => null);
    total += stat?.size ?? 0;
  }
  return total;
}

// ---- Kvóty ---------------------------------------------------------------

export function QuotaOf(userId: number) {
  const row = Db.prepare("SELECT quota_bytes FROM users WHERE id = ?").get(userId) as { quota_bytes: number | null } | undefined;
  return row?.quota_bytes ?? null;
}

// Vyhodí 413, když by se `incoming` bajtů do kvóty nevešlo. Kvóta patří vlastníkovi složky
// (i když nahrává příjemce sdílení), admin v "Všech souborech" ji obchází a koš se nepočítá.
export async function AssertQuota(view: View, incoming: number) {
  if (view.quotaUserId === null) return;
  const quota = QuotaOf(view.quotaUserId);
  if (quota === null) return;
  const used = await DirSize(view.home);
  if (used + incoming > quota) {
    const [limit, left] = [FormatGb(quota), FormatGb(Math.max(0, quota - used))];
    throw new HttpError(413, T(`Not enough space. The limit is ${limit}, ${left} left.`, `Nedostatek místa. Limit je ${limit}, zbývá ${left}.`));
  }
}

// Po přejmenování/přesunu posune cesty všude, kde se na položku odkazuje (sdílení, barvy,
// hvězdičky, nedávné), ať nic nepřestane fungovat.
// "a/Fotky" -> "a/Rodina/Fotky" platí i pro vše pod ní ("a/Fotky/2024" -> "a/Rodina/Fotky/2024").
export function RewritePaths(oldRel: string, newRel: string) {
  // % _ \ v názvu složky by LIKE bral jako zástupné znaky
  const like = `${oldRel.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
  for (const table of ["shares", "user_shares", "folder_colors", "stars", "recent"]) {
    Db.prepare(`UPDATE ${table} SET path = ? || substr(path, ?) WHERE path = ? OR path LIKE ? ESCAPE '\\'`).run(newRel, oldRel.length + 1, oldRel, like);
  }
}

// 1234567890 -> "1,1 GB"
function FormatGb(bytes: number) {
  return `${(bytes / 1024 ** 3).toLocaleString(T("en-US", "cs-CZ"), { maximumFractionDigits: 1 })} GB`;
}

// ---- Koš ----------------------------------------------------------------

export async function MoveToTrash(abs: string, relToRoot: string) {
  const root = GetRootDir();
  const stat = await StatOrThrow(abs);
  const id = randomUUID();
  const trashPath = path.join(root, TRASH_DIR, id);
  await fs.mkdir(path.dirname(trashPath), { recursive: true });
  await MovePath(abs, trashPath);
  Db.prepare(`
    INSERT INTO trash (id, owner, original_path, trash_path, name, is_dir, size, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, relToRoot.split("/")[0], relToRoot, trashPath, path.basename(abs), stat.isDirectory() ? 1 : 0, stat.isDirectory() ? 0 : stat.size, Date.now());
}

export interface TrashRow {
  id: string;
  owner: string;
  original_path: string;
  trash_path: string;
  name: string;
  is_dir: number;
  size: number;
  deleted_at: number;
}

export async function RestoreFromTrash(row: TrashRow) {
  const target = path.join(GetRootDir(), ...row.original_path.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await MovePath(row.trash_path, await UniquePath(path.dirname(target), path.basename(target)));
  Db.prepare("DELETE FROM trash WHERE id = ?").run(row.id);
}

export async function PurgeFromTrash(row: TrashRow) {
  await fs.rm(row.trash_path, { recursive: true, force: true });
  Db.prepare("DELETE FROM trash WHERE id = ?").run(row.id);
}

export const TRASH_RETENTION_DAYS = 30;

export async function PurgeOldTrash() {
  const rows = Db.prepare("SELECT * FROM trash WHERE deleted_at < ?").all(Date.now() - TRASH_RETENTION_DAYS * 86_400_000) as unknown as TrashRow[];
  for (const row of rows) await PurgeFromTrash(row);
}

// ---- Posílání souborů ---------------------------------------------------

// Inline se smí zobrazit jen tohle. Všechno ostatní jde jako příloha, jinak by
// nahrané HTML běželo na stejném originu jako appka (XSS přes sdílený soubor).
const INLINE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
  pdf: "application/pdf",
};

const TEXT_EXTENSIONS = new Set(
  "txt md markdown json jsonc js mjs cjs ts tsx jsx css scss html htm xml yml yaml toml ini conf cfg log csv tsv sh bash zsh ps1 bat py rb go rs java kt c h cpp hpp cs php sql env gitignore dockerfile srt vtt".split(" "),
);

export function ExtensionOf(name: string) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext || name.toLowerCase().replace(/^\./, "");
}

// Hotový náhled (WebP). Cesta v URL mění `v` (čas změny souboru), takže se smí cachovat.
export function SendThumb(reply: FastifyReply, file: string) {
  return reply
    .header("Content-Type", "image/webp")
    .header("X-Content-Type-Options", "nosniff")
    .header("Cache-Control", "private, max-age=604800")
    .send(createReadStream(file));
}

export async function SendFile(request: FastifyRequest, reply: FastifyReply, abs: string, inline: boolean) {
  const stat = await StatOrThrow(abs);
  if (stat.isDirectory()) throw new HttpError(400, T("Folders can't be downloaded this way, only single files.", "Složku zatím nejde stáhnout, jen jednotlivé soubory."));

  const name = path.basename(abs);
  const ext = ExtensionOf(name);
  const type = TEXT_EXTENSIONS.has(ext) ? "text/plain; charset=utf-8" : (INLINE_TYPES[ext] ?? "application/octet-stream");
  const disposition = inline && type !== "application/octet-stream" ? "inline" : "attachment";

  reply
    .header("Content-Type", type)
    .header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`)
    .header("X-Content-Type-Options", "nosniff")
    .header("Accept-Ranges", "bytes")
    .header("Last-Modified", stat.mtime.toUTCString())
    .header("Cache-Control", "private, max-age=300");
  // PDF prohlížeč Chromu se v sandboxu nevykreslí, ostatní typy sandbox dostanou
  if (type !== "application/pdf") {
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  }

  const size = stat.size;
  let start = 0;
  let end = size - 1;
  // Range kvůli přetáčení videa: "bytes=100-", "bytes=100-199", "bytes=-500"
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`);
  }

  reply.header("Content-Length", size ? end - start + 1 : 0);
  return reply.send(size ? createReadStream(abs, { start, end }) : "");
}
