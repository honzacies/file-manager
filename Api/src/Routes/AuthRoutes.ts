import type { FastifyInstance } from "fastify";
import { CreateSession, DeleteOtherSessions, DeleteSession, HashPassword, RequireOwnPassword, RequireUser, SESSION_COOKIE, type SessionUser, VerifyPassword } from "../Auth.ts";
import { Db } from "../Db.ts";
import { PersonById } from "../People.ts";
import { HttpError } from "../Storage.ts";

export async function AuthRoutes(app: FastifyInstance) {
  app.post(
    "/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: { username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const user = Db.prepare("SELECT id, username, role, password_hash FROM users WHERE username = ?").get(username.trim()) as
        | (SessionUser & { password_hash: string })
        | undefined;
      // Stejná hláška i doba pro neexistující jméno a špatné heslo.
      if (!(await VerifyPassword(user?.password_hash, password)) || !user) {
        throw new HttpError(401, "Špatné jméno nebo heslo.");
      }
      const session = CreateSession(user.id);
      reply.setCookie(SESSION_COOKIE, session.token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: "auto",
        maxAge: session.maxAge,
      });
      return { id: user.id, username: user.username, role: user.role };
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) DeleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.register(async (scope) => {
    scope.addHook("preHandler", RequireUser);

    // Role z relace + jméno a avatar pro zobrazení.
    scope.get("/auth/me", async (request) => ({ ...PersonById(request.user.id), role: request.user.role }));

    scope.post(
      "/account/password",
      {
        schema: {
          body: {
            type: "object",
            required: ["currentPassword", "newPassword"],
            properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 8, maxLength: 256 } },
          },
        },
      },
      async (request) => {
        const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
        await RequireOwnPassword(request.user.id, currentPassword, "Současné heslo nesedí.");
        Db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await HashPassword(newPassword), request.user.id);
        // Ostatní zařízení odhlásit, aktuální relace zůstává.
        DeleteOtherSessions(request.user.id, request.cookies[SESSION_COOKIE] ?? "");
        return { ok: true };
      },
    );
  });
}
