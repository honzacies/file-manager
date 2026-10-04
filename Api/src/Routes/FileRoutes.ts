import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { RequireUser } from "../Auth.ts";
import { PeopleByUsername } from "../People.ts";
import { GetThumb, ThumbKind } from "../Thumbs.ts";
import {
  AssertQuota,
  AssertWritable,
  DirSize,
  GetView,
  HttpError,
  ListDir,
  MovePath,
  MoveToTrash,
  QuotaOf,
  RelToRoot,
  Resolve,
  RewritePaths,
  ScopeProps,
  type ScopeT,
  SendFile,
  SendThumb,
  StatOrThrow,
  TouchRecent,
  TRASH_DIR,
  UniquePath,
  UPLOAD_PREFIX,
  ValidName,
  ViewFor,
} from "../Storage.ts";
import { T } from "../Lang.ts";

const PathQuery = {
  type: "object",
  properties: {
    path: { type: "string", default: "" },
    inline: { type: "boolean", default: false },
    // náhledy v mřížce se nezapisují do "Nedávné"
    thumb: { type: "boolean", default: false },
    relative: { type: "string", default: "" },
    ...ScopeProps,
  },
} as const;

interface PathQueryT extends ScopeT {
  path: string;
  inline: boolean;
  thumb: boolean;
  relative: string;
}

const PathsBody = {
  type: "object",
  required: ["paths"],
  properties: {
    paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 },
    destination: { type: "string" },
    ...ScopeProps,
  },
} as const;

export async function FileRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  app.get("/files", { schema: { querystring: PathQuery } }, async (request) => {
    const query = request.query as PathQueryT;
    const view = ViewFor(request, query);
    const { abs, rel, relToRoot } = Resolve(view, query.path);
    if (!(await StatOrThrow(abs)).isDirectory()) throw new HttpError(400, T("This is not a folder.", "Tohle není složka."));
    const entries = await ListDir(abs, abs === view.root, relToRoot, request.user.id);
    return { path: rel, readOnly: view.readOnly, entries, people: PeopleByUsername(entries.map((entry) => entry.owner ?? "")) };
  });

  app.get("/files/download", { schema: { querystring: PathQuery } }, async (request, reply) => {
    const query = request.query as PathQueryT;
    const view = ViewFor(request, query);
    const { abs, rel, relToRoot } = Resolve(view, query.path);
    // Sdílený soubor je sám "kořenem" sdílení, jinak musí být vybraný konkrétní soubor.
    if (!rel && !view.isFile) throw new HttpError(400, "Vyber soubor.");
    const result = await SendFile(request, reply, abs, query.inline);
    if (!query.thumb && !request.headers.range) TouchRecent(request.user.id, relToRoot, query.share);
    return result;
  });

  // Náhled fotky / snímek videa / cover hudby. 404 = náhled není, klient ukáže ikonu.
  app.get("/files/thumb", { schema: { querystring: PathQuery } }, async (request, reply) => {
    const query = request.query as PathQueryT;
    const { abs } = Resolve(ViewFor(request, query), query.path);
    const thumb = await GetThumb(abs);
    if (!thumb) throw new HttpError(404, T("Preview not available.", "Náhled není k dispozici."));
    return SendThumb(reply, thumb);
  });

  app.get("/storage", async (request) => {
    const view = GetView(request.user);
    const stats = await fs.statfs(view.root);
    const quota = QuotaOf(request.user.id);
    return {
      total: stats.blocks * stats.bsize,
      free: stats.bavail * stats.bsize,
      quota,
      used: quota === null ? null : await DirSize(view.base),
    };
  });

  app.post(
    "/files/folder",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { path: { type: "string", default: "" }, name: { type: "string" }, ...ScopeProps },
        },
      },
    },
    async (request) => {
      const body = request.body as ScopeT & { path: string; name: string };
      const view = ViewFor(request, body);
      AssertWritable(view);
      const { abs } = Resolve(view, body.path);
      const name = ValidName(body.name);
      if (abs === view.root && name === TRASH_DIR) throw new HttpError(400, T("This name is reserved.", "Tenhle název je vyhrazený."));
      await fs.mkdir(path.join(abs, name)).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "EEXIST" ? new HttpError(409, T("An item with this name already exists.", "Položka s tímhle názvem už existuje.")) : error;
      });
      return { name };
    },
  );

  // Jeden soubor na request — klient tak má průběh po souborech a může nahrávat souběžně.
  // `relative` = cesta uvnitř nahrávané složky ("Fotky/2024/a.jpg"), podsložky se vytvoří.
  app.post("/files/upload", { schema: { querystring: PathQuery } }, async (request) => {
    const query = request.query as PathQueryT;
    const view = ViewFor(request, query);
    AssertWritable(view);
    const { abs } = Resolve(view, query.path);
    // Předběžná kontrola podle velikosti requestu — ať se velký soubor vůbec nezačne zapisovat.
    await AssertQuota(view, Number(request.headers["content-length"] ?? 0));
    const file = await request.file();
    if (!file) throw new HttpError(400, T("No file was sent.", "Chybí soubor."));

    const parts = (query.relative || file.filename).split("/").map(ValidName);
    if (abs === view.root && parts[0] === TRASH_DIR) throw new HttpError(400, T("This name is reserved.", "Tenhle název je vyhrazený."));
    const targetDir = path.join(abs, ...parts.slice(0, -1));
    await fs.mkdir(targetDir, { recursive: true });

    // Nejdřív do skrytého dočasného souboru, ať se v seznamu neobjeví napůl nahraný.
    const temp = path.join(targetDir, `${UPLOAD_PREFIX}${randomUUID()}`);
    try {
      await pipeline(file.file, createWriteStream(temp));
      // Znovu se skutečnou velikostí (request bez Content-Length, souběžné uploady).
      await AssertQuota(view, 0);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
    const final = await UniquePath(targetDir, parts[parts.length - 1]);
    await fs.rename(temp, final);
    TouchRecent(request.user.id, RelToRoot(view, final), query.share);
    // "Prefetch": náhled se začne dělat hned, ať je hotový, než si ho někdo otevře.
    if (ThumbKind(final)) GetThumb(final).catch(() => {});
    return { name: path.basename(final) };
  });

  app.post(
    "/files/rename",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "name"],
          properties: { path: { type: "string" }, name: { type: "string" }, ...ScopeProps },
        },
      },
    },
    async (request) => {
      const body = request.body as ScopeT & { path: string; name: string };
      const view = ViewFor(request, body);
      AssertWritable(view);
      const { abs, rel, relToRoot } = Resolve(view, body.path);
      if (!rel) throw new HttpError(400, T("The root folder can't be renamed.", "Kořenovou složku nejde přejmenovat."));
      const source = await StatOrThrow(abs);
      const name = ValidName(body.name);
      const target = path.join(path.dirname(abs), name);
      if (path.dirname(abs) === view.root && name === TRASH_DIR) throw new HttpError(400, T("This name is reserved.", "Tenhle název je vyhrazený."));
      // rename by existující cíl tiše přepsal. Stejný inode = jen jiná velikost písmen na FS bez rozlišení.
      const existing = await fs.stat(target).catch(() => null);
      if (existing && existing.ino !== source.ino) throw new HttpError(409, T("An item with this name already exists.", "Položka s tímhle názvem už existuje."));
      await fs.rename(abs, target);
      RewritePaths(relToRoot, RelToRoot(view, target));
      return { name };
    },
  );

  app.post("/files/move", { schema: { body: PathsBody } }, async (request) => {
    const body = request.body as ScopeT & { paths: string[]; destination?: string };
    const view = ViewFor(request, body);
    AssertWritable(view);
    const destination = Resolve(view, body.destination ?? "").abs;
    if (!(await StatOrThrow(destination)).isDirectory()) throw new HttpError(400, T("The destination is not a folder.", "Cíl není složka."));

    for (const clientPath of body.paths) {
      const { abs, rel, relToRoot } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, T("The root folder can't be moved.", "Kořenovou složku nejde přesunout."));
      if (destination === abs || destination.startsWith(abs + path.sep)) {
        throw new HttpError(400, T("A folder can't be moved into itself.", "Složku nejde přesunout sama do sebe."));
      }
      if (path.dirname(abs) === destination) continue;
      await StatOrThrow(abs);
      const target = await UniquePath(destination, path.basename(abs));
      await MovePath(abs, target);
      RewritePaths(relToRoot, RelToRoot(view, target));
    }
    return { ok: true };
  });

  // Mazání = přesun do koše vlastníka složky. Sdílení zůstávají — po obnovení z koše zase fungují.
  app.post("/files/delete", { schema: { body: PathsBody } }, async (request) => {
    const body = request.body as ScopeT & { paths: string[] };
    const view = ViewFor(request, body);
    AssertWritable(view);
    for (const clientPath of body.paths) {
      const { abs, rel, relToRoot } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, T("The root folder can't be deleted.", "Kořenovou složku nejde smazat."));
      await MoveToTrash(abs, relToRoot);
    }
    return { ok: true };
  });
}
