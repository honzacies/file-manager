// Bezpečnostní a funkční self-check nad dočasnou DB a složkou: `npm run verify`.
// Všechno přes app.inject — bez sítě, nic se nespouští natrvalo.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(os.tmpdir(), "cloud-verify-"));
process.env.DATA_DIR = path.join(temp, "data");
process.env.DEFAULT_ROOT_DIR = path.join(temp, "cloud");

const { BuildApp } = await import("../Server.ts");
const { Db } = await import("../Db.ts");
const { HashPassword } = await import("../Auth.ts");

const app = await BuildApp();
const hash = await HashPassword("password123");
Db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES ('admin', ?, 'admin', 0), ('alice', ?, 'user', 0), ('bob', ?, 'user', 0)").run(hash, hash, hash);

async function Login(username: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "password123" } });
  assert.equal(response.statusCode, 200, `login ${username}`);
  const cookie = response.cookies.find((c) => c.name === "sid");
  return { cookie: `sid=${cookie?.value}` };
}

function Upload(headers: { cookie: string }, dir: string, name: string, content: string, extra = "") {
  const boundary = "----verify";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return app.inject({
    method: "POST",
    url: `/api/files/upload?path=${encodeURIComponent(dir)}${extra}`,
    headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

const root = process.env.DEFAULT_ROOT_DIR;
let passed = 0;
async function Check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`\x1b[32m✓\x1b[0m ${name}`);
}

try {
  const admin = await Login("admin");
  const alice = await Login("alice");
  const bob = await Login("bob");

  await Check("bez přihlášení 401", async () => {
    for (const url of ["/api/files", "/api/trash", "/api/shares", "/api/admin/users", "/api/auth/me"]) {
      assert.equal((await app.inject({ url })).statusCode, 401, url);
    }
    assert.equal((await app.inject({ url: "/api/files", headers: { cookie: "sid=nesmysl" } })).statusCode, 401);
  });

  await Check("špatné heslo 401, stejná hláška jako neexistující účet", async () => {
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "xxxxxxxx" } });
    const missing = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "nikdo", password: "xxxxxxxx" } });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), missing.json());
  });

  await Check("běžný uživatel na admin routy 403 a handler neproběhl", async () => {
    const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: alice, payload: { username: "hacker", password: "password123", role: "admin" } });
    assert.equal(response.statusCode, 403);
    assert.equal(Db.prepare("SELECT 1 FROM users WHERE username = 'hacker'").get(), undefined);
    assert.equal((await app.inject({ url: "/api/admin/browse?path=/", headers: alice })).statusCode, 403);
  });

  await Check("upload a stažení vlastního souboru", async () => {
    assert.equal((await Upload(alice, "", "tajne.txt", "alice secret")).statusCode, 200);
    assert.ok(existsSync(path.join(root, "alice", "tajne.txt")));
    const download = await app.inject({ url: "/api/files/download?path=tajne.txt", headers: alice });
    assert.equal(download.body, "alice secret");
    assert.match(String(download.headers["content-disposition"]), /^attachment/);
  });

  await Check("path traversal zůstane ve vlastní složce", async () => {
    for (const p of ["../bob", "../../", "..%2Fbob", "/../alice/tajne.txt", "..\\alice\\tajne.txt"]) {
      const list = await app.inject({ url: `/api/files?path=${encodeURIComponent(p)}`, headers: bob });
      // "../../" se normalizuje na Bobův vlastní kořen — 200 je ok, jen nesmí vidět nic Alicina
      assert.ok(!list.body.includes("tajne.txt"), `list ${p}`);
      const download = await app.inject({ url: `/api/files/download?path=${encodeURIComponent(p)}`, headers: bob });
      assert.ok(!download.body.includes("alice secret"), `download ${p}`);
    }
    const upload = await Upload(bob, "../alice", "x.txt", "pwned");
    assert.ok(!existsSync(path.join(root, "alice", "x.txt")), `upload status ${upload.statusCode}`);
    const relative = await Upload(bob, "", "x.txt", "pwned", `&relative=${encodeURIComponent("../alice/x.txt")}`);
    assert.equal(relative.statusCode, 400);
    assert.ok(!existsSync(path.join(root, "alice", "x.txt")));
  });

  await Check("uživatel s all=true vidí jen svoje, admin s all=true všechno", async () => {
    const bobAll = await app.inject({ url: "/api/files?all=true", headers: bob });
    assert.deepEqual(bobAll.json(), (await app.inject({ url: "/api/files", headers: bob })).json());
    const adminAll = await app.inject({ url: "/api/files?all=true", headers: admin });
    assert.ok(adminAll.json().entries.some((e: { name: string }) => e.name === "alice"));
    assert.equal((await app.inject({ url: "/api/files/download?all=true&path=alice/tajne.txt", headers: admin })).body, "alice secret");
  });

  await Check("HTML se inline servíruje jako text/plain se sandboxem", async () => {
    await Upload(alice, "", "xss.html", "<script>alert(1)</script>");
    const response = await app.inject({ url: "/api/files/download?path=xss.html&inline=true", headers: alice });
    assert.match(String(response.headers["content-type"]), /^text\/plain/);
    assert.match(String(response.headers["content-security-policy"]), /sandbox/);
    const svg = await Upload(alice, "", "a.svg", "<svg/>");
    assert.equal(svg.statusCode, 200);
    const svgResponse = await app.inject({ url: "/api/files/download?path=a.svg&inline=true", headers: alice });
    assert.match(String(svgResponse.headers["content-security-policy"]), /sandbox/);
  });

  await Check("Range request (video přetáčení)", async () => {
    const response = await app.inject({ url: "/api/files/download?path=tajne.txt", headers: { ...alice, range: "bytes=6-" } });
    assert.equal(response.statusCode, 206);
    assert.equal(response.body, "secret");
    const suffix = await app.inject({ url: "/api/files/download?path=tajne.txt", headers: { ...alice, range: "bytes=-3" } });
    assert.equal(suffix.body, "ret");
    const invalid = await app.inject({ url: "/api/files/download?path=tajne.txt", headers: { ...alice, range: "bytes=999-" } });
    assert.equal(invalid.statusCode, 416);
  });

  await Check("složka, přejmenování bez přepsání, přesun, konflikt jmen", async () => {
    assert.equal((await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "Docs" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "Docs" } })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "../ven" } })).statusCode, 400);
    await Upload(alice, "", "b.txt", "bbb");
    const clash = await app.inject({ method: "POST", url: "/api/files/rename", headers: alice, payload: { path: "b.txt", name: "tajne.txt" } });
    assert.equal(clash.statusCode, 409);
    assert.equal(readFileSync(path.join(root, "alice", "tajne.txt"), "utf8"), "alice secret");
    const move = await app.inject({ method: "POST", url: "/api/files/move", headers: alice, payload: { paths: ["b.txt"], destination: "Docs" } });
    assert.equal(move.statusCode, 200);
    assert.ok(existsSync(path.join(root, "alice", "Docs", "b.txt")));
    const self = await app.inject({ method: "POST", url: "/api/files/move", headers: alice, payload: { paths: ["Docs"], destination: "Docs" } });
    assert.equal(self.statusCode, 400);
    await Upload(alice, "", "tajne.txt", "druhy");
    assert.ok(existsSync(path.join(root, "alice", "tajne (1).txt")));
  });

  await Check("koš: smazat, cizí nevidí, obnovit", async () => {
    await app.inject({ method: "POST", url: "/api/files/delete", headers: alice, payload: { paths: ["tajne (1).txt"] } });
    assert.ok(!existsSync(path.join(root, "alice", "tajne (1).txt")));
    const items = (await app.inject({ url: "/api/trash", headers: alice })).json().items;
    assert.equal(items.length, 1);
    assert.equal(items[0].originalPath, "tajne (1).txt");
    assert.equal((await app.inject({ url: "/api/trash", headers: bob })).json().items.length, 0);
    await app.inject({ method: "POST", url: "/api/trash/restore", headers: bob, payload: { ids: [items[0].id] } });
    assert.ok(!existsSync(path.join(root, "alice", "tajne (1).txt")), "bob obnovil cizí položku");
    await app.inject({ method: "POST", url: "/api/trash/restore", headers: alice, payload: { ids: [items[0].id] } });
    assert.ok(existsSync(path.join(root, "alice", "tajne (1).txt")));
    const hidden = await app.inject({ url: "/api/files?all=true", headers: admin });
    assert.ok(!hidden.json().entries.some((e: { name: string }) => e.name === ".trash"));
  });

  await Check("sdílení: veřejný přístup, nejde ven ze sdílené složky, smazání", async () => {
    const created = await app.inject({ method: "POST", url: "/api/shares", headers: alice, payload: { path: "Docs" } });
    const { token } = created.json();
    const listing = await app.inject({ url: `/api/public/shares/${token}` });
    assert.equal(listing.statusCode, 200);
    assert.ok(listing.json().entries.some((e: { name: string }) => e.name === "b.txt"));
    assert.equal((await app.inject({ url: `/api/public/shares/${token}/download?path=b.txt` })).body, "bbb");
    const escape = await app.inject({ url: `/api/public/shares/${token}/download?path=${encodeURIComponent("../tajne.txt")}` });
    assert.ok(!escape.body.includes("alice secret"));
    assert.equal((await app.inject({ method: "DELETE", url: `/api/shares/${token}`, headers: bob })).statusCode, 200);
    assert.equal((await app.inject({ url: `/api/public/shares/${token}` })).statusCode, 200, "bob smazal cizí sdílení");
    await app.inject({ method: "DELETE", url: `/api/shares/${token}`, headers: alice });
    assert.equal((await app.inject({ url: `/api/public/shares/${token}` })).statusCode, 404);
  });

  await Check("sdílený soubor nepustí k sourozencům", async () => {
    const { token } = (await app.inject({ method: "POST", url: "/api/shares", headers: alice, payload: { path: "Docs/b.txt" } })).json();
    assert.equal((await app.inject({ url: `/api/public/shares/${token}/download` })).body, "bbb");
    assert.equal((await app.inject({ url: `/api/public/shares/${token}/download?path=x` })).statusCode, 404);
  });

  await Check("reset cizího hesla a smazání účtu vyžaduje heslo admina", async () => {
    const bobId = (Db.prepare("SELECT id FROM users WHERE username = 'bob'").get() as { id: number }).id;
    const noPassword = await app.inject({ method: "PATCH", url: `/api/admin/users/${bobId}`, headers: admin, payload: { newPassword: "novehesl0" } });
    assert.equal(noPassword.statusCode, 403);
    const del = await app.inject({ method: "DELETE", url: `/api/admin/users/${bobId}`, headers: admin, payload: { currentPassword: "spatne" } });
    assert.equal(del.statusCode, 403);
    const ok = await app.inject({ method: "PATCH", url: `/api/admin/users/${bobId}`, headers: admin, payload: { newPassword: "novehesl0", currentPassword: "password123" } });
    assert.equal(ok.statusCode, 200);
    assert.equal((await app.inject({ url: "/api/auth/me", headers: bob })).statusCode, 401, "bob zůstal přihlášený po resetu");
  });

  await Check("poslední admin nejde degradovat", async () => {
    const adminId = (Db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number }).id;
    const response = await app.inject({ method: "PATCH", url: `/api/admin/users/${adminId}`, headers: admin, payload: { role: "user" } });
    assert.equal(response.statusCode, 400);
  });

  await Check("nastavení kořene: jen existující absolutní složka", async () => {
    const put = (rootDir: string) => app.inject({ method: "PUT", url: "/api/admin/settings", headers: admin, payload: { rootDir } });
    assert.equal((await put("relativni/cesta")).statusCode, 400);
    assert.equal((await put(path.join(temp, "neexistuje"))).statusCode, 400);
    const newRoot = path.join(temp, "cloud2");
    writeFileSync(path.join(temp, "soubor"), "");
    assert.equal((await put(path.join(temp, "soubor"))).statusCode, 400);
    (await import("node:fs")).mkdirSync(newRoot);
    assert.equal((await put(newRoot)).statusCode, 200);
    await Upload(alice, "", "novy.txt", "n");
    assert.ok(existsSync(path.join(newRoot, "alice", "novy.txt")));
  });

  await Check("rate limit na přihlášení", async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "x", password: "yyyyyyyy" } });
      if (response.statusCode === 429) limited = true;
    }
    assert.ok(limited);
  });

  console.log(`\n\x1b[1;32m${passed} kontrol prošlo.\x1b[0m`);
} finally {
  await app.close();
  Db.close();
  rmSync(temp, { recursive: true, force: true });
}
