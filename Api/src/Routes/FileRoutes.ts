import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { RequireUser } from "../Auth.ts";
import {
  AssertQuota,
  DirSize,
  GetView,
  HttpError,
  ListDir,
  MovePath,
  MoveToTrash,
  QuotaOf,
  Resolve,
  SendFile,
  StatOrThrow,
  TRASH_DIR,
  UniquePath,
  UPLOAD_PREFIX,
  ValidName,
} from "../Storage.ts";

// `all` = admin v režimu "Všechny soubory". Běžnému uživateli se ignoruje (GetView).
const PathQuery = {
  type: "object",
  properties: {
    path: { type: "string", default: "" },
    all: { type: "boolean", default: false },
    inline: { type: "boolean", default: false },
    relative: { type: "string", default: "" },
  },
} as const;

interface PathQueryT {
  path: string;
  all: boolean;
  inline: boolean;
  relative: string;
}

const PathsBody = {
  type: "object",
  required: ["paths"],
  properties: {
    paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 },
    destination: { type: "string" },
    all: { type: "boolean", default: false },
  },
} as const;

export async function FileRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  app.get("/files", { schema: { querystring: PathQuery } }, async (request) => {
    const query = request.query as PathQueryT;
    const view = GetView(request.user, query.all);
    const { abs, rel } = Resolve(view, query.path);
    if (!(await StatOrThrow(abs)).isDirectory()) throw new HttpError(400, "Tohle není složka.");
    return { path: rel, entries: await ListDir(abs, abs === view.root) };
  });

  app.get("/files/download", { schema: { querystring: PathQuery } }, async (request, reply) => {
    const query = request.query as PathQueryT;
    const { abs, rel } = Resolve(GetView(request.user, query.all), query.path);
    if (!rel) throw new HttpError(400, "Vyber soubor.");
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
          properties: { path: { type: "string", default: "" }, name: { type: "string" }, all: { type: "boolean", default: false } },
        },
      },
    },
    async (request) => {
      const body = request.body as { path: string; name: string; all: boolean };
      const view = GetView(request.user, body.all);
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
    const view = GetView(request.user, query.all);
    const { abs } = Resolve(view, query.path);
    // Předběžná kontrola podle velikosti requestu — ať se velký soubor vůbec nezačne zapisovat.
    await AssertQuota(view, request.user.id, Number(request.headers["content-length"] ?? 0));
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
      await AssertQuota(view, request.user.id, 0);
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
          properties: { path: { type: "string" }, name: { type: "string" }, all: { type: "boolean", default: false } },
        },
      },
    },
    async (request) => {
      const body = request.body as { path: string; name: string; all: boolean };
      const view = GetView(request.user, body.all);
      const { abs, rel } = Resolve(view, body.path);
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde přejmenovat.");
      const source = await StatOrThrow(abs);
      const name = ValidName(body.name);
      const target = path.join(path.dirname(abs), name);
      if (path.dirname(abs) === view.root && name === TRASH_DIR) throw new HttpError(400, "Tenhle název je vyhrazený.");
      // rename by existující cíl tiše přepsal. Stejný inode = jen jiná velikost písmen na FS bez rozlišení.
      const existing = await fs.stat(target).catch(() => null);
      if (existing && existing.ino !== source.ino) throw new HttpError(409, "Položka s tímhle názvem už existuje.");
      await fs.rename(abs, target);
      return { name };
    },
  );

  app.post("/files/move", { schema: { body: PathsBody } }, async (request) => {
    const body = request.body as { paths: string[]; destination?: string; all: boolean };
    const view = GetView(request.user, body.all);
    const destination = Resolve(view, body.destination ?? "").abs;
    if (!(await StatOrThrow(destination)).isDirectory()) throw new HttpError(400, "Cíl není složka.");

    for (const clientPath of body.paths) {
      const { abs, rel } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde přesunout.");
      if (destination === abs || destination.startsWith(abs + path.sep)) {
        throw new HttpError(400, "Složku nejde přesunout sama do sebe.");
      }
      if (path.dirname(abs) === destination) continue;
      await StatOrThrow(abs);
      await MovePath(abs, await UniquePath(destination, path.basename(abs)));
    }
    return { ok: true };
  });

  // Mazání = přesun do koše.
  app.post("/files/delete", { schema: { body: PathsBody } }, async (request) => {
    const body = request.body as { paths: string[]; all: boolean };
    const view = GetView(request.user, body.all);
    for (const clientPath of body.paths) {
      const { abs, rel, relToRoot } = Resolve(view, clientPath);
      if (!rel) throw new HttpError(400, "Kořenovou složku nejde smazat.");
      await MoveToTrash(abs, relToRoot);
    }
    return { ok: true };
  });
}
