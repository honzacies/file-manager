export interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
  // barva složky (#rrggbb) a hvězdička přihlášeného uživatele
  color?: string;
  starred?: boolean;
}

// Paleta barev složek (4 řady po 8 jako v Google Drive).
export const FOLDER_COLORS = [
  "#ac725e", "#d06b64", "#f83a22", "#fa573c", "#ff7537", "#ffad46", "#fad165", "#fbe983",
  "#b3dc6c", "#7bd148", "#16a765", "#42d692", "#92e1c0", "#9fe1e7", "#9fc6e7", "#4986e7",
  "#9a9cff", "#b99aff", "#a47ae2", "#cd74e6", "#f691b2", "#cca6ac", "#cabdbf", "#434343",
];

export function FormatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("cs-CZ", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function FormatDate(ms: number) {
  return dateFormat.format(ms);
}

export type FileKind = "folder" | "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other";

const KINDS: Record<Exclude<FileKind, "folder" | "other">, string> = {
  image: "png jpg jpeg gif webp avif bmp svg ico",
  video: "mp4 m4v webm mov mkv ogv",
  audio: "mp3 m4a wav flac ogg opus aac",
  pdf: "pdf",
  text: "txt md markdown json jsonc js mjs cjs ts tsx jsx css scss html htm xml yml yaml toml ini conf cfg log csv tsv sh bash zsh ps1 bat py rb go rs java kt c h cpp hpp cs php sql env gitignore dockerfile srt vtt",
  archive: "zip rar 7z tar gz tgz bz2 xz iso",
};

const EXTENSION_KIND = new Map<string, FileKind>(
  Object.entries(KINDS).flatMap(([kind, list]) => list.split(" ").map((ext) => [ext, kind as FileKind] as const)),
);

// "Foto.JPG" -> "jpg", ".env" -> "env"
export function Extension(name: string) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(dot + 1) : name.replace(/^\./, "")).toLowerCase();
}

export function KindOf(entry: Pick<Entry, "name" | "isDir">): FileKind {
  if (entry.isDir) return "folder";
  return EXTENSION_KIND.get(Extension(entry.name)) ?? "other";
}

export const KIND_ICON: Record<FileKind, string> = {
  folder: "folder",
  image: "image",
  video: "movie",
  audio: "music_note",
  pdf: "picture_as_pdf",
  text: "description",
  archive: "folder_zip",
  other: "draft",
};

// Barva ikony podle typu — celé literály, ať je Tailwind najde.
export const KIND_COLOR: Record<FileKind, string> = {
  folder: "text-accent",
  image: "text-sky-500",
  video: "text-violet-500",
  audio: "text-pink-500",
  pdf: "text-red-600",
  text: "text-muted",
  archive: "text-amber-500",
  other: "text-muted",
};

export function CanPreview(entry: Pick<Entry, "name" | "isDir">) {
  const kind = KindOf(entry);
  return kind !== "folder" && kind !== "archive" && kind !== "other";
}

// "a/b/c" -> "a/b/c/name", "" -> "name"
export function JoinPath(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}
