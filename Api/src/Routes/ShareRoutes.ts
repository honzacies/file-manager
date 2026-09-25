import { randomBytes } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { RequireUser } from "../Auth.ts";
import { Db } from "../Db.ts";
import { PersonById } from "../People.ts";
import { GetRootDir, GetView, HttpError, ListDir, RelFromRoot, Resolve, SendFile, StatOrThrow } from "../Storage.ts";

interface ShareRow {
  token: string;
  user_id: number;
  path: string;
  is_dir: number;
  expires_at: number | null;
  created_at: number;
}

// Platné sdílení nebo 404 — vypršené i neexistující vypadají stejně.
function FindShare(token: string) {
  const row = Db.prepare("SELECT * FROM shares WHERE token = ? AND (expires_at IS NULL OR expires_at > ?)").get(token, Date.now()) as
    | ShareRow
    | undefined;
  if (!row) throw new HttpError(404, "Odkaz neexistuje nebo vypršel.");
  return row;
}

// Uvnitř sdílené složky se smí procházet, u sdíleného souboru jen ten soubor.
function ResolveInShare(share: ShareRow, clientPath: string) {
  const base = path.join(GetRootDir(), ...share.path.split("/"));
  if (!share.is_dir) {
    if (clientPath) throw new HttpError(404, "Soubor neexistuje.");
    return { abs: base, rel: "" };
  }
  return Resolve({ base, prefix: share.path }, clientPath);
}

export async function ShareRoutes(app: FastifyInstance) {
  app.register(async (scope) => {
    scope.addHook("preHandler", RequireUser);

    scope.get("/shares", async (request) => {
      const rows = Db.prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY created_at DESC").all(request.user.id) as unknown as ShareRow[];
      const prefix = `${request.user.username}/`;
      return rows.map((row) => ({
        token: row.token,
        name: path.posix.basename(row.path),
        path: row.path.startsWith(prefix) ? row.path.slice(prefix.length) : row.path,
        isDir: row.is_dir === 1,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));
    });

    scope.post(
      "/shares",
      {
        schema: {
          body: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string" },
              all: { type: "boolean", default: false },
              expiresInDays: { type: ["integer", "null"], minimum: 1, maximum: 365, default: null },
            },
          },
        },
      },
      async (request) => {
        const body = request.body as { path: string; all: boolean; expiresInDays: number | null };
        const { abs, rel, relToRoot } = Resolve(GetView(request.user, { all: body.all }), body.path);
        if (!rel) throw new HttpError(400, "Celou domovskou složku sdílet nejde, vyber konkrétní položku.");
        const stat = await StatOrThrow(abs);
        const token = randomBytes(16).toString("base64url");
        const expiresAt = body.expiresInDays ? Date.now() + body.expiresInDays * 86_400_000 : null;
        Db.prepare("INSERT INTO shares (token, user_id, path, is_dir, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
          token,
          request.user.id,
          relToRoot,
          stat.isDirectory() ? 1 : 0,
          expiresAt,
          Date.now(),
        );
        return { token, expiresAt };
      },
    );

    scope.delete("/shares/:token", async (request) => {
      const { token } = request.params as { token: string };
      Db.prepare("DELETE FROM shares WHERE token = ? AND user_id = ?").run(token, request.user.id);
      return { ok: true };
    });
  });

  // Veřejné — bez přihlášení, jen s tokenem.
  const PublicQuery = {
    type: "object",
    properties: { path: { type: "string", default: "" }, inline: { type: "boolean", default: false } },
  } as const;

  const PublicLimit = { rateLimit: { max: 300, timeWindow: "1 minute" } };

  app.get("/public/shares/:token", { config: PublicLimit, schema: { querystring: PublicQuery } }, async (request) => {
    const share = FindShare((request.params as { token: string }).token);
    const { path: clientPath } = request.query as { path: string };
    const { abs, rel } = ResolveInShare(share, clientPath);
    const stat = await StatOrThrow(abs);
    const owner = PersonById(share.user_id);
    return {
      name: path.posix.basename(share.path),
      owner: owner?.name ?? null,
      expiresAt: share.expires_at,
      isDir: stat.isDirectory(),
      path: rel,
      size: stat.isDirectory() ? 0 : stat.size,
      // Barvy složek ano, hvězdičky ne — ty jsou osobní.
      entries: stat.isDirectory() ? await ListDir(abs, false, RelFromRoot(GetRootDir(), abs)) : [],
    };
  });

  app.get("/public/shares/:token/download", { config: PublicLimit, schema: { querystring: PublicQuery } }, async (request, reply) => {
    const share = FindShare((request.params as { token: string }).token);
    const query = request.query as { path: string; inline: boolean };
    return SendFile(request, reply, ResolveInShare(share, query.path).abs, query.inline);
  });
}
