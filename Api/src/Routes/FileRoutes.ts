import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { RequireUser } from "../Auth.ts";
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
  Resolve,
  RewriteSharedPaths,
  SendFile,
  StatOrThrow,
  TRASH_DIR,
  UniquePath,
  UPLOAD_PREFIX,
  ValidName,
  type View,
} from "../Storage.ts";

// Rozsah, ve kterém klient pracuje: `all` = admin v "Všech souborech" (běžnému uživateli se
// ignoruje), `share` = id sdílení, které mu někdo poslal (server ověří, že je příjemce).
const ScopeProps = {
  all: { type: "boolean", default: false },
  share: { type: "integer", minimum: 1 },
} as const;

const PathQuery = {
  type: "object",
  properties: {
    path: { type: "string", default: "" },
    inline: { type: "boolean", default: false },
    relative: { type: "string", default: "" },
    ...ScopeProps,
  },
} as const;

interface ScopeT {
  all: boolean;
  share?: number;
}

interface PathQueryT extends ScopeT {
  path: string;
  inline: boolean;
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

const ViewFor = (request: FastifyRequest, scope: ScopeT) => GetView(request.user, { all: scope.all, share: scope.share });

// Absolutní cesta -> relativní ke kořeni cloudu ("/cloud/alice/Fotky" -> "alice/Fotky")
const RelToRoot = (view: View, abs: string) => path.relative(view.root, abs).split(path.sep).join("/");

export async function FileRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  app.get("/files", { schema: { querystring: PathQuery } }, async (request) => {
    const query = request.query as PathQueryT;
    const view = ViewFor(request, query);
    const { abs, rel } = Resolve(view, query.path);
    if (!(await StatOrThrow(abs)).isDirectory()) throw new HttpError(400, "Tohle není složka.");
    return { path: rel, readOnly: view.readOnly, entries: await ListDir(abs, abs === view.root) };
  });

  app.get("/files/download", { schema: { querystring: PathQuery } }, async (request, reply) => {
    const query = request.query as PathQueryT;
    const view = ViewFor(request, query);
    const { abs, rel } = Resolve(view, query.path);
    // Sdílený soubor je sám "kořenem" sdílení, jinak musí být vybraný konkrétní soubor.
    if (!rel && !view.isFile) throw new HttpError(400, "Vyber soubor.");
    return SendFile(request, reply, abs, query.inline);
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
      if (abs === view.root && name === TRASH_DIR) throw new HttpError(400, "Tenhle název je vyhrazený.");
      await fs.mkdir(path.join(abs, name)).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "EEXIST" ? new HttpError(409, "Položka s tímhle názvem už existuje.") : error;
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
    if (!file) throw new HttpError(400, "Chybí soubor.");

    const parts = (query.relative || file.filename).split("/").map(ValidName);
    if (abs === view.root && parts[0] === TRASH_DIR) throw new HttpError(400, "Tenhle název je vyhrazený.");
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
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde přejmenovat.");
      const source = await StatOrThrow(abs);
      const name = ValidName(body.name);
      const target = path.join(path.dirname(abs), name);
      if (path.dirname(abs) === view.root && name === TRASH_DIR) throw new HttpError(400, "Tenhle název je vyhrazený.");
      // rename by existující cíl tiše přepsal. Stejný inode = jen jiná velikost písmen na FS bez rozlišení.
      const existing = await fs.stat(target).catch(() => null);
      if (existing && existing.ino !== source.ino) throw new HttpError(409, "Položka s tímhle názvem už existuje.");
      await fs.rename(abs, target);
      RewriteSharedPaths(relToRoot, RelToRoot(view, target));
      return { name };
    },
  );

  app.post("/files/move", { schema: { body: PathsBody } }, async (request) => {
    const body = request.body as ScopeT & { paths: string[]; destination?: string };
    const view = ViewFor(request, body);
    AssertWritable(view);
    const destination = Resolve(view, body.destination ?? "").abs;
    if (!(await StatOrThrow(destination)).isDirectory()) throw new HttpError(400, "Cíl není složka.");

    for (const clientPath of body.paths) {
      const { abs, rel, relToRoot } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde přesunout.");
      if (destination === abs || destination.startsWith(abs + path.sep)) {
        throw new HttpError(400, "Složku nejde přesunout sama do sebe.");
      }
      if (path.dirname(abs) === destination) continue;
      await StatOrThrow(abs);
      const target = await UniquePath(destination, path.basename(abs));
      await MovePath(abs, target);
      RewriteSharedPaths(relToRoot, RelToRoot(view, target));
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
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde smazat.");
      await MoveToTrash(abs, relToRoot);
    }
    return { ok: true };
  });
}
