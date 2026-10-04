// Založí admina, nebo existujícímu účtu nastaví heslo a roli admin (obnova přístupu).
// Použití: node src/Scripts/CreateAdmin.ts <username>   (heslo se čte ze stdin)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { HashPassword } from "../Auth.ts";
import { Db } from "../Db.ts";
import { GetRootDir } from "../Storage.ts";

const Fail = (message: string) => {
  console.error(`\x1b[1;31m✗\x1b[0m ${message}`);
  process.exit(1);
};

const username = process.argv[2]?.trim();
if (!username || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{1,31}$/.test(username)) {
  Fail("Usage: create-admin <username> (2–32 characters: letters, digits, _ . -)");
}

const lines = createInterface({ input: process.stdin, output: process.stdin.isTTY ? process.stdout : undefined, terminal: false });
const password = (await lines.question(process.stdin.isTTY ? "Password: " : "")).trim();
lines.close();
if (password.length < 8) Fail("The password must be at least 8 characters long.");

const hash = await HashPassword(password);
const existing = Db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (existing) {
  Db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = ?").run(hash, username);
  console.log(`\x1b[1;32m✓\x1b[0m Account ${username} is now an admin with a new password.`);
} else {
  Db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)").run(username, hash, Date.now());
  mkdirSync(path.join(GetRootDir(), username as string), { recursive: true });
  console.log(`\x1b[1;32m✓\x1b[0m Admin ${username} created.`);
}
