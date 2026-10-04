// Přetažení víc složek najednou musí projít všechny, ne jen první: `node src/lib/dropFiles.check.ts`.
import assert from "node:assert/strict";
import { FilesFromDrop } from "./dropFiles.ts";

// Minimální náhrada FileSystemEntry z prohlížeče.
interface Tree {
  [name: string]: string | Tree;
}
function Entry(name: string, node: string | Tree): FileSystemEntry {
  if (typeof node === "string") {
    return { isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(new File([node], name)) } as unknown as FileSystemEntry;
  }
  const children = Object.entries(node).map(([key, value]) => Entry(key, value));
  return {
    isFile: false,
    isDirectory: true,
    name,
    // readEntries vrací dávky, druhé volání prázdnou = konec
    createReader: () => {
      let done = false;
      return {
        readEntries: (ok: (list: FileSystemEntry[]) => void) => {
          ok(done ? [] : children);
          done = true;
        },
      };
    },
  } as unknown as FileSystemEntry;
}

const drop = {
  items: [Entry("Fotky", { "a.jpg": "a", "2024": { "b.jpg": "b" } }), Entry("Dokumenty", { "c.txt": "c" }), Entry("volny.txt", "x")].map((entry) => ({
    kind: "file",
    webkitGetAsEntry: () => entry,
  })),
  files: [],
} as unknown as DataTransfer;

const result = await FilesFromDrop(drop);
assert.deepEqual(
  result.map((item) => item.relative).sort(),
  ["Dokumenty/c.txt", "Fotky/2024/b.jpg", "Fotky/a.jpg", "volny.txt"],
);
console.log("\x1b[32m✓\x1b[0m přetažení víc složek najednou projde všechny");
