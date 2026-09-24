import type { FastifyInstance, FastifyRequest } from "fastify";
import { RequireUser } from "../Auth.ts";
import { Db } from "../Db.ts";
import { PurgeFromTrash, RestoreFromTrash, TRASH_RETENTION_DAYS, type TrashRow } from "../Storage.ts";

const IdsBody = {
  type: "object",
  required: ["ids"],
  properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 } },
} as const;

// Uživatel vidí jen položky ze svojí složky, admin s `all` všechny.
function Rows(request: FastifyRequest, all: boolean, ids?: string[]) {
  const seeAll = all && request.user.role === "admin";
  // Admin smí obnovit/smazat cokoliv, i když zrovna kouká jen na svoje.
  const canTouchAll = ids && request.user.role === "admin";
  const where = [seeAll || canTouchAll ? "1 = 1" : "owner = ?"];
  const params: string[] = seeAll || canTouchAll ? [] : [request.user.username];
  if (ids) {
    where.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  return Db.prepare(`SELECT * FROM trash WHERE ${where.join(" AND ")} ORDER BY deleted_at DESC`).all(...params) as unknown as TrashRow[];
}

export async function TrashRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  app.get("/trash", { schema: { querystring: { type: "object", properties: { all: { type: "boolean", default: false } } } } }, async (request) => {
    const { all } = request.query as { all: boolean };
    const prefix = `${request.user.username}/`;
    return {
      retentionDays: TRASH_RETENTION_DAYS,
      items: Rows(request, all).map((row) => ({
        id: row.id,
        name: row.name,
        // Uživateli ukazovat cestu od jeho "/", ne od kořene cloudu.
        originalPath: all || !row.original_path.startsWith(prefix) ? row.original_path : row.original_path.slice(prefix.length),
        isDir: row.is_dir === 1,
        size: row.size,
        deletedAt: row.deleted_at,
      })),
    };
  });

  app.post("/trash/restore", { schema: { body: IdsBody } }, async (request) => {
    const { ids } = request.body as { ids: string[] };
    for (const row of Rows(request, false, ids)) await RestoreFromTrash(row);
    return { ok: true };
  });

  app.post("/trash/delete", { schema: { body: IdsBody } }, async (request) => {
    const { ids } = request.body as { ids: string[] };
    for (const row of Rows(request, false, ids)) await PurgeFromTrash(row);
    return { ok: true };
  });

  app.post("/trash/empty", { schema: { body: { type: "object", properties: { all: { type: "boolean", default: false } } } } }, async (request) => {
    const { all } = request.body as { all: boolean };
    for (const row of Rows(request, all)) await PurgeFromTrash(row);
    return { ok: true };
  });
}
