import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { RequireUser } from "../Auth.ts";
import { Db } from "../Db.ts";
import { AllPeople, PersonById } from "../People.ts";
import { GetRootDir, GetView, HttpError, Resolve, StatOrThrow } from "../Storage.ts";
import { T } from "../Lang.ts";

interface UserShareRow {
  id: number;
  owner_id: number;
  recipient_id: number;
  path: string;
  is_dir: number;
  can_write: number;
  created_at: number;
}

// Sdílení, které request.user vlastní — jinak 404 (cizí sdílení nesmí prozradit, že existuje).
function OwnShare(id: number, userId: number) {
  const row = Db.prepare("SELECT * FROM user_shares WHERE id = ? AND owner_id = ?").get(id, userId) as UserShareRow | undefined;
  if (!row) throw new HttpError(404, T("Share not found.", "Sdílení neexistuje."));
  return row;
}

// Cesta pro zobrazení: vlastní soubory bez "username/" na začátku.
function DisplayPath(fullPath: string, username: string) {
  return fullPath.startsWith(`${username}/`) ? fullPath.slice(username.length + 1) : fullPath;
}

const AbsPath = (relToRoot: string) => path.join(GetRootDir(), ...relToRoot.split("/"));
const Exists = (relToRoot: string) => existsSync(AbsPath(relToRoot));

// Starší notifikace jsou jen česky (prostý text), nové JSON s oběma jazyky.
function NotificationText(text: string) {
  if (!text.startsWith("{")) return text;
  const both = JSON.parse(text) as { en: string; cs: string };
  return T(both.en, both.cs);
}

export async function UserShareRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  // Komu jde sdílet — jen jména, nic dalšího o účtech.
  app.get("/users/directory", async (request) => AllPeople().filter((person) => person.id !== request.user.id));

  // S kým je konkrétní položka sdílená (pro dialog sdílení).
  app.get(
    "/user-shares",
    {
      schema: {
        querystring: { type: "object", required: ["path"], properties: { path: { type: "string" }, all: { type: "boolean", default: false } } },
      },
    },
    async (request) => {
      const query = request.query as { path: string; all: boolean };
      const { relToRoot } = Resolve(GetView(request.user, { all: query.all }), query.path);
      return Db.prepare(`
        SELECT s.id, s.recipient_id AS recipientId, s.can_write AS canWrite
        FROM user_shares s WHERE s.owner_id = ? AND s.path = ?
      `)
        .all(request.user.id, relToRoot)
        .map((row) => {
          const share = row as { id: number; recipientId: number; canWrite: number };
          return { id: share.id, recipient: PersonById(share.recipientId), canWrite: share.canWrite === 1 };
        });
    },
  );

  app.post(
    "/user-shares",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "recipientIds"],
          properties: {
            path: { type: "string" },
            all: { type: "boolean", default: false },
            recipientIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 100 },
            canWrite: { type: "boolean", default: false },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as { path: string; all: boolean; recipientIds: number[]; canWrite: boolean };
      // Sdílet jde jen z vlastních souborů (nebo adminovi z "Všech souborů") — ne dál přeposílat cizí sdílení.
      const { abs, rel, relToRoot } = Resolve(GetView(request.user, { all: body.all }), body.path);
      if (!rel) throw new HttpError(400, T("You can't share your whole home folder. Pick a specific item.", "Celou domovskou složku sdílet nejde, vyber konkrétní položku."));
      const isDir = (await StatOrThrow(abs)).isDirectory();
      const name = path.posix.basename(relToRoot);

      const insert = Db.prepare(`
        INSERT INTO user_shares (owner_id, recipient_id, path, is_dir, can_write, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (recipient_id, path) DO UPDATE SET can_write = excluded.can_write
        RETURNING id, (created_at = ?) AS is_new -- u existujícího řádku zůstane původní created_at
      `);
      const notify = Db.prepare("INSERT INTO notifications (user_id, text, share_id, created_at) VALUES (?, ?, ?, ?)");
      const now = Date.now();
      let added = 0;
      for (const recipientId of new Set(body.recipientIds)) {
        if (recipientId === request.user.id) continue;
        if (!Db.prepare("SELECT 1 FROM users WHERE id = ?").get(recipientId)) throw new HttpError(400, T("No such user.", "Takový uživatel neexistuje."));
        const row = insert.get(request.user.id, recipientId, relToRoot, isDir ? 1 : 0, body.canWrite ? 1 : 0, now, now) as { id: number; is_new: number };
        // Notifikace jen při novém sdílení, ne při změně oprávnění.
        if (row.is_new) {
          // Text v obou jazycích — jazyk příjemce se pozná až při čtení.
          const who = PersonById(request.user.id)?.name;
          const text = JSON.stringify({
            en: `${who} shared the ${isDir ? "folder" : "file"} “${name}” with you`,
            cs: `${who} s tebou sdílí ${isDir ? "složku" : "soubor"} „${name}“`,
          });
          notify.run(recipientId, text, row.id, now);
          added++;
        }
      }
      return { added };
    },
  );

  app.patch(
    "/user-shares/:id",
    { schema: { body: { type: "object", required: ["canWrite"], properties: { canWrite: { type: "boolean" } } } } },
    async (request) => {
      const share = OwnShare(Number((request.params as { id: string }).id), request.user.id);
      Db.prepare("UPDATE user_shares SET can_write = ? WHERE id = ?").run((request.body as { canWrite: boolean }).canWrite ? 1 : 0, share.id);
      return { ok: true };
    },
  );

  // Zrušit může vlastník, příjemce si sdílení může odebrat ze svého seznamu.
  app.delete("/user-shares/:id", async (request) => {
    const id = Number((request.params as { id: string }).id);
    const result = Db.prepare("DELETE FROM user_shares WHERE id = ? AND (owner_id = ? OR recipient_id = ?)").run(id, request.user.id, request.user.id);
    if (!result.changes) throw new HttpError(404, T("Share not found.", "Sdílení neexistuje."));
    return { ok: true };
  });

  // Co mi ostatní nasdíleli. Smazané položky (v koši) se nezobrazují, po obnovení se vrátí.
  app.get("/user-shares/incoming", async (request) => {
    const rows = Db.prepare(`
      SELECT s.*, u.username AS owner FROM user_shares s JOIN users u ON u.id = s.owner_id
      WHERE s.recipient_id = ? ORDER BY s.created_at DESC
    `).all(request.user.id) as unknown as (UserShareRow & { owner: string })[];
    return rows
      .filter((row) => Exists(row.path))
      .map((row) => ({
        id: row.id,
        name: path.posix.basename(row.path),
        owner: PersonById(row.owner_id),
        isDir: row.is_dir === 1,
        canWrite: row.can_write === 1 && row.is_dir === 1,
        size: row.is_dir ? 0 : (statSync(AbsPath(row.path), { throwIfNoEntry: false })?.size ?? 0),
        createdAt: row.created_at,
      }));
  });

  // Co jsem nasdílel já (správa na stránce Sdílení).
  app.get("/user-shares/outgoing", async (request) => {
    const rows = Db.prepare(`
      SELECT s.*, u.username AS recipient FROM user_shares s JOIN users u ON u.id = s.recipient_id
      WHERE s.owner_id = ? ORDER BY s.path, u.username
    `).all(request.user.id) as unknown as (UserShareRow & { recipient: string })[];
    return rows.map((row) => ({
      id: row.id,
      name: path.posix.basename(row.path),
      path: DisplayPath(row.path, request.user.username),
      recipient: PersonById(row.recipient_id),
      isDir: row.is_dir === 1,
      canWrite: row.can_write === 1,
      missing: !Exists(row.path),
      createdAt: row.created_at,
    }));
  });

  app.get("/notifications", async (request) => {
    const items = Db.prepare(`
      SELECT n.id, n.text, n.share_id AS shareId, s.is_dir AS isDir, n.created_at AS createdAt, n.read_at AS readAt
      FROM notifications n LEFT JOIN user_shares s ON s.id = n.share_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 30
    `)
      .all(request.user.id)
      .map((row) => ({ ...row, text: NotificationText(row.text as string), isDir: row.isDir === null ? null : row.isDir === 1 }));
    const { unread } = Db.prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL").get(request.user.id) as {
      unread: number;
    };
    return { unread, items };
  });

  // Bez `ids` = označit vše.
  app.post(
    "/notifications/read",
    { schema: { body: { type: "object", properties: { ids: { type: "array", items: { type: "integer" }, maxItems: 100 } } } } },
    async (request) => {
      const { ids } = request.body as { ids?: number[] };
      const now = Date.now();
      if (ids?.length) {
        Db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).run(
          now,
          request.user.id,
          ...ids,
        );
      } else {
        Db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now, request.user.id);
      }
      return { ok: true };
    },
  );
}
