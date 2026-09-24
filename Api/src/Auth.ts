import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { argon2id, argon2Verify } from "hash-wasm";
import { Db } from "./Db.ts";

export type Role = "admin" | "user";
export interface SessionUser {
  id: number;
  username: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser;
  }
}

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export async function HashPassword(password: string) {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "encoded",
  });
}

// Figurína pro neexistující jméno — ověření trvá stejně dlouho, takže se
// z doby odpovědi nedá poznat, jestli účet existuje.
const DUMMY_HASH = await HashPassword(randomBytes(16).toString("hex"));

export async function VerifyPassword(hash: string | undefined, password: string) {
  try {
    return await argon2Verify({ password, hash: hash ?? DUMMY_HASH }) && hash !== undefined;
  } catch {
    return false;
  }
}

const Sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function CreateSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
  Db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(Sha256(token), userId, expiresAt);
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

export function DeleteSession(token: string) {
  Db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(Sha256(token));
}

export function DeleteOtherSessions(userId: number, keepToken: string) {
  Db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, Sha256(keepToken));
}

export function LookupSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = Db.prepare(`
    SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(Sha256(token), Date.now()) as SessionUser | undefined;
  return row ? { ...row } : null;
}

export function PurgeExpiredSessions() {
  Db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

// Guardy — `return reply` je nutné, jinak Fastify u async hooku pustí request dál.
export async function RequireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = LookupSession(request.cookies[SESSION_COOKIE]);
  if (!user) {
    await reply.code(401).send({ error: "Nejsi přihlášený." });
    return reply;
  }
  request.user = user;
}

export async function RequireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user.role !== "admin") {
    await reply.code(403).send({ error: "Na tohle nemáš oprávnění." });
    return reply;
  }
}
