import path from "node:path";

// Konfigurace se ověřuje hned při startu — ať server spadne s jasnou hláškou,
// ne až při prvním requestu.
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid environment configuration:\n  PORT: "${process.env.PORT}" is not a valid port`);
  process.exit(1);
}

export const Env = {
  Port: port,
  Host: process.env.LISTEN_HOST ?? "127.0.0.1",
  // SQLite databáze, nic jiného.
  DataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  // Výchozí kořen cloudu, admin ho pak může změnit v nastavení.
  DefaultRootDir: path.resolve(process.env.DEFAULT_ROOT_DIR ?? "./cloud"),
  // Statický export Next.js webu. Bez něj běží jen API (dev: web jede přes `next dev`).
  WebDir: process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null,
  IsProduction: process.env.NODE_ENV === "production",
};
