import { createReadStream, existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { RequireUser } from "../Auth.ts";
import { Db } from "../Db.ts";
import { AVATAR_DIR, AvatarPath, NormalizeName, PersonById } from "../People.ts";
import { HttpError } from "../Storage.ts";
import { T } from "../Lang.ts";

const AVATAR_MAX_BYTES = 512 * 1024;

// WebP = "RIFF" + 4 bajty délky + "WEBP". Prohlížeč posílá vždy WebP z canvasu; nic jiného se neukládá.
const IsWebp = (buffer: Buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";

export async function ProfileRoutes(app: FastifyInstance) {
  app.addHook("preHandler", RequireUser);

  app.put(
    "/account/profile",
    {
      schema: {
        body: {
          type: "object",
          required: ["firstName", "lastName"],
          properties: { firstName: { type: "string", maxLength: 50 }, lastName: { type: "string", maxLength: 50 } },
        },
      },
    },
    async (request) => {
      const body = request.body as { firstName: string; lastName: string };
      Db.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?").run(NormalizeName(body.firstName), NormalizeName(body.lastName), request.user.id);
      return PersonById(request.user.id);
    },
  );

  // null = automaticky
  app.put(
    "/account/lang",
    { schema: { body: { type: "object", required: ["lang"], properties: { lang: { type: ["string", "null"], enum: ["en", "cs", null] } } } } },
    async (request) => {
      const { lang } = request.body as { lang: "en" | "cs" | null };
      Db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(lang, request.user.id);
      return { lang };
    },
  );

  app.post("/account/avatar", async (request) => {
    const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES } });
    if (!file) throw new HttpError(400, T("No image was sent.", "Chybí obrázek."));
    const buffer = await file.toBuffer().catch(() => {
      throw new HttpError(413, T("The image is too large.", "Obrázek je moc velký."));
    });
    if (file.file.truncated) throw new HttpError(413, T("The image is too large.", "Obrázek je moc velký."));
    if (!IsWebp(buffer)) throw new HttpError(400, T("The image must be WebP (the app converts it automatically).", "Obrázek musí být WebP (appka ho převádí sama)."));
    mkdirSync(AVATAR_DIR, { recursive: true });
    // Nejdřív do dočasného souboru, ať nikdo nedostane napůl zapsaný obrázek.
    const target = AvatarPath(request.user.id);
    await fs.writeFile(`${target}.tmp`, buffer);
    await fs.rename(`${target}.tmp`, target);
    Db.prepare("UPDATE users SET avatar_version = ? WHERE id = ?").run(Date.now(), request.user.id);
    return PersonById(request.user.id);
  });

  app.delete("/account/avatar", async (request) => {
    await fs.rm(AvatarPath(request.user.id), { force: true });
    Db.prepare("UPDATE users SET avatar_version = NULL WHERE id = ?").run(request.user.id);
    return PersonById(request.user.id);
  });

  // Avatar vidí jen přihlášení. `?v=` v URL mění verzi, takže se smí cachovat napořád.
  app.get("/users/:id/avatar", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const file = AvatarPath(id);
    if (!Number.isInteger(id) || !existsSync(file)) throw new HttpError(404, T("Avatar not found.", "Avatar neexistuje."));
    return reply
      .header("Content-Type", "image/webp")
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(createReadStream(file));
  });
}
