import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Env } from "./Env.ts";

mkdirSync(Env.DataDir, { recursive: true });

export const Db = new DatabaseSync(path.join(Env.DataDir, "cloud.db"));

Db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- original_path je relativní ke kořeni cloudu, trash_path absolutní cesta v .trash
  CREATE TABLE IF NOT EXISTS trash (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,
    original_path TEXT NOT NULL,
    trash_path    TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_dir        INTEGER NOT NULL,
    size          INTEGER NOT NULL,
    deleted_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    is_dir     INTEGER NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- Sdílení s konkrétním uživatelem. path je relativní ke kořeni cloudu.
  CREATE TABLE IF NOT EXISTS user_shares (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    is_dir       INTEGER NOT NULL,
    can_write    INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    UNIQUE (recipient_id, path)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    share_id   INTEGER REFERENCES user_shares(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  );
`);

// Migrace: sloupec přidaný po první verzi. NULL = bez limitu.
const userColumns = Db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "quota_bytes")) Db.exec("ALTER TABLE users ADD COLUMN quota_bytes INTEGER");

export function GetSetting(key: string): string | undefined {
  const row = Db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function SetSetting(key: string, value: string) {
  Db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
