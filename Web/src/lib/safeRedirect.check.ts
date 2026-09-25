// Kontrola SafeRedirect: `node src/lib/safeRedirect.check.ts` (Node spouští TS přímo).
import assert from "node:assert/strict";
import { SafeRedirect } from "./safeRedirect.ts";

const ORIGIN = "https://cloud.example";
const evil = ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r\n/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", null];
for (const target of evil) assert.equal(SafeRedirect(target, ORIGIN), "/files/", JSON.stringify(target));

assert.equal(SafeRedirect("/files/?path=Fotky", ORIGIN), "/files/?path=Fotky");
assert.equal(SafeRedirect("/shared/", ORIGIN), "/shared/");
console.log(`✓ SafeRedirect: ${evil.length} útoků zablokováno, platné cesty prošly`);
