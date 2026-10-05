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

  await Check("kvóta: nad limit 413 a nic nezůstane na disku, bez limitu projde", async () => {
    const aliceId = (Db.prepare("SELECT id FROM users WHERE username = 'alice'").get() as { id: number }).id;
    const set = (quotaBytes: number | null) => app.inject({ method: "PATCH", url: `/api/admin/users/${aliceId}`, headers: admin, payload: { quotaBytes } });
    assert.equal((await set(1000)).statusCode, 200);
    const storage = (await app.inject({ url: "/api/storage", headers: alice })).json();
    assert.equal(storage.quota, 1000);
    assert.equal(typeof storage.used, "number");

    const tooBig = await Upload(alice, "", "velky.bin", "x".repeat(2000));
    assert.equal(tooBig.statusCode, 413);
    const aliceDir = path.join(temp, "cloud2", "alice");
    assert.ok(!existsSync(path.join(aliceDir, "velky.bin")));
    assert.ok(!(await import("node:fs")).readdirSync(aliceDir).some((name) => name.startsWith(".upload-")), "zůstal dočasný soubor");

    assert.equal((await Upload(alice, "", "maly.bin", "x".repeat(300))).statusCode, 200);
    assert.equal((await set(null)).statusCode, 200);
    assert.equal((await Upload(alice, "", "velky.bin", "x".repeat(2000))).statusCode, 200);

    const self = await app.inject({ method: "PATCH", url: `/api/admin/users/${aliceId}`, headers: alice, payload: { quotaBytes: null } });
    assert.equal(self.statusCode, 403);
    const listed = (await app.inject({ url: "/api/admin/users", headers: admin })).json();
    assert.ok(listed.find((u: { username: string }) => u.username === "alice").usedBytes >= 2300);
  });

  // Bob má po testu resetu hesla nové heslo a byl odhlášen.
  const bobLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "bob", password: "novehesl0" } });
  const bob2 = { cookie: `sid=${bobLogin.cookies.find((c) => c.name === "sid")?.value}` };
  const bobId = (Db.prepare("SELECT id FROM users WHERE username = 'bob'").get() as { id: number }).id;
  const aliceHome = path.join(temp, "cloud2", "alice");
  let shareId = 0;

  await Check("sdílení s uživatelem: notifikace, čtení, zákaz zápisu, nejde ven, cizí nic nevidí", async () => {
    await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "Sdilene" } });
    await Upload(alice, "Sdilene", "doc.txt", "sdileny obsah");
    const created = await app.inject({ method: "POST", url: "/api/user-shares", headers: alice, payload: { path: "Sdilene", recipientIds: [bobId] } });
    assert.equal(created.json().added, 1);

    const notifications = (await app.inject({ url: "/api/notifications", headers: bob2 })).json();
    assert.equal(notifications.unread, 1);
    assert.match(notifications.items[0].text, /alice/);
    assert.equal((await app.inject({ url: "/api/notifications", headers: admin })).json().unread, 0);

    const incoming = (await app.inject({ url: "/api/user-shares/incoming", headers: bob2 })).json();
    assert.equal(incoming.length, 1);
    shareId = incoming[0].id;

    const list = (await app.inject({ url: `/api/files?share=${shareId}`, headers: bob2 })).json();
    assert.equal(list.readOnly, true);
    assert.deepEqual(list.entries.map((e: { name: string }) => e.name), ["doc.txt"]);
    assert.equal((await app.inject({ url: `/api/files/download?share=${shareId}&path=doc.txt`, headers: bob2 })).body, "sdileny obsah");

    assert.equal((await Upload(bob2, "", "x.txt", "x", `&share=${shareId}`)).statusCode, 403);
    assert.ok(!existsSync(path.join(aliceHome, "Sdilene", "x.txt")));
    const del = await app.inject({ method: "POST", url: "/api/files/delete", headers: bob2, payload: { paths: ["doc.txt"], share: shareId } });
    assert.equal(del.statusCode, 403);

    for (const p of ["../", "../../", "..\\novy.txt"]) {
      const escape = await app.inject({ url: `/api/files?share=${shareId}&path=${encodeURIComponent(p)}`, headers: bob2 });
      assert.ok(!escape.body.includes("novy.txt"), `list ${p}`);
    }
    const escapeDownload = await app.inject({ url: `/api/files/download?share=${shareId}&path=${encodeURIComponent("../novy.txt")}`, headers: bob2 });
    assert.notEqual(escapeDownload.statusCode, 200);

    // Admin není příjemce — sdílení pro něj neexistuje.
    assert.equal((await app.inject({ url: `/api/files?share=${shareId}`, headers: admin })).statusCode, 404);
    assert.equal((await app.inject({ method: "PATCH", url: `/api/user-shares/${shareId}`, headers: bob2, payload: { canWrite: true } })).statusCode, 404);
  });

  await Check("sdílení se zápisem: příjemce nahrává, kvóta i koš patří vlastníkovi", async () => {
    assert.equal((await app.inject({ method: "PATCH", url: `/api/user-shares/${shareId}`, headers: alice, payload: { canWrite: true } })).statusCode, 200);
    assert.equal((await Upload(bob2, "", "odbob.txt", "b", `&share=${shareId}`)).statusCode, 200);
    assert.ok(existsSync(path.join(aliceHome, "Sdilene", "odbob.txt")));

    const aliceId = (Db.prepare("SELECT id FROM users WHERE username = 'alice'").get() as { id: number }).id;
    await app.inject({ method: "PATCH", url: `/api/admin/users/${aliceId}`, headers: admin, payload: { quotaBytes: 10 } });
    assert.equal((await Upload(bob2, "", "velky.txt", "x".repeat(500), `&share=${shareId}`)).statusCode, 413);
    await app.inject({ method: "PATCH", url: `/api/admin/users/${aliceId}`, headers: admin, payload: { quotaBytes: null } });

    await app.inject({ method: "POST", url: "/api/files/delete", headers: bob2, payload: { paths: ["odbob.txt"], share: shareId } });
    const aliceTrash = (await app.inject({ url: "/api/trash", headers: alice })).json().items;
    assert.ok(aliceTrash.some((item: { name: string }) => item.name === "odbob.txt"));
  });

  await Check("přejmenování a přesun posune sdílení s uživatelem i odkaz", async () => {
    const { token } = (await app.inject({ method: "POST", url: "/api/shares", headers: alice, payload: { path: "Sdilene" } })).json();
    const stillWorks = async () => {
      assert.equal((await app.inject({ url: `/api/files/download?share=${shareId}&path=doc.txt`, headers: bob2 })).body, "sdileny obsah");
      assert.equal((await app.inject({ url: `/api/public/shares/${token}/download?path=doc.txt` })).body, "sdileny obsah");
    };
    await app.inject({ method: "POST", url: "/api/files/rename", headers: alice, payload: { path: "Sdilene", name: "Spolecne" } });
    await stillWorks();
    await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "Archiv" } });
    await app.inject({ method: "POST", url: "/api/files/move", headers: alice, payload: { paths: ["Spolecne"], destination: "Archiv" } });
    await stillWorks();
    const outgoing = (await app.inject({ url: "/api/user-shares/outgoing", headers: alice })).json();
    assert.equal(outgoing[0].path, "Archiv/Spolecne");
  });

  await Check("sdílený soubor: jde stáhnout, sourozenci ne, zápis nikdy", async () => {
    await app.inject({ method: "POST", url: "/api/user-shares", headers: alice, payload: { path: "novy.txt", recipientIds: [bobId], canWrite: true } });
    const file = (await app.inject({ url: "/api/user-shares/incoming", headers: bob2 })).json().find((s: { name: string }) => s.name === "novy.txt");
    assert.equal(file.canWrite, false);
    assert.equal((await app.inject({ url: `/api/files/download?share=${file.id}`, headers: bob2 })).body, "n");
    assert.notEqual((await app.inject({ url: `/api/files/download?share=${file.id}&path=maly.bin`, headers: bob2 })).statusCode, 200);
    assert.equal((await Upload(bob2, "", "y.txt", "y", `&share=${file.id}`)).statusCode, 403);
  });

  await Check("zrušení sdílení: příjemce ztratí přístup", async () => {
    assert.equal((await app.inject({ method: "DELETE", url: `/api/user-shares/${shareId}`, headers: admin })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/user-shares/${shareId}`, headers: alice })).statusCode, 200);
    assert.equal((await app.inject({ url: `/api/files?share=${shareId}`, headers: bob2 })).statusCode, 404);
    const incoming = (await app.inject({ url: "/api/user-shares/incoming", headers: bob2 })).json();
    assert.ok(!incoming.some((s: { id: number }) => s.id === shareId));
  });

  await Check("ZIP: složka se stáhne celá, koš ani cizí soubory v něm nejsou", async () => {
    const zip = await app.inject({ url: "/api/files/zip?paths=Archiv", headers: alice });
    assert.equal(zip.statusCode, 200);
    assert.match(String(zip.headers["content-type"]), /application\/zip/);
    assert.equal(zip.rawPayload.subarray(0, 2).toString(), "PK");
    assert.ok(zip.rawPayload.includes("Archiv/Spolecne/doc.txt"));
    const escape = await app.inject({ url: `/api/files/zip?paths=${encodeURIComponent("../bob")}`, headers: alice });
    assert.ok(!escape.rawPayload.includes("bob/"), "ZIP vylezl ze složky");
    const all = await app.inject({ url: "/api/files/zip?paths=&all=true", headers: admin });
    assert.ok(!all.rawPayload.includes(".trash/"), "ZIP obsahuje koš");
    assert.equal((await app.inject({ url: "/api/files/zip?paths=Archiv&all=true", headers: bob2 })).statusCode, 404, "bob zazipoval cizí složku");
  });

  await Check("kopie, barva složky, hvězdička, nedávné, hledání, podrobnosti", async () => {
    const copy = await app.inject({ method: "POST", url: "/api/files/copy", headers: alice, payload: { paths: ["novy.txt"] } });
    assert.deepEqual(copy.json().names, ["novy (kopie).txt"]);
    assert.equal(readFileSync(path.join(aliceHome, "novy (kopie).txt"), "utf8"), "n");

    const color = (c: unknown, p = "Archiv", h = alice) => app.inject({ method: "POST", url: "/api/files/color", headers: h, payload: { paths: [p], color: c } });
    assert.equal((await color("#FF0000")).statusCode, 200);
    assert.equal((await color("red")).statusCode, 400);
    assert.equal((await color("#00ff00", "novy.txt")).statusCode, 400);
    await app.inject({ method: "POST", url: "/api/files/rename", headers: alice, payload: { path: "Archiv", name: "Archiv2" } });
    const listed = (await app.inject({ url: "/api/files", headers: alice })).json().entries.find((e: { name: string }) => e.name === "Archiv2");
    assert.equal(listed.color, "#ff0000", "barva se po přejmenování ztratila");

    await app.inject({ method: "POST", url: "/api/files/star", headers: alice, payload: { paths: ["novy.txt"], starred: true } });
    const starred = (await app.inject({ url: "/api/starred", headers: alice })).json().items;
    assert.ok(starred.some((item: { name: string; path: string }) => item.name === "novy.txt" && item.path === "novy.txt"));
    assert.ok(!(await app.inject({ url: "/api/starred", headers: bob2 })).body.includes("novy.txt\",\"isDir\":false,\"size\":1,\"modified\""), "bob vidí cizí hvězdičky");

    // Nahrání se do Nedávné zapisuje taky — začít s čistým seznamem, ať se měří jen stažení.
    Db.prepare("DELETE FROM recent WHERE user_id = (SELECT id FROM users WHERE username = 'alice')").run();
    await app.inject({ url: "/api/files/download?path=novy.txt", headers: alice });
    await app.inject({ url: "/api/files/download?path=maly.bin&inline=true&thumb=true", headers: alice });
    const recent = (await app.inject({ url: "/api/recent", headers: alice })).json().items.map((item: { name: string }) => item.name);
    assert.ok(recent.includes("novy.txt"));
    assert.ok(!recent.includes("maly.bin"), "náhled v mřížce se zapsal do Nedávné");

    const search = (await app.inject({ url: "/api/files/search?q=DOC", headers: alice })).json().entries.map((e: { name: string }) => e.name);
    assert.ok(search.includes("Archiv2/Spolecne/doc.txt"));
    const bobSearch = await app.inject({ url: `/api/files/search?q=doc&path=${encodeURIComponent("../alice")}`, headers: bob2 });
    assert.ok(!bobSearch.body.includes("Spolecne"), "hledání vylezlo ze složky");

    const details = (await app.inject({ url: "/api/files/details?path=Archiv2", headers: alice })).json();
    assert.equal(details.isDir, true);
    assert.ok(details.files >= 1 && details.folders >= 1);
    assert.equal(details.owner.username, "alice");
  });

  await Check("jazyk: hlášky a notifikace anglicky, s X-Lang: cs česky", async () => {
    const url = "/api/files/details?path=neexistuje";
    assert.equal((await app.inject({ url, headers: alice })).json().error, "File or folder not found.");
    assert.equal((await app.inject({ url, headers: { ...alice, "x-lang": "cs" } })).json().error, "Soubor nebo složka neexistuje.");
    assert.match((await app.inject({ url: "/api/notifications", headers: bob2 })).json().items[0].text, /shared the/);
    assert.match((await app.inject({ url: "/api/notifications", headers: { ...bob2, "x-lang": "cs" } })).json().items[0].text, /s tebou sdílí/);
  });

  await Check("jazyk: volba uživatele, výchozí jazyk mění jen admin", async () => {
    assert.equal((await app.inject({ url: "/api/auth/me", headers: alice })).json().lang, null);
    const put = (lang: unknown) => app.inject({ method: "PUT", url: "/api/account/lang", headers: alice, payload: { lang } });
    assert.equal((await put("cs")).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/auth/me", headers: alice })).json().lang, "cs");
    assert.equal((await put("de")).statusCode, 400);
    assert.equal((await put(null)).statusCode, 200);
    const setDefault = (headers: Record<string, string>) => app.inject({ method: "PUT", url: "/api/admin/settings/lang", headers, payload: { defaultLang: "cs" } });
    assert.equal((await setDefault(alice)).statusCode, 403);
    assert.equal((await setDefault(admin)).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/public/lang" })).json().defaultLang, "cs");
  });

  await Check("sdílení jen pro čtení: kopie a barva zakázané, hvězdička povolená", async () => {
    const file = (await app.inject({ url: "/api/user-shares/incoming", headers: bob2 })).json().find((s: { name: string }) => s.name === "novy.txt");
    assert.equal((await app.inject({ method: "POST", url: "/api/files/copy", headers: bob2, payload: { paths: [""], share: file.id } })).statusCode, 403);
    const star = await app.inject({ method: "POST", url: "/api/files/star", headers: bob2, payload: { paths: [""], share: file.id, starred: true } });
    assert.equal(star.statusCode, 200);
    const bobStarred = (await app.inject({ url: "/api/starred", headers: bob2 })).json().items;
    assert.ok(bobStarred.some((item: { share: number }) => item.share === file.id));
  });

  await Check("profil: jméno se hezky naformátuje, vlastník je vidět v seznamu", async () => {
    const saved = await app.inject({ method: "PUT", url: "/api/account/profile", headers: alice, payload: { firstName: "  alice ", lastName: "novák-DVOŘÁK" } });
    assert.equal(saved.json().name, "Alice Novák-DVOŘÁK");
    assert.equal((await app.inject({ url: "/api/auth/me", headers: alice })).json().name, "Alice Novák-DVOŘÁK");
    const listing = (await app.inject({ url: "/api/files", headers: alice })).json();
    assert.equal(listing.entries[0].owner, "alice");
    assert.equal(listing.people.alice.name, "Alice Novák-DVOŘÁK");
    assert.ok(!JSON.stringify(listing.people).includes("password"), "v people je heslo");
    const tooLong = await app.inject({ method: "PUT", url: "/api/account/profile", headers: alice, payload: { firstName: "x".repeat(51), lastName: "" } });
    assert.equal(tooLong.statusCode, 400);
  });

  await Check("avatar: jen WebP, omezená velikost, jen pro přihlášené, cizí nejde přepsat", async () => {
    const boundary = "----avatar";
    const send = (bytes: Buffer, headers: { cookie: string }) =>
      app.inject({
        method: "POST",
        url: "/api/account/avatar",
        headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.webp"\r\nContent-Type: image/webp\r\n\r\n`),
          bytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
    assert.equal((await send(Buffer.from("<svg onload=alert(1)>"), alice)).statusCode, 400);
    assert.equal((await send(Buffer.concat([webp, Buffer.alloc(600 * 1024)]), alice)).statusCode, 413);
    const ok = await send(webp, alice);
    assert.equal(ok.statusCode, 200);
    const aliceId = ok.json().id;
    assert.equal(typeof ok.json().avatar, "number");
    const image = await app.inject({ url: `/api/users/${aliceId}/avatar`, headers: bob2 });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/webp");
    assert.equal((await app.inject({ url: `/api/users/${aliceId}/avatar` })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/users/..%2F..%2Fcloud/avatar", headers: bob2 })).statusCode, 404);
    // Bob nahraje svůj — Alicin zůstane
    await send(webp, bob2);
    assert.equal((await app.inject({ url: `/api/users/${aliceId}/avatar`, headers: bob2 })).statusCode, 200);
    await app.inject({ method: "DELETE", url: "/api/account/avatar", headers: alice });
    assert.equal((await app.inject({ url: `/api/users/${aliceId}/avatar`, headers: bob2 })).statusCode, 404);
  });

  await Check("rate limit na přihlášení", async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "x", password: "yyyyyyyy" } });
      if (response.statusCode === 429) limited = true;
    }
    assert.ok(limited);
  });

  await Check("náhledy a tagy: video, cover hudby, bez coveru 404, tagy z FLAC, nejde ven ze složky, veřejné sdílení", async () => {
    const { spawnSync } = await import("node:child_process");
    const ffmpeg = (args: string[]) => spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v", "error", "-y", ...args]).status === 0;
    if (!ffmpeg(["-version"])) {
      console.log("  (ffmpeg chybí — náhledy přeskočeny)");
      return;
    }
    const at = (name: string) => path.join(aliceHome, name);
    assert.ok(ffmpeg(["-f", "lavfi", "-i", "testsrc=size=640x360:duration=1", "-pix_fmt", "yuv420p", at("klip.mp4")]));
    assert.ok(ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=300x300", "-frames:v", "1", at("cover.png")]));
    assert.ok(ffmpeg(["-f", "lavfi", "-i", "sine=d=1", "-i", at("cover.png"), "-map", "0", "-map", "1", "-c:a", "libmp3lame", "-c:v", "mjpeg", "-disposition:v", "attached_pic", at("pisen.mp3")]));
    assert.ok(ffmpeg(["-f", "lavfi", "-i", "sine=d=1", "-c:a", "libmp3lame", at("bez-coveru.mp3")]));
    assert.ok(ffmpeg(["-f", "lavfi", "-i", "sine=d=1", "-metadata", "title=Breed", "-metadata", "artist=Nirvana", "-metadata", "album=Nevermind", "-c:a", "flac", at("tagy.flac")]));

    const thumb = (p: string, headers = alice) => app.inject({ url: `/api/files/thumb?path=${encodeURIComponent(p)}`, headers });
    for (const name of ["klip.mp4", "pisen.mp3", "cover.png"]) {
      const response = await thumb(name);
      assert.equal(response.statusCode, 200, name);
      assert.equal(response.headers["content-type"], "image/webp", name);
      assert.equal(response.rawPayload.subarray(8, 12).toString(), "WEBP", name);
    }
    assert.equal((await thumb("bez-coveru.mp3")).statusCode, 404);
    assert.equal((await thumb("novy.txt")).statusCode, 404);
    assert.equal((await thumb("../bob/x.txt", bob2)).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/files/thumb?path=klip.mp4` })).statusCode, 401);

    const tags = (p: string, headers = alice) => app.inject({ url: `/api/files/tags?path=${encodeURIComponent(p)}`, headers });
    assert.deepEqual((await tags("tagy.flac")).json(), { title: "Breed", artist: "Nirvana", album: "Nevermind" });
    assert.deepEqual((await tags("bez-coveru.mp3")).json(), {}, "skladba bez tagů");
    assert.deepEqual((await tags("klip.mp4")).json(), {}, "video tagy nečte");
    assert.equal((await tags("../bob/x.txt", bob2)).statusCode, 404);
    assert.equal((await app.inject({ url: "/api/files/tags?path=tagy.flac" })).statusCode, 401);

    const { token } = (await app.inject({ method: "POST", url: "/api/shares", headers: alice, payload: { path: "klip.mp4" } })).json();
    assert.equal((await app.inject({ url: `/api/public/shares/${token}/thumb` })).statusCode, 200);
    assert.equal((await app.inject({ url: `/api/public/shares/${token}/thumb?path=../pisen.mp3` })).statusCode, 404);
  });

  // ---- Safe Test My Code 2026-09-25: regrese nálezů --------------------------------

  await Check("kořen cloudu nesmí obsahovat databázi (jinak by šla stáhnout cloud.db)", async () => {
    const put = (rootDir: string) => app.inject({ method: "PUT", url: "/api/admin/settings", headers: admin, payload: { rootDir } });
    assert.equal((await put(temp)).statusCode, 400, "kořen nad DATA_DIR");
    assert.equal((await put(path.join(temp, "data"))).statusCode, 400, "kořen = DATA_DIR");
    assert.equal((await app.inject({ url: "/api/files/download?all=true&path=data/cloud.db", headers: admin })).statusCode, 404);
  });

  await Check("název delší než 255 bajtů je 400, ne 500", async () => {
    const long = await app.inject({ method: "POST", url: "/api/files/folder", headers: alice, payload: { name: "ž".repeat(200) } });
    assert.equal(long.statusCode, 400);
  });

  await Check("veřejné sdílení má rate limit na IP", async () => {
    let limited = false;
    for (let i = 0; i < 310 && !limited; i++) {
      limited = (await app.inject({ url: `/api/public/shares/neexistuje${i}` })).statusCode === 429;
    }
    assert.ok(limited);
  });

  await Check("X-Forwarded-For platí jen od lokální proxy, z LAN ho podvrhnout nejde", async () => {
    const attempt = (ip: string, forwarded: string) =>
      app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: ip, headers: { "x-forwarded-for": forwarded }, payload: { username: "x", password: "yyyyyyyy" } });
    // přes proxy (127.0.0.1): klient 10.0.0.1 vyčerpá svůj limit, jiný klient za stejnou proxy ne
    for (let i = 0; i < 11; i++) await attempt("127.0.0.1", "10.0.0.1");
    assert.equal((await attempt("127.0.0.1", "10.0.0.1")).statusCode, 429);
    assert.notEqual((await attempt("127.0.0.1", "10.0.0.2")).statusCode, 429, "limit společný pro všechny za proxy");
    // přímo z LAN: měnit X-Forwarded-For nepomůže
    let limited = false;
    for (let i = 0; i < 12; i++) limited = (await attempt("192.168.1.50", `6.6.6.${i}`)).statusCode === 429 || limited;
    assert.ok(limited, "podvržený X-Forwarded-For obešel limit");
  });

  console.log(`\n\x1b[1;32m${passed} kontrol prošlo.\x1b[0m`);
} finally {
  await app.close();
  Db.close();
  rmSync(temp, { recursive: true, force: true });
}
