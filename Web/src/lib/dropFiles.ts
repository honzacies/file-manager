import type { UploadRequest } from "@/Components/Uploads";

// Přetažené soubory i celé složky z plochy. Složky jde projít jen přes
// webkitGetAsEntry (Chrome, Firefox, Safari to umí všechny).
export async function FilesFromDrop(dataTransfer: DataTransfer): Promise<UploadRequest[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, relative: file.name }));

  const result: UploadRequest[] = [];
  async function Walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      result.push({ file, relative: prefix + entry.name });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries vrací po dávkách (max ~100), prázdná dávka = konec
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await Walk(child, `${prefix}${entry.name}/`);
    }
  }
  for (const entry of entries) await Walk(entry, "");
  return result;
}

// <input webkitdirectory> dává cestu v webkitRelativePath ("Fotky/2024/a.jpg")
export function FilesFromInput(files: FileList | null): UploadRequest[] {
  return [...(files ?? [])].map((file) => ({ file, relative: file.webkitRelativePath || file.name }));
}
