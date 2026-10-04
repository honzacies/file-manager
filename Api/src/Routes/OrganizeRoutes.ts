import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { ZipFile } from "yazl";
import { RequireUser, type SessionUser } from "../Auth.ts";
import { Db } from "../Db.ts";
import { PeopleByUsername } from "../People.ts";
import {
  AssertQuota,
  AssertWritable,
  Decorate,
  DirSize,
  type Entry,
  ExtensionOf,
  GetRootDir,
  HttpError,
  Resolve,
  ScopeProps,
  type ScopeT,
  StatOrThrow,
  TRASH_DIR,
  UniquePath,
  UPLOAD_PREFIX,
  ViewFor,
} from "../Storage.ts";
import { T } from "../Lang.ts";

const PathsBody = (extra: Record<string, unknown> = {}, required: string[] = []) =>
  ({
    type: "object",
    required: ["paths", ...required],
    properties: { paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 }, ...ScopeProps, ...extra },
  }) as const;

// Tyhle formáty jsou už zkomprimované — deflate by jen pálil CPU.
const STORED = new Set("jpg jpeg png gif webp avif heic mp4 m4v mkv mov webm avi mp3 m4a aac ogg opus flac zip rar 7z gz tgz xz bz2 iso pdf docx xlsx pptx".split(" "));

// Položky pod `abs` (rekurzivně), bez rozpracovaných uploadů a koše.
async function Walk(abs: string, isRoot: boolean) {
  const dirents = await fs.readdir(abs, { withFileTypes: true, recursive: true });
  return dirents.filter((d) => {
    const rel = path.relative(abs, path.join(d.parentPath, d.name)).split(path.sep);
    return !d.name.startsWith(UPLOAD_PREFIX) && !(isRoot && rel[0] === TRASH_DIR);
  });
}

// "Honza/Fotky" bez diakritiky a velikosti písmen, ať "cesky" najde "Česky".
const Normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Kde položku z hvězdiček/nedávných uživatel uvidí: ve svých souborech, ve sdílení, nebo (admin) ve Všech souborech.
function ScopeFor(user: SessionUser, rel: string, shareId: number | null) {
  if (shareId) {
    const share = Db.prepare(`
      SELECT s.path, u.username AS owner FROM user_shares s JOIN users u ON u.id = s.owner_id WHERE s.id = ? AND s.recipient_id = ?
    `).get(shareId, user.id) as { path: string; owner: string } | undefined;
    if (!share || (rel !== share.path && !rel.startsWith(`${share.path}/`))) return null;
    const inner = rel.slice(share.path.length + 1);
    return { path: inner, share: shareId, location: [T(`Shared by ${share.owner}`, `Sdílí ${share.owner}`), path.posix.basename(share.path), path.posix.dirname(inner)].filter((p) => p && p !== ".").join(" / ") };
  }
  if (rel.startsWith(`${user.username}/`)) {
    const inner = rel.slice(user.username.length + 1);
    const parent = path.posix.dirname(inner);
    return { path: inner, location: [T("My files", "Moje soubory"), ...(parent === "." ? [] : parent.split("/"))].join(" / ") };
  }
  if (user.role === "admin") return { path: rel, all: true, location: `${T("All files", "Všechny soubory")} / ${path.posix.dirname(rel).replaceAll("/", " / ")}` };
  return null;
}

async function Collection(user: SessionUser, rows: { path: string; share_id: number | null; at: number }[]) {
  const root = GetRootDir();
  const items = await Promise.all(
    rows.map(async (row) => {
      const scope = ScopeFor(user, row.path, row.share_id);
      if (!scope) return null;
      const stat = await fs.stat(path.join(root, ...row.path.split("/"))).catch(() => null);
      if (!stat) return null;
      const isDir = stat.isDirectory();
      return { key: row.path, name: path.posix.basename(row.path), isDir, size: isDir ? 0 : stat.size, modified: stat.mtimeMs, at: row.at, ...scope };
    }),
  );
  const found = Decorate(
    items.filter((item) => item !== null),
    (item) => item.key,
    user.id,
  );
  return { items: found, people: PeopleByUsername(found.map((item) => item.owner ?? "")) };
}

export async function OrganizeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  // Stažení složek a/nebo víc souborů jako jeden ZIP. Streamuje se, takže i velké složky.
  app.get(
    "/files/zip",
    { schema: { querystring: { type: "object", required: ["paths"], properties: { paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 }, ...ScopeProps } } } },
    async (request, reply) => {
      const query = request.query as ScopeT & { paths: string[] };
      const view = ViewFor(request, query);
      const targets = query.paths.map((p) => Resolve(view, p));
      const zip = new ZipFile();

      for (const { abs } of targets) {
        const stat = await StatOrThrow(abs);
        const prefix = abs === view.root ? "" : path.basename(abs);
        if (!stat.isDirectory()) {
          zip.addFile(abs, prefix, { compress: !STORED.has(ExtensionOf(prefix)) });
          continue;
        }
        if (prefix) zip.addEmptyDirectory(prefix);
        for (const d of await Walk(abs, abs === view.root)) {
          const full = path.join(d.parentPath, d.name);
          const name = path.posix.join(prefix, path.relative(abs, full).split(path.sep).join("/"));
          if (d.isDirectory()) zip.addEmptyDirectory(name);
          else if (d.isFile()) zip.addFile(full, name, { compress: !STORED.has(ExtensionOf(d.name)) });
        }
      }
      zip.end();

      // Jedna položka -> "Fotky.zip", víc -> podle nadřazené složky.
      const first = targets[0].abs;
      const base = targets.length === 1 ? path.basename(first) : path.basename(path.dirname(first));
      const fileName = `${base && first !== view.root ? base : "soubory"}.zip`;
      reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .header("X-Content-Type-Options", "nosniff");
      return reply.send(zip.outputStream);
    },
  );

  app.post("/files/copy", { schema: { body: PathsBody() } }, async (request) => {
    const body = request.body as ScopeT & { paths: string[] };
    const view = ViewFor(request, body);
    AssertWritable(view);
    const names: string[] = [];
    for (const clientPath of body.paths) {
      const { abs, rel } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, T("The root folder can't be copied.", "Kořenovou složku nejde zkopírovat."));
      const stat = await StatOrThrow(abs);
      await AssertQuota(view, stat.isDirectory() ? await DirSize(abs) : stat.size);
      // "foto.jpg" -> "foto (kopie).jpg"
      const ext = stat.isDirectory() ? "" : path.extname(abs);
      const stem = path.basename(abs, ext);
      const target = await UniquePath(path.dirname(abs), `${stem} (kopie)${ext}`);
      await fs.cp(abs, target, { recursive: true, errorOnExist: true, force: false });
      names.push(path.basename(target));
    }
    return { names };
  });

  app.get(
    "/files/details",
    { schema: { querystring: { type: "object", properties: { path: { type: "string", default: "" }, ...ScopeProps } } } },
    async (request) => {
      const query = request.query as ScopeT & { path: string };
      const view = ViewFor(request, query);
      const { abs, relToRoot } = Resolve(view, query.path);
      const stat = await StatOrThrow(abs);
      const isDir = stat.isDirectory();
      let size = stat.size;
      let files = 0;
      let folders = 0;
      if (isDir) {
        size = 0;
        for (const d of await Walk(abs, abs === view.root)) {
          if (d.isDirectory()) folders++;
          else if (d.isFile()) {
            files++;
            size += (await fs.stat(path.join(d.parentPath, d.name)).catch(() => null))?.size ?? 0;
          }
        }
      }
      // S kým je sdílená — jen vlastníkovi (příjemce to vědět nemusí).
      const sharedWith = (
        Db.prepare(`
          SELECT u.username, s.can_write FROM user_shares s JOIN users u ON u.id = s.recipient_id
          WHERE s.owner_id = ? AND s.path = ? ORDER BY u.username
        `).all(request.user.id, relToRoot) as { username: string; can_write: number }[]
      ).map((row) => ({ username: row.username, canWrite: row.can_write === 1 }));
      const links = (Db.prepare("SELECT COUNT(*) AS n FROM shares WHERE user_id = ? AND path = ?").get(request.user.id, relToRoot) as { n: number }).n;
      return {
        name: path.basename(abs),
        isDir,
        size,
        files,
        folders,
        modified: stat.mtimeMs,
        created: stat.birthtimeMs || stat.ctimeMs,
        owner: PeopleByUsername([relToRoot.split("/")[0]])[relToRoot.split("/")[0]] ?? null,
        sharedWith,
        links,
      };
    },
  );

  // Hledání v podsložkách. Název výsledku je cesta relativně k prohledávané složce ("2024/leto.jpg").
  app.get(
    "/files/search",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { path: { type: "string", default: "" }, q: { type: "string", minLength: 1, maxLength: 200 }, ...ScopeProps },
        },
      },
    },
    async (request) => {
      const query = request.query as ScopeT & { path: string; q: string };
      const view = ViewFor(request, query);
      const { abs, relToRoot } = Resolve(view, query.path);
      if (!(await StatOrThrow(abs)).isDirectory()) throw new HttpError(400, T("This is not a folder.", "Tohle není složka."));
      const needle = Normalize(query.q.trim());
      const LIMIT = 300;
      const results: Entry[] = [];
      for (const d of await Walk(abs, abs === view.root)) {
        if (!Normalize(d.name).includes(needle)) continue;
        const full = path.join(d.parentPath, d.name);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        const isDir = stat.isDirectory();
        results.push({ name: path.relative(abs, full).split(path.sep).join("/"), isDir, size: isDir ? 0 : stat.size, modified: stat.mtimeMs });
        if (results.length >= LIMIT) break;
      }
      const entries = Decorate(results, (entry) => [relToRoot, entry.name].filter(Boolean).join("/"), request.user.id);
      return {
        readOnly: view.readOnly,
        truncated: results.length >= LIMIT,
        entries,
        people: PeopleByUsername(entries.map((entry) => entry.owner ?? "")),
      };
    },
  );

  // Hvězdička je osobní, takže jde přidat i v sdílení jen pro čtení.
  app.post("/files/star", { schema: { body: PathsBody({ starred: { type: "boolean" } }, ["starred"]) } }, async (request) => {
    const body = request.body as ScopeT & { paths: string[]; starred: boolean };
    const view = ViewFor(request, body);
    for (const clientPath of body.paths) {
      const { abs, relToRoot } = Resolve(view, clientPath);
      await StatOrThrow(abs);
      if (body.starred) {
        Db.prepare("INSERT INTO stars (user_id, path, share_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").run(
          request.user.id,
          relToRoot,
          body.share ?? null,
          Date.now(),
        );
      } else {
        Db.prepare("DELETE FROM stars WHERE user_id = ? AND path = ?").run(request.user.id, relToRoot);
      }
    }
    return { ok: true };
  });

  // Barva složky je vidět všem, takže ji smí měnit jen ten, kdo smí složku upravovat.
  app.post(
    "/files/color",
    { schema: { body: PathsBody({ color: { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$" } }, ["color"]) } },
    async (request) => {
      const body = request.body as ScopeT & { paths: string[]; color: string | null };
      const view = ViewFor(request, body);
      AssertWritable(view);
      for (const clientPath of body.paths) {
        const { abs, rel, relToRoot } = Resolve(view, clientPath);
        if (!rel) throw new HttpError(400, T("The root folder can't have a color.", "Kořenové složce barvu nastavit nejde."));
        if (!(await StatOrThrow(abs)).isDirectory()) throw new HttpError(400, T("Only folders can have a color.", "Barvu jde nastavit jen složce."));
        if (body.color) {
          Db.prepare("INSERT INTO folder_colors (path, color) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET color = excluded.color").run(
            relToRoot,
            body.color.toLowerCase(),
          );
        } else {
          Db.prepare("DELETE FROM folder_colors WHERE path = ?").run(relToRoot);
        }
      }
      return { ok: true };
    },
  );

  app.get("/starred", async (request) => {
    const rows = Db.prepare("SELECT path, share_id, created_at AS at FROM stars WHERE user_id = ? ORDER BY created_at DESC").all(request.user.id) as {
      path: string;
      share_id: number | null;
      at: number;
    }[];
    return Collection(request.user, rows);
  });

  app.get("/recent", async (request) => {
    const rows = Db.prepare("SELECT path, share_id, opened_at AS at FROM recent WHERE user_id = ? ORDER BY opened_at DESC LIMIT 50").all(
      request.user.id,
    ) as { path: string; share_id: number | null; at: number }[];
    return Collection(request.user, rows);
  });
}

