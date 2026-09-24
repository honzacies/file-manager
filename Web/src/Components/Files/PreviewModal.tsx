"use client";

import { Button, Modal, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { type Entry, FormatBytes, KindOf } from "@/lib/format";
import { FileIcon } from "../FileIcon";
import { Icon } from "../Icon";

const TEXT_LIMIT = 2 * 1024 * 1024;

function TextPreview({ url, size }: { url: string; size: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (size > TEXT_LIMIT) return;
    setText(null);
    fetch(url)
      .then((response) => response.text())
      .then(setText)
      .catch(() => setText("Soubor se nepodařilo načíst."));
  }, [url, size]);

  if (size > TEXT_LIMIT) return <p className="m-auto text-sm text-muted">Soubor je na náhled moc velký ({FormatBytes(size)}). Stáhni si ho.</p>;
  if (text === null) return <Spinner className="m-auto" />;
  return <pre className="h-full w-full overflow-auto rounded-xl bg-surface p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-surface-foreground">{text}</pre>;
}

// Náhled souboru přes celou obrazovku, šipky ←/→ přepínají mezi soubory ve složce.
// `urlFor` — přihlášený prohlížeč i veřejné sdílení mají jiné URL.
export function PreviewModal({
  entries,
  index,
  onIndexChange,
  onClose,
  urlFor,
}: {
  entries: Entry[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  urlFor: (entry: Entry, inline: boolean) => string;
}) {
  const entry = index === null ? null : entries[index];

  useEffect(() => {
    if (index === null) return;
    const OnKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < entries.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", OnKey);
    return () => window.removeEventListener("keydown", OnKey);
  }, [index, entries.length, onIndexChange]);

  if (!entry || index === null) return null;
  const kind = KindOf(entry);
  const inlineUrl = urlFor(entry, true);

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()} variant="opaque" className="bg-black/95! backdrop-blur-sm">
      <Modal.Container size="full" className="p-0!">
        <Modal.Dialog className="flex h-dvh max-h-dvh! flex-col gap-0 rounded-none! bg-transparent! p-0! text-white shadow-none!">
          <header className="flex items-center gap-3 px-4 py-3">
            <FileIcon name={entry.name} isDir={false} className="text-[22px]" />
            <div className="min-w-0 flex-1">
              <Modal.Heading className="truncate text-base font-medium text-white">{entry.name}</Modal.Heading>
              <p className="text-xs text-white/60 tabular-nums">
                {FormatBytes(entry.size)} · {index + 1} z {entries.length}
              </p>
            </div>
            <a
              href={urlFor(entry, false)}
              download
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
            >
              <Icon name="download" className="text-[18px]" />
              <span className="hidden sm:inline">Stáhnout</span>
            </a>
            <Button isIconOnly variant="ghost" aria-label="Zavřít náhled" onPress={onClose} className="text-white! hover:bg-white/10!">
              <Icon name="close" className="text-[22px]" />
            </Button>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
            {kind === "image" && <img src={inlineUrl} alt={entry.name} className="max-h-full max-w-full object-contain" />}
            {kind === "video" && (
              // biome-ignore lint/a11y/useMediaCaption: uživatelská videa titulky nemají
              <video key={inlineUrl} src={inlineUrl} controls autoPlay className="max-h-full max-w-full" />
            )}
            {kind === "audio" && (
              <div className="flex w-full max-w-md flex-col items-center gap-6">
                <Icon name="music_note" className="text-[96px] text-white/40" />
                {/* biome-ignore lint/a11y/useMediaCaption: hudba titulky nemá */}
                <audio key={inlineUrl} src={inlineUrl} controls autoPlay className="w-full" />
              </div>
            )}
            {kind === "pdf" && <iframe src={inlineUrl} title={entry.name} className="h-full w-full max-w-5xl rounded-xl bg-white" />}
            {kind === "text" && (
              <div className="flex h-full w-full max-w-5xl">
                <TextPreview url={inlineUrl} size={entry.size} />
              </div>
            )}

            {index > 0 && (
              <Button
                isIconOnly
                aria-label="Předchozí soubor"
                onPress={() => onIndexChange(index - 1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full! bg-white/10! text-white! hover:bg-white/20! sm:left-4"
              >
                <Icon name="chevron_left" className="text-[26px]" />
              </Button>
            )}
            {index < entries.length - 1 && (
              <Button
                isIconOnly
                aria-label="Další soubor"
                onPress={() => onIndexChange(index + 1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full! bg-white/10! text-white! hover:bg-white/20! sm:right-4"
              >
                <Icon name="chevron_right" className="text-[26px]" />
              </Button>
            )}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
