import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { PurgeExpiredSessions } from "./Auth.ts";
import { Env } from "./Env.ts";
import { AdminRoutes } from "./Routes/AdminRoutes.ts";
import { AuthRoutes } from "./Routes/AuthRoutes.ts";
import { FileRoutes } from "./Routes/FileRoutes.ts";
import { OrganizeRoutes } from "./Routes/OrganizeRoutes.ts";
import { ProfileRoutes } from "./Routes/ProfileRoutes.ts";
import { ShareRoutes } from "./Routes/ShareRoutes.ts";
import { TrashRoutes } from "./Routes/TrashRoutes.ts";
import { UserShareRoutes } from "./Routes/UserShareRoutes.ts";
import { HttpError, PurgeOldTrash } from "./Storage.ts";
import { PurgeOldThumbs } from "./Thumbs.ts";

// 'unsafe-inline' kvůli inline skriptům Next.js bez nonce.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

type AppError = Error & { statusCode?: number; code?: string; validation?: unknown };

export async function BuildApp() {
  // Jen varování a chyby — log každého requestu by na domácím serveru jen zahlcoval `docker logs`.
  // trustProxy: IP klienta z X-Forwarded-For jen od lokální proxy (tailscale serve, Caddy, cloudflared
  // na hostiteli -> Docker brána 172.16/12). Přímé spojení z LAN hlavičku podvrhnout nemůže.
  const app = Fastify({ logger: { level: "warn" }, trustProxy: ["127.0.0.1", "::1", "172.16.0.0/12"] });

  await app.register(cookie);
  // Domácí server — velikost souboru neomezujeme.
  await app.register(multipart, { limits: { fileSize: Number.POSITIVE_INFINITY, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error: AppError, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    if (error.validation) return reply.code(400).send({ error: "Neplatný požadavek." });
    if (error.code === "ENOENT") return reply.code(404).send({ error: "Soubor nebo složka neexistuje." });
    if (error.code === "EACCES" || error.code === "EPERM") return reply.code(403).send({ error: "Server k tomuhle nemá na disku přístup." });
    if (error.code === "ENOSPC") return reply.code(507).send({ error: "Na disku došlo místo." });
    if (error.code === "ENAMETOOLONG") return reply.code(400).send({ error: "Název nebo cesta je moc dlouhá." });
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ error: status >= 500 && Env.IsProduction ? "Něco se pokazilo. Zkus to znovu." : error.message });
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
      reply.header("Content-Security-Policy", PAGE_CSP);
    }
  });

  await app.register(
    async (api) => {
      await api.register(AuthRoutes);
      await api.register(FileRoutes);
      await api.register(OrganizeRoutes);
      await api.register(ProfileRoutes);
      await api.register(TrashRoutes);
      await api.register(ShareRoutes);
      await api.register(UserShareRoutes);
      await api.register(AdminRoutes);
      api.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Neznámý endpoint." }));
    },
    { prefix: "/api" },
  );

  if (Env.WebDir) {
    // Statický export Next.js (`trailingSlash: true` -> /files/index.html).
    await app.register(fastifyStatic, { root: Env.WebDir, redirect: true });
    // Wildcard routa statiky chytá i GET /api/neco — ty mají dostat JSON, ne HTML stránku.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/") ? reply.code(404).send({ error: "Neznámý endpoint." }) : reply.code(404).sendFile("404.html"),
    );
  }

  return app;
}

if (import.meta.main) {
  const app = await BuildApp();
  const Housekeeping = () => {
    PurgeExpiredSessions();
    PurgeOldTrash().catch((error) => app.log.error(error));
    PurgeOldThumbs().catch((error) => app.log.error(error));
  };
  Housekeeping();
  setInterval(Housekeeping, 6 * 3_600_000).unref();

  await app.listen({ port: Env.Port, host: Env.Host });
  console.log(`\x1b[1;31m●\x1b[0m Cloud běží na http://${Env.Host}:${Env.Port}`);
}
