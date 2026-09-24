import { constants, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HashPassword, RequireAdmin, RequireUser, VerifyPassword } from "../Auth.ts";
import { Db, SetSetting } from "../Db.ts";
import { Env } from "../Env.ts";
import { GetRootDir, HttpError } from "../Storage.ts";

const USERNAME = { type: "string", pattern: "^[A-Za-z0-9_-][A-Za-z0-9_.-]{1,31}$" } as const;
const PASSWORD = { type: "string", minLength: 8, maxLength: 256 } as const;
const ROLE = { type: "string", enum: ["admin", "user"] } as const;

// Akce, po které vlastník účtu ztratí přístup (reset hesla, smazání), musí
// potvrdit heslem ten, kdo ji dělá — platná session nestačí.
async function RequireOwnPassword(request: FastifyRequest, password: string | undefined) {
  const row = Db.prepare("SELECT password_hash FROM users WHERE id = ?").get(request.user.id) as { password_hash: string };
  if (!password || !(await VerifyPassword(row.password_hash, password))) {
    throw new HttpError(403, "Tvoje heslo nesedí.");
  }
}

function AdminCount() {
  return (Db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

export async function AdminRoutes(app: FastifyInstance) {
  // Guard na celé skupině — nový endpoint se nedá zapomenout ochránit.
  app.addHook("preHandler", RequireUser);
  app.addHook("preHandler", RequireAdmin);

  app.get("/admin/users", async () => {
    const rows = Db.prepare("SELECT id, username, role, created_at FROM users ORDER BY username").all() as {
      id: number;
      username: string;
      role: string;
      created_at: number;
    }[];
    return rows.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at }));
  });

  app.post(
    "/admin/users",
    {
      schema: {
        body: { type: "object", required: ["username", "password", "role"], properties: { username: USERNAME, password: PASSWORD, role: ROLE } },
      },
    },
    async (request) => {
      const { username, password, role } = request.body as { username: string; password: string; role: string };
      if (Db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "Uživatel s tímhle jménem už existuje.");
      const result = Db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)").run(
        username,
        await HashPassword(password),
        role,
        Date.now(),
      );
      mkdirSync(path.join(GetRootDir(), username), { recursive: true });
      return { id: Number(result.lastInsertRowid) };
    },
  );

  app.patch(
    "/admin/users/:id",
    {
      schema: {
        body: { type: "object", properties: { role: ROLE, newPassword: PASSWORD, currentPassword: { type: "string" } } },
      },
    },
    async (request) => {
      const id = Number((request.params as { id: string }).id);
      const body = request.body as { role?: string; newPassword?: string; currentPassword?: string };
      const target = Db.prepare("SELECT id, role FROM users WHERE id = ?").get(id) as { id: number; role: string } | undefined;
      if (!target) throw new HttpError(404, "Uživatel neexistuje.");

      if (body.newPassword) await RequireOwnPassword(request, body.currentPassword);
      if (body.role && body.role !== target.role) {
        if (target.role === "admin" && AdminCount() <= 1) throw new HttpError(400, "Poslední admin musí zůstat adminem.");
        Db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, id);
      }
      if (body.newPassword) {
        Db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await HashPassword(body.newPassword), id);
        // Po resetu hesla odhlásit všechna zařízení toho účtu.
        if (id !== request.user.id) Db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      }
      return { ok: true };
    },
  );

  app.delete(
    "/admin/users/:id",
    { schema: { body: { type: "object", required: ["currentPassword"], properties: { currentPassword: { type: "string" } } } } },
    async (request) => {
      const id = Number((request.params as { id: string }).id);
      if (id === request.user.id) throw new HttpError(400, "Sám sebe smazat nemůžeš.");
      await RequireOwnPassword(request, (request.body as { currentPassword: string }).currentPassword);
      // Soubory na disku zůstávají — smazání účtu nemá tiše smazat data.
      Db.prepare("DELETE FROM users WHERE id = ?").run(id);
      return { ok: true };
    },
  );

  app.get("/admin/settings", async () => {
    const rootDir = GetRootDir();
    const stats = await fs.statfs(rootDir).catch(() => null);
    return {
      rootDir,
      defaultRootDir: Env.DefaultRootDir,
      disk: stats ? { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize } : null,
    };
  });

  app.put(
    "/admin/settings",
    { schema: { body: { type: "object", required: ["rootDir"], properties: { rootDir: { type: "string", minLength: 1 } } } } },
    async (request) => {
      const { rootDir } = request.body as { rootDir: string };
      if (!path.isAbsolute(rootDir)) throw new HttpError(400, "Cesta musí být absolutní (začínat /).");
      const resolved = path.resolve(rootDir);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) throw new HttpError(400, "Tahle složka neexistuje.");
      await fs.access(resolved, constants.W_OK).catch(() => {
        throw new HttpError(400, "Server do téhle složky nemůže zapisovat.");
      });
      SetSetting("root_dir", resolved);
      return { rootDir: resolved };
    },
  );

  // Procházení disku serveru pro výběr kořenové složky (jen složky).
  app.get(
    "/admin/browse",
    { schema: { querystring: { type: "object", properties: { path: { type: "string", default: "/" } } } } },
    async (request) => {
      const current = path.resolve((request.query as { path: string }).path || "/");
      const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => {
        throw new HttpError(400, "Do téhle složky se nedá nahlédnout.");
      });
      const parent = path.dirname(current);
      return {
        path: current,
        parent: parent === current ? null : parent,
        dirs: dirents
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b)),
      };
    },
  );
}
