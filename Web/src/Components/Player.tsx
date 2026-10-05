"use client";

import { Button, Modal } from "@heroui/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

// Material Icons (Google), jako SVG — ostré v každé velikosti a bez čekání na font.
const ICONS = {
  previous: "M6 6h2v12H6zm3.5 6 8.5 6V6z",
  next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  volumeUp:
    "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  volumeDown: "M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z",
  volumeOff:
    "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
};

function Glyph({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d={d} />
    </svg>
  );
}

// Skladba ve frontě. URL dodává ten, kdo přehrávání spouští (přihlášený prohlížeč, veřejné sdílení…).
export interface Track {
  name: string;
  src: string;
  download: string;
  thumb?: string;
}

// Barvy pozadí, když skladba nemá obal (nebo se ho nepodaří přečíst).
const FALLBACK_COLORS = ["#d9302d", "#7b2cbf", "#1f4e79", "#3a0ca3"];
const VOLUME_KEY = "cloud.volume";

// 4 barvy z obalu pro mesh gradient: obal zmenšený na 2×2 px = průměrné barvy čtvrtin.
function useCoverColors(url: string | undefined) {
  const [colors, setColors] = useState(FALLBACK_COLORS);
  useEffect(() => {
    if (!url) return setColors(FALLBACK_COLORS);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 2, 2);
      const data = context.getImageData(0, 0, 2, 2).data;
      setColors([0, 1, 2, 3].map((i) => `rgb(${data[i * 4]} ${data[i * 4 + 1]} ${data[i * 4 + 2]})`));
    };
    image.onerror = () => setColors(FALLBACK_COLORS);
    image.src = url;
  }, [url]);
  return colors;
}

const FormatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// "01 BREED.flac" -> "01 BREED"
const TrackTitle = (name: string) => name.slice(name.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

interface Tags {
  title?: string;
  artist?: string;
  album?: string;
}

// Tagy mají stejnou URL jako náhled, jen /tags místo /thumb (přihlášený prohlížeč i veřejné sdílení).
const TagsUrl = (thumb: string) => thumb.replace("/thumb?", "/tags?");
// Mezi otevřeními se tagy pamatují — ffprobe na serveru je cachovaný, ale request ne.
const tagsCache = new Map<string, Tags>();

// Tagy všech skladeb ve frontě (název, interpret, album). Dokud nedorazí, zobrazuje se název souboru.
function useTags(queue: Track[]) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    for (const track of queue) {
      if (!track.thumb) continue;
      const url = TagsUrl(track.thumb);
      if (tagsCache.has(url)) continue;
      tagsCache.set(url, {});
      ApiFetch<Tags>(url).then((result) => {
        if (!result.ok) return;
        tagsCache.set(url, result.body);
        if (!cancelled) setVersion((v) => v + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [queue]);
  return (track: Track | undefined): Tags => (track?.thumb ? (tagsCache.get(TagsUrl(track.thumb)) ?? {}) : {});
}

// "Interpret · Album", prázdné části vynechané; nic = null (řádek se nezobrazí).
const Byline = (tags: Tags) => [tags.artist, tags.album].filter(Boolean).join(" · ") || null;

function Cover({ url, className }: { url?: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className={`grid place-items-center bg-white/10 ${className}`}>
        <Icon name="music_note" className="text-[40%] text-white/60" />
      </div>
    );
  }
  return <img src={url} alt="" draggable={false} onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

// Posuvník (pozice ve skladbě, hlasitost) — vyplněná část přes CSS proměnnou --fill.
function Range({ value, max, onChange, label, className = "" }: { value: number; max: number; onChange: (value: number) => void; label: string; className?: string }) {
  const fill = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step="any"
      value={value}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`player-range ${className}`}
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
    />
  );
}

const PlayerContext = createContext<{ Play: (queue: Track[], index: number) => void; Stop: () => void }>({ Play: () => {}, Stop: () => {} });
export const usePlayer = () => useContext(PlayerContext);

// Přehrávač hudby pro celou appku: jeden <audio> (mezi skladbami se jen mění src), přes celou obrazovku
// s obalem, mesh gradientem a frontou. Zavření nechá hrát dál a přehrávač se schová do lišty dole.
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      return Number(localStorage.getItem(VOLUME_KEY) ?? 1);
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(false);

  const track = queue[index] as Track | undefined;
  const tagsOf = useTags(queue);
  const tags = tagsOf(track);
  const title = tags.title ?? (track ? TrackTitle(track.name) : "");
  const byline = Byline(tags);
  const colors = useCoverColors(track?.thumb);

  const Play = useCallback((next: Track[], at: number) => {
    setQueue(next);
    setIndex(at);
    setExpanded(true);
  }, []);
  const Stop = useCallback(() => {
    audio.current?.pause();
    setQueue([]);
    setExpanded(false);
  }, []);
  const api = useMemo(() => ({ Play, Stop }), [Play, Stop]);

  const Go = (offset: number) => {
    if (queue[index + offset]) setIndex(index + offset);
  };
  const Toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) element.play().catch(() => setPlaying(false));
    else element.pause();
  };
  // Jako v každém přehrávači: po pár sekundách "předchozí" vrací na začátek skladby.
  const Previous = () => {
    if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0;
    else Go(-1);
  };

  // Nová skladba: stejný element, nový zdroj a hned přehrát (spuštění je vždy po kliknutí uživatele).
  useEffect(() => {
    const element = audio.current;
    if (!element || !track) return;
    setError(false);
    setTime(0);
    setDuration(0);
    element.src = track.src;
    element.play().catch(() => setPlaying(false));
  }, [track?.src]);

  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = volume;
    audio.current.muted = muted;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  }, [volume, muted]);

  // Ovládání ze zamčené obrazovky mobilu, z hodinek a mediálních kláves.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: tags.artist ?? "",
      album: tags.album ?? "",
      artwork: track.thumb ? [{ src: new URL(track.thumb, window.location.href).href, sizes: "480x480", type: "image/webp" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => audio.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", index > 0 ? Previous : null);
    navigator.mediaSession.setActionHandler("nexttrack", index < queue.length - 1 ? () => Go(1) : null);
  });

  // Mezerník = play/pauza, šipky = posun o 10 s (jen v otevřeném přehrávači, jinde patří klávesy souborům).
  useEffect(() => {
    if (!expanded) return;
    const OnKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest?.("input, button, textarea")) return;
      const element = audio.current;
      if (!element) return;
      if (event.key === " ") Toggle();
      else if (event.key === "ArrowRight") element.currentTime = Math.min(element.duration || 0, element.currentTime + 10);
      else if (event.key === "ArrowLeft") element.currentTime = Math.max(0, element.currentTime - 10);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", OnKey);
    return () => window.removeEventListener("keydown", OnKey);
  });

  const Seek = (value: number) => {
    if (audio.current) audio.current.currentTime = value;
    setTime(value);
  };
  const volumeIcon = muted || volume === 0 ? ICONS.volumeOff : volume < 0.5 ? ICONS.volumeDown : ICONS.volumeUp;
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <PlayerContext value={api}>
      {children}

      {/* biome-ignore lint/a11y/useMediaCaption: hudba titulky nemá */}
      <audio
        ref={audio}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => (index < queue.length - 1 ? Go(1) : setPlaying(false))}
        onError={() => track && setError(true)}
      />

      {track && expanded && (
        <Modal.Backdrop isOpen onOpenChange={(open) => !open && setExpanded(false)} variant="opaque" className="bg-black!">
          <Modal.Container size="full" className="p-0!">
            <Modal.Dialog className="isolate flex h-dvh max-h-dvh! flex-col gap-0 rounded-none! bg-transparent! p-0! text-white shadow-none!">
              {/* Mesh gradient přes celou obrazovku; při pauze se zastaví. */}
              <div className="mesh fixed inset-0 -z-10 overflow-hidden bg-black" data-paused={playing ? undefined : ""} aria-hidden>
                {colors.map((color, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 4 pevné skvrny
                  <span key={i} className={`mesh-blob mesh-blob-${i}`} style={{ backgroundColor: color }} />
                ))}
                <div className="absolute inset-0 bg-black/35" />
              </div>

              <header className="flex items-center gap-3 px-4 py-3">
                <Icon name="music_note" className="text-[22px] text-white/70" />
                <Modal.Heading className="min-w-0 flex-1 truncate text-base font-medium text-white">{track.name}</Modal.Heading>
                <a
                  href={track.download}
                  download
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Icon name="download" className="text-[18px]" />
                  <span className="hidden sm:inline">{t("Download", "Stáhnout")}</span>
                </a>
                <Button isIconOnly variant="ghost" aria-label={t("Close player (music keeps playing)", "Zavřít přehrávač (hudba hraje dál)")} onPress={() => setExpanded(false)} className="text-white! hover:bg-white/10!">
                  <Icon name="close" className="text-[22px]" />
                </Button>
              </header>

              <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
                <div className="flex h-full w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-center">
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-10">
                    <div
                      className={`aspect-square w-[min(72vw,42dvh,26rem)] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        playing ? "scale-100" : "scale-[0.8]"
                      }`}
                    >
                      <Cover
                        key={track.thumb}
                        url={track.thumb}
                        className={`size-full rounded-2xl transition-shadow duration-700 ${playing ? "shadow-[0_20px_50px_rgb(0_0_0/0.45)]" : "shadow-[0_12px_30px_rgb(0_0_0/0.35)]"}`}
                      />
                    </div>

                    <div className="flex w-full max-w-md flex-col gap-4">
                      <div className="min-w-0 text-center">
                        <p className="truncate text-xl font-semibold" title={track.name}>
                          {title}
                        </p>
                        {error ? (
                          <p className="text-sm text-white/60">{t("Your browser can't play this format. Download it instead.", "Tenhle formát prohlížeč neumí přehrát. Stáhni si ho.")}</p>
                        ) : (
                          byline && <p className="truncate text-sm text-white/60">{byline}</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        <Range value={time} max={duration} label={t("Position", "Pozice")} onChange={Seek} />
                        <div className="flex justify-between text-xs text-white/60 tabular-nums">
                          <span>{FormatTime(time)}</span>
                          <span>-{FormatTime(Math.max(0, duration - time))}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-center gap-6">
                        <button type="button" onClick={Previous} aria-label={t("Previous", "Předchozí")} className="player-button size-14">
                          <Glyph d={ICONS.previous} className="size-9" />
                        </button>
                        <button
                          type="button"
                          onClick={Toggle}
                          aria-label={playing ? t("Pause", "Pauza") : t("Play", "Přehrát")}
                          className="grid size-16 place-items-center rounded-full bg-white text-black outline-none transition-transform hover:scale-105 active:scale-95 focus-visible:ring-4 focus-visible:ring-white/40"
                        >
                          <Glyph d={playing ? ICONS.pause : ICONS.play} className="size-9" />
                        </button>
                        <button type="button" onClick={() => Go(1)} disabled={index >= queue.length - 1} aria-label={t("Next", "Další")} className="player-button size-14">
                          <Glyph d={ICONS.next} className="size-9" />
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? t("Unmute", "Zapnout zvuk") : t("Mute", "Ztlumit")} className="player-button size-9">
                          <Glyph d={volumeIcon} className="size-6" />
                        </button>
                        <Range
                          value={muted ? 0 : volume}
                          max={1}
                          label={t("Volume", "Hlasitost")}
                          onChange={(value) => {
                            setVolume(value);
                            setMuted(false);
                          }}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>

                  {queue.length > 1 && (
                    <aside className="flex max-h-[32dvh] min-h-0 w-full flex-col rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-3xl backdrop-saturate-150 lg:max-h-[72dvh] lg:w-[26rem]">
                      <p className="px-5 pt-4 pb-2 text-sm font-semibold">
                        {t("Queue", "Fronta")} <span className="font-normal text-white/60">· {queue.length}</span>
                      </p>
                      <ol className="min-h-0 overflow-y-auto px-2 pb-2">
                        {queue.map((item, i) => {
                          const current = i === index;
                          const itemTags = tagsOf(item);
                          return (
                            <li key={item.src}>
                              <button
                                type="button"
                                onClick={() => (current ? Toggle() : setIndex(i))}
                                aria-current={current ? "true" : undefined}
                                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
                                  current ? "bg-white/15" : "hover:bg-white/10"
                                }`}
                              >
                                <Cover key={item.thumb} url={item.thumb} className="size-11 shrink-0 rounded-lg" />
                                <span className="min-w-0 flex-1">
                                  <span className={`block truncate text-sm ${current ? "font-semibold" : "text-white/85"}`}>{itemTags.title ?? TrackTitle(item.name)}</span>
                                  {itemTags.artist && <span className="block truncate text-xs text-white/55">{itemTags.artist}</span>}
                                </span>
                                {current ? (
                                  <span className="eq" data-paused={playing ? undefined : ""} aria-hidden>
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                ) : (
                                  <span className="w-5 text-right text-xs text-white/45 tabular-nums">{i + 1}</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    </aside>
                  )}
                </div>
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}

      {/* Po zavření hraje dál — malá lišta dole: klik na obal/název přehrávač zase otevře. */}
      {track && !expanded && (
        <div
          role="region"
          aria-label={t("Now playing", "Právě hraje")}
          className="fixed right-4 bottom-4 left-4 z-40 overflow-hidden rounded-2xl border border-border bg-overlay/90 text-overlay-foreground shadow-2xl backdrop-blur-xl sm:right-auto sm:w-[26rem] lg:left-[17rem]"
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("Open player", "Otevřít přehrávač")}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left outline-none hover:bg-default/60 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Cover key={track.thumb} url={track.thumb} className="size-11 shrink-0 rounded-lg bg-default!" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title}</span>
                {byline && <span className="block truncate text-xs text-muted">{byline}</span>}
              </span>
            </button>
            <button type="button" onClick={Toggle} aria-label={playing ? t("Pause", "Pauza") : t("Play", "Přehrát")} className="grid size-10 place-items-center rounded-full outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus">
              <Glyph d={playing ? ICONS.pause : ICONS.play} className="size-7" />
            </button>
            <button
              type="button"
              onClick={() => Go(1)}
              disabled={index >= queue.length - 1}
              aria-label={t("Next", "Další")}
              className="grid size-10 place-items-center rounded-full outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-35"
            >
              <Glyph d={ICONS.next} className="size-6" />
            </button>
            <button type="button" onClick={Stop} aria-label={t("Stop and close", "Zastavit a zavřít")} className="grid size-10 place-items-center rounded-full text-muted outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus">
              <Icon name="close" className="text-[20px]" />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-default">
            <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </PlayerContext>
  );
}
