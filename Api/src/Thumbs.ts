// Náhledy (WebP) pro fotky, videa a cover hudby přes ffmpeg. Cache v DATA_DIR/thumbs,
// klíč = cesta + velikost + čas změny → přepsaný soubor dostane nový náhled sám.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Env } from "./Env.ts";
import { ExtensionOf } from "./Storage.ts";

const THUMB_DIR = path.join(Env.DataDir, "thumbs");
const SIZE = 480;
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const TIMEOUT_MS = 30_000;
// ponytail: globální limit 2 současných ffmpeg; frontu podle uživatele, až bude víc lidí nahrávat najednou
const MAX_JOBS = 2;

const KINDS: Record<string, "image" | "video" | "audio"> = {};
for (const ext of "jpg jpeg png gif webp avif bmp ico tif tiff".split(" ")) KINDS[ext] = "image";
for (const ext of "mp4 m4v mov mkv webm avi ogv wmv flv 3gp".split(" ")) KINDS[ext] = "video";
for (const ext of "mp3 m4a flac ogg opus aac wma".split(" ")) KINDS[ext] = "audio";

export const ThumbKind = (name: string) => KINDS[ExtensionOf(name)] ?? null;

let ffmpegMissing = false;
let running = 0;
const waiting: (() => void)[] = [];
const inFlight = new Map<string, Promise<string | null>>();

// Kratší strana 480 px, poměr stran zachovaný (dlaždice si ořízne sama přes object-cover).
const SCALE = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase`;

function Args(kind: "image" | "video" | "audio", input: string, output: string, seek: number) {
  const out = ["-frames:v", "1", "-c:v", "libwebp", "-quality", "75", "-y", output];
  if (kind === "video") return ["-v", "error", "-ss", String(seek), "-i", input, "-vf", SCALE, "-an", ...out];
  // audio: jen vložený obrázek (attached_pic); bez něj ffmpeg selže → žádný náhled
  if (kind === "audio") return ["-v", "error", "-i", input, "-map", "0:v:0", "-vf", SCALE, "-an", ...out];
  return ["-v", "error", "-i", input, "-vf", SCALE, ...out];
}

function RunFfmpeg(args: string[]) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(FFMPEG, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT" && !ffmpegMissing) {
        ffmpegMissing = true;
        console.warn("ffmpeg is not installed: videos and music will show icons instead of thumbnails.");
      }
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function Slot<T>(job: () => Promise<T>) {
  if (running >= MAX_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// Cesta k hotovému náhledu, nebo null (typ bez náhledu, hudba bez coveru, chybí ffmpeg…).
export async function GetThumb(abs: string): Promise<string | null> {
  const kind = ThumbKind(path.basename(abs));
  if (!kind || ffmpegMissing) return null;
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return null;

  const key = createHash("sha1").update(`${abs}\0${stat.size}\0${stat.mtimeMs}`).digest("hex");
  const file = path.join(THUMB_DIR, `${key}.webp`);
  const none = path.join(THUMB_DIR, `${key}.none`); // značka "náhled nejde", ať se ffmpeg nepouští pořád dokola
  if (existsSync(file)) {
    // čas přístupu pro úklid starých náhledů
    fs.utimes(file, new Date(), new Date()).catch(() => {});
    return file;
  }
  if (existsSync(none)) return null;

  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = Slot(async () => {
    mkdirSync(THUMB_DIR, { recursive: true });
    const temp = `${file}.${process.pid}.tmp.webp`;
    // ffmpeg umí skončit s kódem 0 a prázdným souborem (seek za konec videa) → úspěch jen s daty.
    const Produced = async () => ((await fs.stat(temp).catch(() => null))?.size ?? 0) > 0;
    // Video: snímek z 5. sekundy (první bývá černý); krátké video ho nemá → znovu od začátku.
    let ok = (await RunFfmpeg(Args(kind, abs, temp, 5))) && (await Produced());
    if (!ok && kind === "video" && !ffmpegMissing) ok = (await RunFfmpeg(Args(kind, abs, temp, 0))) && (await Produced());
    if (ok) {
      await fs.rename(temp, file);
      return file;
    }
    await fs.rm(temp, { force: true });
    if (!ffmpegMissing) await fs.writeFile(none, "").catch(() => {});
    return null;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// Úklid: náhledy, na které 90 dní nikdo nesáhl (smazané/přepsané soubory).
export async function PurgeOldThumbs() {
  const limit = Date.now() - 90 * 86_400_000;
  const names = await fs.readdir(THUMB_DIR).catch(() => []);
  for (const name of names) {
    const file = path.join(THUMB_DIR, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < limit) await fs.rm(file, { force: true });
  }
}
