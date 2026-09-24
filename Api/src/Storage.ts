import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionUser } from "./Auth.ts";
import { Db, GetSetting } from "./Db.ts";
import { Env } from "./Env.ts";

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

// Co uživatel vidí jako "/": běžný uživatel (i admin v "Moje soubory") svoji
// složku <root>/<username>, admin v režimu "Všechny soubory" celý kořen.
export interface View {
  root: string;
  base: string;
  // cesta `base` relativně ke kořeni ("" nebo "username")
  prefix: string;
}

export function GetView(user: SessionUser, all = false): View {
  const root = GetRootDir();
  if (all && user.role === "admin") return { root, base: root, prefix: "" };
  const base = path.join(root, user.username);
  mkdirSync(base, { recursive: true });
  return { root, base, prefix: user.username };
}

// Cesta od klienta -> absolutní cesta uvnitř `view.base`.
// Normalizace přes "/" na začátku pohltí všechna "..", takže ven se nedá dostat.
// "a/b/../c/" -> "a/c"
// ponytail: symlinky se neřeší — vytvořit je může jen někdo s přístupem na server, a ten je důvěryhodný.
export function Resolve(view: Pick<View, "base" | "prefix">, clientPath = "") {
  if (clientPath.includes("\0")) throw new HttpError(400, "Neplatná cesta.");
  const rel = path.posix.normalize(`/${clientPath.replaceAll("\\", "/")}`).replace(/^\/+|\/+$/g, "");
  const abs = rel ? path.join(view.base, ...rel.split("/")) : view.base;
  const relToRoot = [view.prefix, rel].filter(Boolean).join("/");
  return { abs, rel, relToRoot };
}

export function ValidName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value || value === "." || value === ".." || value.length > 255 || /[/\\\0]/.test(value) || value.startsWith(UPLOAD_PREFIX)) {
    throw new HttpError(400, "Neplatný název.");
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
  if (!stat) throw new HttpError(404, "Soubor nebo složka neexistuje.");
  return stat;
}

export async function ListDir(abs: string, isRoot: boolean) {
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((d) => !d.name.startsWith(UPLOAD_PREFIX) && !(isRoot && d.name === TRASH_DIR))
      .map(async (d) => {
        const stat = await fs.stat(path.join(abs, d.name)).catch(() => null);
        if (!stat) return null;
        const isDir = stat.isDirectory();
        return { name: d.name, isDir, size: isDir ? 0 : stat.size, modified: stat.mtimeMs };
      }),
  );
  return entries.filter((e) => e !== null);
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

export async function SendFile(request: FastifyRequest, reply: FastifyReply, abs: string, inline: boolean) {
  const stat = await StatOrThrow(abs);
  if (stat.isDirectory()) throw new HttpError(400, "Složku zatím nejde stáhnout, jen jednotlivé soubory.");

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
